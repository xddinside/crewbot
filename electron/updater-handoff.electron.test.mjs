// The Ubuntu hand-off ends in two side effects that only exist at runtime:
// the command reaching the system clipboard, and a terminal being spawned.
// terminal-launch.test.mjs injects a fake runner, so nothing is ever launched
// there. This runs the production path inside a real Electron process, with a
// recording script on PATH standing in for the terminal emulator.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const electron = require("electron");
const fixture = fileURLToPath(new URL("./fixtures/updater-handoff.cjs", import.meta.url));

function resolveCommand(command) {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

const linux = process.platform === "linux";
const xvfbRun = linux ? resolveCommand("xvfb-run") : "";
const dbusRunSession = linux ? resolveCommand("dbus-run-session") : "";
const xauth = linux ? resolveCommand("xauth") : "";
const missingIsolationTools = [
  !xvfbRun && "xvfb-run",
  !dbusRunSession && "dbus-run-session",
  !xauth && "xauth",
].filter(Boolean);
const canRun = linux && missingIsolationTools.length === 0;
if (linux && !canRun) {
  const reason = `requires ${missingIsolationTools.join(", ")} for an isolated display and D-Bus session`;
  if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") {
    it("has isolated Electron fixture prerequisites", () => {
      throw new Error(reason);
    });
  } else {
    console.log(`skipping updater hand-off Electron fixture: ${reason}`);
  }
} else if (!linux) {
  console.log("skipping updater hand-off Electron fixture: Linux clipboard hand-off only");
}

function fixtureEnvironment(privateRoot, parentEnv = process.env) {
  const privatePath = (name) => join(privateRoot, name);
  const env = { ...parentEnv };
  for (const name of [
    "ELECTRON_RUN_AS_NODE",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "DBUS_SESSION_BUS_ADDRESS",
    "DBUS_SYSTEM_BUS_ADDRESS",
    "SESSION_MANAGER",
    "XDG_SESSION_TYPE",
    "GDK_BACKEND",
    "QT_QPA_PLATFORM",
    "ELECTRON_OZONE_PLATFORM_HINT",
  ]) delete env[name];
  Object.assign(env, {
    HOME: privatePath("home"),
    TMPDIR: privatePath("tmp"),
    XDG_CONFIG_HOME: privatePath("config"),
    XDG_CACHE_HOME: privatePath("cache"),
    XDG_DATA_HOME: privatePath("data"),
    XDG_STATE_HOME: privatePath("state"),
    XDG_RUNTIME_DIR: privatePath("runtime"),
  });
  return env;
}

function runFixture(privateRoot) {
  const env = fixtureEnvironment(privateRoot);
  const command = dbusRunSession;
  const args = ["--", xvfbRun, "-a", electron, "--no-sandbox", fixture];
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const signalGroup = (signal) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      signalGroup("SIGTERM");
      killTimer = setTimeout(() => signalGroup("SIGKILL"), 5_000);
    }, 60_000);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut });
    });
  });
}

it("isolates the Electron fixture from inherited desktop sessions", () => {
  const env = fixtureEnvironment("/owned-fixture", {
    PATH: "/usr/bin",
    ELECTRON_RUN_AS_NODE: "1",
    DISPLAY: ":0",
    WAYLAND_DISPLAY: "wayland-1",
    XAUTHORITY: "/home/user/.Xauthority",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    DBUS_SYSTEM_BUS_ADDRESS: "unix:path=/run/dbus/system_bus_socket",
    SESSION_MANAGER: "local/session",
    XDG_SESSION_TYPE: "wayland",
    GDK_BACKEND: "wayland",
    QT_QPA_PLATFORM: "wayland",
    ELECTRON_OZONE_PLATFORM_HINT: "auto",
  });
  for (const name of [
    "ELECTRON_RUN_AS_NODE",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "DBUS_SESSION_BUS_ADDRESS",
    "DBUS_SYSTEM_BUS_ADDRESS",
    "SESSION_MANAGER",
    "XDG_SESSION_TYPE",
    "GDK_BACKEND",
    "QT_QPA_PLATFORM",
    "ELECTRON_OZONE_PLATFORM_HINT",
  ]) expect(env[name], `${name} should not reach the fixture`).toBeUndefined();
  expect(env).toMatchObject({
    HOME: "/owned-fixture/home",
    TMPDIR: "/owned-fixture/tmp",
    XDG_CONFIG_HOME: "/owned-fixture/config",
    XDG_CACHE_HOME: "/owned-fixture/cache",
    XDG_DATA_HOME: "/owned-fixture/data",
    XDG_STATE_HOME: "/owned-fixture/state",
    XDG_RUNTIME_DIR: "/owned-fixture/runtime",
  });
});

it.runIf(canRun)(
  "copies the install command and launches a terminal for real",
  async () => {
    const privateRoot = mkdtempSync(join(tmpdir(), "omb-handoff-electron-"));
    try {
      for (const name of ["home", "tmp", "config", "cache", "data", "state", "runtime"]) {
        const path = join(privateRoot, name);
        mkdirSync(path, { mode: 0o700 });
        chmodSync(path, 0o700);
      }

      const result = await runFixture(privateRoot);
      const diagnostics = `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`;

      expect(result.timedOut, diagnostics).toBe(false);
      expect(result.code, diagnostics).toBe(0);
      expect(result.stdout, diagnostics).toContain("fixture-complete");

      // The command the user pastes really is on the clipboard, quoting intact.
      expect(result.stdout, diagnostics).toContain("clipboard-holds-the-install-command");
      expect(result.stdout, diagnostics).toContain("hand-off-returned-the-command");

      // A real child process was resolved through PATH and spawned.
      expect(result.stdout, diagnostics).toContain("terminal-really-launched");
      expect(result.stdout, diagnostics).toContain("hand-off-reported-the-terminal");

      // With no terminal available the card must say so, and the clipboard must
      // still hold the command — that is what the troubleshooting doc promises.
      expect(result.stdout, diagnostics).toContain("no-terminal-is-reported-honestly");
      expect(result.stdout, diagnostics).toContain("clipboard-written-even-without-a-terminal");

      expect(result.stdout, diagnostics).toContain("missing-download-is-reported");
      expect(result.stdout, diagnostics).toContain("vanished-download-is-reported");
    } finally {
      rmSync(privateRoot, { recursive: true, force: true });
    }
  },
  90_000,
);
