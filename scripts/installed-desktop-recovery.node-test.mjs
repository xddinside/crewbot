// Fail-closed guards of the installed desktop recovery fixture, proven without
// an installed package, an X server or a display.
//
// The runner-only journey cannot run on a development machine, so everything it
// depends on before the first click has to be provable here: the fixture refuses
// a live session, its package inputs fail closed on any mismatch, and the
// workflow it runs in clears exactly the session values the fixture refuses to
// inherit. Those three are the difference between "the fixture is written" and
// "the fixture cannot quietly prove something about the wrong machine".
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import {
  ISOLATED_SESSION_KEYS,
  assertIsolatedSessionEnv,
  collectFixtureLogs,
  createFixtureEnvironment,
  ownedProcessAlive,
  keepFixtureRoot,
  packageAbsent,
  readPackageStatus,
  terminate,
} from "./installed-desktop-recovery/environment.mjs";
import {
  assertPinnedFile,
  candidateDeb,
  verifyCandidateArtifact,
} from "./installed-desktop-recovery/inputs.mjs";
import { chooseApprovalMode, selectThread, spawnInstalledApp } from "./installed-desktop-recovery/renderer.mjs";
import { countChooserWindows, listWindows, waitForFolderChooser } from "./installed-desktop-recovery/native-picker.mjs";
import { assertAcceptedRequestPreserved, assertConcurrentTurns, assertScopedStop, assertStoppedTranscript, freshReplyEvidence } from "./installed-desktop-recovery/stop-proof.mjs";

test("Stop proof rejects stopping both concurrent threads or seeding a failed working folder", () => {
  const running = (threadId) => ({ threadId, busy: true, activity: "working", cwd: `/owned/project-${threadId}` });
  const cwds = new Map([["a", "/owned/project-a"], ["b", "/owned/project-b"]]);
  const idle = (threadId) => ({ ...running(threadId), busy: false, activity: "idle" });
  assert.doesNotThrow(() => assertConcurrentTurns(new Map([["a", running("a")], ["b", running("b")]]), "a", "b", cwds));
  assert.throws(() => assertConcurrentTurns(new Map([["a", running("a")], ["b", idle("b")]]), "a", "b", cwds), /not concurrently running/);
  assert.throws(() => assertConcurrentTurns(new Map([["a", running("a")], ["b", running("b")]]), "a", "b", new Map([["a", "/owned/missing-a"], ["b", "/owned/missing-b"]])), /existing fixture folder/);
  assert.throws(() => assertConcurrentTurns(new Map([["a", running("a")], ["b", running("b")]]), "a", "b", new Map([["a", "/owned/project-a"], ["b", "/owned/project-a"]])), /separate project folders/);
  assert.doesNotThrow(() => assertScopedStop(new Map([["a", idle("a")], ["b", running("b")]]), "a", "b"));
  assert.throws(() => assertScopedStop(new Map([["a", idle("a")], ["b", idle("b")]]), "a", "b"), /also interrupted/);
  assert.throws(() => assertScopedStop(new Map([["a", running("a")], ["b", running("b")]]), "a", "b"), /target thread running/);
});

test("Stop proof rejects auto-replay and a late answer while preserving interrupted requests", () => {
  const request = { id: "request", role: "user", kind: "text", text: "Keep running" };
  const interrupted = { id: "cancel", role: "bot", kind: "activity", text: "Outcome unknown" };
  const greeting = { id: "greeting", role: "bot", kind: "text", text: "Hi, I'm Stop fixture. What would you like me to do?" };
  assert.doesNotThrow(() => assertStoppedTranscript([greeting, request], [greeting, request, interrupted], request.text));
  assert.throws(() => assertStoppedTranscript([greeting, request], [{ ...greeting, text: greeting.text + "late delta" }, request], request.text), /late assistant/);
  assert.throws(() => assertStoppedTranscript([greeting, request], [{ ...greeting, attachments: [{ kind: "image", path: "late.png" }] }, request], request.text), /late assistant/);
  assert.throws(() => assertStoppedTranscript([greeting, request], [greeting, request, { ...greeting, id: "new-answer" }], request.text), /late assistant/);
  assert.doesNotThrow(() => assertStoppedTranscript([request], [request, interrupted], request.text));
  assert.throws(() => assertStoppedTranscript([request], [request, { ...request, id: "replay" }], request.text), /automatically replayed/);
  assert.throws(() => assertStoppedTranscript([request], [request, { id: "late", role: "bot", kind: "text", text: "late answer" }], request.text), /late assistant/);
  assert.doesNotThrow(() => assertAcceptedRequestPreserved([request], [request, { id: "new-request", role: "user", kind: "text", text: "Distinct new work" }], request.text));
  assert.throws(() => assertAcceptedRequestPreserved([request], [request, { ...request, id: "replay-after-provider-change" }], request.text), /automatically replayed/);
});

test("post-Stop continuation needs a new request and new reply, not idle state or a prior answer", () => {
  const prior = { id: "old-reply", role: "bot", kind: "text", text: "hello from fake claude" };
  const request = { id: "new-request", role: "user", kind: "text", text: "New work after Stop" };
  const input = { before: [prior], requestText: request.text, expectedReply: prior.text };
  assert.equal(freshReplyEvidence({ ...input, after: [prior] }), null);
  assert.equal(freshReplyEvidence({ ...input, after: [prior, request, { id: "failed", role: "bot", kind: "activity", text: "working folder vanished" }] }), null);
  assert.equal(freshReplyEvidence({ ...input, after: [prior, { ...prior, id: "early-reply" }, request] }), null);
  assert.deepEqual(freshReplyEvidence({ ...input, after: [prior, request, { ...prior, id: "new-reply" }] }), { requestId: "new-request", replyId: "new-reply" });
});

test("installed app cleanup returns after an immediately exiting child and keeps its log", async () => {
  const root = mkdtempSync(join(tmpdir(), "omb-recovery-stop-test-"));
  const logPath = join(root, "app.log");
  const app = spawnInstalledApp({
    executable: process.execPath,
    args: ["-e", "console.log('fixture ready'); setInterval(() => {}, 1000)"],
    env: { PATH: process.env.PATH },
    logPath,
  });
  let timer;
  try {
    await once(app.child.stdout, "data");
    await Promise.race([
      app.stop(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("cleanup missed the child's close event")), 1500);
      }),
    ]);
    assert.match(readFileSync(logPath, "utf8"), /fixture ready/);
    assert.notEqual(app.child.signalCode, null);
    await app.stop();
  } finally {
    clearTimeout(timer);
    try { process.kill(-app.pid, "SIGKILL"); } catch { /* this test's child already exited */ }
    rmSync(root, { recursive: true, force: true });
  }
});

test("thread selection expands the bot and waits for its thread to become current", async () => {
  let selectedBot = false;
  let expanded = false;
  let current = false;
  const bot = { click: () => { selectedBot = true; } };
  const thread = {
    click: () => { queueMicrotask(() => { current = true; }); },
    getAttribute: (name) => name === "aria-current" && current ? "page" : null,
  };
  const toggle = {
    click: () => { queueMicrotask(() => { expanded = true; }); },
    getAttribute: (name) => name === "aria-label" ? "Expand Fixture threads" : "false",
  };
  const document = {
    querySelector: (selector) => selector.includes("data-sidebar-bot-row") ? bot : expanded ? thread : null,
    querySelectorAll: () => expanded ? [] : [toggle],
  };
  const renderer = {
    evaluate: async (expression) => runInNewContext(expression, { document }),
    waitFor: async (expression, description) => {
      assert.ok(runInNewContext(expression, { document }), description);
    },
  };
  const result = await selectThread(renderer, { botId: "bot", botName: "Fixture", threadId: "thread" });
  assert.deepEqual(result, { botId: "bot", threadId: "thread", expanded: true });
  assert.equal(selectedBot, true);
  assert.equal(current, true);
  // Selecting another thread under an already expanded bot must not collapse it.
  assert.equal((await selectThread(renderer, { botId: "bot", botName: "Fixture", threadId: "sibling" })).expanded, false);
  assert.equal(expanded, true);
});

test("the picker pairs xdotool IDs with titles and counts chooser windows using the owned env", async () => {
  const root = mkdtempSync(join(tmpdir(), "omb-recovery-xdotool-test-"));
  const binary = join(root, "xdotool");
  // Match xdotool's actual output contract without connecting to any display.
  writeFileSync(binary, `#!${process.execPath}
if (process.env.DISPLAY !== ':owned-fixture') process.exit(2);
const [command, id] = process.argv.slice(2);
if (command === 'search') {
  if (process.env.NO_WINDOWS === '1') process.exit(1);
  console.log('101\\n102\\n103\\n104');
} else if (command === 'getwindowname') {
  if (id === '104') process.exit(1);
  console.log(id === '101' ? 'Crewbot' : 'Choose a working folder');
} else process.exit(2);
`);
  chmodSync(binary, 0o700);
  const env = { PATH: root, DISPLAY: ":owned-fixture" };
  try {
    assert.deepEqual([...listWindows(env)], [["101", "Crewbot"], ["102", "Choose a working folder"], ["103", "Choose a working folder"]]);
    assert.deepEqual(await waitForFolderChooser({ env }), { id: "102", name: "Choose a working folder" });
    assert.equal(countChooserWindows({ env }), 2);
    assert.equal(listWindows({ ...env, NO_WINDOWS: "1" }).size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const workflow = readFileSync(join(ROOT, ".github", "workflows", "linux-desktop-recovery.yml"), "utf8");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha512 = (bytes) => createHash("sha512").update(bytes).digest("base64");

/** Run `body` with the live session values cleared, so the fixture's own
 * refusal can be exercised without inheriting this machine's desktop. */
async function withoutSession(body) {
  const saved = new Map();
  for (const key of ISOLATED_SESSION_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    return await body();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** A candidate artifact that satisfies the shared release validator: the six
 * supported files, a checksum manifest that covers exactly the package bytes,
 * and an updater feed naming exactly the versioned AppImage and DEB.
 *
 * `extraDebByte` seals a differently-packaged DEB: self-consistent for the
 * release validator, and different from the reviewed bytes. That is exactly the
 * repack the pinned handover manifest has to catch. */
function makeCandidateArtifact(root, { extraDebByte = false } = {}) {
  const appImage = `crewbot-${VERSION}-x86_64.AppImage`;
  const deb = `crewbot-${VERSION}-amd64.deb`;
  const bytes = new Map([
    [appImage, Buffer.from("synthetic AppImage bytes for the installed recovery fixture")],
    [deb, Buffer.concat([
      Buffer.from("synthetic DEB bytes for the installed recovery fixture"),
      ...(extraDebByte ? [Buffer.from(" ")] : []),
    ])],
  ]);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, appImage), bytes.get(appImage));
  writeFileSync(join(root, deb), bytes.get(deb));
  writeFileSync(join(root, "crewbot.AppImage"), bytes.get(appImage));
  writeFileSync(join(root, "crewbot-amd64.deb"), bytes.get(deb));
  // The checksum manifest must cover exactly the four package rows, the stable
  // copies included: they ship the same bytes as the versioned assets.
  const byName = new Map([
    [appImage, bytes.get(appImage)],
    [deb, bytes.get(deb)],
    ["crewbot.AppImage", bytes.get(appImage)],
    ["crewbot-amd64.deb", bytes.get(deb)],
  ]);
  const manifest = [...byName].map(([name, content]) => `${sha256(content)}  ${name}`).join("\n");
  writeFileSync(join(root, "SHA256SUMS-ubuntu-x64.txt"), `${manifest}\n`);
  const feed = [
    `version: ${VERSION}`,
    "files:",
    `  - url: ${appImage}`,
    `    sha512: ${sha512(bytes.get(appImage))}`,
    `    size: ${bytes.get(appImage).byteLength}`,
    `  - url: ${deb}`,
    `    sha512: ${sha512(bytes.get(deb))}`,
    `    size: ${bytes.get(deb).byteLength}`,
    `path: ${appImage}`,
    `sha512: ${sha512(bytes.get(appImage))}`,
    "",
  ].join("\n");
  writeFileSync(join(root, "latest-linux.yml"), feed);
  return { appImage, deb, manifest };
}

/** The pinned handover manifest. It lives beside the artifact, never inside it:
 * the fixture requires the artifact directory to hold exactly the six supported
 * files, so a manifest written into it would itself be an extra file. */
function makePinnedManifest(directory, manifestPath, names) {
  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const files = names.map((name) => {
    const path = join(directory, name);
    return { name, bytes: statSync(path).size, sha256: sha256(readFileSync(path)) };
  });
  writeFileSync(manifestPath, JSON.stringify({
    schema: 1,
    sha: "1111111111111111111111111111111111111111",
    version,
    producer: { run: 1, runAttempt: 1, repository: "fixture/repo", workflow: "fixture", job: "package", ref: "fixture" },
    artifactName: `crewbot-ubuntu-${version}-x64`,
    files,
  }));
  return manifestPath;
}

test("the fixture refuses to run with a live display, seat, bus or login session", async () => {
  assert.throws(
    () => assertIsolatedSessionEnv({ DISPLAY: ":0" }),
    /live session attached: DISPLAY/,
  );
  assert.throws(
    () => assertIsolatedSessionEnv({ WAYLAND_DISPLAY: "wayland-1", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" }),
    /WAYLAND_DISPLAY, DBUS_SESSION_BUS_ADDRESS/,
  );
  assert.doesNotThrow(() => assertIsolatedSessionEnv(Object.fromEntries(ISOLATED_SESSION_KEYS.map((key) => [key, ""]))));
  // Blank is cleared; whitespace is not, so a stray space cannot slip past.
  assert.throws(() => assertIsolatedSessionEnv({ DISPLAY: " " }), /DISPLAY/);
});

test("the owned fixture root is private, holds the three working folders, and removes itself", async () => {
  await withoutSession(async () => {
    const parent = mkdtempSync(join(tmpdir(), "omb-recovery-guard-"));
    const fixture = createFixtureEnvironment(parent);
    try {
      assert.equal(fixture.root.startsWith(resolve(parent)), true);
      for (const key of ["home", "config", "data", "cache", "runtime", "state", "tmp", "logs", "evidence",
        "missingCwd", "replacementCwd", "alternateCwd"]) {
        assert.equal(statSync(fixture[key]).mode & 0o777, 0o700, `${key} must be private`);
      }
      // The folder the bot is pinned to exists first, so "it went away" is a
      // deletion this run performs rather than a state it inherited.
      assert.equal(statSync(fixture.missingCwd).isDirectory(), true);
      assert.equal(readFileSync(join(fixture.replacementCwd, "PROJECT.md"), "utf8").includes("picker chose"), true);
      assert.equal(readFileSync(join(fixture.alternateCwd, "PROJECT.md"), "utf8").includes("stale chooser"), true);
      assert.equal(existsSync(join(fixture.missingCwd, "PROJECT.md")), false);

      let torn = 0;
      fixture.own(() => { torn += 1; });
      await fixture.stop();
      assert.equal(torn, 1, "every owned teardown must run");
      assert.equal(existsSync(fixture.root), false, "the fixture root must not outlive the run");
    } finally {
      rmSync(parent, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});

test("fixture teardown awaits owned processes in reverse order before removing their root", async () => {
  await withoutSession(async () => {
    const parent = mkdtempSync(join(tmpdir(), "omb-recovery-teardown-test-"));
    const fixture = createFixtureEnvironment(parent);
    const calls = [];
    fixture.own(async () => {
      assert.deepEqual(calls, ["app"]);
      assert.equal(existsSync(fixture.root), true);
      calls.push("display");
    });
    fixture.own(async () => {
      await Promise.resolve();
      calls.push("app");
    });
    try {
      await fixture.stop({ keep: true });
      assert.deepEqual(calls, ["app", "display"]);
      assert.equal(existsSync(fixture.root), true);
      await fixture.stop();
      assert.equal(existsSync(fixture.root), false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

test("a throwing cleanup callback fails the run after every remaining callback has run", async () => {
  await withoutSession(async () => {
    const parent = mkdtempSync(join(tmpdir(), "omb-recovery-cleanup-failure-"));
    const fixture = createFixtureEnvironment(parent);
    const calls = [];
    // Registered last, so it runs first: one failure in the middle of the
    // teardown must not cut the rest of it short.
    fixture.own(() => { calls.push("last"); }, "the last resource");
    fixture.own(async () => {
      calls.push("throwing");
      throw new Error("this teardown could not finish");
    }, "the stubborn display");
    fixture.own(() => { calls.push("first"); }, "the app process group");
    let failure = null;
    try {
      await fixture.stop({ keep: true });
    } catch (error) {
      failure = error;
    }
    try {
      assert.deepEqual(calls, ["first", "throwing", "last"], "every owned teardown must be attempted");
      assert.ok(failure, "an unmet cleanup obligation must fail the run, not warn");
      assert.match(failure.message, /the stubborn display: this teardown could not finish/);
      // The run's verdict is read from the evidence, so the failures are
      // structured data on the thrown error rather than console text.
      assert.deepEqual(failure.cleanupFailures.map((one) => one.obligation), ["the stubborn display"]);
      assert.equal(existsSync(fixture.root), true, "a kept fixture root survives an unclean teardown");
    } finally {
      // A second stop must still work: teardown is idempotent, and the failed
      // callback was already consumed rather than retried forever.
      await fixture.stop();
      rmSync(parent, { recursive: true, force: true });
    }
    assert.equal(existsSync(fixture.root), false);
  });
});

test("an unclean teardown keeps the root holding the evidence naming what was left behind", async () => {
  await withoutSession(async () => {
    const parent = mkdtempSync(join(tmpdir(), "omb-recovery-keep-evidence-"));
    const fixture = createFixtureEnvironment(parent);
    // A file standing in for the run's evidence.json, which the journey writes
    // before teardown and which names the failure the teardown is about to report.
    const evidencePath = join(fixture.root, "evidence.json");
    writeFileSync(evidencePath, JSON.stringify({ cleanup: [] }));
    fixture.own(() => { throw new Error("the window manager would not die"); }, "the owned openbox");
    let failure = null;
    try {
      // keep: false, which is the ordinary local run: the orchestrator could not
      // know a callback was about to fail when it decided this.
      await fixture.stop();
    } catch (error) {
      failure = error;
    }
    try {
      assert.ok(failure, "the failed callback must be reported");
      assert.deepEqual(failure.cleanupFailures.map((one) => one.obligation), ["the owned openbox"]);
      assert.equal(fixture.root, failure.rootKept, "the error names the root it kept");
      // Deleting the root would have deleted the report of the failure that is
      // about to be thrown, so it survives until the caller has read it.
      assert.equal(existsSync(evidencePath), true, "the evidence must outlive the failure describing it");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true, maxRetries: 5 });
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

test("a clean teardown still removes the root, so nothing accumulates between runs", async () => {
  await withoutSession(async () => {
    const parent = mkdtempSync(join(tmpdir(), "omb-recovery-clean-root-"));
    const fixture = createFixtureEnvironment(parent);
    fixture.own(() => {}, "the owned resource");
    await fixture.stop();
    assert.equal(existsSync(fixture.root), false);
    rmSync(parent, { recursive: true, force: true });
  });
});

test("a log that cannot be collected is reported without throwing, so teardown continues", async () => {
  await withoutSession(async () => {
    const parent = mkdtempSync(join(tmpdir(), "omb-recovery-logs-"));
    const fixture = createFixtureEnvironment(parent);
    writeFileSync(join(fixture.logs, "app.log"), "the app's own log\n");
    const evidenceDir = join(fixture.root, "evidence");
    try {
      const collected = collectFixtureLogs(fixture, evidenceDir);
      assert.deepEqual(collected.failure, null);
      assert.deepEqual(collected.saved, ["logs/app.log"]);
      // The saved name is the log's path inside the fixture root, so the copy
      // keeps the layout it had on disk.
      assert.equal(
        readFileSync(join(evidenceDir, "logs", ...collected.saved), "utf8"),
        "the app's own log\n",
      );

      // A target that cannot be written is the realistic failure: the collector
      // must report it, because throwing here would skip the package removal and
      // the display, bus and window manager teardowns that follow it in the run.
      const blocked = join(fixture.root, "blocked-evidence");
      writeFileSync(blocked, "not a directory");
      const refused = collectFixtureLogs(fixture, blocked);
      assert.deepEqual(refused.saved, []);
      assert.equal(refused.failure.obligation, "the fixture logs are collected");
      assert.match(refused.failure.detail, /ENOTDIR|EEXIST|not a directory/);
    } finally {
      rmSync(parent, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});

test("bounded teardown reports an owned process that is still alive after SIGKILL", async () => {
  await withoutSession(async () => {
    const parent = mkdtempSync(join(tmpdir(), "omb-recovery-survivor-test-"));
    const fixture = createFixtureEnvironment(parent);
    // A pid this fixture owns that refuses to die, standing in for a process
    // whose teardown was skipped. It has no socket, which is exactly the case a
    // socket-only survivor check cannot see. Signalling a stranger's pid is
    // never at stake: the child below holds it, so it is this test's own.
    const holder = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    const stubborn = {
      pid: holder.pid,
      get exitCode() { return null; },
      get signalCode() { return null; },
      // The signal is swallowed and no exit is reported, so only the pid check
      // can tell whether the process is still standing.
      kill() {},
    };
    let failure = null;
    try {
      // Short bounds: the wait windows are the fixture's business, not this
      // test's runtime.
      fixture.own(() => terminate(stubborn, undefined, "the test survivor", { graceMs: 300, killMs: 300 }), "the test survivor");
      try {
        await fixture.stop({ keep: true });
      } catch (error) {
        failure = error;
      }
      assert.ok(failure, "a surviving owned process must be reported");
      assert.match(failure.message, /the test survivor survived SIGKILL/);
      assert.match(failure.message, new RegExp(`pid ${holder.pid} is still running`));
    } finally {
      try { process.kill(holder.pid, "SIGKILL"); } catch { /* already reaped */ }
      rmSync(parent, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});

test("bounded teardown accepts an owned process that actually went away", async () => {
  await withoutSession(async () => {
    const parent = mkdtempSync(join(tmpdir(), "omb-recovery-teardown-live-test-"));
    const fixture = createFixtureEnvironment(parent);
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "ignore", "ignore"] });
    try {
      fixture.own(() => terminate(child, undefined, "the cooperative child", { graceMs: 2_000, killMs: 2_000 }), "the cooperative child");
      await fixture.stop({ keep: true });
      // SIGTERM ends it and the pid disappears while its close event is still
      // pending. That is gone, and must not be reported as a survivor.
      assert.equal(ownedProcessAlive(child.pid), false);
    } finally {
      try { process.kill(child.pid, "SIGKILL"); } catch { /* already reaped */ }
      rmSync(parent, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});
  test("the workflow fails on a survivor instead of annotating one", () => {
  const cleanupStep = workflow.slice(workflow.indexOf("- name: Remove the installed package"));
  assert.ok(cleanupStep.length > 0, "the workflow must still remove the installed package");
  // A warning leaves the job green with an owned process still running, so the
  // survivor path has to end the step.
  assert.match(cleanupStep, /exit 1/);
  assert.doesNotMatch(cleanupStep, /::warning::/);
  assert.match(cleanupStep, /\[ -e \/opt\/crewbot \]/);
});

test("only a dpkg state with nothing installed proves the package was removed", () => {
  // The journey reads absence back from dpkg, and the fixture's own install
  // obligation is only met by a state holding no files.
  assert.equal(packageAbsent(null), true, "dpkg saying the package is unknown is absence");
  for (const gone of ["un ", "dn ", " rn ", "unX"]) {
    assert.equal(packageAbsent(gone), true, `${gone.trim()} is not installed`);
  }
  for (const present of ["ii ", " iu", "iU ", "iF ", "iR ", "uc ", "rc ", "ii", "n "]) {
    assert.equal(packageAbsent(present), false, `${present.trim()} still has files or says nothing`);
  }
  // Silence is not a dpkg verdict, so it never reaches this predicate: the
  // caller throws on an empty answer rather than passing one. A predicate that
  // answered "absent" for input it cannot interpret is exactly the guess this
  // exists to prevent, so it is pinned as a non-answer rather than a boolean.
  assert.equal(packageAbsent(""), false, "an empty status says nothing and is not absence");
});

test("a dpkg query that failed or answered nothing is an unmet obligation, not absence", () => {
  const parent = mkdtempSync(join(tmpdir(), "omb-recovery-readback-"));
  // Real query executables this test owns, so the readback runs actual child
  // processes and never reaches host sudo or dpkg. One file per query, because a
  // shared one would be overwritten before the loop reached it.
  let written = 0;
  const query = (stdout, stderr, code) => {
    const path = join(parent, `dpkg-query-${written += 1}`);
    writeFileSync(path, `#!/bin/sh\nprintf '%s' '${stdout.replaceAll("'", "'\\''")}'\nprintf '%s' '${stderr.replaceAll("'", "'\\''")}' >&2\nexit ${code}\n`);
    chmodSync(path, 0o700);
    return (args) => execFileSync(path, args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  };

  try {
    // Absence needs exit 1 and dpkg naming the package as not installed on
    // stderr, which is where dpkg-query writes its complaints.
    assert.equal(readPackageStatus(query("", "dpkg-query: no packages found matching crewbot", 1)), null);
    assert.equal(readPackageStatus(query("", "dpkg-query: package 'crewbot' is not installed and only information belonging to installed packages is available", 1)), null);

    for (const [label, thrown, args] of [
      ["a missing query", /could not report/, () => execFileSync(join(parent, "absent-binary"), ["-W"], { encoding: "utf8" })],
      ["a locked database", /could not report/, query("", "dpkg-query: error in loading /var/lib/dpkg/status", 1)],
      ["an unrelated failure", /could not report/, query("", "dpkg: failed to lock /var/lib/dpkg/lock", 2)],
      ["silence", /with no status/, query("", "", 0)],
      ["whitespace", /with no status/, query("  \n ", "", 0)],
    ]) {
      assert.throws(() => readPackageStatus(args), thrown, `${label} must never prove absence`);
    }

    // Exit 0 means dpkg answered, so its output is a status whatever it reads
    // like: absence still needs the status column to say so.
    const answered = readPackageStatus(query("no packages found matching crewbot", "", 0));
    assert.equal(packageAbsent(answered), false, "exit zero is dpkg answering, not dpkg reporting a failure");
    // Exit 1 is part of what makes the diagnostic trustworthy. The words on their
    // own, at another exit status, are a different failure that happens to
    // mention the package, so they cannot stand in for dpkg's verdict.
    assert.throws(
      () => readPackageStatus(query("", "dpkg-query: no packages found matching crewbot", 2)),
      /could not report/,
      "the not-found wording at the wrong exit status must never prove absence",
    );

    // A real status is passed through untouched, so the caller decides what it
    // means: every state holding files stays present.
    for (const installed of ["ii ", "iU ", "iF ", "iR ", "uc ", "rc "]) {
      const status = readPackageStatus(query(installed, "", 0));
      assert.equal(packageAbsent(status), false, `${installed.trim()} still has files on disk`);
    }
    for (const gone of ["un ", "dn "]) {
      assert.equal(packageAbsent(readPackageStatus(query(gone, "", 0))), true, `${gone.trim()} is not installed`);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("the run's evidence names unmet cleanup and the journey error stays the reported one", async () => {
  await withoutSession(async () => {
    const parent = mkdtempSync(join(tmpdir(), "omb-recovery-evidence-"));
    const fixture = createFixtureEnvironment(parent);
    // Stands in for the journey: evidence already carries a failure of its own,
    // and a teardown that cannot meet an obligation adds to it.
    const journeyError = new Error("the installed app never opened its window");
    const evidence = {
      failure: journeyError.stack,
      cleanup: [],
      observations: [],
      screenshots: [],
      windows: [],
      logs: [],
      steps: [],
    };
    // The journey records the same way: an obligation it could not meet, with
    // the reason, whether the reason arrived as an Error or as a plain record.
    const cleanupFailed = (obligation, error) => {
      evidence.cleanup.push({ obligation, detail: error?.message ?? error?.detail ?? String(error) });
    };
    try {
      let fixtureFailure = null;
      fixture.own(() => { throw new Error("the window manager would not die"); }, "the owned openbox");
      try {
        await fixture.stop({ keep: true });
      } catch (error) {
        fixtureFailure = error;
      }
      for (const failure of fixtureFailure.cleanupFailures) cleanupFailed(failure.obligation, failure);

      const written = join(fixture.root, "evidence.json");
      writeFileSync(written, JSON.stringify(evidence));
      const recorded = JSON.parse(readFileSync(written, "utf8"));
      // The journey's own error is the reported one; unmet cleanup is named
      // beside it rather than replacing it.
      assert.equal(recorded.failure, journeyError.stack);
      assert.deepEqual(recorded.cleanup.map((one) => one.obligation), ["the owned openbox"]);
      assert.match(recorded.cleanup[0].detail, /the window manager would not die/);
      assert.equal(existsSync(written), true, "the evidence outlives the failure describing it");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true, maxRetries: 5 });
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

test("an unmet cleanup obligation keeps the root holding the evidence that names it", () => {
  assert.equal(keepFixtureRoot({ requested: false, unmetObligations: 0 }), false);
  assert.equal(keepFixtureRoot({ requested: true, unmetObligations: 0 }), true);
  // The evidence saying what was left behind is the only record of it, so
  // removing the root would destroy the report of the failure about to be thrown.
  assert.equal(keepFixtureRoot({ requested: false, unmetObligations: 1 }), true);
  assert.equal(keepFixtureRoot({ requested: false, unmetObligations: 3 }), true);
});

test("the workflow reads package absence from dpkg and treats a query failure as unproven", () => {
  const stepSource = workflow.slice(workflow.indexOf("- name: Remove the installed package"));
  // `ii` alone is not the test: an unpacked or half-configured package, and one
  // still holding configuration, also leave files behind.
  assert.match(stepSource, /package_absence_problem\(\)/);
  assert.match(stepSource, /\$\{status:1:1\}" = "n"/);
  assert.doesNotMatch(stepSource, /grep -q '\^ii'/);

  // Drive the step's own function against every dpkg answer, so the check runs
  // in the same shell the runner uses rather than a Node copy of it.
  const functionSource = stepSource.slice(
    stepSource.indexOf("package_absence_problem() {"),
    stepSource.indexOf("package_absence=\"$(package_absence_problem)\""),
  );
  assert.ok(functionSource.length > 0, "the absence check must be a shell function the test can run");
  const verdict = (status, exitCode) => {
    const root = mkdtempSync(join(tmpdir(), "omb-recovery-dpkg-"));
    try {
      // A stub dpkg-query on PATH, so nothing here can reach the host's dpkg.
      const binary = join(root, "dpkg-query");
      writeFileSync(binary, `#!/bin/sh\nprintf '%s' '${status.replaceAll("'", "'\\''")}'\nexit ${exitCode}\n`);
      chmodSync(binary, 0o700);
      const script = `PATH=${root}:$PATH\n${functionSource}\npackage_absence_problem`;
      return execFileSync("bash", ["-c", script], { encoding: "utf8" }).trim();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  assert.equal(verdict("ii ", 0), "the candidate package is still present: ii");
  for (const halfConfigured of ["iU ", "iF ", "iR "]) {
    assert.equal(
      verdict(halfConfigured, 0),
      `the candidate package is still present: ${halfConfigured.trim()}`,
      `${halfConfigured.trim()} still has the installed files on disk`,
    );
  }
  assert.equal(verdict("uc ", 0), "the candidate package is still present: uc");
  assert.equal(verdict("rc ", 0), "the candidate package is still present: rc");
  for (const uninstalled of ["un ", "dn ", " rn "]) {
    assert.equal(
      verdict(uninstalled, 0),
      "the candidate package is not installed",
      `${uninstalled.trim()} means nothing of it is installed`,
    );
  }
  // dpkg saying the package is unknown is absence. dpkg failing for any other
  // reason is a question this step could not answer, which is not absence.
  assert.equal(
    verdict("dpkg-query: no packages found matching crewbot", 1),
    "the candidate package is not installed",
  );
  assert.match(
    verdict("dpkg-query: error in loading /var/lib/dpkg/status", 1),
    /^dpkg could not report whether crewbot is installed/,
  );
  assert.match(verdict("", 1), /^dpkg could not report whether crewbot is installed/);
  // A query that succeeds with nothing on stdout is silence, and silence is not
  // a dpkg verdict: reading it as absence would let a broken check report an
  // installed package as removed.
  assert.match(verdict("", 0), /^dpkg reported whether crewbot is installed with no status/);
  assert.match(verdict("  \n ", 0), /^dpkg reported whether crewbot is installed with no status/);
});


test("a pinned package file is held to its digest and byte count", () => {
  const root = mkdtempSync(join(tmpdir(), "omb-recovery-pin-"));
  try {
    const path = join(root, "candidate.deb");
    writeFileSync(path, "the exact bytes");
    const pinned = { bytes: "the exact bytes".length, sha256: sha256("the exact bytes") };
    assert.deepEqual(assertPinnedFile(path, pinned).sha256, pinned.sha256);

    writeFileSync(path, "the tampered bytes");
    assert.throws(() => assertPinnedFile(path, pinned), /size mismatch/);
    assert.throws(
      () => assertPinnedFile(path, { bytes: "the tampered bytes".length, sha256: pinned.sha256 }),
      /digest mismatch/,
    );
    assert.throws(() => assertPinnedFile(root, { sha256: pinned.sha256 }), /not a regular file/);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("the candidate artifact is verified against the shared release validator and the pinned manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "omb-recovery-artifact-"));
  try {
    const artifact = join(root, "candidate");
    const { appImage, deb } = makeCandidateArtifact(artifact);
    const names = [appImage, deb, "crewbot.AppImage", "crewbot-amd64.deb",
      "SHA256SUMS-ubuntu-x64.txt", "latest-linux.yml"];
    const manifestPath = makePinnedManifest(artifact, join(root, "candidate-hashes.json"), names);
    const claimed = "1111111111111111111111111111111111111111";

    const verified = verifyCandidateArtifact({ candidateDir: artifact, manifestPath, expectedSha: claimed });
    assert.equal(verified.files.length, 6);
    // The versioned DEB is the one installed: both copies ship the same bytes,
    // and the release validator names the versioned one.
    assert.equal(candidateDeb(verified.files).path, join(artifact, deb));

    // A manifest written for another source SHA is refused before anything else.
    assert.throws(
      () => verifyCandidateArtifact({ candidateDir: artifact, manifestPath, expectedSha: "2222222222222222222222222222222222222222" }),
      /candidate manifest is for 1111111/,
    );
    // An extra file in the artifact directory is a repacked artifact. The
    // shared validator sees it first, which is the point of running it first.
    writeFileSync(join(artifact, "extra.txt"), "not part of the release");
    assert.throws(
      () => verifyCandidateArtifact({ candidateDir: artifact, manifestPath, expectedSha: claimed }),
      /unexpected release assets: extra\.txt/,
    );
    rmSync(join(artifact, "extra.txt"));

    // A repacked DEB that is internally consistent still fails on the pinned
    // digest, because the manifest is the reviewed contract, not the artifact's
    // own claim about itself.
    const repacked = join(root, "repacked");
    makeCandidateArtifact(repacked, { extraDebByte: true });
    // The pinned manifest describes the bytes that were reviewed; the artifact
    // on disk is the repack. Both are internally consistent, and they disagree.
    const repackedManifest = makePinnedManifest(artifact, join(root, "reviewed-hashes.json"), names);
    // The repack changes the DEB and every file that describes it, so the pinned
    // manifest catches the first candidate file whose bytes moved.
    assert.throws(
      () => verifyCandidateArtifact({ candidateDir: repacked, manifestPath: repackedManifest, expectedSha: claimed }),
      (error) => /^candidate .* mismatch: /.test(error.message),
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("the workflow clears every session value the fixture refuses to inherit", () => {
  for (const key of ISOLATED_SESSION_KEYS) {
    assert.match(
      workflow,
      new RegExp(`^\\s{6}${key}: ""$`, "m"),
      `the workflow must clear ${key}, or the fixture would refuse to start there`,
    );
  }
});

test("the workflow that carries the installed proof can run on a pull request", () => {
  // A workflow_dispatch-only file cannot run before it reaches the default
  // branch, so the installed picker proof would be undeliverable.
  const wrapper = readFileSync(join(ROOT, ".github", "workflows", "linux-installed-acceptance.yml"), "utf8");
  assert.match(wrapper, /^on:\n(?:.|\n)*?^\s{2}pull_request:$/m);
  assert.match(wrapper, /uses: \.\/\.github\/workflows\/linux-desktop-recovery\.yml/);
  assert.match(workflow, /^\s{2}workflow_call:$/m);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /run: node scripts\/verify-installed-desktop-recovery\.mjs/);
  // The journey runs against the installed package, not an unpacked build.
  assert.match(workflow, /OMB_RECOVERY_CANDIDATE_DIR:/);
});

test("every local module of the fixture is dependency-free, so the runner needs no install", () => {
  const modules = [
    "verify-installed-desktop-recovery.mjs",
    join("installed-desktop-recovery", "environment.mjs"),
    join("installed-desktop-recovery", "inputs.mjs"),
    join("installed-desktop-recovery", "native-picker.mjs"),
    join("installed-desktop-recovery", "renderer.mjs"),
    join("installed-desktop-recovery", "stop-proof.mjs"),
  ];
  for (const name of modules) {
    const source = readFileSync(join(ROOT, "scripts", name), "utf8");
    const imports = [...source.matchAll(/^import .*?from ["']([^"']+)["']/gm)].map((match) => match[1]);
    for (const specifier of imports) {
      assert.ok(
        specifier.startsWith("node:") || specifier.startsWith("."),
        `scripts/${name} imports ${specifier}; the runner proves the installed package without pnpm install`,
      );
    }
  }
  // The fake engine the journey runs on is the repository's own, executable and
  // dependency-free too: a missing shebang would surface as a mysterious spawn
  // failure on the runner.
  const fake = join(ROOT, "server", "testing", "fake-claude-cli.ts");
  assert.match(readFileSync(fake, "utf8"), /^#!\/usr\/bin\/env node\n/);
  assert.equal(statSync(fake).mode & 0o111, 0o111);
});

test("approval fixture selects the exact label inside the menu item description", () => {
  const entry = (label, description, disabled = false) => ({
    textContent: label + description, disabled, clicks: 0,
    querySelector: (selector) => selector === "span > span" ? { textContent: label } : null,
    click() { this.clicks++; },
  });
  const ask = entry("Ask for approval", "Requests approval for commands and file changes");
  const full = entry("Full access", "Full computer access (elevated risk)");
  const entries = [ask, full];
  const menu = {
    getAttribute: () => "Approval mode for Recovery fixture",
    querySelectorAll: (selector) => selector === '[role="menuitemradio"]' ? entries : [],
  };
  const document = { querySelectorAll: (selector) => selector === '[role="menu"]' ? [menu] : [] };
  const choose = () => JSON.parse(JSON.stringify(runInNewContext(chooseApprovalMode("Full access"), { document })));
  assert.deepEqual(choose(), { opened: true, selected: true });
  assert.equal(full.clicks, 1);
  assert.equal(ask.clicks, 0);
  full.disabled = true;
  assert.equal(choose().selected, false);
  assert.equal(full.clicks, 1);
  full.disabled = false;
  entries.splice(1, 1, entry("Full access to other settings", "Full access"));
  // Match only the visible title line, never a description or a partial label.
  assert.equal(choose().selected, false);
});
