// The disposable world this fixture owns: one home, one XDG tree, one display,
// one DBus session, one unlocked keyring, and one external project folder that
// lives outside every data root so "did not move" is checkable.
//
// Two rules shape this file. Nothing is inherited: the caller asserts the
// session environment is clear before a single directory is created, and every
// value the children receive is written here. Nothing outlives the run: the
// returned handle owns every process and path it made, and teardown is a
// single call the orchestrator makes in a `finally`.
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { assertIsolatedSessionEnv } from "./inputs.mjs";

const FIXTURE_MODE = 0o700;

/** Create the owned root and its isolated session directories. The root lives
 * under RUNNER_TEMP so the whole run is disposable with the runner itself. */
export function createFixtureEnvironment(runnerTemp, label = "omb-installed-continuity-") {
  assertIsolatedSessionEnv(process.env);
  const root = realpathSync(mkdtempSync(join(resolve(runnerTemp), label)));
  const directories = {
    root,
    home: join(root, "home"),
    config: join(root, "config"),
    data: join(root, "data"),
    cache: join(root, "cache"),
    runtime: join(root, "runtime"),
    tmp: join(root, "tmp"),
    // Deliberately a sibling of home and of both data roots: a user's project
    // must never be inside the workspace the migration is allowed to move.
    project: join(root, "external-project"),
    logs: join(root, "logs"),
  };
  for (const path of Object.values(directories)) {
    mkdirSync(path, { recursive: true, mode: FIXTURE_MODE });
    chmodSync(path, FIXTURE_MODE);
  }
  writeFileSync(join(directories.project, "PROJECT.md"), "external project that must not move\n", {
    mode: 0o644,
  });
  return {
    ...directories,
    /** Absolute paths the stable and development identities must never share. */
    development: {
      dataDir: join(directories.home, ".crewbot-development"),
      profileDir: join(directories.config, "crewbot-development"),
      cacheDir: join(directories.cache, "crewbot-development"),
      serverPort: 18799,
      webhookPort: 18800,
    },
    stopped: [],
    stop() {
      for (const restore of this.stopped.reverse()) {
        try { restore(); } catch { /* teardown must never mask the real failure */ }
      }
      this.stopped.length = 0;
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

/** The base environment every owned child receives. Only the values this
 * fixture decided are present; the caller's session is never spread into it. */
export function fixtureBaseEnv(fixture, { display, dbusAddress, keyringControl } = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: fixture.home,
    USER: process.env.USER ?? "runner",
    LOGNAME: process.env.USER ?? "runner",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TMPDIR: fixture.tmp,
    XDG_CONFIG_HOME: fixture.config,
    XDG_DATA_HOME: fixture.data,
    XDG_CACHE_HOME: fixture.cache,
    XDG_STATE_HOME: join(fixture.root, "state"),
    XDG_RUNTIME_DIR: fixture.runtime,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  };
  mkdirSync(env.XDG_STATE_HOME, { recursive: true, mode: FIXTURE_MODE });
  chmodSync(env.XDG_STATE_HOME, FIXTURE_MODE);
  if (display) env.DISPLAY = display;
  if (dbusAddress) {
    env.DBUS_SESSION_BUS_ADDRESS = dbusAddress;
    // Chromium's session-manager caches a machine-id-derived bus address and
    // silently reuses it when the variable is present but stale.
    env.DBUS_MACHINE_UUID_PATH = join(fixture.runtime, "dbus-machine-id");
    writeFileSync(env.DBUS_MACHINE_UUID_PATH, "00000000000000000000000000000000\n", { mode: 0o600 });
  }
  if (keyringControl) env.GNOME_KEYRING_CONTROL = keyringControl;
  return env;
}

/** Start this fixture's own display server.
 *
 * The workflow hands this process a session with no `DISPLAY` at all, so there
 * is no runner display and no developer desktop to fall back onto. */
export function startOwnedDisplay(fixture) {
  for (let number = 90; number < 130; number += 1) {
    const socket = `/tmp/.X11-unix/X${number}`;
    if (existsSync(socket)) continue;
    const child = spawn("Xvfb", [`:${number}`, "-screen", "0", "1280x1024x24", "-nolisten", "tcp", "-noreset"], {
      env: { PATH: process.env.PATH, HOME: fixture.home, TMPDIR: fixture.tmp },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errors = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { errors += chunk; });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (existsSync(socket)) {
        let ready = false;
        try {
          execFileSync("xdpyinfo", ["-display", `:${number}`], { stdio: "ignore", timeout: 5_000 });
          ready = true;
        } catch { /* not answering yet */ }
        if (ready) {
          return {
            display: `:${number}`,
            stop() {
              try { child.kill("SIGTERM"); } catch { /* already gone */ }
            },
          };
        }
      }
      if (child.exitCode !== null) break;
      execFileSync("sleep", ["0.1"], { stdio: "ignore" });
    }
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
    if (existsSync(socket)) continue;
    throw new Error(`Xvfb could not start on :${number}: ${errors.slice(-600)}`);
  }
  throw new Error("no free display number was available for this fixture");
}

/** Start this fixture's own session bus with an explicit socket inside the
 * fixture root, so nothing can resolve to the runner's login bus.
 *
 * The bus is spawned with `--nofork` and kept as a child, so its pid is the
 * spawned child's pid rather than a number parsed out of `--print-pid`. That
 * matters: `dbus-daemon --fork --print-pid` is parsed differently across the
 * distro versions these runners carry, and some reject the flag outright with
 * `Invalid file descriptor: "--print-pid"`, which fails the run before it
 * starts.
 *
 * Readiness is the socket file appearing rather than `--print-address` output:
 * waiting on the child's stdout needs a live event loop to drain the pipe, which
 * a synchronous poll cannot provide, and the address is already fully determined
 * by the socket path this fixture chose. */
export function startOwnedSessionBus(fixture) {
  const socket = join(fixture.runtime, "dbus-session");
  const address = `unix:path=${socket}`;
  const child = spawn(
    "dbus-daemon",
    ["--session", "--nofork", `--address=${address}`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (existsSync(socket)) break;
    if (child.exitCode !== null) {
      throw new Error(`dbus-daemon exited with ${child.exitCode} before creating ${socket}: ${stderr}`);
    }
    execFileSync("sleep", ["0.1"], { stdio: "ignore" });
  }
  if (!existsSync(socket)) {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
    throw new Error(`dbus-daemon never created ${socket} within 10s: ${stderr}`);
  }
  const bus = {
    address,
    pid: child.pid,
    socket,
    stop() {
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
    },
  };
  fixture.stopped.push(() => bus.stop());
  return bus;
}

/** The pid that owns a bus name on the session bus, or null when nobody owns it.
 *
 * `gnome-keyring-daemon` hands its real work to a background process and lets the
 * spawned child exit, so the child's pid is not always the daemon. Asking the bus
 * who holds the name is the only answer that survives that split. */
function busNameOwner(env, name) {
  try {
    const reply = execFileSync(
      "gdbus",
      [
        "call", "--session",
        "--dest", "org.freedesktop.DBus",
        "--object-path", "/org/freedesktop/DBus",
        "--method", "org.freedesktop.DBus.GetConnectionUnixProcessID", name,
      ],
      { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5_000 },
    ).trim();
    const pid = Number(reply.match(/\d+/)?.[0]);
    return Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

/** Whether a name currently has an owner on this fixture's private bus. */
function busNameOwned(env, name) {
  try {
    execFileSync(
      "gdbus",
      ["call", "--session", "--dest", name, "--object-path", "/org/freedesktop/secrets", "--method", "org.freedesktop.DBus.Peer.Ping"],
      { env, stdio: ["ignore", "pipe", "pipe"], timeout: 5_000 },
    );
    return true;
  } catch {
    return false;
  }
}

/** Start this fixture's own secret-service daemon with a synthetic password.
 *
 * `dbus-run-session` already gave this run a private bus; the keyring daemon
 * started here is unlocked with a value generated inside the fixture and is
 * killed with it. No host keyring, no host password, no host login session is
 * read or written.
 *
 * Readiness is a secret round trip through `secret-tool` on the fixture's own
 * bus — the same operation the proof later performs — not the
 * `GNOME_KEYRING_CONTROL=` line. That line is a login-keyring convenience for
 * libsecret's fallback path, and whether the daemon prints it depends on its
 * version and on whether it daemonizes: the packaged daemon on Ubuntu 24.04
 * serves the secret service while never announcing an address. A control address
 * is recorded when it is offered and never waited for.
 *
 * An address pointing outside this fixture's runtime directory means the daemon
 * found somebody else's login keyring and pointed at it instead of serving this
 * bus. That breaks the isolation the fixture claims, so it is refused rather
 * than used.
 *
 * `--start` is incompatible with `--unlock`: the daemon rejects the pair
 * outright. `--unlock` alone both reads the generated password from stdin and
 * unlocks the collection, so it is the only correct invocation. stdin must be a
 * pipe, and the control directory must exist at 0700 or the daemon refuses to
 * start. The login keyring itself is created first: `--unlock` has nothing to
 * unlock in a fresh home and will not unlock anything until one exists. */
export function startOwnedKeyring({ env, password }) {
  if (typeof password !== "string" || password.length < 16) {
    throw new Error("the fixture keyring needs its own generated password");
  }
  const controlDirectory = join(env.XDG_RUNTIME_DIR ?? "/tmp", "keyring");
  mkdirSync(controlDirectory, { recursive: true, mode: 0o700 });
  chmodSync(controlDirectory, 0o700);
  const keyringsDirectory = join(env.HOME, ".local", "share", "keyrings");
  mkdirSync(keyringsDirectory, { recursive: true, mode: 0o700 });
  const loginKeyring = join(keyringsDirectory, "login.keyring");
  if (!existsSync(loginKeyring)) writeFileSync(loginKeyring, "", { mode: 0o600 });
  const child = spawn("gnome-keyring-daemon", ["--unlock", "--components=secrets"], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let announced = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { announced += chunk; });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { announced += chunk; });
  child.stdin.on("error", () => { /* the daemon may exit before reading it */ });
  child.stdin.end(`${password}\n`);
  const control = () => announced.match(/GNOME_KEYRING_CONTROL=(.+)/)?.[1]?.trim() ?? null;
  const stop = () => {
    // The spawned child may already have exited and handed the name to a
    // background process, so the bus owner is what has to be stopped.
    const owner = busNameOwner(env, "org.freedesktop.secrets");
    for (const pid of new Set([owner, child.pid].filter((value) => Number.isInteger(value) && value > 1))) {
      try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    }
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  };
  let lastFailure = null;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const offered = control();
    if (offered && !offered.startsWith(controlDirectory)) {
      stop();
      throw new Error([
        `gnome-keyring-daemon pointed at a keyring outside this fixture: ${offered}`,
        `this fixture owns only ${controlDirectory}`,
        `a host keyring must never be read or written by this proof`,
      ].join("\n"));
    }
    const usable = offered ? { ...env, GNOME_KEYRING_CONTROL: offered } : env;
    if (busNameOwned(usable, "org.freedesktop.secrets")) {
      try {
        proveKeyringRoundTrip(usable, { label: "fixture-readiness", value: password });
        return {
          control: offered,
          pid: busNameOwner(usable, "org.freedesktop.secrets") ?? child.pid,
          announce: announced,
          stop,
        };
      } catch (error) {
        // The name is owned but the collection is still locked or empty. Keep
        // waiting, and keep the reason for the failure report.
        lastFailure = error instanceof Error ? error.message : String(error);
      }
    }
    if (child.exitCode !== null && !announced) break;
    execFileSync("sleep", ["0.2"], { env, stdio: "ignore" });
  }
  stop();
  // Report the exit status and what the daemon was actually given as well as
  // anything it printed, so a start failure names its cause.
  throw new Error([
    `no secret service on this fixture's own session bus could store and read a value within 45s`,
    `exit: ${child.exitCode === null ? "still running" : child.exitCode}`,
    `signal: ${child.signalCode ?? "none"}`,
    `argv: --unlock --components=secrets`,
    `HOME: ${env.HOME}`,
    `XDG_RUNTIME_DIR: ${env.XDG_RUNTIME_DIR}`,
    `DBUS_SESSION_BUS_ADDRESS: ${env.DBUS_SESSION_BUS_ADDRESS ?? "(unset)"}`,
    `control directory: ${controlDirectory}`,
    `login keyring: ${loginKeyring}`,
    `last round-trip failure: ${lastFailure ?? "none attempted"}`,
    `stdout/stderr:\n${announced}`,
  ].join("\n"));
}

/** Read the secret-service default collection through the D-Bus API itself.
 *
 * `Item.Search` with an empty attribute array is the specification's "every
 * item in this collection", so this needs no unlocked session and prints no
 * secret material. It is the observable that separates a real operating-system
 * keyring from Electron's `basic_text` fallback, which writes no item at all.
 */
export function listSecretServiceItems(env) {
  const listing = execFileSync(
    "gdbus",
    [
      "call",
      "--session",
      "--dest", "org.freedesktop.secrets",
      "--object-path", "/org/freedesktop/secrets/aliases/default",
      "--method", "org.freedesktop.Secret.Item.Search", "[]",
    ],
    { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 },
  ).trim();
  const paths = [...listing.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  return paths.map((itemPath) => {
    const attributes = execFileSync(
      "gdbus",
      [
        "call",
        "--session",
        "--dest", "org.freedesktop.secrets",
        "--object-path", itemPath,
        "--method", "org.freedesktop.Secret.Item.GetAttributes",
      ],
      { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 },
    ).trim();
    const parsed = {};
    for (const [, key, value] of attributes.matchAll(/'([^']+)':\s*'([^']*)'/g)) parsed[key] = value;
    return { path: itemPath, attributes: parsed };
  });
}

/** Round-trip one synthetic secret through the fixture's keyring, so a later
 * "the app used the keyring" claim cannot rest on an empty collection.
 *
 * Every `secret-tool` call is bounded. Unattended, `secret-tool store` falls back
 * to prompting on a terminal it cannot see, and a synchronous call with no
 * timeout then waits for a password that will never be typed — the fixture stops
 * reporting and the job runs to its own timeout instead of naming the cause. */
export function proveKeyringRoundTrip(env, { label, value, timeoutMs = 20_000 }) {
  const run = (args) => {
    try {
      return execFileSync("secret-tool", args, {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
      });
    } catch (error) {
      const timedOut = error?.code === "ETIMEDOUT" || error?.signal === "SIGTERM";
      throw new Error(
        `secret-tool ${args[0]} did not finish within ${timeoutMs}ms${timedOut ? " (an unattended store blocks on a password prompt)" : ""}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  run(["store", "--label", label, "continuity", value]);
  const read = run(["lookup", "continuity", label]).trim();
  run(["clear", "continuity", label]);
  if (read !== value) throw new Error("the fixture keyring did not round-trip its own synthetic value");
  return true;
}

/** List every path below a directory, relative and sorted. Used to prove that a
 * launch created state in one identity's tree and nowhere else. */
export function listTree(root) {
  const found = [];
  const walk = (directory, prefix) => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      found.push(relative);
      if (entry.isDirectory()) walk(join(directory, entry.name), relative);
    }
  };
  walk(root, "");
  return found.sort();
}

export function readTextIfPresent(path) {
  try { return readFileSync(path, "utf8"); }
  catch { return null; }
}