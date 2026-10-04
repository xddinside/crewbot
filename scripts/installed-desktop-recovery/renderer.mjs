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
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5_000) });
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
    const timer = setTimeout(() => rejectPromise(new Error("the devtools websocket did not open within 30s")), 30_000);
    timer.unref?.();
    socket.addEventListener("open", () => { clearTimeout(timer); resolvePromise(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); rejectPromise(new Error("devtools websocket failed")); }, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data));
    const waiter = pending.get(frame.id);
    if (!waiter) return;
    pending.delete(frame.id);
    if (frame.error) waiter.reject(new Error(frame.error.message ?? JSON.stringify(frame.error)));
    else waiter.resolve(frame.result);
  });

  /** One DevTools round trip, bounded.
   *
   * The protocol has no reply timeout: a renderer that never answers, or a page
   * whose evaluated promise never settles, leaves the request id in `pending`
   * forever. That is a hang the whole job inherits, so every request carries its
   * own deadline and the failed id is dropped rather than leaked. */
  const send = (method, params = {}, { timeoutMs = 60_000 } = {}) => new Promise((resolvePromise, rejectPromise) => {
    const id = (nextId += 1);
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectPromise(new Error(`${method} did not answer within ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolvePromise(value); },
      reject: (error) => { clearTimeout(timer); rejectPromise(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });

  /** Run one expression in the page and return its value. A rejection inside
   * the page becomes this call's rejection, so a failing journey step reports
   * its own message instead of a silent null. */
  const evaluate = async (expression, { awaitPromise = true, timeoutMs = 60_000 } = {}) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    }, { timeoutMs });
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
      // Each poll gets what is left of this wait, so an unresponsive renderer
      // ends the step by name instead of outliving the wait that contains it.
      last = await evaluate(expression, { timeoutMs: Math.max(1_000, limit - Date.now()) });
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

/** Create the fixture's bot from inside the renderer.
 *
 * The installed server refuses a mutating loopback request that does not carry
 * the desktop app's own capability token:
 * `403 forbidden: this change must come from the desktop app or a paired
 * device`. That guard is the product's, and it is correct — a bare HTTP client
 * on loopback is exactly what it must refuse. So the mutation is issued from the
 * shipped renderer, through the app's own client code that supplies the token,
 * rather than from the fixture's `fetch`. The guard is not relaxed and the
 * desktop-owner token is not read out of the process. */
export const createBotInRenderer = (name, modelSelection) => `(async () => {
  const response = await fetch("/api/bots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(${JSON.stringify({ name, modelSelection })}),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: response.status, body };
})()`;

/** A mutating request issued from inside the shipped renderer.
 *
 * The installed server refuses a mutating loopback request without the desktop
 * app's own capability token (`403 … must come from the desktop app or a paired
 * device`). That guard is correct — a bare loopback client is exactly what it
 * must refuse — so the fixture issues its mutations from the renderer, through
 * the app's own client code that carries the token. The guard is not relaxed and
 * the token is never read out of the process.
 *
 * `body` may be omitted for an empty POST. */
export const mutateInRenderer = (path, { method = "POST", body = null } = {}) => `(async () => {
  const response = await fetch(${JSON.stringify(path)}, {
    method: ${JSON.stringify(method)},
    headers: { "content-type": "application/json" },
    ...(${body === null ? "false" : `true`} ? { body: JSON.stringify(${JSON.stringify(body)}) } : {}),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: response.status, body: parsed };
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

/** Selection and expansion are separate shipped controls. Wait for each React
 * render before trying the next control, then prove the requested thread is
 * current before a composer send or an approval grant. */
export async function selectThread(renderer, { botId, botName, threadId, timeoutMs = 30_000 }) {
  const botSelector = JSON.stringify(`[data-sidebar-bot-row="${botId}"]`);
  const threadSelector = JSON.stringify(`[data-sidebar-thread-row="${threadId}"]`);
  const options = { timeoutMs };
  await renderer.waitFor(`Boolean(document.querySelector(${botSelector}))`, `bot ${botId} in the sidebar`, options);
  await renderer.evaluate(`document.querySelector(${botSelector}).click()`);
  const expanded = await renderer.evaluate(`(() => {
    const label = ${JSON.stringify(`Expand ${botName} threads`)};
    const toggle = [...document.querySelectorAll('button[aria-expanded]')]
      .find((button) => button.getAttribute("aria-label") === label);
    if (toggle) toggle.click();
    return Boolean(toggle);
  })()`);
  await renderer.waitFor(`Boolean(document.querySelector(${threadSelector}))`, `thread ${threadId} after sidebar expansion`, options);
  await renderer.evaluate(`document.querySelector(${threadSelector}).click()`);
  await renderer.waitFor(
    `document.querySelector(${threadSelector})?.getAttribute("aria-current") === "page"`,
    `thread ${threadId} to be current`, options,
  );
  return { botId, threadId, expanded };
}

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
  // Register before asking the process group to exit. `close` can fire while a
  // grace period is running, and registering afterward loses that event.
  const closed = new Promise((resolveClosed) => child.once("close", resolveClosed));
  child.on("error", (error) => output.push(`app launch failed: ${error.message}\n`));
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
  const closedWithin = async (timeoutMs) => {
    let timer;
    try {
      return await Promise.race([
        closed.then(() => true),
        new Promise((resolveTimeout) => { timer = setTimeout(() => resolveTimeout(false), timeoutMs); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  let stopping;
  return {
    child,
    pid: child.pid,
    text: () => output.join(""),
    logPath,
    stop() {
      stopping ??= (async () => {
        try {
          if (child.pid) {
            try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
          }
          if (!await closedWithin(15_000)) {
            try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
            if (!await closedWithin(5_000)) {
              throw new Error(`installed app process group ${child.pid} did not close after SIGKILL`);
            }
          }
          return save();
        } finally {
          save();
        }
      })();
      return stopping;
    },
  };
}

export const chooseApprovalMode = (label) => `(() => {
  const wanted = ${JSON.stringify(label)};
  const menu = [...document.querySelectorAll('[role="menu"]')].find((node) =>
    /approval mode/i.test(node.getAttribute("aria-label") || ""));
  if (!menu) return { opened: false, reason: "the approval menu did not open" };
  const entry = [...menu.querySelectorAll('[role="menuitemradio"]')]
    // The menu item includes a description. Its first nested span is the
    // visible title line; matching the whole item joins title + description.
    .find((button) => (button.querySelector("span > span")?.textContent || "").trim().toLowerCase() === wanted.toLowerCase());
  if (!entry) {
    return { opened: true, selected: false,
      offered: [...menu.querySelectorAll('[role="menuitemradio"]')].map((b) => (b.textContent || "").trim()) };
  }
  if (entry.disabled) return { opened: true, selected: false, reason: "the entry is disabled" };
  entry.click();
  return { opened: true, selected: true };
})()`;
