// Renderer control for the installed package, over the Chromium DevTools
// endpoint the shipped Electron app already exposes when it is launched with
// `--remote-debugging-port`.
//
// Every action here is a real DOM event in the real renderer inside the
// installed window: the step finds the shipped control and dispatches a real
// click, so the component's own handler runs, the preload bridge is the
// production one, and every API call is the shipped route. No production UI or
// API path is stubbed or bypassed.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function running(handle) {
  return handle.exitCode === null && handle.signalCode === null;
}

/**
 * Wait for the installed app to expose a page target, then attach to it.
 *
 * The app serves the renderer from its own embedded server on loopback, so this
 * waits for the renderer document itself rather than assuming a boot order.
 */
export async function connectToRenderer({ port, timeoutMs = 120_000, child, log }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no target seen yet";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return await attachToTarget(page);
      lastError = `no page target among ${targets.length}`;
    } catch (error) {
      lastError = String(error?.message ?? error);
    }
    if (child && !running(child)) {
      throw new Error(`the installed app exited before the renderer was reachable (${lastError})`);
    }
    await delay(250);
  }
  log?.(`[desktop-recovery] renderer target never appeared: ${lastError}`);
  throw new Error(`the installed app exposed no renderer target within ${timeoutMs}ms`);
}

async function attachToTarget(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  await new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", () => rejectPromise(new Error("devtools websocket failed")), { once: true });
  });
  socket.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data));
    const waiter = pending.get(frame.id);
    if (!waiter) return;
    pending.delete(frame.id);
    if (frame.error) waiter.reject(new Error(frame.error.message ?? JSON.stringify(frame.error)));
    else waiter.resolve(frame.result);
  });

  const send = (method, params = {}) => new Promise((resolvePromise, rejectPromise) => {
    const id = (nextId += 1);
    pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
    socket.send(JSON.stringify({ id, method, params }));
  });

  /** Run one expression in the page and return its value. A rejection inside
   * the page becomes this call's rejection, so a failing journey step reports
   * its own message instead of a silent null. */
  const evaluate = async (expression, { awaitPromise = true } = {}) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text
        ?? "unknown page error";
      throw new Error(`renderer evaluation failed: ${text}`);
    }
    return result.result?.value;
  };

  await send("Runtime.enable");
  await send("Page.enable");

  const waitFor = async (expression, description, { timeoutMs: waitMs = 90_000, intervalMs = 250 } = {}) => {
    const limit = Date.now() + waitMs;
    let last = null;
    while (Date.now() < limit) {
      last = await evaluate(expression);
      if (last) return last;
      await delay(intervalMs);
    }
    throw new Error(`timed out waiting for ${description} (last value: ${JSON.stringify(last)})`);
  };

  return {
    send,
    evaluate,
    waitFor,
    close() {
      try { socket.close(); } catch { /* already closed */ }
    },
  };
}

/** The renderer document as the journey needs to see it: the transcript rows,
 * the composer's state, and the control that recovery renders. Serialized so a
 * step's evidence is plain JSON rather than a live reference. */
export const READ_CHAT_STATE = `(() => {
  const rows = [...document.querySelectorAll("[data-mid]")].map((node) => ({
    id: node.getAttribute("data-mid"),
    role: node.getAttribute("data-role") || undefined,
    text: (node.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240),
  }));
  const composer = document.querySelector("textarea");
  const recovery = [...document.querySelectorAll("button")].find((button) =>
    /choose folder and retry/i.test(button.textContent || ""));
  return {
    rows,
    composerDisabled: Boolean(composer?.disabled),
    composerBusy: composer?.getAttribute("aria-busy") || null,
    recoveryButton: recovery
      ? { text: (recovery.textContent || "").trim(), disabled: recovery.disabled }
      : null,
  };
})()`;

/** Click the shipped recovery control by its accessible text. A real click
 * through the element's own listener, not a synthetic dispatch of React
 * internals, so this exercises the same path a user's mouse takes. */
export const CLICK_RECOVERY = `(() => {
  const button = [...document.querySelectorAll("button")].find((candidate) =>
    /choose folder and retry/i.test(candidate.textContent || ""));
  if (!button) return { clicked: false, reason: "no recovery control in the transcript" };
  if (button.disabled) return { clicked: false, reason: "recovery control is disabled" };
  button.click();
  return { clicked: true };
})()`;

export async function saveScreenshot(renderer, evidenceDir, name) {
  mkdirSync(evidenceDir, { recursive: true });
  const shot = await renderer.send("Page.captureScreenshot", { format: "png" });
  const path = join(evidenceDir, `${name}.png`);
  writeFileSync(path, Buffer.from(shot.data, "base64"));
  return path;
}

/** Launch the installed package in its own process group, so teardown reaches
 * the app, its server child and anything it forked. Everything the app printed
 * is kept in memory and written to `logPath` on stop, whether the run passed or
 * failed: a failing journey that swallowed its own app log is unusable. */
export function spawnInstalledApp({ executable, args, env, logPath }) {
  const child = spawn(executable, args, {
    cwd: "/",
    detached: true,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output.push(chunk);
      if (output.length > 4000) output.splice(0, 2000);
    });
  }
  const save = () => {
    if (!logPath) return null;
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      writeFileSync(logPath, output.join(""));
      return logPath;
    } catch {
      return null;
    }
  };
  return {
    child,
    pid: child.pid,
    text: () => output.join(""),
    logPath,
    stop: async function stop() {
      if (running(child)) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
        const grace = Date.now() + 15_000;
        while (running(child) && Date.now() < grace) await delay(100);
        if (running(child)) {
          try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
        }
        await new Promise((resolvePromise) => child.once("close", resolvePromise));
      }
      return save();
    },
  };
}