#!/usr/bin/env node
// Waits for CI in one blocking call and prints a check only when its state
// changes, so waiting on a run costs one tool call instead of a poll loop.
//
//   pnpm ci:wait                     # the PR for the current branch
//   pnpm ci:wait 812 813 814         # a stack: every layer, one loop
//   pnpm ci:wait --interval 60 --timeout 90
//   pnpm ci:wait --required           # only required checks
//   pnpm ci:wait --json reports/ci.json
//
// Why this exists: asking `gh api .../jobs` again every 30 seconds inside an
// agent loop burns a model step per poll on a context that is already hundreds
// of thousands of tokens, and it re-reads the same job JSON every time. `gh`
// already knows how to block (`gh pr checks --watch`); this wraps it so one call
// covers a whole stack, prints state changes rather than repeated state, and
// hands back failing checks with their links.
//
// Exit codes: 0 every check passed or skipped, 1 a check failed, 2 still
// pending when the timeout expires, 3 `gh` could not be reached or the branch
// has no PR.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");

const BUCKETS = ["pass", "fail", "pending", "skipping", "cancel"];
// A red stack can fail every shard at once; name the first few and stop.
const MAX_LISTED_FAILURES = 12;

export function parseArguments(argv) {
  const options = { prs: [], interval: 30, timeout: 60, required: false, json: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--required") options.required = true;
    else if (argument === "--interval" || argument === "--timeout" || argument === "--json") {
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
      } else options.json = value;
      index += 1;
    } else if (/^\d+$/.test(argument)) options.prs.push(Number(argument));
    else throw new Error(`unknown argument: ${argument}; pass PR numbers, or none for the current branch`);
  }
  return options;
}

export function gh(args) {
  const child = spawn("gh", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((done) => {
    child.on("error", (error) => done({ code: 127, stdout: "", stderr: error.message }));
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
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
  return BUCKETS.filter((bucket) => summary.counts[bucket] > 0).map((bucket) => `${summary.counts[bucket]} ${bucket}`).join(" · ");
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
    const verdict = state.failed ? "FAIL" : state.pending ? "PENDING" : "pass";
    console.log(`${label(state.pr)}  ${verdict}  ${countsLine(state)}`);
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const stamp = () => new Date().toISOString().slice(11, 19);

// A wrong PR number or a missing scope is the caller's mistake: waiting the
// full timeout on it only wastes the caller's time. A blip in the network is
// not, so those keep the loop alive.
const TERMINAL_GH_ERROR = /could not resolve|no pull requests found|not found|authentication|permission|forbidden|enoent|spawn gh/i;

async function fetchChecks(pr, required) {
  const args = ["pr", "checks"];
  if (pr !== null) args.push(String(pr));
  if (required) args.push("--required");
  args.push("--json", "bucket,name,link");
  const result = await gh(args);
  // Exit 8 means "checks pending" and still carries the JSON body.
  if (result.code === 8) return { checks: parseChecks(result.stdout) };
  if (result.code !== 0) {
    const message = result.stderr.trim() || `gh pr checks exited ${result.code}`;
    return { error: message, terminal: TERMINAL_GH_ERROR.test(message), checks: null };
  }
  const checks = parseChecks(result.stdout);
  if (checks === null) return { error: "gh pr checks returned output this script could not read", checks: null };
  return { checks };
}

export async function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(`usage: pnpm ci:wait [pr...] [--interval <seconds>] [--timeout <minutes>] [--required] [--json <path>]`);
    return 0;
  }
  const prs = options.prs.length > 0 ? options.prs : [null];
  const deadline = Date.now() + options.timeout * 60_000;
  const seen = new Map();
  const final = new Map();
  const reported = new Set();
  let lastError = null;

  console.log(`waiting on ${prs.map(label).join(", ")} — every ${options.interval}s, up to ${options.timeout} min`);

  for (;;) {
    let allSettled = true;
    for (const pr of prs) {
      const { checks, error, terminal } = await fetchChecks(pr, options.required);
      if (error) {
        if (!reported.has(error)) {
          reported.add(error);
          lastError = `${label(pr)}: ${error}`;
          console.error(lastError);
        }
        allSettled = false;
        // Nothing will arrive for a PR that does not exist or is out of reach.
        if (terminal) return 3;
        continue;
      }
      if (checks === null) {
        allSettled = false;
        continue;
      }
      const state = summarize(checks);
      if (seen.get(pr) === undefined) printOpening(pr, state, stamp());
      else printChanges(pr, stateChanges(seen.get(pr), checks), stamp());
      if (state.failed && !reported.has(`${pr}:failed`)) {
        reported.add(`${pr}:failed`);
        printFailures(pr, state.failures);
      }
      seen.set(pr, checks);
      final.set(pr, { pr, checks, ...state });
      if (state.pending) allSettled = false;
    }
    if (allSettled) break;
    if (Date.now() >= deadline) {
      console.log(`\ntimeout after ${options.timeout} min; checks still pending`);
      break;
    }
    await sleep(options.interval * 1000);
  }

  printVerdict([...final.values()]);
  const pending = [...final.values()].some((state) => state.pending);
  const failed = [...final.values()].some((state) => state.failed);

  if (options.json) {
    const target = resolve(ROOT, options.json);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify({
      ranAt: new Date().toISOString(),
      error: lastError,
      pullRequests: [...final.values()],
    }, null, 2)}\n`);
    console.log(`\nrecord ${target}`);
  }
  if (failed) return 1;
  if (pending) return 2;
  // gh never came back with checks for any PR: the run's status is unknown.
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