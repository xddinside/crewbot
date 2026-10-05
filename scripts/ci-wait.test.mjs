import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  countsLine,
  parseArguments,
  parseChecks,
  parseGitHubRemote,
  printOpening,
  printVerdict,
  resolveRepository,
  stateChanges,
  summarize,
} from "./ci-wait.mjs";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "ci-wait.mjs");
const scratch = mkdtempSync(join(tmpdir(), "omb-ci-wait-"));
const binDirectory = join(scratch, "bin");
mkdirSync(binDirectory);

// A `gh` this test controls, so the script runs against a real subprocess
// rather than a replaced module. It answers per repository and pull request, so
// a call that forgot `--repo` lands somewhere else and says so.
const STUB = `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const log = process.env.GH_STUB_LOG;

const keyOf = (call) => {
  const at = call.indexOf("--repo");
  return \`\${at === -1 ? "" : call[at + 1]}#\${call.find((value) => /^\\d+$/.test(value)) ?? "current"}\`;
};
const key = keyOf(argv);
const rules = JSON.parse(readFileSync(process.env.GH_STUB_RULES, "utf8"));
const scripted = rules[key] ?? rules.default;
if (scripted === undefined) {
  process.stderr.write(\`no stub rule for \${key}\\n\`);
  process.exit(1);
}
// Count the calls that already happened before recording this one, so the
// first scripted response belongs to the first call.
const previous = (log === undefined ? "" : readFileSync(log, "utf8")).split("\\n").filter(Boolean).map((line) => JSON.parse(line));
const used = previous.filter((call) => keyOf(call.argv) === key).length;
const served = Array.isArray(scripted) ? Math.min(used, scripted.length - 1) : 0;
// The record names which scripted response answered, so a test can prove which
// round of a scripted sequence it actually watched.
if (log !== undefined) appendFileSync(log, \`\${JSON.stringify({ argv, served })}\\n\`);
const response = Array.isArray(scripted) ? scripted[served] : scripted;
if (response.stdout !== undefined) process.stdout.write(response.stdout);
if (response.stderr !== undefined) process.stderr.write(response.stderr);
process.exit(response.code ?? 0);
`;

let callCounter = 0;
beforeAll(() => writeFileSync(join(binDirectory, "gh"), STUB, { mode: 0o755 }));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function writeStubRules(rules) {
  callCounter += 1;
  const path = join(scratch, `rules-${callCounter}.json`);
  writeFileSync(path, JSON.stringify(rules));
  return path;
}

function runScript(args, rules, timeoutMs = 20_000) {
  const logPath = join(scratch, `calls-${callCounter}.log`);
  writeFileSync(logPath, "");
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH}`, GH_STUB_RULES: rules, GH_STUB_LOG: logPath },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", logPath };
}

const stubRounds = (run) => readFileSync(run.logPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const stubCalls = (run) => stubRounds(run).map((round) => round.argv);
// Which scripted responses the pull request actually received, in order.
const servedFor = (run, pr) => stubRounds(run).filter((round) => round.argv.includes(pr)).map((round) => round.served);

const checks = (bucket) => JSON.stringify([{ name: `check ${bucket}`, bucket, link: null }]);
const passing = { code: 0, stdout: checks("pass") };
const pending = { code: 8, stdout: checks("pending") };
const failing = { code: 8, stdout: checks("fail") };

// One polling round, then the deadline is already behind the run: no test here
// waits on the real interval unless it means to.
const ONE_ROUND = "0.000001";

// The repository this checkout's origin names, so the exit-code tests below
// exercise the documented outcomes without leaning on the new `--repo` flag.
// Read on first use rather than at import, so importing this file touches no
// git checkout.
let originSlug = null;
function origin() {
  if (originSlug === null) originSlug = parseGitHubRemote(execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim());
  return originSlug;
}

const threeChecks = JSON.stringify([
  { name: "typecheck + lint", bucket: "pass", link: "https://example.test/1" },
  { name: "vitest (ubuntu, shard 2/4)", bucket: "pending", link: "https://example.test/2" },
  { name: "packaged server smoke (ubuntu)", bucket: "skipping", link: null },
]);

const withShardFailed = JSON.stringify([
  { name: "typecheck + lint", bucket: "pass", link: "https://example.test/1" },
  { name: "vitest (ubuntu, shard 2/4)", bucket: "fail", link: "https://example.test/2" },
  { name: "packaged server smoke (ubuntu)", bucket: "skipping", link: null },
]);

describe("ci-wait.mjs arguments", () => {
  it("defaults to the current branch on a 30 second cadence", () => {
    const options = parseArguments([]);
    expect(options.prs).toEqual([]);
    expect(options.interval).toBe(30);
    expect(options.timeout).toBe(60);
    expect(options.required).toBe(false);
    expect(options.repo).toBeNull();
  });

  it("reads a stack of pull requests", () => {
    expect(parseArguments(["812", "813"]).prs).toEqual([812, 813]);
    expect(parseArguments(["--repo", "xddinside/crewbot"]).repo).toBe("xddinside/crewbot");
  });

  it("refuses a cadence faster than five seconds", () => {
    expect(() => parseArguments(["--interval", "1"])).toThrow(/at least 5 seconds/);
    expect(() => parseArguments(["--interval", "abc"])).toThrow(/at least 5 seconds/);
    expect(() => parseArguments(["--timeout", "0"])).toThrow(/positive number of minutes/);
    expect(() => parseArguments(["--repo", "crewbot"])).toThrow(/--repo needs owner\/name, not crewbot/);
    expect(() => parseArguments(["812", "--verbose"])).toThrow(/unknown argument: --verbose/);
  });
});

describe("ci-wait.mjs check state", () => {
  it("reads gh's buckets and holds an unknown one as pending", () => {
    expect(parseChecks(threeChecks)?.map((check) => check.bucket)).toEqual(["pass", "pending", "skipping"]);
    expect(parseChecks(JSON.stringify([{ name: "odd", bucket: "weird" }]))?.[0].bucket).toBe("pending");
  });

  it("reports unreadable output rather than guessing at it", () => {
    expect(parseChecks("")).toBeNull();
    expect(parseChecks("{}")).toBeNull();
  });

  it("reports only what moved, so an unchanged poll says nothing", () => {
    const first = parseChecks(threeChecks);
    expect(stateChanges(undefined, first)).toHaveLength(3);
    expect(stateChanges(first, parseChecks(threeChecks))).toEqual([]);
    expect(stateChanges(first, parseChecks(withShardFailed))).toEqual([
      { name: "vitest (ubuntu, shard 2/4)", bucket: "fail", link: "https://example.test/2" },
    ]);
  });

  it("separates a red run from a run that is still going", () => {
    const waiting = summarize(parseChecks(threeChecks));
    expect(waiting.counts).toMatchObject({ pass: 1, fail: 0, pending: 1, skipping: 1 });
    expect(waiting.pending).toBe(true);
    expect(waiting.failed).toBe(false);

    const red = summarize(parseChecks(JSON.stringify([{ name: "x", bucket: "fail" }, { name: "y", bucket: "cancel" }])));
    expect(red.failed).toBe(true);
    expect(red.pending).toBe(false);
    expect(red.failures.map((check) => check.name)).toEqual(["x", "y"]);
  });

  it("tallies buckets instead of listing them, so a settled stack stays short", () => {
    expect(countsLine(summarize(parseChecks(threeChecks)))).toBe("1 pass · 1 pending · 1 skipping");
  });
});

describe("ci-wait.mjs output", () => {
  function captureLog(run) {
    const lines = [];
    const original = console.log;
    console.log = (line) => lines.push(line);
    try {
      run();
    } finally {
      console.log = original;
    }
    return lines;
  }

  it("opens a pull request with one tally line, not its roster", () => {
    const many = Array.from({ length: 26 }, (_, index) => ({ name: `check ${index}`, bucket: "pass" }));
    const lines = captureLog(() => printOpening(2129, summarize(many), "12:00:00"));
    expect(lines).toEqual(["12:00:00 #2129  26 pass"]);
  });

  it("names the pull request for the current branch", () => {
    const lines = captureLog(() => printOpening(null, summarize(parseChecks(threeChecks)), "12:00:00"));
    expect(lines[0]).toContain("current branch");
  });

  it("ends with one verdict per pull request", () => {
    const lines = captureLog(() => printVerdict([
      { pr: 8, failed: true, pending: false, counts: { pass: 24, fail: 1, pending: 0, skipping: 1, cancel: 0 } },
      { pr: 9, failed: false, pending: true, counts: { pass: 24, fail: 0, pending: 1, skipping: 1, cancel: 0 } },
    ]));
    expect(lines.filter((line) => line !== "")).toEqual([
      "#8  FAIL  24 pass · 1 fail · 1 skipping",
      "#9  PENDING  24 pass · 1 pending · 1 skipping",
    ]);
  });
});
describe("ci-wait.mjs repository choice", () => {
  it("names the origin repository rather than letting gh infer one", async () => {
    expect(origin()).not.toBeNull();

    const rules = writeStubRules({ [`${origin()}#17`]: [passing] });
    const run = await runScript(["17", "--interval", "5", "--timeout", ONE_ROUND], rules);

    expect(run.status).toBe(0);
    for (const call of stubCalls(run)) {
      expect(call).toContain("--repo");
      expect(call[call.indexOf("--repo") + 1]).toBe(origin());
    }
  });

  it("takes an explicit override for every call in the wait", async () => {
    const rules = writeStubRules({ "fork/crewbot#17": [passing] });
    const run = await runScript(["17", "--repo", "fork/crewbot", "--interval", "5", "--timeout", ONE_ROUND], rules);

    expect(run.status).toBe(0);
    expect(stubCalls(run).every((call) => call[call.indexOf("--repo") + 1] === "fork/crewbot")).toBe(true);
  });

  it("cannot read a pass out of the wrong repository", async () => {
    // The upstream remote answers with a settled run; this fork does not carry
    // that pull request at all. Asking for upstream by number must not pass.
    const rules = writeStubRules({
      ["upstream/openmausbot#17"]: [passing],
      default: { code: 1, stderr: "could not resolve to a Repository with the name 'fork/crewbot'" },
    });
    const run = await runScript(["17", "--repo", "fork/crewbot", "--interval", "5", "--timeout", ONE_ROUND], rules);

    expect(run.status).toBe(3);
    expect(run.stdout).not.toMatch(/^#17 {2}pass/m);
    expect(run.stderr).toMatch(/could not resolve/);
  });

  it("records which repository the record covers", async () => {
    const rules = writeStubRules({ "fork/crewbot#17": [passing] });
    const record = join(scratch, "repo.json");
    const run = await runScript(["17", "--repo", "fork/crewbot", "--interval", "5", "--timeout", ONE_ROUND, "--json", record], rules);

    expect(run.status).toBe(0);
    expect(JSON.parse(readFileSync(record, "utf8")).repository).toBe("fork/crewbot");
  });

  it("rejects a --repo that is not owner/name, before calling gh", async () => {
    const run = await runScript(["--repo", "not-a-slug"], writeStubRules({}));
    expect(run.status).toBe(3);
    expect(run.stderr).toMatch(/--repo needs owner\/name/);
    expect(stubCalls(run)).toEqual([]);
  });

  it("reads origin through git, so a fork's own remote wins over upstream", () => {
    const resolved = resolveRepository({
      runGit: () => "git@github.com:someone-else/crewbot.git",
    });
    expect(resolved).toEqual({ repository: "someone-else/crewbot", source: "origin" });
  });

  it("says so instead of guessing when there is no origin to read", () => {
    expect(resolveRepository({ runGit: () => null })).toEqual({
      error: "no origin remote to name a repository; pass --repo owner/name",
    });
    expect(resolveRepository({ runGit: () => "/srv/git/crewbot.git" })).toEqual({
      error: "origin is not a remote this script can read; pass --repo owner/name",
    });
    expect(resolveRepository({ runGit: () => "git@github.com:crewbot.git" }).error).toMatch(/does not name owner\/name on github.com/);
  });

  it("names the host it refused, and never the credentials in the URL", () => {
    const refused = resolveRepository({ runGit: () => "https://ghp_exampletokenvalue@github.enterprise.test/team/crewbot.git" });
    expect(refused.error).toBe("origin points at github.enterprise.test, which is not github.com; pass --repo owner/name");
    expect(refused.error).not.toMatch(/ghp_exampletokenvalue/);

    const refusedPath = resolveRepository({ runGit: () => "https://ghp_exampletokenvalue@git.example.test/team/crewbot" });
    expect(refusedPath.error).not.toMatch(/ghp_exampletokenvalue/);
  });

  it("reduces every github.com remote spelling gh understands to one slug", () => {
    expect(parseGitHubRemote("git@github.com:xddinside/crewbot.git")).toBe("xddinside/crewbot");
    expect(parseGitHubRemote("https://github.com/xddinside/crewbot")).toBe("xddinside/crewbot");
    expect(parseGitHubRemote("https://github.com/xddinside/crewbot.git")).toBe("xddinside/crewbot");
    expect(parseGitHubRemote("ssh://git@github.com/xddinside/crewbot.git")).toBe("xddinside/crewbot");
    expect(parseGitHubRemote("https://token@github.com/xddinside/crewbot.git")).toBe("xddinside/crewbot");
  });

  it("refuses to read a non-github remote as a GitHub repository", () => {
    // --repo is the supported way to name another host; a silent guess here is
    // how a wait ends up watching the wrong repository.
    expect(parseGitHubRemote("https://github.enterprise.test/team/crewbot.git")).toBeNull();
    expect(parseGitHubRemote("git@git.example.test:team/crewbot.git")).toBeNull();
    expect(parseGitHubRemote("git@gitlab.com:team/crewbot.git")).toBeNull();
    expect(parseGitHubRemote("/srv/git/crewbot.git")).toBeNull();
    expect(parseGitHubRemote("git@github.com:crewbot.git")).toBeNull();
    expect(parseGitHubRemote("")).toBeNull();
    expect(parseGitHubRemote(null)).toBeNull();
  });

  it("refuses a github.com path that is not exactly owner/name", () => {
    // github.com/xddinside/nested/crewbot is not the repository
    // nested/crewbot; reading its last two segments would watch a different
    // repository than the one origin names.
    expect(parseGitHubRemote("https://github.com/xddinside/nested/crewbot.git")).toBeNull();
    expect(parseGitHubRemote("git@github.com:xddinside/nested/crewbot.git")).toBeNull();
    expect(resolveRepository({ runGit: () => "git@github.com:xddinside/nested/crewbot.git" }).error).toMatch(
      /does not name owner\/name on github.com/,
    );
  });
});

describe("ci-wait.mjs partial observations", () => {
  it("does not pass a stack when one pull request never reported a check state", async () => {
    // PR 23 settles green, PR 24 stays unreachable. The old run exited 0 here,
    // reporting the stack's only successful reading as the whole stack's pass.
    const rules = writeStubRules({
      default: [{ code: 0, stdout: passing.stdout }],
      "fork/crewbot#24": [{ code: 1, stderr: "temporary network failure" }],
    });
    const record = join(scratch, "partial.json");
    const run = await runScript(["23", "24", "--repo", "fork/crewbot", "--interval", "5", "--timeout", ONE_ROUND, "--json", record], rules);

    expect(run.status).toBe(3);
    expect(run.stdout).toMatch(/#24 {2}UNKNOWN {2}no checks read/);
    const written = JSON.parse(readFileSync(record, "utf8"));
    // The unreadable layer is recorded, not dropped.
    expect(written.pullRequests).toEqual([
      { pr: 23, status: "pass", error: null, checks: parseChecks(passing.stdout), counts: { pass: 1, fail: 0, pending: 0, skipping: 0, cancel: 0 }, pending: false, failed: false },
      { pr: 24, status: "unknown", error: "temporary network failure", checks: [], counts: { pass: 0, fail: 0, pending: 0, skipping: 0, cancel: 0 }, pending: false, failed: false },
    ]);
    expect(written.error).toBe("#24: temporary network failure");
  });

  it("records every requested pull request, whatever state it reached", async () => {
    const rules = writeStubRules({
      [`${origin()}#23`]: [passing],
      [`${origin()}#24`]: [failing],
      [`${origin()}#25`]: [pending],
      [`${origin()}#26`]: [{ code: 1, stderr: "temporary network failure" }],
    });
    const record = join(scratch, "complete.json");
    const run = await runScript(["23", "24", "25", "26", "--interval", "5", "--timeout", ONE_ROUND, "--json", record], rules);

    expect(run.status).toBe(1);
    const written = JSON.parse(readFileSync(record, "utf8"));
    expect(written.pullRequests.map((entry) => [entry.pr, entry.status])).toEqual([
      [23, "pass"],
      [24, "fail"],
      [25, "pending"],
      [26, "unknown"],
    ]);
    expect(written.pullRequests.find((entry) => entry.pr === 26).error).toBe("temporary network failure");
    expect(written.pullRequests.find((entry) => entry.pr === 23).checks).toHaveLength(1);
  });

  it("drops a cached pass when a later poll of the same PR cannot be read", async () => {
    // Round one: #24 reads green and #23 keeps the loop open by still running.
    // Round two: #23 settles and #24 stops answering. #24 must not keep the
    // green reading it had a poll ago.
    const rules = writeStubRules({
      [`${origin()}#23`]: [pending, passing],
      [`${origin()}#24`]: [passing, { code: 1, stderr: "temporary network failure" }],
    });
    const record = join(scratch, "stale.json");
    const run = await runScript(["23", "24", "--interval", "5", "--timeout", "0.16", "--json", record], rules, 40_000);

    expect(run.status).toBe(3);
    expect(run.stdout).toMatch(/#24 {2}UNKNOWN {2}no checks read/);
    expect(run.stdout).not.toMatch(/#24 {2}pass/);
    expect(run.stdout).toMatch(/#23 {2}pass {2}1 pass/);
    // Both rounds really ran: #24 was read green once, then refused.
    expect(servedFor(run, "24")[0]).toBe(0);
    expect(servedFor(run, "24")[1]).toBe(1);
    expect(servedFor(run, "23")[0]).toBe(0);
    expect(servedFor(run, "23")[1]).toBe(1);
    // The record keeps no green reading for the pull request it could not read.
    const written = JSON.parse(readFileSync(record, "utf8"));
    expect(written.pullRequests.find((entry) => entry.pr === 24)).toEqual({
      pr: 24,
      status: "unknown",
      error: "temporary network failure",
      checks: [],
      counts: { pass: 0, fail: 0, pending: 0, skipping: 0, cancel: 0 },
      pending: false,
      failed: false,
    });
  });

  it("recovers a pass once a later poll reads it again", async () => {
    // Round one: #23 pending and #24 unreachable. Round two settles both, so a
    // wait that treated one transient failure as fatal would never pass here.
    const rules = writeStubRules({
      [`${origin()}#23`]: [pending, passing],
      [`${origin()}#24`]: [{ code: 1, stderr: "temporary network failure" }, passing],
    });
    const run = await runScript(["23", "24", "--interval", "5", "--timeout", "0.16"], rules, 40_000);

    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/#23 {2}pass {2}1 pass/);
    expect(run.stdout).toMatch(/#24 {2}pass {2}1 pass/);
    expect(run.stdout).not.toMatch(/UNKNOWN/);
    // The failure was really observed before the pass that recovered it.
    expect(run.stderr).toMatch(/#24: temporary network failure/);
    expect(servedFor(run, "24")).toEqual([0, 1]);
    expect(servedFor(run, "23")).toEqual([0, 1]);
  });

  it("keeps the documented outcome for a check that is still pending", async () => {
    const rules = writeStubRules({ [`${origin()}#24`]: [{ code: 8, stdout: pending.stdout }] });
    const run = await runScript(["24", "--interval", "5", "--timeout", ONE_ROUND], rules);

    expect(run.status).toBe(2);
    expect(run.stdout).toMatch(/#24 {2}PENDING {2}1 pending/);
  });

  it("keeps the documented outcome for a check that failed", async () => {
    const rules = writeStubRules({ [`${origin()}#24`]: [{ code: 8, stdout: failing.stdout }] });
    const run = await runScript(["24", "--interval", "5", "--timeout", ONE_ROUND], rules);

    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/#24 {2}FAIL {2}1 fail/);
  });

  it("stops at once when the repository itself is out of reach", async () => {
    const rules = writeStubRules({ default: { code: 1, stderr: "authentication failed" } });
    const run = await runScript(["24", "--interval", "5", "--timeout", "5"], rules);

    expect(run.status).toBe(3);
    expect(stubCalls(run)).toHaveLength(1);
  });

  it("passes only when every requested pull request was read green", async () => {
    const rules = writeStubRules({
      [`${origin()}#23`]: [passing],
      [`${origin()}#24`]: [passing],
    });
    const run = await runScript(["23", "24", "--interval", "5", "--timeout", ONE_ROUND], rules);

    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/#23 {2}pass {2}1 pass/);
    expect(run.stdout).toMatch(/#24 {2}pass {2}1 pass/);
  });
});
