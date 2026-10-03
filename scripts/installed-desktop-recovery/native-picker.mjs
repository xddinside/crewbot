// The real native folder chooser, driven as one.
//
// `window.ogb.pickFolder` crosses the production preload bridge into Electron's
// production `dialog.showOpenDialog`, which on Linux is GTK's own folder
// chooser: a separate top-level X window owned by the display this fixture
// started. This module finds that window by the title the shipped main process
// sets, focuses it, and types a real absolute path into GTK's location entry —
// the same keystrokes a user's keyboard would produce.
//
// Keystrokes go out through XTEST, not `xdotool key --window`. `--window` makes
// xdotool synthesise the event with `XSendEvent`, and GTK discards synthesised
// key events, so that form of "driving the dialog" types into nothing. XTEST
// injects at the server, so the focused window sees an ordinary key press.
//
// Nothing here patches the dialog, calls into Electron, or answers the IPC
// request. The only thing this fixture observes is what the chooser returned.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The window title `electron/main.mjs` passes to `dialog.showOpenDialog`. A
 * fixture that finds nothing under it is looking at the wrong window, so the
 * exact string is part of the contract, not a search hint. */
export const FOLDER_CHOOSER_TITLE = "Choose a working folder";

function xdotool(args, env, { timeoutMs = 15_000 } = {}) {
  return execFileSync("xdotool", args, { env, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
}

/** Every mapped window on the fixture's display, by id. The chooser is found by
 * its exact production title among these — never by guessing at its class. */
export function listWindows(env) {
  const output = xdotool(["search", "--name", ".", "getwindowname", "%@"], env).split("\n");
  const names = new Map();
  for (const line of output) {
    const match = line.match(/^(\d+)\s"(.*)"$/);
    if (match) names.set(match[1], match[2]);
  }
  return names;
}

export function windowExists(env, id) {
  try {
    xdotool(["getwindowname", id], env, { timeoutMs: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** Find the chooser window once the app has actually opened it. */
export async function waitForFolderChooser({ env, timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let seen = [];
  while (Date.now() < deadline) {
    seen = [...listWindows(env)].filter(([, name]) => name);
    const hit = seen.find(([, name]) => name === FOLDER_CHOOSER_TITLE);
    if (hit) return { id: hit[0], name: hit[1] };
    await delay(300);
  }
  throw new Error(
    `the native folder chooser never opened within ${timeoutMs}ms; windows were ${JSON.stringify(seen)}`,
  );
}

/** How many chooser windows exist right now. Two activations of one row must
 * never make this 2: that is the duplicate-retry guard's observable. */
export function countChooserWindows(env) {
  return [...listWindows(env)].filter(([, name]) => name === FOLDER_CHOOSER_TITLE).length;
}

/**
 * Give the chooser input focus and report which method actually took.
 *
 * `windowactivate` is what a user's click does, and needs a window manager.
 * `windowfocus` is `XSetInputFocus`, which needs none. The pointer move is the
 * last resort, for a chooser that refuses both. The result is returned rather
 * than assumed, so a keystroke that went nowhere is visible in the evidence.
 */
export function focusWindow({ env, id }) {
  const attempts = [];
  try {
    xdotool(["windowactivate", "--sync", id], env, { timeoutMs: 8_000 });
    attempts.push("windowactivate");
  } catch {
    attempts.push("windowactivate-unavailable");
  }
  try {
    xdotool(["windowfocus", "--sync", id], env, { timeoutMs: 8_000 });
    attempts.push("windowfocus");
    return { focus: "window", attempts };
  } catch {
    attempts.push("windowfocus-unavailable");
  }
  const geometry = xdotool(["getwindowgeometry", "--shell", id], env);
  const x = Number(geometry.match(/X=(\d+)/)?.[1] ?? 0);
  const y = Number(geometry.match(/Y=(\d+)/)?.[1] ?? 0);
  const width = Number(geometry.match(/WIDTH=(\d+)/)?.[1] ?? 0);
  const height = Number(geometry.match(/HEIGHT=(\d+)/)?.[1] ?? 0);
  xdotool(["mousemove", String(x + Math.floor(width / 2)), String(y + Math.floor(height / 2))], env);
  attempts.push("pointer");
  return { focus: "pointer", attempts };
}

/**
 * Type an absolute path into GTK's location entry and accept it.
 *
 * Ctrl+L is GTK's "type a location" binding. Enter navigates to the path; in
 * folder-selection mode the chooser still has to run its default action to
 * return that folder, so Enter is sent again. Whether either Enter was needed is
 * recorded rather than assumed, and the caller still has to observe the exact
 * path come back through IPC — a chooser that accepted the keystrokes without
 * returning the folder fails the journey, which is the point.
 */
export async function chooseFolder({ env, id, path, extraEnter = true }) {
  const { focus, attempts } = focusWindow({ env, id });
  const steps = [];
  const run = (args) => {
    xdotool(args, env);
    steps.push(args.join(" "));
  };
  run(["key", "--clearmodifiers", "ctrl+l"]);
  // GTK's location entry needs a moment before it accepts typed characters.
  await delay(400);
  run(["type", "--clearmodifiers", "--delay", "30", path]);
  await delay(700);
  run(["key", "--clearmodifiers", "Return"]);
  await delay(900);
  if (extraEnter && windowExists(env, id)) {
    steps.push("Return (still open)");
    run(["key", "--clearmodifiers", "Return"]);
    await delay(700);
  }
  return { focus, attempts, steps };
}

/** Cancel the chooser the way a user does: Escape. */
export async function cancelFolder({ env, id }) {
  const { focus, attempts } = focusWindow({ env, id });
  xdotool(["key", "--clearmodifiers", "Escape"], env);
  await delay(600);
  return { focus, attempts, steps: ["key Escape"] };
}

/** Wait until the chooser window is gone, which is the observable that the
 * dialog really closed rather than merely losing focus. */
export async function waitForChooserClosed({ env, id, timeoutMs = 30_000 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!windowExists(env, id)) return true;
    await delay(200);
  }
  throw new Error(`the native folder chooser (window ${id}) never closed`);
}

/** Keep a picture of the chooser itself. `import` reads the fixture's own
 * display only, so this is the native window the app opened — not a guess at
 * what the renderer shows. A capture that fails is reported, not fatal: losing
 * one screenshot must not fail a journey whose real evidence is the path that
 * came back through IPC. */
export function captureWindow({ env, id, path }) {
  mkdirSync(dirname(path), { recursive: true });
  try {
    execFileSync("import", ["-display", env.DISPLAY, "-window", id, path], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 20_000,
    });
    return path;
  } catch (error) {
    return { path: null, reason: String(error?.message ?? error).slice(0, 200) };
  }
}