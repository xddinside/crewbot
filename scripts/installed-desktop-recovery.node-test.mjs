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
  createFixtureEnvironment,
} from "./installed-desktop-recovery/environment.mjs";
import {
  assertPinnedFile,
  candidateDeb,
  verifyCandidateArtifact,
} from "./installed-desktop-recovery/inputs.mjs";
import { selectThread, spawnInstalledApp } from "./installed-desktop-recovery/renderer.mjs";
import { countChooserWindows, listWindows, waitForFolderChooser } from "./installed-desktop-recovery/native-picker.mjs";
import { assertAcceptedRequestPreserved, assertConcurrentTurns, assertScopedStop, assertStoppedTranscript, freshReplyEvidence } from "./installed-desktop-recovery/stop-proof.mjs";

test("Stop proof rejects stopping both concurrent threads or seeding a failed working folder", () => {
  const running = (threadId) => ({ threadId, busy: true, activity: "working", cwd: "/owned/project" });
  const idle = (threadId) => ({ ...running(threadId), busy: false, activity: "idle" });
  assert.doesNotThrow(() => assertConcurrentTurns(new Map([["a", running("a")], ["b", running("b")]]), "a", "b", "/owned/project"));
  assert.throws(() => assertConcurrentTurns(new Map([["a", running("a")], ["b", idle("b")]]), "a", "b", "/owned/project"), /not concurrently running/);
  assert.throws(() => assertConcurrentTurns(new Map([["a", running("a")], ["b", running("b")]]), "a", "b", "/owned/missing"), /existing fixture folder/);
  assert.doesNotThrow(() => assertScopedStop(new Map([["a", idle("a")], ["b", running("b")]]), "a", "b"));
  assert.throws(() => assertScopedStop(new Map([["a", idle("a")], ["b", idle("b")]]), "a", "b"), /also interrupted/);
  assert.throws(() => assertScopedStop(new Map([["a", running("a")], ["b", running("b")]]), "a", "b"), /target thread running/);
});

test("Stop proof rejects auto-replay and a late answer while preserving interrupted requests", () => {
  const request = { id: "request", role: "user", kind: "text", text: "Keep running" };
  const interrupted = { id: "cancel", role: "bot", kind: "activity", text: "Outcome unknown" };
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
  const files = names.map((name) => {
    const path = join(directory, name);
    return { name, bytes: statSync(path).size, sha256: sha256(readFileSync(path)) };
  });
  writeFileSync(manifestPath, JSON.stringify({
    sha: "1111111111111111111111111111111111111111",
    run: 1,
    artifactName: "synthetic",
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
  assert.match(workflow, /^on:\n(?:.|\n)*?^\s{2}pull_request:$/m);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /run: node scripts\/verify-installed-desktop-recovery\.mjs/);
  // The journey runs against the installed package, not an unpacked build.
  assert.match(workflow, /crewbot-0\.1\.84-amd64\.deb/);
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
