// Shared plumbing for the native systemd service cutover/rollback proof.
//
// Everything here is disposable-runner material: it refuses to touch a machine
// that is not an explicitly disposable Linux runner with real systemd as PID 1,
// and it records every unit, path and shim it creates so the scenario can
// remove exactly those and nothing else. No helper fabricates a command
// result; the failure injector below only ever returns a real non-zero exit.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

export const FIXTURE_TAG = "[linux-service-cutover]";

export class FixtureError extends Error {}

export function fail(message) {
  throw new FixtureError(`${FIXTURE_TAG} ${message}`);
}

export function step(message) {
  console.log(`${FIXTURE_TAG} ${message}`);
}

export function note(message) {
  console.log(`${FIXTURE_TAG}   ${message}`);
}

/** Run a command; fail loudly with both streams unless `allowFailure` is set. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) fail(`${command} ${args.join(" ")} could not start: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFailure) {
    fail(`${command} ${args.join(" ")} exited ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function runOk(command, args, options = {}) {
  const result = run(command, args, { ...options, allowFailure: true });
  if (result.status !== 0) {
    fail(`expected ${command} ${args.join(" ")} to succeed, got ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

export function stdout(command, args, options = {}) {
  return runOk(command, args, options).trim();
}

/** Run systemctl, failing loudly unless `allowFailure` is set. */
export function systemctl(args, options = {}) {
  return run("systemctl", args, options);
}

export function systemctlProp(unit, property) {
  // `systemctl show` exits non-zero for an unknown unit, which is a state this
  // function is asked to report as "no such unit" rather than crash on. Read it
  // tolerantly and let the empty result mean absent.
  const value = run("systemctl", ["show", "-p", property, "--value", unit], { allowFailure: true }).stdout.trim();
  return value === "" ? null : value;
}

export function unitIsActive(unit) {
  return systemctlProp(unit, "ActiveState") === "active";
}

export function unitIsEnabled(unit) {
  return systemctlProp(unit, "UnitFileState") === "enabled";
}

/** The ownership picture the cutover and rollback assertions compare. */
export function unitSnapshot(units) {
  const snapshot = {};
  for (const unit of units) {
    snapshot[unit] = {
      loadState: systemctlProp(unit, "LoadState"),
      activeState: systemctlProp(unit, "ActiveState"),
      unitFileState: systemctlProp(unit, "UnitFileState"),
      mainPid: systemctlProp(unit, "MainPID"),
    };
  }
  return snapshot;
}

export function journalExcerpt(unit, lines = 60) {
  const result = run("journalctl", ["-u", unit, "-n", String(lines), "--no-pager", "--output=short-iso"], { allowFailure: true });
  return result.stdout || result.stderr;
}

/** The real process environment of a live unit, read from the kernel. */
export function processEnvironment(pid) {
  const environment = {};
  for (const entry of readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")) {
    const separator = entry.indexOf("=");
    if (separator > 0) environment[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return environment;
}

export function processCwd(pid) {
  return realpathSync(`/proc/${pid}/cwd`);
}

export async function waitForHealth(port, { timeoutMs = 90_000, label = `port ${port}` } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no attempt";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      const text = await response.text();
      if (response.ok && text.includes("app")) return JSON.parse(text);
      lastError = `health returned HTTP ${response.status}: ${text.slice(0, 200)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  fail(`${label} never became healthy within ${timeoutMs} ms: ${lastError}`);
}

export async function api(base, method, route, body, options = {}) {
  const headers = { ...options.headers };
  let payload;
  if (body !== undefined) {
    headers["content-type"] ??= "application/json";
    payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  }
  const init = { method, headers, ...(payload === undefined ? {} : { body: payload }) };
  const response = await fetch(new URL(route, base), init);
  const bytes = Buffer.from(await response.arrayBuffer());
  let parsed = null;
  try { parsed = bytes.length ? JSON.parse(bytes.toString("utf8")) : null; } catch { parsed = null; }
  return { status: response.status, body: parsed, bytes, headers: response.headers };
}

export async function apiOk(base, method, route, body, options) {
  const response = await api(base, method, route, body, options);
  if (response.status >= 400) fail(`${method} ${route} returned HTTP ${response.status}: ${JSON.stringify(response.body)}`);
  return response.body;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** A port that is free right now; the webhook ingress always takes +1. */
export async function reservePortBlock() {
  const listen = (server) => new Promise((done) => {
    server.once("error", () => done(false));
    server.listen(0, "127.0.0.1", () => done(true));
  });
  const closed = (server) => new Promise((done) => server.close(() => done()));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const primary = createServer();
    if (!await listen(primary)) { await closed(primary); continue; }
    const { port } = primary.address();
    const webhook = createServer();
    const free = port >= 1024 && await new Promise((done) => {
      webhook.once("error", () => done(false));
      webhook.listen(port + 1, "127.0.0.1", () => done(true));
    });
    await closed(primary);
    await closed(webhook);
    if (free) return { port, webhookPort: port + 1 };
  }
  fail("could not reserve a free port block for the service fixture");
}

/**
 * Prove this really is a disposable Linux runner with systemd as PID 1 and the
 * real systemctl binary. A container, a non-systemd init or a shimmed systemctl
 * is a hard refusal: fabricated systemctl output is not native proof.
 */
export function requireNativeSystemd({ repoRoot }) {
  if (process.platform !== "linux") fail("this proof only runs on Linux");
  if (process.getuid?.() !== 0) fail("this proof drives real systemd, so it must run as root");
  if (existsSync("/.dockerenv") || existsSync("/run/.containerenv")) {
    fail("refusing to run inside a container: PID 1 is not the runner's own systemd");
  }
  const init = readFileSync("/proc/1/comm", "utf8").trim();
  if (init !== "systemd") fail(`refusing to run: PID 1 is ${init}, not systemd`);
  if (!existsSync("/run/systemd/system")) {
    fail("refusing to run: /run/systemd/system is absent, so systemd is not managing this boot");
  }
  const systemctlPath = stdout("sh", ["-c", "command -v systemctl"]);
  const realSystemctl = realpathSync(systemctlPath);
  for (const fixtureOwned of [process.env.RUNNER_TEMP, process.env.HOME, tmpdir()].filter(Boolean)) {
    if (realSystemctl.startsWith(resolve(fixtureOwned))) {
      fail(`refusing to run: systemctl resolves to ${realSystemctl}, inside the fixture's own ${fixtureOwned}`);
    }
  }
  if (!realSystemctl.startsWith("/usr/") && !realSystemctl.startsWith("/bin/")) {
    fail(`refusing to run: systemctl resolves to ${realSystemctl}, not the distribution's systemd client`);
  }
  const version = run("systemctl", ["--version"], { allowFailure: true });
  // The real client prints `systemd <version>` as its first line, followed by a
  // feature line whose tokens vary by distro. Match the first line, not a
  // feature token: Ubuntu 24.04's line has no `+SYSTEMD`, so asserting on one
  // rejects the genuine article.
  const versionLine = version.stdout.split("\n", 1)[0].trim();
  if (version.status !== 0 || !/^systemd \d+/.test(versionLine)) {
    fail(`refusing to run: ${realSystemctl} is not the real systemd client\n${version.stdout}\n${version.stderr}`);
  }
  // `is-system-running` exits non-zero for `degraded` — that is the documented
  // contract, not a failure of the command. Ask for the state tolerantly and
  // judge the value, instead of routing it through the strict helper that
  // demands exit 0 and so rejects the very state this gate accepts.
  const systemState = run("systemctl", ["is-system-running"], { allowFailure: true }).stdout.trim();
  if (!["running", "degraded", "starting"].includes(systemState)) {
    fail(`refusing to run: systemd reports the system as ${systemState || "unknown"}, so unit state cannot be trusted`);
  }
  // server/openmausbot.ts is the real `openmausbot`/`crewbot` command entry;
  // server/cli.ts only exports its functions, so running it as a command exits 0
  // without doing anything.
  if (!existsSync(join(repoRoot, "server", "openmausbot.ts"))) {
    fail(`expected a source checkout with server/openmausbot.ts under ${repoRoot}`);
  }
  step(`native systemd confirmed: PID 1=${init}, ${version.stdout.split("\n")[0]}, systemctl=${realSystemctl}, system=${systemState}`);
  return { init, systemctl: realSystemctl, systemdVersion: versionLine, systemState };
}

/** The unprivileged account that owns the service, never root. */
export function serviceOwner() {
  const owner = process.env.SUDO_USER?.trim() || stdout("id", ["-un"]);
  if (!owner || owner === "root") fail("refusing to run: the service must be owned by an unprivileged account, not root");
  const passwd = run("getent", ["passwd", owner], { allowFailure: true }).stdout.split(":");
  if (passwd.length < 6 || !passwd[5]?.startsWith("/")) fail(`could not read ${owner} from the passwd database`);
  runOk("sudo", ["-n", "-u", owner, "sudo", "-n", "true"]);
  return { owner, home: passwd[5], shell: passwd[6] };
}

/** Everything this fixture creates, so cleanup can be exact and reportable. */
export class OwnedResources {
  constructor() {
    this.units = new Set();
    this.paths = new Set();
    this.notes = [];
  }

  unit(name) { this.units.add(name); }
  path(value) { const absolute = resolve(value); this.paths.add(absolute); return absolute; }
  note(line) { this.notes.push(line); }

  report() {
    return { units: [...this.units].sort(), paths: [...this.paths].sort(), notes: [...this.notes] };
  }
}

/**
 * Write an executable fixture shim that refuses the exact argv patterns it is
 * given and execs the real sudo for everything else. It can only turn a
 * command into a real failure; it never turns one into a success.
 */
export function writeFailingSudoShim(directory, refuse) {
  mkdirSync(directory, { recursive: true, mode: 0o755 });
  const real = realpathSync(stdout("sh", ["-c", "command -v sudo"]));
  const script = [
    "#!/bin/sh",
    "# Fixture-owned control-flow injector for the native service proof.",
    "# It refuses the exact argv patterns it was given and delegates every",
    "# other command to the real sudo. It never fabricates a success.",
    `case " $* " in`,
    ...refuse.map((pattern) => `  *" ${pattern} "*) echo "${FIXTURE_TAG} injected failure: sudo $*" >&2; exit 1 ;;`),
    "esac",
    `exec ${real} "$@"`,
    "",
  ].join("\n");
  const shim = join(directory, "sudo");
  writeFileSync(shim, script, { mode: 0o755 });
  chmodSync(shim, 0o755);
  return shim;
}

export function removeQuietly(path) {
  try {
    const stat = lstatSync(path);
    rmSync(path, { recursive: stat.isDirectory() && !stat.isSymbolicLink(), force: true });
    return null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return error instanceof Error ? error.message : String(error);
  }
}

/** Create a fixture directory with an explicit mode, optionally owned by a user. */
export function ensureDirectory(path, { owner, mode = 0o700 } = {}) {
  mkdirSync(path, { recursive: true, mode });
  chmodSync(path, mode);
  if (owner) runOk("chown", ["-R", owner, path]);
  return path;
}

/** Run the production CLI as the service owner, with an explicit environment.
 *
 * Tolerates a non-zero exit by default: several of the boundaries under test are
 * refusals, so the caller has to be able to inspect the exit status and the
 * message. Callers that require success assert on `result.status` themselves.
 *
 * `CREWBOT_DEV_LAUNCH` is preserved by name because sudo's default `env_reset`
 * drops it: the stable/development separation is proved by running the CLI with
 * that variable set, and without preserving it the CLI never sees it and the
 * development launch quietly behaves like the stable one. Naming one variable
 * keeps the reset in force for everything else. */
export function productionCli(args, { as, home, repoRoot, env = {}, extraPath = [], allowFailure = true } = {}) {
  const searchPath = [...extraPath, "/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"].join(":");
  return run("sudo", ["-n", "-u", as, "-H", "--preserve-env=CREWBOT_DEV_LAUNCH", process.execPath, "--experimental-strip-types", join(repoRoot, "server", "openmausbot.ts"), ...args], {
    env: { ...process.env, HOME: home, PATH: searchPath, ...env },
    cwd: repoRoot,
    allowFailure,
  });
}

export function controlOmb(args, { url, repoRoot }) {
  return run(process.execPath, ["--experimental-strip-types", join(repoRoot, "scripts", "control-omb.ts"), ...args, "--url", url], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function parseControlOmb(result, what) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`control-omb ${what} did not return JSON (${error instanceof Error ? error.message : String(error)}):\n${result.stdout}\n${result.stderr}`);
  }
}

/**
 * Split one printed instruction into argv. Production prints paths without
 * spaces, so a token needing shell quoting is a drift signal, not something to
 * guess at: it fails instead of guessing.
 */
export function tokenizePrintedCommand(line) {
  const trimmed = line.trim();
  if (/["'\\]/.test(trimmed)) fail(`printed instruction needs shell quoting, which this fixture refuses to guess: ${line}`);
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (!tokens.length) fail(`cannot tokenize an empty printed instruction: ${line}`);
  return tokens;
}

/** Tokenize the single-quoted argv production prints for its rollback command. */
export function tokenizeQuotedCommand(line) {
  const tokens = [];
  let current = "";
  let started = false;
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === null && character === "'" && line.slice(index + 1, index + 4) === "'\\''") {
      current += "'";
      started = true;
      index += 3;
      continue;
    }
    if (quote === "'") {
      if (character === "'") quote = null;
      else current += character;
      continue;
    }
    if (quote === '"') {
      if (character === "\\") { current += line[index + 1] ?? ""; index += 1; continue; }
      if (character === '"') quote = null;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') { quote = character; started = true; continue; }
    if (/\s/.test(character)) {
      if (started) { tokens.push(current); current = ""; started = false; }
      continue;
    }
    current += character;
    started = true;
  }
  if (quote) fail(`unfinished quote in printed instruction: ${line}`);
  if (started) tokens.push(current);
  if (!tokens.length) fail(`cannot tokenize an empty printed instruction: ${line}`);
  return tokens;
}
