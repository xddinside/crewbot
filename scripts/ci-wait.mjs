#!/usr/bin/env node
// Waits for CI in one blocking call and prints a check only when its state
// changes, so waiting on a run costs one tool call instead of a poll loop.
//
//   pnpm ci:wait                     # the PR for the current branch
//   pnpm ci:wait 812 813 814         # a stack: every layer, one loop
//   pnpm ci:wait --interval 60 --timeout 90
//   pnpm ci:wait --required           # only required checks
//   pnpm ci:wait --repo other/repo    # watch somewhere other than origin
//   pnpm ci:wait --json reports/ci.json
//
// Why this exists: asking `gh api .../jobs` again every 30 seconds inside an
// agent loop burns a model step per poll on a context that is already hundreds
// of thousands of tokens, and it re-reads the same job JSON every time. `gh`
// already knows how to block (`gh pr checks --watch`); this wraps it so one call
// covers a whole stack, prints state changes rather than repeated state, and
// hands back failing checks with their links.
//
// Repository choice is explicit for the whole wait: every `gh pr checks` call
// carries `--repo`, taken from the origin remote unless `--repo` overrides it.
// A fork checkout has both remotes, and a bare pull request number means
// different things in each, so inferring the repository through `gh` can report
// a settled upstream run as this fork's pass.
//
// A pass is only a pass when the last poll of that pull request actually read
// it. A later failed fetch drops the earlier reading: an unreachable PR at the
// timeout is an unknown status, never a pass.
//
// Exit codes: 0 every check passed or skipped, 1 a check failed, 2 still
// pending when the timeout expires, 3 `gh` could not be reached, the branch has
// no PR, or some pull request never reported a check state.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");

const BUCKETS = ["pass", "fail", "pending", "skipping", "cancel"];
// A red stack can fail every shard at once; name the first few and stop.
const MAX_LISTED_FAILURES = 12;
const REPOSITORY_SLUG = /^[\w.-]+\/[\w.-]+$/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
// Only github.com is read out of a remote. A self-hosted forge or a local path
// is not reinterpreted as a GitHub repository; `--repo` names those explicitly.
const GITHUB_HOSTS = new Set(["github.com"]);

export function parseArguments(argv) {
  const options = { prs: [], interval: 30, timeout: 60, required: false, repo: null, json: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--required") options.required = true;
    else if (argument === "--interval" || argument === "--timeout" || argument === "--json" || argument === "--repo") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} needs a value`);
      if (argument === "--interval") {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds < 5) throw new Error("--interval needs at least 5 seconds");
        options.interval = seconds;
      } else if (argument === "--timeout") {
        const minutes = Number(value);
        if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("--timeout needs a positive number of minutes");
        options.timeout = minutes;
      } else if (argument === "--repo") {
        const slug = parseRepositorySlug(value);
        if (slug === null) throw new Error(`--repo needs owner/name, not ${value}`);
        options.repo = slug;
      } else options.json = value;
      index += 1;
    } else if (/^\d+$/.test(argument)) options.prs.push(Number(argument));
    else throw new Error(`unknown argument: ${argument}; pass PR numbers, or none for the current branch`);
  }
  return options;
}

/**
 * Reduce a value to the `owner/name` slug `gh` expects.
 *
 * @param {unknown} value - A candidate repository reference, such as an argument or a remote URL.
 * @returns {string | null} The slug, or `null` when the value is not `owner/name`.
 */
export function parseRepositorySlug(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return REPOSITORY_SLUG.test(trimmed) ? trimmed : null;
}

// Split a git remote into its host and path. Credentials are dropped here, so
// no message built from a remote can echo a token.
function splitRemote(url) {
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (trimmed === "") return null;
  const withoutScheme = trimmed.replace(URL_SCHEME, "");
  const at = withoutScheme.indexOf("@");
  const withoutCredentials = at === -1 ? withoutScheme : withoutScheme.slice(at + 1);
  // git@github.com:owner/name.git is scp syntax: host, colon, path. A URL spells
  // the same remote with a scheme and slashes.
  const scp = /^([^:/]+):(?!\/\/)(.+)$/.exec(withoutCredentials);
  if (scp !== null) return { host: scp[1], path: scp[2] };
  const slash = withoutCredentials.indexOf("/");
  return slash === -1
    ? { host: withoutCredentials, path: "" }
    : { host: withoutCredentials.slice(0, slash), path: withoutCredentials.slice(slash + 1) };
}

/**
 * Read a GitHub repository slug out of a git remote URL.
 *
 * @param {unknown} url - A remote URL or scp-style remote.
 * @returns {string | null} The `owner/name` slug, or `null` when the remote does not name a repository on github.com.
 */
export function parseGitHubRemote(url) {
  const remote = splitRemote(url);
  if (remote === null || !GITHUB_HOSTS.has(remote.host.toLowerCase())) return null;
  const parts = remote.path.split("/").filter((part) => part !== "");
  // Exactly owner/name. A deeper path is a different repository than its last
  // two segments, so it is refused rather than guessed at.
  if (parts.length !== 2) return null;
  return parseRepositorySlug(`${parts[0]}/${parts[1].replace(/\.git$/i, "")}`);
}

function gitRemoteUrl(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/**
 * Choose the repository every `gh pr checks` call in a wait names.
 *
 * @param {object} [options] - Resolution inputs.
 * @param {string | null} [options.explicit] - A caller-supplied `owner/name`, or `null` to read the origin remote.
 * @param {(args: string[]) => string | null} [options.runGit] - Git reader seam; the composition root passes the real git.
 * @returns {{ repository: string, source: string } | { error: string }} The chosen repository, or a message that names no credentials.
 */
export function resolveRepository({ explicit = null, runGit = gitRemoteUrl } = {}) {
  if (explicit !== null) {
    const slug = parseRepositorySlug(explicit);
    return slug === null
      ? { error: `--repo needs owner/name, not ${explicit}` }
      : { repository: slug, source: "argument" };
  }
  const url = runGit(["remote", "get-url", "origin"]);
  if (url === null) return { error: "no origin remote to name a repository; pass --repo owner/name" };
  const slug = parseGitHubRemote(url);
  if (slug !== null) return { repository: slug, source: "origin" };
  // A remote URL can carry a token, so the message names its host, not the URL.
  const host = splitRemote(url)?.host ?? "";
  if (host === "") return { error: "origin is not a remote this script can read; pass --repo owner/name" };
  return GITHUB_HOSTS.has(host.toLowerCase())
    ? { error: `origin does not name owner/name on ${host}; pass --repo owner/name` }
    : { error: `origin points at ${host}, which is not github.com; pass --repo owner/name` };
}

export function gh(args) {
  const child = spawn("gh", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((done) => {
    // A missing `gh` emits both events; settling twice would resolve with a
    // second, less informative answer.
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      done(result);
    };
    child.on("error", (error) => settle({ code: 127, stdout: "", stderr: error.message }));
    child.on("close", (code) => settle({ code: code ?? 1, stdout, stderr }));
  });
}

export function parseChecks(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.map((check) => ({
    name: String(check.name ?? "?"),
    bucket: BUCKETS.includes(check.bucket) ? check.bucket : "pending",
    link: typeof check.link === "string" ? check.link : null,
  }));
}

// A state change is what a reader needs; a repeat of the same bucket is noise.
export function stateChanges(previous, next) {
  const before = new Map((previous ?? []).map((check) => [check.name, check.bucket]));
  return next.filter((check) => before.get(check.name) !== check.bucket);
}

export function summarize(checks) {
  const counts = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0]));
  for (const check of checks) counts[check.bucket] += 1;
  return {
    counts,
    pending: counts.pending > 0,
    failed: counts.fail > 0 || counts.cancel > 0,
    failures: checks.filter((check) => check.bucket === "fail" || check.bucket === "cancel"),
  };
}

export function countsLine(summary) {
  const line = BUCKETS.filter((bucket) => summary.counts[bucket] > 0).map((bucket) => `${summary.counts[bucket]} ${bucket}`).join(" · ");
  return line === "" ? "no checks read" : line;
}

/**
 * Counters for a pull request that reported no check at all.
 *
 * @returns {Record<string, number>} One zero per bucket.
 */
export function emptyCounts() {
  return Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0]));
}

const label = (pr) => (pr === null ? "current branch" : `#${pr}`);

// The opening line is a tally, not the roster: a settled pull request has ~26
// checks and none of them need repeating.
export function printOpening(pr, summary, at) {
  console.log(`${at} ${label(pr)}  ${countsLine(summary)}`);
}

export function printChanges(pr, changes, at) {
  if (changes.length === 0) return;
  console.log(`\n${at} ${label(pr)}`);
  for (const check of changes) console.log(`  ${check.bucket.padEnd(8)} ${check.name}${check.link ? `  ${check.link}` : ""}`);
}

export function printFailures(pr, failures) {
  if (failures.length === 0) return;
  console.log(`\nfailed on ${label(pr)} — open the run log, do not re-poll:`);
  for (const failure of failures.slice(0, MAX_LISTED_FAILURES)) console.log(`  ${failure.name}${failure.link ? `  ${failure.link}` : ""}`);
  if (failures.length > MAX_LISTED_FAILURES) console.log(`  ...and ${failures.length - MAX_LISTED_FAILURES} more`);
}

export function printVerdict(states) {
  if (states.length === 0) return;
  console.log("");
  for (const state of states) {
    const verdict = state.failed ? "FAIL" : state.unknown ? "UNKNOWN" : state.pending ? "PENDING" : "pass";
    console.log(`${label(state.pr)}  ${verdict}  ${countsLine(state)}`);
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const stamp = () => new Date().toISOString().slice(11, 19);

// A wrong PR number or a missing scope is the caller's mistake: waiting the
// full timeout on it only wastes the caller's time. A blip in the network is
// not, so those keep the loop alive.
const TERMINAL_GH_ERROR = /could not resolve|no pull requests found|not found|authentication|permission|forbidden|enoent|spawn gh/i;

//   | { _tag: "observed"; checks: ParsedCheck[] }
//   | { _tag: "unreadable"; error: string; terminal: boolean }
async function fetchChecks(pr, { required, repository }) {
  const args = ["pr", "checks"];
  if (pr !== null) args.push(String(pr));
  if (required) args.push("--required");
  // Never let gh pick the repository: in a fork checkout the same PR number
  // names a different pull request in each remote.
  args.push("--repo", repository, "--json", "bucket,name,link");
  const result = await gh(args);
  const unreadable = (error, terminal = false) => ({ _tag: "unreadable", error, terminal });
  // Exit 8 means "checks pending" and still carries the JSON body.
  if (result.code === 8) {
    const carrying = parseChecks(result.stdout);
    return carrying === null || carrying.length === 0 ? unreadable("gh pr checks returned output this script could not read") : { _tag: "observed", checks: carrying };
  }
  if (result.code !== 0) {
    const message = result.stderr.trim() || `gh pr checks exited ${result.code}`;
    return unreadable(message, TERMINAL_GH_ERROR.test(message));
  }
  const checks = parseChecks(result.stdout);
  // An empty list settles nothing, and a wait that treated it as settled would
  // print a pass for a pull request it never saw a check on.
  if (checks === null || checks.length === 0) return unreadable("gh pr checks returned output this script could not read");
  return { _tag: "observed", checks };
}

export async function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(`usage: pnpm ci:wait [pr...] [--interval <seconds>] [--timeout <minutes>] [--required] [--repo <owner/name>] [--json <path>]`);
    return 0;
  }
  const chosen = resolveRepository({ explicit: options.repo });
  if (chosen.error !== undefined) {
    console.error(chosen.error);
    return 3;
  }
  const prs = options.prs.length > 0 ? options.prs : [null];
  const deadline = Date.now() + options.timeout * 60_000;
  const seen = new Map();
  // Only the newest successful reading of a pull request lives here; a poll
  // that cannot read one deletes its entry rather than leaving a stale pass.
  const final = new Map();
  const unresolved = new Map();
  const reported = new Set();
  let lastError = null;

  console.log(`waiting on ${prs.map(label).join(", ")} in ${chosen.repository} (from ${chosen.source}) — every ${options.interval}s, up to ${options.timeout} min`);

  for (;;) {
    let allSettled = true;
    for (const pr of prs) {
      const outcome = await fetchChecks(pr, { required: options.required, repository: chosen.repository });
      if (outcome._tag === "unreadable") {
        // The last good reading of this PR is no longer current.
        final.delete(pr);
        unresolved.set(pr, outcome.error);
        if (!reported.has(outcome.error)) {
          reported.add(outcome.error);
          lastError = `${label(pr)}: ${outcome.error}`;
          console.error(lastError);
        }
        allSettled = false;
        // Nothing will arrive for a PR that does not exist or is out of reach.
        if (outcome.terminal) return 3;
        continue;
      }
      unresolved.delete(pr);
      const state = summarize(outcome.checks);
      if (seen.get(pr) === undefined) printOpening(pr, state, stamp());
      else printChanges(pr, stateChanges(seen.get(pr), outcome.checks), stamp());
      if (state.failed && !reported.has(`${pr}:failed`)) {
        reported.add(`${pr}:failed`);
        printFailures(pr, state.failures);
      }
      seen.set(pr, outcome.checks);
      final.set(pr, { pr, checks: outcome.checks, ...state });
      if (state.pending) allSettled = false;
    }
    if (allSettled) break;
    if (Date.now() >= deadline) {
      console.log(`\ntimeout after ${options.timeout} min`);
      if (unresolved.size > 0) console.log(`${unresolved.size} pull request never reported a check state: ${[...unresolved.keys()].map(label).join(", ")}`);
      break;
    }
    await sleep(options.interval * 1000);
  }

  // A requested pull request with no current reading appears in the verdict as
  // unknown rather than being left out of the tally altogether.
  const states = prs.map((pr) => final.get(pr) ?? { pr, checks: [], counts: emptyCounts(), pending: false, failed: false, unknown: true });
  printVerdict(states);
  const pending = states.some((state) => state.pending);
  const failed = states.some((state) => state.failed);

  if (options.json) {
    const target = resolve(ROOT, options.json);
    mkdirSync(dirname(target), { recursive: true });
    // Every requested pull request appears, including the ones this run could
    // not read: a record that silently omits a layer of a stack is the same
    // false success as an exit code of 0.
    writeFileSync(target, `${JSON.stringify({
      ranAt: new Date().toISOString(),
      repository: chosen.repository,
      error: lastError,
      pullRequests: states.map((state) => ({
        pr: state.pr,
        status: state.unknown ? "unknown" : state.failed ? "fail" : state.pending ? "pending" : "pass",
        error: state.unknown ? unresolved.get(state.pr) ?? "no check state read" : null,
        checks: state.checks,
        counts: state.counts,
        pending: state.pending,
        failed: state.failed,
      })),
    }, null, 2)}\n`);
    console.log(`\nrecord ${target}`);
  }
  if (failed) return 1;
  if (pending) return 2;
  // gh never came back with current checks for some requested PR: that run's
  // status is unknown, whatever an earlier poll of it said.
  if (unresolved.size > 0) return 3;
  if (final.size === 0) return 3;
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 3;
  }
}