// The disposable world this fixture owns: one home, one XDG tree, one display,
// one session bus, one window manager, two working folders and a temporary
// root under the runner's temp.
//
// Nothing is inherited. The workflow hands this process a session with no
// display, no bus and no seat, `assertIsolatedSessionEnv` proves it, and every
// value an owned child receives is written here. Nothing outlives the run: the
// returned handle owns every process and path it made, and `stop()` is a single
// call the orchestrator makes in a `finally`.
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const FIXTURE_MODE = 0o700;
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

/** Session values that would attach this run to somebody's desktop, login
 * keyring or service session. A fixture that finds one of them set is not
 * allowed to continue — it would drive the wrong machine. The set is asserted
 * against the workflow that clears them, so the two cannot drift apart. */
export const ISOLATED_SESSION_KEYS = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "WAYLAND_SOCKET",
  "XDG_SESSION_TYPE",
  "XDG_SESSION_ID",
  "XDG_CURRENT_DESKTOP",
  "DESKTOP_SESSION",
  "XDG_SEAT",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "DBUS_SYSTEM_BUS_ADDRESS",
  "GNOME_KEYRING_CONTROL",
  "SSH_AUTH_SOCK",
];

export function assertIsolatedSessionEnv(env = process.env) {
  // A value that is absent or the empty string is cleared. Anything else counts,
  // including whitespace, because that is what the workflow's own `test -z`
  // check treats as present — the two must agree on where the line is.
  const present = ISOLATED_SESSION_KEYS.filter((key) => (env[key] ?? "") !== "");
  if (present.length) {
    throw new Error(
      `refusing to run an installed-desktop fixture with a live session attached: ${present.join(", ")}`,
    );
  }
}

/** One owned root under the runner's temp, with the two working folders the
 * journey needs: the one the bot is pinned to, and the valid one the native
 * picker will return. Both are siblings of home and of the data root, so
 * "the folder went away" and "the picker chose a real folder" are both checkable
 * without anything landing inside the workspace. */
export function createFixtureEnvironment(runnerTemp, label = "omb-installed-recovery-") {
  assertIsolatedSessionEnv(process.env);
  const root = realpathSync(mkdtempSync(join(resolve(runnerTemp), label)));
  const directories = {
    root,
    home: join(root, "home"),
    config: join(root, "config"),
    data: join(root, "data"),
    cache: join(root, "cache"),
    runtime: join(root, "runtime"),
    state: join(root, "state"),
    tmp: join(root, "tmp"),
    logs: join(root, "logs"),
    evidence: join(root, "evidence"),
    missingCwd: join(root, "vanishing-project"),
    replacementCwd: join(root, "replacement-project"),
    alternateCwd: join(root, "alternate-project"),
  };
  for (const path of Object.values(directories)) {
    mkdirSync(path, { recursive: true, mode: FIXTURE_MODE });
    chmodSync(path, FIXTURE_MODE);
  }
  writeFileSync(join(directories.replacementCwd, "PROJECT.md"), "the folder the picker chose\n");
  writeFileSync(join(directories.alternateCwd, "PROJECT.md"), "a second valid folder, offered only to a stale chooser\n");
  return {
    ...directories,
    stopped: [],
    /** Register teardown in reverse order, so the app dies before the display it
     * draws on and the display dies before the bus it registered with. */
    own(restore) {
      this.stopped.push(restore);
    },
    stop() {
      for (const restore of this.stopped.reverse()) {
        try { restore(); } catch { /* teardown must never mask the real failure */ }
      }
      this.stopped.length = 0;
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

/** Only the values this fixture decided, plus its own display and bus. */
export function fixtureBaseEnv(fixture, { display, dbusAddress, windowManager } = {}) {
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
    XDG_STATE_HOME: fixture.state,
    XDG_RUNTIME_DIR: fixture.runtime,
    // The chooser this journey drives is the real GTK one, which needs a
    // session type to open against. Nothing else in the session is inherited.
    XDG_SESSION_TYPE: "x11",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  };
  if (display) env.DISPLAY = display;
  if (windowManager) {
    // Named because the window manager is this fixture's own. Electron reads
    // this to decide it is on X11 rather than guessing from the compositor.
    env.XDG_CURRENT_DESKTOP = windowManager;
    env.DESKTOP_SESSION = windowManager;
  }
  if (dbusAddress) {
    env.DBUS_SESSION_BUS_ADDRESS = dbusAddress;
    // Chromium caches a machine-id-derived bus address and silently reuses it
    // when the variable is present but stale.
    env.DBUS_MACHINE_UUID_PATH = join(fixture.runtime, "dbus-machine-id");
    writeFileSync(env.DBUS_MACHINE_UUID_PATH, "00000000000000000000000000000000\n", { mode: 0o600 });
  }
  return env;
}

/** This fixture's own X server.
 *
 * The workflow starts the job with no `DISPLAY` at all, so there is no runner
 * display and no developer desktop to fall back onto. The number is chosen from
 * a bounded private range and the socket must be absent before the server
 * starts, so this can never attach to somebody else's X. */
export async function startOwnedDisplay(fixture) {
  for (let number = 91; number < 131; number += 1) {
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
    let ready = false;
    while (Date.now() < deadline && !ready) {
      if (existsSync(socket)) {
        try {
          execFileSync("xdpyinfo", ["-display", `:${number}`], { stdio: "ignore", timeout: 5_000 });
          ready = true;
        } catch { /* not answering yet */ }
      }
      if (!ready) {
        if (child.exitCode !== null) break;
        await delay(100);
      }
    }
    if (ready) {
      const owned = {
        display: `:${number}`,
        pid: child.pid,
        socket,
        async stop() {
          await terminate(child, socket);
        },
      };
      fixture.own(() => owned.stop());
      return owned;
    }
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
    if (existsSync(socket)) continue;
    throw new Error(`Xvfb could not start on :${number}: ${errors.slice(-600)}`);
  }
  throw new Error("no free display number was available for this fixture");
}

/** This fixture's own session bus, with a socket inside the fixture root so
 * nothing can resolve to the runner's login bus.
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
  const owned = {
    address,
    pid: child.pid,
    socket,
    stop() {
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
    },
  };
  fixture.own(() => owned.stop());
  return owned;
}

/**
 * A window manager for this fixture's own display, when one is available.
 *
 * A window manager is not decoration here: `xdotool windowactivate` speaks
 * `_NET_ACTIVE_WINDOW`, which only a window manager answers, and a managed
 * dialog is the case GTK delivers keystrokes to reliably. When none is
 * installed the fixture still runs — the picker driver falls back to
 * `XSetInputFocus` — but it records that it did, so a keystroke that never
 * landed is diagnosable rather than mysterious.
 */
export async function startOwnedWindowManager(fixture, display) {
  const binary = ["openbox", "matchbox-window-manager", "twm"].find((name) => {
    try {
      execFileSync("sh", ["-c", `command -v ${name}`], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
  if (!binary) return null;
  const child = spawn(binary, [], {
    env: { PATH: process.env.PATH, HOME: fixture.home, TMPDIR: fixture.tmp, DISPLAY: display },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errors = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { errors += chunk; });
  // Give it a moment to map its own windows; a manager that dies immediately
  // is worse than none, because `windowactivate` would then hang.
  await delay(1_200);
  if (child.exitCode !== null) {
    return { name: null, note: `${binary} exited immediately: ${errors.slice(-200)}` };
  }
  const owned = {
    name: binary,
    pid: child.pid,
    stop() {
      try { process.kill(child.pid, "SIGTERM"); } catch { /* already gone */ }
    },
  };
  fixture.own(() => owned.stop());
  return owned;
}

/** Bounded teardown for the display: ask, then insist, then report the socket
 * still standing rather than leaving another run's display behind. */
async function terminate(child, socket) {
  if (child.exitCode !== null && !existsSync(socket)) return;
  try { child.kill("SIGTERM"); } catch { /* already gone */ }
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null && !existsSync(socket)) return;
    await delay(100);
  }
  try { child.kill("SIGKILL"); } catch { /* already gone */ }
  await delay(300);
  if (existsSync(socket)) {
    throw new Error(`Xvfb left its socket behind after SIGKILL: ${socket}`);
  }
}

/**
 * Copy the logs this run produced into its evidence directory.
 *
 * The app and its embedded server write into the fixture's own XDG tree, so
 * every log line here belongs to this run. Anything outside the fixture root is
 * refused rather than copied: a fixture that reaches further than it owns would
 * be reading somebody else's machine.
 */
export function collectFixtureLogs(fixture, evidenceDir) {
  const copied = [];
  const walk = (directory, depth = 0) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".log")) copied.push(path);
    }
  };
  walk(fixture.root);
  mkdirSync(evidenceDir, { recursive: true });
  const saved = [];
  for (const path of copied) {
    const inside = relative(fixture.root, path);
    if (inside.startsWith("..") || inside.startsWith("/")) {
      throw new Error(`refusing to collect a log outside the fixture root: ${path}`);
    }
    const target = join(evidenceDir, "logs", inside);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path));
    saved.push(inside);
  }
  return saved.sort();
}