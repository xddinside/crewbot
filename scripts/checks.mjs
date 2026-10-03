#!/usr/bin/env node
// Runs the static-check battery once and reports it in a form an agent can act
// on without reading whole logs: one line per check, a log path per check, and
// a JSON record tying the result to the exact tree it ran against.
//
//   pnpm checks                               # typecheck, lint, i18n, electron
//   pnpm checks --only lint i18n              # a subset
//   pnpm checks --keep-going                  # every check, not just up to the first failure
//   pnpm checks --json reports/checks.json    # also write the record there
//
// Why this exists: `pnpm typecheck`, `pnpm lint`, `pnpm i18n:check` and
// `pnpm check:electron` are four separate commands whose failure output is tens
// of kilobytes each. Run one at a time into a terminal, an agent re-reads the
// whole output and re-runs the battery on every iteration. Here each check
// streams to its own log, stdout stays bounded to a status line plus the tail of
// a failure, and the JSON record carries the command, exit code, seconds, log
// path and revision, so evidence holds while those inputs hold.
//
// The full `pnpm test` suite is deliberately absent. It runs its files serially
// on purpose and takes about 19 minutes; CI shards it four ways on Linux.
// Reproduce one shard locally with `pnpm exec vitest run --shard=n/4`.
import { spawn, execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");

// Mirrors the `typecheck + lint` job in .github/workflows/ci.yml, so a local run
// and that job cover the same ground.
export const CHECKS = [
  { name: "typecheck", command: ["pnpm", "run", "typecheck"] },
  { name: "lint", command: ["pnpm", "run", "lint"] },
  { name: "i18n", command: ["pnpm", "run", "i18n:check"] },
  { name: "electron", command: ["pnpm", "run", "check:electron"] },
];

// How much of a failing log reaches stdout: enough to see the first error and
// its file, not enough to flood the transcript.
const FAILURE_TAIL_LINES = 24;

export function parseArguments(argv) {
  const options = { only: [], keepGoing: false, json: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--keep-going") options.keepGoing = true;
    else if (argument === "--only" || argument === "--json") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} needs a value`);
      if (argument === "--only") options.only.push(...value.split(",").map((name) => name.trim()).filter(Boolean));
      else options.json = value;
      index += 1;
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

export function selectChecks(checks, only) {
  if (only.length === 0) return checks;
  const known = checks.map((check) => check.name);
  const unknown = only.filter((name) => !known.includes(name));
  if (unknown.length > 0) throw new Error(`unknown check(s): ${unknown.join(", ")}; known: ${known.join(", ")}`);
  return checks.filter((check) => only.includes(check.name));
}

export function gitRevision(root) {
  const git = (args) => {
    try {
      return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null;
    }
  };
  const sha = git(["rev-parse", "HEAD"]);
  if (sha === null) return { sha: null, dirty: null };
  const status = git(["status", "--porcelain"]);
  return { sha: sha.trim(), dirty: (status ?? "").trim() !== "" };
}

// One check, its output going straight to a log file, so a check that prints
// 60 KB never reaches this process's stdout.
export function runCheck(check, logPath) {
  const startedAt = Date.now();
  const log = openSync(logPath, "w");
  return new Promise((done) => {
    const child = spawn(check.command[0], check.command.slice(1), { cwd: ROOT, stdio: ["ignore", log, log] });
    const settle = (result) => {
      closeSync(log);
      done({
        name: check.name,
        command: check.command.join(" "),
        seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
        logPath,
        ...result,
      });
    };
    child.on("error", (error) => settle({ exitCode: 127, error: error.message }));
    child.on("close", (code) => settle({ exitCode: code ?? 1 }));
  });
}

export function tail(path, lines) {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return "(no log written)";
  }
  const all = text.split("\n").filter((line) => line.trim() !== "");
  return all.slice(-lines).join("\n");
}

export async function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(`usage: pnpm checks [--only <name,...>] [--keep-going] [--json <path>]\n\nchecks: ${CHECKS.map((check) => check.name).join(", ")}`);
    return 0;
  }
  const selected = selectChecks(CHECKS, options.only);
  const tree = gitRevision(ROOT);
  const logDirectory = join(ROOT, ".omb-scratch", "checks", tree.sha ?? "unknown");
  mkdirSync(logDirectory, { recursive: true });

  console.log(`tree ${tree.sha ?? "unknown"}${tree.dirty ? " (dirty)" : ""}`);
  console.log(`logs ${logDirectory}`);
  const results = [];
  for (const check of selected) {
    const result = await runCheck(check, join(logDirectory, `${check.name}.log`));
    results.push(result);
    console.log(`\n${result.exitCode === 0 ? "pass" : `FAIL(${result.exitCode})`} ${check.name} ${result.seconds}s -> ${result.logPath}`);
    if (result.error) console.log(result.error);
    if (result.exitCode !== 0) {
      console.log(tail(result.logPath, FAILURE_TAIL_LINES));
      if (!options.keepGoing) break;
    }
  }

  const record = {
    // Load average travels with the record: a check that takes three times its
    // usual time was competing with other workers on the same host, and that
    // fact belongs in the evidence.
    host: { cores: cpus().length, load1: Number(loadavg()[0].toFixed(2)) },
    tree,
    ranAt: new Date().toISOString(),
    results,
  };
  if (options.json) {
    const target = resolve(ROOT, options.json);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`\nrecord ${target}`);
  }
  const failed = results.find((result) => result.exitCode !== 0);
  console.log(`\n${results.length - results.filter((result) => result.exitCode !== 0).length}/${results.length} passed`);
  return failed ? failed.exitCode || 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}