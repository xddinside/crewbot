// Installed desktop recovery: the real candidate package, the real native folder
// chooser, the exact failed request retried once.
//
// Sequence, all inside one disposable root this run owns:
//
//   1. hold every candidate artifact file to its pinned SHA-256 and fail closed
//   2. install the pinned candidate .deb, then launch /opt/crewbot/crewbot
//   3. seed the installed app's own config with the repository's deterministic
//      fake engines and an already-finished welcome flow, pin a bot to a folder,
//      then delete that folder underneath it
//   4. send a real message from the real composer and reach the real
//      missing-working-folder failure row
//   5. click the shipped recovery control, drive the real GTK chooser window,
//      and require the exact replacement folder to come back through the
//      production preload bridge
//   6. prove the retry: the exact failed request runs once, the transcript is
//      preserved, the pinned folder changed, and only that thread's provider
//      continuation was cleared
//   7. cancel a chooser and prove nothing changed
//   8. double activation and prove one chooser, one PATCH, one replay
//   9. stale selection: switch threads while the chooser is open and prove
//      nothing was patched and nothing was replayed
//  10. approval/grant and thread-scoped Stop on synthetic actions
//  11. remove every window, child, package and path this run created
//
// The renderer is driven through the installed app's own Chromium DevTools
// endpoint, so every step is a real DOM event in the shipped renderer against
// the shipped server. The chooser is driven with real keystrokes inside the
// fixture's own X display. Nothing is stubbed.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectFixtureLogs,
  createFixtureEnvironment,
  fixtureBaseEnv,
  startOwnedDisplay,
  startOwnedSessionBus,
  startOwnedWindowManager,
} from "./installed-desktop-recovery/environment.mjs";
import {
  CLICK_RECOVERY,
  READ_CHAT_STATE,
  connectToRenderer,
  mutateInRenderer,
  saveScreenshot,
  spawnInstalledApp,
} from "./installed-desktop-recovery/renderer.mjs";
import {
  cancelFolder,
  captureWindow,
  countChooserWindows,
  chooseFolder,
  waitForChooserClosed,
  waitForFolderChooser,
} from "./installed-desktop-recovery/native-picker.mjs";
import {
  assertPinnedFile,
  candidateDeb,
  sha256File,
  verifyCandidateArtifact,
} from "./installed-desktop-recovery/inputs.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fakeCli = join(repoRoot, "server", "testing", "fake-claude-cli.ts");
const installedExecutable = "/opt/crewbot/crewbot";
const evidence = { steps: [], observations: [], screenshots: [], windows: [], logs: [] };
const started = Date.now();

const BOT_NAME = "Folder recovery fixture";
const ENGINE_NAME = "Recovery fixture";
const SIBLING_THREAD_TITLE = "Sibling thread";
const FAILED_REQUEST = "Run the fixture check in the working folder";
const SIBLING_REQUEST = "Answer in the sibling thread first";
// The composer's approval-mode trigger is named "<mode> for <provider>", so the
// provider's display name is the one anchor that is unique on the page.
const APPROVAL_TRIGGER_SUFFIX = ` for ${ENGINE_NAME}`;

function step(name, detail) {
  console.log(`[desktop-recovery] ${name}${detail ? `: ${detail}` : ""}`);
  evidence.steps.push({ name, detail: detail ?? null, at: new Date().toISOString() });
}

/** Record what the server durably holds for one thread beside what the
 * transcript shows. A screenshot says the control was there; this says what the
 * app then did with it, so the uploaded artifact carries both halves of the
 * claim without anybody having to re-run the journey. */
function observe(label, dataDir, botId, threadId, messages) {
  const task = storedTasks(dataDir, botId).get(threadId);
  evidence.observations.push({
    label,
    at: new Date().toISOString(),
    thread: {
      threadId,
      cwd: task?.cwd ?? null,
      resumeCursors: Object.keys(task?.resumeCursors ?? {}),
      lastInstanceId: task?.lastInstanceId ?? null,
      busy: Boolean(task?.busy),
      activity: task?.activity ?? null,
    },
    transcript: (messages ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      kind: message.kind,
      tool: message.tool?.name ?? null,
    })),
  });
}

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function asRoot(args) {
  return execFileSync("sudo", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

async function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
    probe.on("error", rejectPort);
  });
}

/** Read the installed app's own durable state. This is the file the packaged
 * server leases, so it is the same record the production PATCH mutates. */
function storedTasks(dataDir, botId) {
  const bots = JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"));
  const bot = bots.find((candidate) => candidate.id === botId);
  return new Map((bot?.tasks ?? []).map((task) => [task.threadId, task]));
}

async function api(base, path, init) {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: response.status, body };
}

async function waitForSettled(base, botId, threadId, { timeoutMs = 90_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = (await api(base, "/api/bots?messages=0")).body;
    const task = last?.bots?.find((bot) => bot.id === botId)?.tasks?.find((entry) => entry.threadId === threadId);
    if (task && !task.busy && task.activity === "idle") return task;
    await delay(300);
  }
  throw new Error(`thread ${threadId} never settled: ${JSON.stringify(last)}`);
}

/** The approval mode the server currently records for one thread. A thread that
 * has never been granted anything reports nothing at all, which is the same
 * thing as "ask", so this is what the refused-grant check compares against. */
async function readApprovalMode(base, botId, threadId) {
  const task = (await api(base, "/api/bots?messages=0")).body
    ?.bots?.find((bot) => bot.id === botId)?.tasks?.find((entry) => entry.threadId === threadId);
  if (!task) throw new Error(`thread ${threadId} is not in the bot payload`);
  return task.approvalMode ?? "ask";
}

/** Wait until the server itself records the granted approval mode. The grant
 * path is private to the packaged app, so the API is the only place to read the
 * result back. */
async function waitForApprovalMode(base, botId, threadId, expected, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let seen = null;
  while (Date.now() < deadline) {
    seen = (await api(base, "/api/bots?messages=0")).body
      ?.bots?.find((bot) => bot.id === botId)?.tasks?.find((task) => task.threadId === threadId)?.approvalMode;
    if (seen === expected) return seen;
    await delay(300);
  }
  throw new Error(`thread ${threadId} never recorded approval mode ${expected} (saw ${seen})`);
}

async function waitForFolderError(renderer, { timeoutMs = 90_000 } = {}) {
  return renderer.waitFor(
    `(() => {
      const state = ${READ_CHAT_STATE};
      const failure = state.rows.find((row) => /the working folder .*no longer exists/i.test(row.text || ""));
      return failure ? { ...state, failure } : null;
    })()`,
    "the missing-working-folder failure row",
    { timeoutMs },
  );
}

const sendThroughComposer = (text) => `(() => {
  const composer = document.querySelector("textarea");
  if (!composer) return { sent: false, reason: "no composer" };
  if (composer.disabled) return { sent: false, reason: "composer is disabled" };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(composer, ${JSON.stringify(text)});
  composer.dispatchEvent(new Event("input", { bubbles: true }));
  composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  return { sent: true };
})()`;

const SELECT_THREAD = (threadId) => `(() => {
  const row = document.querySelector('[data-sidebar-thread-row="' + ${JSON.stringify(threadId)} + '"]');
  if (!row) return { clicked: false, reason: "thread row is not in the sidebar" };
  row.click();
  return { clicked: true };
})()`;

/** `aria-current="page"` is what SidebarThreadRow puts on the selected row, so
 * it is the shipped signal that the renderer really switched threads. */
const THREAD_IS_CURRENT = (threadId) => `(() => {
  const row = document.querySelector('[data-sidebar-thread-row="' + ${JSON.stringify(threadId)} + '"]');
  return row?.getAttribute("aria-current") === "page";
})()`;

const CLICK_STOP = `(() => {
  const stop = [...document.querySelectorAll("button")].find((button) =>
    /stop this turn/i.test(button.getAttribute("aria-label") || ""));
  if (!stop) return { clicked: false, reason: "no Stop control; the turn is not running" };
  stop.click();
  return { clicked: true };
})()`;

/**
 * Grant Full access the way a person does: open the installed composer's own
 * approval menu, choose the entry, then confirm the warning it opens. Both
 * clicks are real DOM clicks on shipped components, so the grant travels the
 * production path: renderer -> store -> preload -> private Electron IPC -> the
 * embedded server's utility port.
 */
const CHOOSE_APPROVAL_MODE = (label) => `(() => {
  const wanted = ${JSON.stringify(label)};
  const trigger = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
    .find((button) => (button.getAttribute("aria-label") || "").endsWith(${JSON.stringify(APPROVAL_TRIGGER_SUFFIX)}));
  if (!trigger) {
    return { opened: false, reason: "no approval-mode control for this provider",
      triggers: [...document.querySelectorAll('button[aria-haspopup="menu"]')]
        .map((button) => button.getAttribute("aria-label")) };
  }
  if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
  const menu = [...document.querySelectorAll('[role="menu"]')].find((node) =>
    /approval mode/i.test(node.getAttribute("aria-label") || ""));
  if (!menu) return { opened: false, reason: "the approval menu did not open" };
  const entry = [...menu.querySelectorAll('[role="menuitemradio"]')]
    .find((button) => new RegExp("^" + wanted + "$", "i").test((button.textContent || "").trim()));
  if (!entry) {
    return { opened: true, selected: false,
      offered: [...menu.querySelectorAll('[role="menuitemradio"]')].map((b) => (b.textContent || "").trim()) };
  }
  if (entry.disabled) return { opened: true, selected: false, reason: "the entry is disabled" };
  entry.click();
  return { opened: true, selected: true };
})()`;

const CONFIRM_APPROVAL_WARNING = `(() => {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) return { confirmed: false, reason: "the Full access warning did not open" };
  const confirm = [...dialog.querySelectorAll("button")]
    .find((button) => /enable full access/i.test(button.textContent || ""));
  if (!confirm) return { confirmed: false, reason: "the warning offered no confirm button",
    buttons: [...dialog.querySelectorAll("button")].map((b) => (b.textContent || "").trim()) };
  confirm.click();
  return { confirmed: true };
})()`;

async function main() {
  const runnerTemp = process.env.RUNNER_TEMP ?? process.env.TMPDIR ?? "/tmp";
  const candidateDir = process.env.OMB_RECOVERY_CANDIDATE_DIR;
  const manifestPath = process.env.OMB_RECOVERY_CANDIDATE_MANIFEST;
  const expectedSha = process.env.OMB_RECOVERY_CANDIDATE_SHA;
  if (!candidateDir || !manifestPath || !expectedSha) {
    throw new Error("OMB_RECOVERY_CANDIDATE_DIR, OMB_RECOVERY_CANDIDATE_MANIFEST and OMB_RECOVERY_CANDIDATE_SHA are required");
  }
  if (!existsSync(fakeCli)) throw new Error(`the repository's fake engine is missing: ${fakeCli}`);

  const manifest = verifyCandidateArtifact({ candidateDir, manifestPath, expectedSha });
  step("candidate artifact verified", `${manifest.files.length} files, source ${manifest.sha}`);
  const deb = candidateDeb(manifest.files).path;
  assertPinnedFile(deb, manifest.files.find((file) => file.path === deb));

  const fixture = createFixtureEnvironment(runnerTemp);
  let installed = false;
  let app = null;
  let renderer = null;
  try {
    const display = await startOwnedDisplay(fixture);
    const bus = startOwnedSessionBus(fixture);
    const windowManager = await startOwnedWindowManager(fixture, display.display);
    const env = fixtureBaseEnv(fixture, {
      display: display.display,
      dbusAddress: bus.address,
      windowManager: windowManager?.name,
    });
    step(
      "owned session ready",
      `DISPLAY=${display.display} dbus=${bus.address} window manager ${windowManager?.name ?? "none (focus falls back to XSetInputFocus)"}`,
    );

    const installLog = spawnSync("sudo", ["dpkg", "-i", deb], { encoding: "utf8" });
    if (installLog.status !== 0) {
      // `dpkg -i` cannot fetch the dependencies the package declares, and the
      // `apt-get -f` repair needs package lists plus those dependencies already
      // selected. Install them explicitly, then let apt configure. The runner
      // image carries none of them, so without this the install fails with
      // `libnotify4`/`libsecret-1-0` not installed.
      const repair = spawnSync(
        "sudo",
        [
          "apt-get", "install", "-y", "--no-install-recommends",
          // Electron's packaged runtime dependencies that the runner image omits.
          "libnotify4", "libsecret-1-0", "libnss3", "libasound2t64", "libgbm1",
          "libgtk-3-0", "libxss1", "libxtst6", "xdg-utils", "libdrm2",
        ],
        { encoding: "utf8" },
      );
      writeFileSync(
        join(fixture.logs, "dpkg-install.log"),
        `${installLog.stdout}\n${installLog.stderr}\n${repair.stdout}\n${repair.stderr}`,
      );
      step("dependency install", `exit ${repair.status}`);
      const configure = spawnSync("sudo", ["apt-get", "install", "-f", "-y"], { encoding: "utf8" });
      step("dependency repair", `exit ${configure.status}`);
      if (configure.status !== 0) {
        throw new Error(`installing the candidate package failed: ${configure.stderr || configure.stdout}`);
      }
    }
    installed = true;
    const installedVersion = spawnSync("dpkg-query", ["-W", "-f=${Version}", "crewbot"], { encoding: "utf8" }).stdout.trim();
    if (!existsSync(installedExecutable)) throw new Error(`the installed package has no executable at ${installedExecutable}`);
    // The shipped package owns this mode and the upgrade smoke asserts it. A
    // candidate that lost it could not start Chromium here, so it is checked
    // before launch rather than as an unexplained exit.
    const sandboxMode = statSync("/opt/crewbot/chrome-sandbox").mode & 0o7777;
    if (sandboxMode !== 0o4755) {
      throw new Error(`the installed Chromium sandbox is not 4755: ${sandboxMode.toString(8)}`);
    }
    step("candidate package installed", `${installedVersion} at ${installedExecutable}, chrome-sandbox 4755`);

    // The installed app's own data directory, with the repository's fake engines
    // as the only engines. `claude` is the happy engine the recovery journey runs
    // on; `hanging` is the same fake CLI in its documented `hang` mode, which is
    // what gives the installed composer's Stop a genuinely running turn.
    // The welcome flow is recorded as already finished: a first-run install
    // replaces the whole shell with it, and this journey is about the chat.
    const dataDir = join(fixture.home, ".crewbot");
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({
      instances: {
        claude: {
          driver: "claudeAgent",
          displayName: ENGINE_NAME,
          config: { cli: fakeCli },
          environment: { FAKE_CLAUDE_MODE: "happy" },
        },
        hanging: {
          driver: "claudeAgent",
          displayName: "Stop fixture",
          config: { cli: fakeCli },
          environment: { FAKE_CLAUDE_MODE: "hang" },
        },
      },
      onboarding: { completedAt: new Date().toISOString(), version: 1, reelSeen: true, hintsSeen: [] },
      profile: { name: "Recovery fixture" },
    }, null, 2), { mode: 0o600 });

    const debugPort = await freePort();
    app = spawnInstalledApp({
      executable: installedExecutable,
      // Chromium's password store is chosen per launch. This journey is about
      // folder recovery, so it names the backend rather than letting a headless
      // runner block on a keyring unlock prompt. Credential continuity across an
      // upgrade is T01's subject with a real unlocked keyring, not this one.
      args: [`--remote-debugging-port=${debugPort}`, "--password-store=basic"],
      env: { ...env, CREWBOT_DATA_DIR: dataDir },
      logPath: join(fixture.logs, "app.log"),
    });
    fixture.own(() => app.stop());
    step("installed app launched", `pid ${app.pid}, devtools on 127.0.0.1:${debugPort}`);

    renderer = await connectToRenderer({ port: debugPort, child: app.child, log: console.log });
    const location = await renderer.waitFor(
      "window.location.origin.startsWith('http://127.0.0.1:') ? window.location.href : null",
      "the embedded renderer's loopback origin",
    );
    const base = new URL(location).origin;
    step("renderer attached", location);

    // ── the synthetic conversation that reaches the failure ──
    // Mutations are issued from inside the shipped renderer. The installed
    // server refuses a bare loopback client with `403 … must come from the
    // desktop app or a paired device`, and that guard is the product's, so the
    // journey goes through the app's own client code rather than around it.
    const mutate = (path, init) => renderer.evaluate(mutateInRenderer(path, init));
    const created = await mutate("/api/bots", {
      body: { name: BOT_NAME, modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } },
    });
    if (created.status >= 400) throw new Error(`creating the fixture bot failed: ${JSON.stringify(created)}`);
    const botId = created.body.bot.id;
    const failedThread = created.body.bot.threadId;
    const pinned = await mutate(`/api/bots/${botId}`, {
      method: "PATCH", body: { cwd: fixture.missingCwd },
    });
    if (pinned.status >= 400) throw new Error(`pinning the working folder failed: ${JSON.stringify(pinned)}`);

    const sibling = await mutate(`/api/bots/${botId}/tasks`, { body: { title: SIBLING_THREAD_TITLE } });
    if (sibling.status >= 400) throw new Error(`creating the sibling thread failed: ${JSON.stringify(sibling)}`);
    const siblingThread = sibling.body.task.threadId;
    step("fixture bot ready", `bot ${botId}, failed thread ${failedThread}, sibling ${siblingThread}`);

    await mutate(`/api/bots/${botId}/messages`, { body: { text: SIBLING_REQUEST, threadId: siblingThread } });
    await waitForSettled(base, botId, siblingThread);
    const beforeFailure = storedTasks(dataDir, botId);
    const siblingBefore = beforeFailure.get(siblingThread);
    if (!Object.keys(siblingBefore?.resumeCursors ?? {}).length) {
      throw new Error("the sibling thread has no provider continuation to protect");
    }
    step("sibling continuation established", `${Object.keys(siblingBefore.resumeCursors).length} cursor(s)`);

    // The folder goes away underneath the bot, then the user opens the failed
    // thread in the real sidebar and types into the real composer.
    rmSync(fixture.missingCwd, { recursive: true, force: true });
    const selectBot = await renderer.evaluate(
      `(() => {
        const row = document.querySelector('[data-sidebar-bot-row="' + ${JSON.stringify(botId)} + '"]');
        if (!row) return { clicked: false, reason: "bot row missing" };
        row.click();
        return { clicked: true };
      })()`,
    );
    if (!selectBot.clicked) throw new Error(`could not select the fixture bot in the sidebar: ${JSON.stringify(selectBot)}`);
    // Creating the sibling thread made it the bot's selected task, so the failed
    // thread is opened by its own sidebar row — the same click a user makes.
    const opened = await renderer.evaluate(SELECT_THREAD(failedThread));
    if (!opened.clicked) throw new Error(`the failed thread was not in the sidebar: ${JSON.stringify(opened)}`);
    await renderer.waitFor(THREAD_IS_CURRENT(failedThread), `thread ${failedThread} to be current`, { timeoutMs: 30_000 });

    const sent = await renderer.evaluate(sendThroughComposer(FAILED_REQUEST));
    if (!sent.sent) throw new Error(`the composer did not accept the request: ${JSON.stringify(sent)}`);
    const failure = await waitForFolderError(renderer);
    const failedTranscript = await api(base, `/api/threads/${failedThread}/messages?limit=50`);
    const failedUser = failedTranscript.body.messages.find((message) => message.role === "user" && message.text === FAILED_REQUEST);
    if (!failedUser) throw new Error("the failed human request is not in the transcript");
    evidence.screenshots.push(await saveScreenshot(renderer, fixture.evidence, "01-missing-working-folder"));
    observe("after the missing-working-folder failure", dataDir, botId, failedThread, failedTranscript.body.messages);
    step("reached the missing-working-folder failure", `error ${failure.failure.id}, user ${failedUser.id}`);

    // ── cancel: the chooser opens and the user presses Escape ──
    const cancelClick = await renderer.evaluate(CLICK_RECOVERY);
    if (!cancelClick.clicked) throw new Error(`the recovery control was not activatable: ${JSON.stringify(cancelClick)}`);
    const cancelledChooser = await waitForFolderChooser({ env });
    evidence.windows.push({ phase: "cancel", ...cancelledChooser });
    evidence.screenshots.push(captureWindow({ env, id: cancelledChooser.id, path: join(fixture.evidence, "02-native-chooser-cancel.png") }));
    const cancelInput = await cancelFolder({ env, id: cancelledChooser.id });
    await waitForChooserClosed({ env, id: cancelledChooser.id });
    await waitForSettled(base, botId, failedThread, { timeoutMs: 30_000 });
    const afterCancel = storedTasks(dataDir, botId);
    const afterCancelTranscript = (await api(base, `/api/threads/${failedThread}/messages?limit=50`)).body.messages;
    if (afterCancel.get(failedThread)?.cwd !== fixture.missingCwd) {
      throw new Error("a cancelled chooser changed the pinned working folder");
    }
    if (JSON.stringify(afterCancelTranscript.map((m) => m.id)) !== JSON.stringify(failedTranscript.body.messages.map((m) => m.id))) {
      throw new Error("a cancelled chooser changed the transcript");
    }
    if (afterCancel.get(failedThread).resumeCursors !== undefined) {
      throw new Error("a cancelled chooser touched the provider continuation");
    }
    evidence.screenshots.push(await saveScreenshot(renderer, fixture.evidence, "03-after-cancel"));
    observe("after the cancelled chooser", dataDir, botId, failedThread, afterCancelTranscript);
    step("chooser cancellation changed nothing", `focus via ${cancelInput.focus} (${cancelInput.attempts.join(", ")})`);

    // ── the real chooser chooses a real folder, and the exact request retries once ──
    const chooseClick = await renderer.evaluate(CLICK_RECOVERY);
    if (!chooseClick.clicked) throw new Error(`the recovery control was not activatable: ${JSON.stringify(chooseClick)}`);
    const chooser = await waitForFolderChooser({ env });
    evidence.windows.push({ phase: "choose", ...chooser });
    evidence.screenshots.push(captureWindow({ env, id: chooser.id, path: join(fixture.evidence, "04-native-chooser.png") }));
    const chooseInput = await chooseFolder({ env, id: chooser.id, path: fixture.replacementCwd });
    await waitForChooserClosed({ env, id: chooser.id });
    await waitForSettled(base, botId, failedThread);
    evidence.screenshots.push(await saveScreenshot(renderer, fixture.evidence, "05-after-recovery"));

    const recovered = storedTasks(dataDir, botId);
    if (recovered.get(failedThread)?.cwd !== fixture.replacementCwd) {
      throw new Error(
        `the chooser did not pin the folder it returned: ${recovered.get(failedThread)?.cwd} (want ${fixture.replacementCwd})`,
      );
    }
    if (Object.keys(recovered.get(failedThread)?.resumeCursors ?? {}).length) {
      throw new Error("recovery did not clear the failed thread's provider continuation");
    }
    const afterRetry = (await api(base, `/api/threads/${failedThread}/messages?limit=50`)).body.messages;
    const failedUserRepeats = afterRetry.filter((message) => message.role === "user" && message.text === FAILED_REQUEST);
    if (failedUserRepeats.length !== 2) {
      throw new Error(`expected the failed request to be retried exactly once, found ${failedUserRepeats.length} copies`);
    }
    for (const message of failedTranscript.body.messages) {
      if (!afterRetry.some((candidate) => candidate.id === message.id)) {
        throw new Error(`recovery lost transcript row ${message.id}`);
      }
    }
    const siblingAfter = storedTasks(dataDir, botId).get(siblingThread);
    if (JSON.stringify(siblingAfter.resumeCursors) !== JSON.stringify(siblingBefore.resumeCursors)) {
      throw new Error("recovery cleared the sibling thread's provider continuation");
    }
    if (siblingAfter.lastInstanceId !== siblingBefore.lastInstanceId) {
      throw new Error("recovery replaced the sibling thread's provider instance");
    }
    observe("after the native chooser recovery", dataDir, botId, failedThread, afterRetry);
    observe("sibling thread after the native chooser recovery", dataDir, botId, siblingThread,
      (await api(base, `/api/threads/${siblingThread}/messages?limit=50`)).body.messages);
    step(
      "native chooser recovery succeeded",
      `focus via ${chooseInput.focus} (${chooseInput.attempts.join(", ")}), retry replayed once, transcript preserved, sibling untouched`,
    );

    // ── a fresh failure for the two cases that follow ──
    // Recovery pinned the task to the folder the chooser returned, so removing
    // that folder puts a new terminal failure on the same thread without
    // touching the recovery path under test.
    const pinnedBeforeSecondFailure = storedTasks(dataDir, botId).get(failedThread)?.cwd;
    rmSync(pinnedBeforeSecondFailure, { recursive: true, force: true });
    const secondSend = await renderer.evaluate(sendThroughComposer(FAILED_REQUEST));
    if (!secondSend.sent) throw new Error(`the composer did not accept the second request: ${JSON.stringify(secondSend)}`);
    const secondFailure = await waitForFolderError(renderer);
    const staleTranscript = (await api(base, `/api/threads/${failedThread}/messages?limit=80`)).body.messages;
    const staleUser = staleTranscript.filter((message) => message.role === "user" && message.text === FAILED_REQUEST).at(-1);
    evidence.screenshots.push(await saveScreenshot(renderer, fixture.evidence, "06-second-missing-working-folder"));
    observe("after the second missing-working-folder failure", dataDir, botId, failedThread, staleTranscript);
    step("second terminal folder failure reached", `error ${secondFailure.failure.id}, user ${staleUser?.id}`);

    // ── duplicate activation: two activations of one row, one lifecycle ──
    const duplicateClick = await renderer.evaluate(
      `(() => {
        const button = [...document.querySelectorAll("button")].find((candidate) =>
          /choose folder and retry/i.test(candidate.textContent || ""));
        if (!button) return { clicked: 0, reason: "no recovery control" };
        button.click();
        const again = [...document.querySelectorAll("button")].find((candidate) =>
          /choose folder and retry/i.test(candidate.textContent || ""));
        const disabled = Boolean(again?.disabled);
        again?.click();
        return { clicked: 2, disabledAfterFirst: disabled };
      })()`,
    );
    const duplicateChooser = await waitForFolderChooser({ env });
    // Two activations of one row must open exactly one chooser, not two.
    await delay(2_000);
    const chooserWindows = countChooserWindows({ env });
    evidence.windows.push({ phase: "duplicate", ...duplicateChooser, openWindows: chooserWindows });
    if (chooserWindows !== 1) {
      throw new Error(`two activations opened ${chooserWindows} native choosers; exactly one lifecycle may run`);
    }
    await cancelFolder({ env, id: duplicateChooser.id });
    await waitForChooserClosed({ env, id: duplicateChooser.id });
    await waitForSettled(base, botId, failedThread, { timeoutMs: 30_000 });
    const afterDuplicate = storedTasks(dataDir, botId);
    const afterDuplicateTranscript = (await api(base, `/api/threads/${failedThread}/messages?limit=80`)).body.messages;
    if (afterDuplicate.get(failedThread)?.cwd !== pinnedBeforeSecondFailure) {
      throw new Error("a cancelled duplicate lifecycle patched the pinned folder");
    }
    if (JSON.stringify(afterDuplicateTranscript.map((m) => m.id)) !== JSON.stringify(staleTranscript.map((m) => m.id))) {
      throw new Error("a duplicate activation queued a retry");
    }
    observe("after the duplicate activation", dataDir, botId, failedThread, afterDuplicateTranscript);
    step(
      "duplicate activation queued one lifecycle",
      `second activation disabled=${duplicateClick.disabledAfterFirst}, chooser windows=${chooserWindows}`,
    );

    // ── stale selection: switch threads while the chooser is open ──
    // A second valid folder exists so the stale chooser can still be given a
    // real selection — the point is what the app does with it, not whether GTK
    // works.
    const staleClick = await renderer.evaluate(CLICK_RECOVERY);
    if (!staleClick.clicked) throw new Error("the recovery control was not activatable for the stale case");
    const staleChooser = await waitForFolderChooser({ env });
    evidence.windows.push({ phase: "stale", ...staleChooser });
    const switchResult = await renderer.evaluate(SELECT_THREAD(siblingThread));
    if (!switchResult.clicked) throw new Error("could not switch to the sibling thread while the chooser was open");
    await renderer.waitFor(THREAD_IS_CURRENT(siblingThread), "the sibling thread to become current", { timeoutMs: 30_000 });
    const chooseStale = await chooseFolder({ env, id: staleChooser.id, path: fixture.alternateCwd });
    await waitForChooserClosed({ env, id: staleChooser.id });
    await delay(2_000);
    const afterStale = storedTasks(dataDir, botId);
    const afterStaleFailedTranscript = (await api(base, `/api/threads/${failedThread}/messages?limit=80`)).body.messages;
    if (afterStale.get(failedThread)?.cwd !== pinnedBeforeSecondFailure) {
      throw new Error(
        `a stale selection patched the thread it was opened from: ${afterStale.get(failedThread)?.cwd}`,
      );
    }
    if (afterStale.get(siblingThread)?.cwd === fixture.alternateCwd) {
      throw new Error("a stale selection patched the sibling thread");
    }
    if (JSON.stringify(afterStale.get(siblingThread)?.resumeCursors ?? {})
      !== JSON.stringify(siblingBefore.resumeCursors)) {
      throw new Error("a stale selection cleared the sibling thread's continuation");
    }
    if (JSON.stringify(afterStaleFailedTranscript.map((m) => m.id)) !== JSON.stringify(staleTranscript.map((m) => m.id))) {
      throw new Error("a stale selection replayed a request");
    }
    evidence.screenshots.push(await saveScreenshot(renderer, fixture.evidence, "07-after-stale-selection"));
    observe("after the stale selection, failed thread", dataDir, botId, failedThread, afterStaleFailedTranscript);
    observe("after the stale selection, sibling thread", dataDir, botId, siblingThread,
      (await api(base, `/api/threads/${siblingThread}/messages?limit=80`)).body.messages);
    step("stale selection did nothing", `error ${secondFailure.failure.id}, user ${staleUser?.id}, focus via ${chooseStale.focus}`);

    // ── the installed app's own approval/grant policy ──
    // Full and Custom access cannot be granted over loopback HTTP: the server
    // refuses them for every client that is not the packaged desktop. That
    // refusal is checked first, then the renderer's own control is used, which
    // is exactly what a user clicks and the only path that can grant it.
    const modeBefore = await readApprovalMode(base, botId, failedThread);
    const overHttp = await api(base, `/api/bots/${botId}/tasks/${failedThread}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalMode: "full" }),
    });
    if (overHttp.status < 400) {
      throw new Error(`loopback HTTP granted a trusted approval mode (${overHttp.status}); the private grant path is not the only path`);
    }
    const modeAfterRefusal = await readApprovalMode(base, botId, failedThread);
    if (modeAfterRefusal !== modeBefore) {
      throw new Error(`a refused grant changed the thread's approval mode: ${modeBefore} -> ${modeAfterRefusal}`);
    }
    const approval = await renderer.evaluate(CHOOSE_APPROVAL_MODE("Full access"));
    if (!approval.opened) throw new Error(`the approval-mode control was not present: ${JSON.stringify(approval)}`);
    if (!approval.selected) throw new Error(`the installed menu offered no Full access entry: ${JSON.stringify(approval)}`);
    const confirmed = await renderer.evaluate(CONFIRM_APPROVAL_WARNING);
    if (!confirmed.confirmed) throw new Error(`the Full access warning was not confirmed: ${JSON.stringify(confirmed)}`);
    await waitForApprovalMode(base, botId, failedThread, "full");
    evidence.screenshots.push(await saveScreenshot(renderer, fixture.evidence, "08-approval-granted"));
    step(
      "installed approval grant applied",
      `loopback grant refused ${overHttp.status} (${overHttp.body?.error ?? "no reason"}); ` +
      `Full access granted through the renderer's own control`,
    );

    // ── thread-scoped Stop on a synthetic running turn ──
    // A second bot uses the repository's hanging fake engine, so its turn really
    // is running and the installed composer's Stop really has something to stop.
    const stopBot = await mutate("/api/bots", {
      body: { name: "Stop fixture", modelSelection: { instanceId: "hanging", model: "claude-sonnet-5" } },
    });
    if (stopBot.status >= 400) throw new Error(`creating the stop fixture bot failed: ${JSON.stringify(stopBot)}`);
    const stopBotId = stopBot.body.bot.id;
    const stopThread = stopBot.body.bot.threadId;
    const openedStop = await renderer.evaluate(
      `(() => {
        const row = document.querySelector('[data-sidebar-bot-row="' + ${JSON.stringify(stopBotId)} + '"]');
        if (!row) return { clicked: false };
        row.click();
        return { clicked: true };
      })()`,
    );
    if (!openedStop.clicked) throw new Error("the stop fixture bot was not in the sidebar");
    const stopSent = await renderer.evaluate(sendThroughComposer("Keep this turn running"));
    if (!stopSent.sent) throw new Error(`the stop fixture composer refused the request: ${JSON.stringify(stopSent)}`);
    await renderer.waitFor(
      `[...document.querySelectorAll("button")].some((button) => /stop this turn/i.test(button.getAttribute("aria-label") || ""))`,
      "the installed Stop control while a turn is running",
      { timeoutMs: 60_000 },
    );
    const stopped = await renderer.evaluate(CLICK_STOP);
    if (!stopped.clicked) throw new Error(`Stop did not activate: ${JSON.stringify(stopped)}`);
    await waitForSettled(base, stopBotId, stopThread, { timeoutMs: 90_000 });
    const afterStop = storedTasks(dataDir, stopBotId).get(stopThread);
    if (afterStop.busy) throw new Error("Stop left the stopped thread busy");
    // Stopped work must not land late. The fake engine in `hang` mode never
    // replies at all, so the window below is what a late write would have to
    // slip through: re-read after it and require the thread still idle and
    // still empty of assistant rows.
    await delay(3_000);
    const settledAgain = storedTasks(dataDir, stopBotId).get(stopThread);
    if (settledAgain.busy) throw new Error("the stopped thread became busy again after Stop");
    const afterStopTranscript = (await api(base, `/api/threads/${stopThread}/messages?limit=50`)).body.messages;
    const cancelledAssistant = afterStopTranscript.filter((message) => message.role === "bot" && message.kind === "text");
    if (cancelledAssistant.length) {
      throw new Error(`stopped work applied a stale assistant answer: ${cancelledAssistant.map((m) => m.id).join(", ")}`);
    }
    // The sibling thread of the recovery bot is still usable after that Stop.
    const siblingStillWorks = await mutate(`/api/bots/${botId}/messages`,
      { body: { text: "Still usable after the other thread was stopped", threadId: siblingThread } });
    if (siblingStillWorks.status >= 400) throw new Error(`the sibling stopped working: ${JSON.stringify(siblingStillWorks)}`);
    await waitForSettled(base, botId, siblingThread);
    evidence.screenshots.push(await saveScreenshot(renderer, fixture.evidence, "09-after-stop"));
    observe("after the thread-scoped Stop", dataDir, stopBotId, stopThread, afterStopTranscript);
    step("thread-scoped Stop cancelled only its own turn", `stopped ${stopThread}, sibling ${siblingThread} still answered`);

    renderer.close();
    renderer = null;
    await app.stop();
    app = null;
    step("installed app stopped", "renderer closed and process group reaped");

    const digest = sha256File(deb);
    if (digest !== manifest.files.find((file) => file.path === deb).sha256) {
      throw new Error("the installed package digest changed under the run");
    }
    step("journey complete", `${evidence.screenshots.length} screenshots, ${evidence.windows.length} chooser windows`);
  } finally {
    renderer?.close();
    if (app) await app.stop();
    evidence.logs = collectFixtureLogs(fixture, fixture.evidence);
    if (installed) {
      try {
        asRoot(["dpkg", "--purge", "crewbot"]);
        rmSync("/opt/crewbot", { recursive: true, force: true });
        step("installed package removed", "dpkg --purge crewbot, /opt/crewbot removed");
      } catch (error) {
        console.error(`[desktop-recovery] WARNING could not purge the installed package: ${error?.message ?? error}`);
      }
    }
    writeFileSync(join(fixture.root, "evidence.json"), JSON.stringify({
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      observations: evidence.observations,
      screenshots: evidence.screenshots,
      windows: evidence.windows,
      logs: evidence.logs,
      steps: evidence.steps,
    }, null, 2));
    console.log(`[desktop-recovery] evidence: ${fixture.root}`);
    if (process.env.OMB_KEEP_RECOVERY_FIXTURE === "1") {
      step("fixture kept", fixture.root);
      // Keep the evidence on disk but stop the owned display, bus and app. Left
      // running they hold this process's event loop open, so the job hangs to
      // its timeout and the real failure is never reported.
      for (const restore of [...fixture.stopped].reverse()) {
        try { restore(); } catch { /* teardown must not mask the real failure */ }
      }
      fixture.stopped.length = 0;
    } else {
      fixture.stop();
    }
  }
}

await main().catch((error) => {
  console.error(`[desktop-recovery] FAILED: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
// The runner's timeout must never be how this run reports itself: leave on the
// recorded exit code once teardown has run.
process.exit(process.exitCode ?? 0);