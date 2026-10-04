// Linux installed continuity: the real old package produces the state, the real
// candidate package adopts it.
//
// Sequence, all inside one disposable root owned by this run:
//
//   1. verify both packages against pinned digests and fail closed on mismatch
//   2. install the released predecessor, seed a synthetic conversation, an
//      attachment, one workspace path that must move and one external project
//      path that must not, all through its shipped server
//   3. launch the installed predecessor so IT writes a synthetic credential
//      through production encryption into its own operating-system keyring
//   4. install the candidate beside it, then probe the two refusals that must
//      preserve recoverable originals
//   5. launch the installed candidate: it adopts the old desktop profile,
//      decrypts the old app's credential, migrates the old workspace and
//      rebases its embedded paths
//   6. drive the candidate's shipped server: the same conversation, its next
//      turn, the prior attachment's bytes, the moved workspace path and the
//      untouched external project
//   7. audit stable/development separation from what the launches created
//
// Every mutation happens on the runner this script runs on. It refuses to start
// unless the session environment is empty, so it can never reach a real
// desktop, keyring or profile.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  assertPinnedFile,
  CANDIDATE_PACKAGE,
  OLD_PACKAGE,
  verifyCandidateArtifact,
} from "./installed-continuity/inputs.mjs";
import {
  createFixtureEnvironment,
  fixtureBaseEnv,
  listSecretServiceItems,
  listTree,
  proveKeyringRoundTrip,
  readTextIfPresent,
  startOwnedDisplay,
  startOwnedKeyring,
  startOwnedSessionBus,
} from "./installed-continuity/environment.mjs";
import { passwordStoreArgs, runInstalledApp } from "./installed-continuity/app-launch.mjs";
import {
  digestTree,
  reservePortBlock,
  sha256Bytes,
  startProductionServer,
} from "./installed-continuity/workspace.mjs";
import {
  assertInside,
  assertOutside,
  assertRefusalPreservedOriginals,
  auditCredentialSurvival,
  auditStableDevelopmentSeparation,
  compareBytes,
  compareSnapshots,
  findResidualRoot,
} from "./installed-continuity/assertions.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fakeCli = join(repoRoot, "server", "testing", "fake-claude-cli.ts");
const syntheticSecret = `continuity-${randomBytes(18).toString("hex")}`;
const keyringSelfCheck = `keyring-selfcheck-${randomBytes(12).toString("hex")}`;
/** The fake engine's unscripted reply. Asserting it is what a real turn looks
 * like, rather than a scripted string the fixture could have faked. */
const ENGINE_REPLY = "hello from fake claude";
/** The shape the composer sends and the migration rewrites: a standalone tag on
 * its own line, pointing at the server-generated stored path. */
const attachmentTag = (path, name) => `<attached-image path="${path}" name="${name}" />`;

const evidence = { steps: [], warnings: [] };
const started = Date.now();

function step(name, detail) {
  console.log(`[continuity] ${name}${detail ? `: ${detail}` : ""}`);
  evidence.steps.push({ name, detail: detail ?? null, at: new Date().toISOString() });
}

function warn(message) {
  console.warn(`[continuity] WARNING ${message}`);
  evidence.warnings.push(message);
}

/** A small real PNG, built here rather than pasted as an opaque blob, so the
 * attachment the server stores and the bytes read back are honest bytes. */
function syntheticPng() {
  const width = 8;
  const height = 8;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = rowStart + 1 + x * 3;
      raw[pixel] = (x * 32 + y) & 0xff;
      raw[pixel + 1] = (x * 16 + 8) & 0xff;
      raw[pixel + 2] = (y * 32 + 64) & 0xff;
    }
  }
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const payload = Buffer.concat([Buffer.from(type, "latin1"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(payload) >>> 0);
    return Buffer.concat([length, payload, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let crcTable = null;
function crc32(bytes) {
  crcTable ??= Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function asRoot(args) {
  execFileSync("sudo", ["--preserve-env=CI,RUNNER_TEMP", ...args], {
    env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
    stdio: "inherit",
  });
}

function installedVersion(name) {
  return execFileSync("dpkg-query", ["-W", "-f=${Version}", name], { encoding: "utf8" }).trim();
}

function requirePath(path, what) {
  if (!existsSync(path)) throw new Error(`${what} is missing: ${path}`);
  return path;
}

function compareVersion(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

/** The persisted tag path for one attachment in a transcript page. */
function attachmentPathsIn(text) {
  return [...String(text ?? "").matchAll(/<attached-(?:image|file)\s+path="([^"\r\n]+)"/g)].map((match) => match[1]);
}

function collectReceipts(dataDir) {
  const root = join(dataDir, ".crewbot-migration", "recovery");
  const receipts = [];
  let entries = [];
  try { entries = readdirSync(root); } catch { return receipts; }
  for (const id of entries) {
    try {
      const value = JSON.parse(readFileSync(join(root, id, "receipt.json"), "utf8"));
      if (value?.phase === "complete" && Array.isArray(value.metadataFiles)) receipts.push({ id, ...value });
    } catch { /* not a receipt directory */ }
  }
  return receipts;
}

function scanTranscript(path, legacyRoot) {
  const db = new DatabaseSync(path, { readOnly: true });
  const problems = [];
  try {
    for (const table of ["messages", "chat_followups"]) {
      let rows;
      try { rows = db.prepare(`SELECT json FROM ${table}`).iterate(); }
      catch { continue; }
      for (const row of rows) {
        const found = findResidualRoot(JSON.parse(String(row.json)), legacyRoot, table);
        if (found) problems.push({ ...found, residuals: found.residuals.slice(0, 3) });
      }
    }
  } finally {
    db.close();
  }
  return problems;
}

function scanForResiduals(root, legacyRoot) {
  const problems = [];
  for (const name of ["bots.json", "groups.json", "config.json", "routines.json", "room-continuations.json"]) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    const found = findResidualRoot(JSON.parse(readFileSync(path, "utf8")), legacyRoot, name);
    if (found) problems.push(found);
  }
  const transcript = join(root, "messages.db");
  if (existsSync(transcript)) problems.push(...scanTranscript(transcript, legacyRoot));
  return problems;
}

async function main() {
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp || !existsSync(runnerTemp)) {
    throw new Error("RUNNER_TEMP must be an existing absolute CI path; this fixture never runs on a developer machine");
  }
  const oldDeb = resolve(process.env.OMB_CONTINUITY_OLD_DEB ?? "");
  const candidateDir = resolve(process.env.OMB_CONTINUITY_CANDIDATE_DIR ?? "");
  const manifestPath = resolve(process.env.OMB_CONTINUITY_CANDIDATE_MANIFEST ?? "");
  if (!oldDeb.endsWith(".deb") || !existsSync(oldDeb)) throw new Error("OMB_CONTINUITY_OLD_DEB must point at the downloaded old package");
  if (!existsSync(candidateDir)) throw new Error("OMB_CONTINUITY_CANDIDATE_DIR must point at the downloaded candidate artifact");
  if (!existsSync(manifestPath)) throw new Error("OMB_CONTINUITY_CANDIDATE_MANIFEST must point at the pinned candidate manifest");

  // ── 1. inputs ────────────────────────────────────────────────────────
  step("inputs", "verifying both packages against pinned digests before anything is installed");
  const oldDigest = assertPinnedFile(oldDeb, { sha256: OLD_PACKAGE.sha256, bytes: OLD_PACKAGE.bytes }, "old package");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.sha !== process.env.OMB_CONTINUITY_CANDIDATE_SHA) {
    throw new Error(`the candidate manifest describes ${manifest.sha}, not the pinned ${process.env.OMB_CONTINUITY_CANDIDATE_SHA}`);
  }
  const candidateVersionFromArtifact = /crewbot-ubuntu-(\d+\.\d+\.\d+)-x\d+$/.exec(manifest.artifactName ?? "")?.[1];
  if (!candidateVersionFromArtifact) throw new Error(`the pinned artifact name does not carry a version: ${manifest.artifactName}`);
  const candidateFiles = verifyCandidateArtifact(candidateDir, { ...manifest, version: candidateVersionFromArtifact });
  const candidateDeb = candidateFiles.find((file) => basename(file.path) === `crewbot-${candidateVersionFromArtifact}-amd64.deb`);
  if (!candidateDeb) throw new Error(`the candidate artifact has no crewbot-${manifest.version}-amd64.deb`);
  evidence.inputs = {
    old: { ...oldDigest, source: OLD_PACKAGE.url },
    candidate: {
      sourceSha: manifest.sha,
      run: manifest.run,
      artifactId: manifest.artifactId,
      deb: basename(candidateDeb.path),
      files: candidateFiles.map((file) => basename(file.path)),
    },
  };
  step("inputs", `old ${oldDigest.sha256.slice(0, 16)}… and candidate ${manifest.sha?.slice(0, 12) ?? "?"} verified`);

  const fixture = createFixtureEnvironment(runnerTemp);
  const storeArgs = passwordStoreArgs();
  evidence.passwordStore = storeArgs;
  const attachment = syntheticPng();
  const attachmentSha256 = sha256Bytes(attachment);
  let keyring = null;
  let servers = [];
  try {
    // ── owned session ──────────────────────────────────────────────────
    const ownedDisplay = startOwnedDisplay(fixture);
    fixture.stopped.push(() => ownedDisplay.stop());
    const ownedBus = startOwnedSessionBus(fixture);
    const baseEnv = fixtureBaseEnv(fixture, { display: ownedDisplay.display, dbusAddress: ownedBus.address });
    step("session", `owned display ${ownedDisplay.display} and session bus ${ownedBus.address}`);
    keyring = await startOwnedKeyring({ env: baseEnv, password: syntheticSecret });
    fixture.stopped.push(() => keyring.stop());
    // Only offer the control address when the daemon published one. libsecret
    // reaches the secret service over the session bus without it, so an absent
    // address is a normal outcome and must not become the string "undefined".
    const appEnv = keyring.control ? { ...baseEnv, GNOME_KEYRING_CONTROL: keyring.control } : { ...baseEnv };
    // Prove the collection really takes a secret before the app's use of it means
    // anything. The collection already reported itself unlocked to start with;
    // this is the write-then-read that a client actually performs.
    proveKeyringRoundTrip(appEnv, { label: "continuity-selfcheck", value: keyringSelfCheck });
    const baselineItems = listSecretServiceItems(appEnv);
    evidence.baselineSecretServiceItems = baselineItems.length;
    step(
      "keyring",
      `own unlocked collection ${keyring.collection}${keyring.control ? ` (control ${keyring.control})` : " (no control address offered)"}; ${baselineItems.length} pre-existing item(s)`,
    );

    // ── 2. the old package ─────────────────────────────────────────────
    step("install-old", `${OLD_PACKAGE.name} ${OLD_PACKAGE.version} from ${OLD_PACKAGE.url}`);
    asRoot(["apt-get", "install", "-y", "--no-install-recommends", oldDeb]);
    if (installedVersion(OLD_PACKAGE.name) !== OLD_PACKAGE.version) {
      throw new Error(`the old package is not installed at ${OLD_PACKAGE.version}`);
    }
    requirePath(OLD_PACKAGE.executable, "the old package executable");
    requirePath(OLD_PACKAGE.serverEntry, "the old package bundled server");
    step("install-old", `installed ${OLD_PACKAGE.version} at ${OLD_PACKAGE.installRoot}`);

    const legacyDataDir = join(fixture.home, OLD_PACKAGE.dataDirName);
    const candidateDataDir = join(fixture.home, CANDIDATE_PACKAGE.dataDirName);
    const externalProject = assertOutside("the external project", legacyDataDir, fixture.project);
    // A workspace path that lives inside the data root: the migration must move
    // it. The external project must not move.
    const embeddedProject = join(legacyDataDir, "projects", "embedded");
    mkdirSync(embeddedProject, { recursive: true, mode: 0o700 });
    writeFileSync(join(embeddedProject, "NOTE.md"), "workspace project that must move\n", { mode: 0o600 });
    // A plaintext secret the OLD app must encrypt for itself. Seeding this file
    // is not the claim; the old app's own boot migration doing the encryption is.
    writeFileSync(
      join(legacyDataDir, "config.json"),
      JSON.stringify({ xai: { key: syntheticSecret } }, null, 2),
      { mode: 0o600 },
    );
    step("seed-old", `old workspace ${legacyDataDir} with a synthetic plaintext secret`);

    const oldServer = await startProductionServer({
      serverEntry: OLD_PACKAGE.serverEntry,
      dataDir: legacyDataDir,
      overrideDataDir: false, // prove the 0.1.83 default: $HOME/.openmausbot
      env: appEnv,
      fakeCli,
      replies: [],
      port: (await reservePortBlock()).port,
      logPath: join(fixture.logs, "old-server.log"),
      cwd: resolve(OLD_PACKAGE.installRoot, "resources"),
    });
    servers.push(oldServer);
    step("seed-old", `old shipped server ${oldServer.url} against $HOME/${OLD_PACKAGE.dataDirName}`);

    const conversationBot = await oldServer.createBot();
    await oldServer.setBotCwd(conversationBot.id, externalProject);
    const embeddedBot = await oldServer.createBot();
    await oldServer.setBotCwd(embeddedBot.id, embeddedProject);
    const stored = await oldServer.uploadAttachment({ mime: "image/png", bytes: attachment });
    if (!stored?.path || !stored.mime) throw new Error(`the old server did not store the attachment: ${JSON.stringify(stored)}`);
    const storedName = basename(stored.path);
    assertInside("the stored attachment", legacyDataDir, stored.path);
    step("seed-old", `two bots, one pinned to ${externalProject} and one to ${embeddedProject}; attachment ${storedName} stored in the old workspace`);

    await oldServer.send(conversationBot.id, {
      text: `Continuity seed turn for ${externalProject}.\n${attachmentTag(stored.path, storedName)}`,
    });
    const seededBot = await oldServer.waitForUserMessage(
      conversationBot.id,
      (message) => message.role === "user" && attachmentPathsIn(message.text).length > 0,
      { label: "the seeded user message with its attachment in the production transcript" },
    );
    await oldServer.waitForBot(conversationBot.id, (bot) => !bot.busy && (bot.messages ?? [])
      .some((message) => message.role === "bot" && (message.text ?? "").includes(ENGINE_REPLY)),
    { label: "the old server's seed turn to settle" });
    const seededMessages = await oldServer.threadMessages(seededBot.threadId, 50);
    evidence.seed = {
      conversationBotId: conversationBot.id,
      embeddedBotId: embeddedBot.id,
      externalProject,
      embeddedProject,
      attachmentName: storedName,
      attachmentSha256,
      attachmentBytes: attachment.byteLength,
      oldMessageCount: seededMessages.length,
      oldTurnSettled: !seededBot.busy,
    };
    step("seed-old", `transcript persisted ${seededMessages.length} message(s) through the old shipped server`);

    // Release the exclusive data lease before the desktop app takes ownership.
    await oldServer.stop();
    servers = servers.filter((entry) => entry !== oldServer);

    // ── 3. the old app encrypts ─────────────────────────────────────────
    step("old-app", "launching the installed old app so it writes the credential itself");
    const oldApp = await runInstalledApp({
      executable: OLD_PACKAGE.executable,
      env: { ...appEnv, HOME: fixture.home, OMB_SMOKE_TEST: "1", OMB_SMOKE_CUA: "0" },
      storeArgs,
      profileDir: join(fixture.config, OLD_PACKAGE.profileName),
      dataDir: legacyDataDir,
      expectEnv: "XAI_API_KEY",
      timeoutMs: 300_000,
    });
    writeFileSync(join(fixture.logs, "old-app-output.log"), oldApp.output);
    auditCredentialSurvival({
      credentialsFile: join(fixture.config, OLD_PACKAGE.profileName, "credentials.bin"),
      syntheticSecret,
      secretServiceItems: listSecretServiceItems(appEnv),
      identityName: OLD_PACKAGE.profileName,
      childEnvValue: oldApp.serverEnv,
      plaintextStillInConfig: (readTextIfPresent(join(legacyDataDir, "config.json")) ?? "").includes(syntheticSecret),
    });
    evidence.oldApp = {
      exitCode: oldApp.exitCode,
      signal: oldApp.signal,
      rendererReady: oldApp.rendererReady,
      leaseHeld: oldApp.leaseHeld,
      credentialFileWritten: existsSync(join(fixture.config, OLD_PACKAGE.profileName, "credentials.bin")),
      serverChildPid: oldApp.serverPid,
      decryptedAndUsed: true,
    };
    step("old-app", `old app encrypted the secret and handed it to its own server child (pid ${oldApp.serverPid})`);
    if (!oldApp.rendererReady) warn("the old app's renderer never reported ready; its credential effects still came from its own boot");
    // The migration snapshot must be compared against the workspace exactly as
    // the old app left it, after its own boot migration rewrote config.json.
    const before = digestTree(legacyDataDir);

    // ── 4. the candidate package ────────────────────────────────────────
    step("install-candidate", "installing the candidate beside the unchanged old package");
    asRoot(["apt-get", "install", "-y", "--no-install-recommends", candidateDeb.path]);
    requirePath(CANDIDATE_PACKAGE.executable, "the candidate package executable");
    requirePath(CANDIDATE_PACKAGE.serverEntry, "the candidate package bundled server");
    const candidateVersion = installedVersion(CANDIDATE_PACKAGE.name);
    if (compareVersion(candidateVersion, OLD_PACKAGE.version) <= 0) {
      throw new Error(`the candidate ${candidateVersion} does not upgrade the old ${OLD_PACKAGE.version}`);
    }
    if (installedVersion(OLD_PACKAGE.name) !== OLD_PACKAGE.version) {
      throw new Error(`installing the candidate changed the installed old package`);
    }
    step("install-candidate", `installed ${candidateVersion} beside the unchanged ${OLD_PACKAGE.name} ${OLD_PACKAGE.version}`);

    // ── 4a. refusal: an existing destination ────────────────────────────
    mkdirSync(candidateDataDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(candidateDataDir, "occupant.txt"), "an unrelated workspace that must survive\n", { mode: 0o600 });
    const refusal = await runInstalledApp({
      executable: CANDIDATE_PACKAGE.executable,
      env: { ...appEnv, HOME: fixture.home, OMB_SMOKE_TEST: "1", OMB_SMOKE_CUA: "0" },
      storeArgs,
      profileDir: join(fixture.config, OLD_PACKAGE.profileName),
      dataDir: candidateDataDir,
      timeoutMs: 300_000,
    });
    writeFileSync(join(fixture.logs, "candidate-refusal-existing-output.log"), refusal.output);
    const existingWarning = refusal.serverLog ?? refusal.output;
    assertRefusalPreservedOriginals({
      legacyDirs: [legacyDataDir, candidateDataDir],
      expectedWarningFragments: [
        { warning: existingWarning, text: "was not migrated into" },
        { warning: existingWarning, text: "already exists and wins without merging" },
        { warning: existingWarning, text: "Keep both directories intact" },
      ],
    });
    if (!existsSync(join(candidateDataDir, "occupant.txt"))) throw new Error("the refusal replaced the existing workspace");
    if (!existsSync(join(legacyDataDir, "messages.db"))) throw new Error("the refusal consumed the old workspace");
    evidence.refusalExistingDestination = {
      oldWorkspaceIntact: true,
      occupantIntact: true,
      warning: existingWarning.split("\n").find((line) => line.includes("was not migrated into")) ?? null,
    };
    step("refusal", "an existing workspace won without merging; both directories survived");

    // ── 4b. refusal: a second legacy root ───────────────────────────────
    const secondLegacy = join(fixture.home, ".opengrokbot");
    mkdirSync(secondLegacy, { recursive: true, mode: 0o700 });
    writeFileSync(join(secondLegacy, "keep.txt"), "a second legacy root that must not be merged\n", { mode: 0o600 });
    const secondRefusal = await runInstalledApp({
      executable: CANDIDATE_PACKAGE.executable,
      env: { ...appEnv, HOME: fixture.home, OMB_SMOKE_TEST: "1", OMB_SMOKE_CUA: "0" },
      storeArgs,
      profileDir: join(fixture.config, OLD_PACKAGE.profileName),
      dataDir: candidateDataDir,
      timeoutMs: 300_000,
    });
    writeFileSync(join(fixture.logs, "candidate-refusal-second-legacy-output.log"), secondRefusal.output);
    const secondWarning = secondRefusal.serverLog ?? secondRefusal.output;
    assertRefusalPreservedOriginals({
      legacyDirs: [secondLegacy, legacyDataDir, candidateDataDir],
      expectedWarningFragments: [
        { warning: secondWarning, text: "already exists and wins without merging" },
        { warning: secondWarning, text: "Keep both directories intact" },
      ],
    });
    evidence.refusalSecondLegacyRoot = { preserved: [secondLegacy], warning: secondWarning.split("\n").find((line) => line.includes("already exists and wins without merging")) ?? null };
    step("refusal", "a second legacy root was preserved, not merged");

    // ── 5. the real migration, in the installed candidate ───────────────
    execFileSync("rm", ["-rf", candidateDataDir], { stdio: "inherit" });
    step("candidate-app", "launching the installed candidate over the old workspace");
    const candidateApp = await runInstalledApp({
      executable: CANDIDATE_PACKAGE.executable,
      env: { ...appEnv, HOME: fixture.home, OMB_SMOKE_TEST: "1", OMB_SMOKE_CUA: "0" },
      storeArgs,
      profileDir: join(fixture.config, OLD_PACKAGE.profileName),
      dataDir: candidateDataDir,
      expectEnv: "XAI_API_KEY",
      timeoutMs: 300_000,
    });
    writeFileSync(join(fixture.logs, "candidate-app-output.log"), candidateApp.output);
    requirePath(candidateDataDir, `the migrated workspace ${candidateDataDir}`);
    if (existsSync(legacyDataDir)) throw new Error(`the old workspace still exists after the migration: ${legacyDataDir}`);
    const profileLog = candidateApp.serverLog ?? "";
    if (!profileLog.includes("using the existing OpenMausBot desktop profile in place at")) {
      throw new Error(`the candidate did not adopt the old desktop profile; its log ended: ${profileLog.slice(-800)}`);
    }
    assertRefusalPreservedOriginals({
      legacyDirs: [secondLegacy, candidateDataDir],
      expectedWarningFragments: [
        { warning: profileLog, text: "only one directory moves automatically" },
        { warning: profileLog, text: "Keep both directories intact" },
      ],
    });
    if (readFileSync(join(secondLegacy, "keep.txt"), "utf8") !== "a second legacy root that must not be merged\n") {
      throw new Error("the migration changed the second legacy root");
    }
    evidence.refusalSecondLegacyRoot.afterMigrationPreserved = true;
    evidence.refusalSecondLegacyRoot.afterMigrationWarning = profileLog.split("\n")
      .find((line) => line.includes("only one directory moves automatically")) ?? null;
    auditCredentialSurvival({
      credentialsFile: join(fixture.config, OLD_PACKAGE.profileName, "credentials.bin"),
      syntheticSecret,
      secretServiceItems: listSecretServiceItems(appEnv),
      identityName: OLD_PACKAGE.profileName,
      childEnvValue: candidateApp.serverEnv,
      plaintextStillInConfig: (readTextIfPresent(join(candidateDataDir, "config.json")) ?? "").includes(syntheticSecret),
    });
    evidence.candidateApp = {
      exitCode: candidateApp.exitCode,
      signal: candidateApp.signal,
      rendererReady: candidateApp.rendererReady,
      leaseHeld: candidateApp.leaseHeld,
      adoptedLegacyProfile: true,
      decryptedAndUsed: true,
      serverChildPid: candidateApp.serverPid,
    };
    step("candidate-app", `adopted the old profile, decrypted the old app's secret, migrated ${OLD_PACKAGE.dataDirName} -> ${CANDIDATE_PACKAGE.dataDirName}`);

    const receipts = collectReceipts(candidateDataDir);
    if (!receipts.length) throw new Error(`no migration recovery receipt was written under ${candidateDataDir}`);
    const receipt = receipts[0];
    compareSnapshots({
      before,
      snapshotDir: join(candidateDataDir, ".crewbot-migration", "recovery", receipt.id),
      expect: receipt.metadataFiles.filter((file) => before.has(file)),
    });
    evidence.migration = { receiptId: receipt.id, phase: receipt.phase, metadataFiles: receipt.metadataFiles, snapshotVerified: true };
    step("migration", `recovery receipt ${receipt.id} holds byte-identical snapshots of ${receipt.metadataFiles.length} file(s)`);

    const residuals = scanForResiduals(candidateDataDir, legacyDataDir);
    if (residuals.length) throw new Error(`an old data-directory path survived the migration: ${JSON.stringify(residuals).slice(0, 900)}`);
    assertOutside("the external project", candidateDataDir, externalProject);
    requirePath(join(externalProject, "PROJECT.md"), "the external project marker");
    assertInside("the moved workspace project", candidateDataDir, join(candidateDataDir, "projects", "embedded", "NOTE.md"));
    evidence.paths = { residuals: 0, externalProjectUnchanged: true, embeddedProjectMoved: true };
    step("paths", "no old data-root path survived; the workspace project moved and the external project did not");

    // ── 6. separation, from what the launches created ──────────────────
    // Inspect application identity roots; runtime/logs/project belong to the
    // harness and are created before either installed application starts.
    const stableTree = [fixture.home, fixture.config, fixture.data, fixture.cache]
      .flatMap((root) => listTree(root).map((entry) => join(root, entry)));
    evidence.separation = auditStableDevelopmentSeparation({
      home: fixture.home,
      config: fixture.config,
      data: fixture.data,
      cache: fixture.cache,
      development: fixture.development,
      observed: stableTree,
    });
    const devItems = listSecretServiceItems(appEnv).filter((item) => item.attributes?.application === "crewbot-development");
    if (devItems.length) throw new Error(`a development identity already owns ${devItems.length} keyring item(s)`);
    for (const port of [fixture.development.serverPort, fixture.development.webhookPort]) {
      const reachable = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(700) })
        .then((response) => response.ok, () => false);
      if (reachable) throw new Error(`a stable launch occupied the development port ${port}`);
    }
    evidence.separation.developmentKeyringItems = 0;
    evidence.separation.developmentPortsFree = true;
    evidence.separation.stableLeaseObserved = candidateApp.leaseHeld;
    step("separation", `stable wrote ${stableTree.length} fixture paths and no development identity path, keyring item or port`);

    // ── 7. continue the conversation ────────────────────────────────────
    step("continuity", "starting the candidate's shipped server over the migrated workspace");
    const nextServer = await startProductionServer({
      serverEntry: CANDIDATE_PACKAGE.serverEntry,
      dataDir: candidateDataDir,
      env: appEnv,
      fakeCli,
      replies: [],
      port: (await reservePortBlock()).port,
      logPath: join(fixture.logs, "candidate-server.log"),
      cwd: resolve(CANDIDATE_PACKAGE.installRoot, "resources"),
    });
    servers.push(nextServer);
    step("continuity", `candidate shipped server ${nextServer.url}`);

    const migrated = await nextServer.bot(conversationBot.id);
    if (!migrated) throw new Error(`the migrated workspace does not contain the seeded conversation ${conversationBot.id}`);
    const migratedMessages = await nextServer.threadMessages(migrated.threadId, 100);
    if (migratedMessages.length < evidence.seed.oldMessageCount) {
      throw new Error(`the seeded transcript shrank across the upgrade: ${migratedMessages.length} < ${evidence.seed.oldMessageCount}`);
    }
    const seededUser = migratedMessages.find(
      (message) => message.role === "user" && attachmentPathsIn(message.text).includes(join(candidateDataDir, "attachments", storedName)),
    );
    if (!seededUser) {
      throw new Error(`no migrated message points at the attachment under the new workspace; paths seen: ${JSON.stringify(migratedMessages.flatMap((message) => attachmentPathsIn(message.text)))}`);
    }
    const carried = await nextServer.bot(embeddedBot.id);
    if (!carried) throw new Error("the migrated workspace does not contain the workspace-pinned conversation");
    if (carried.cwd !== join(candidateDataDir, "projects", "embedded")) {
      throw new Error(`the embedded workspace path was not rebased: ${carried.cwd}`);
    }
    if (migrated.cwd !== externalProject) {
      throw new Error(`the external project path changed across the upgrade: ${migrated.cwd}`);
    }
    const downloaded = await nextServer.attachmentBytes(storedName);
    const identical = compareBytes(attachmentSha256, sha256Bytes(downloaded));
    evidence.continuity = {
      conversationBotId: conversationBot.id,
      messagesBeforeUpgrade: evidence.seed.oldMessageCount,
      messagesAfterUpgrade: migratedMessages.length,
      attachmentName: storedName,
      attachmentSha256: identical.sha256,
      attachmentBytes: identical.bytes,
      embeddedCwdAfterUpgrade: carried.cwd,
      externalCwdAfterUpgrade: migrated.cwd,
    };
    step("continuity", `seeded transcript and attachment survived; bytes identical (${identical.sha256.slice(0, 16)}…)`);

    const nextRequest = "Continuity: take the next turn in this conversation.";
    const priorMessageIds = new Set(migratedMessages.map((message) => message.id));
    await nextServer.send(conversationBot.id, { text: nextRequest });
    const settled = await nextServer.waitForBot(
      conversationBot.id,
      (value) => {
        if (value.busy) return false;
        const messages = value.messages ?? [];
        const requestIndex = messages.findIndex((message) => message.role === "user"
          && message.text === nextRequest && !priorMessageIds.has(message.id));
        return requestIndex >= 0 && messages.slice(requestIndex + 1).some((message) => message.role === "bot"
          && !priorMessageIds.has(message.id) && (message.text ?? "").includes(ENGINE_REPLY));
      },
      { label: "the next turn to settle with the engine's reply", budgetMs: 180_000 },
    );
    const afterTurn = await nextServer.threadMessages(settled.threadId, 100);
    compareBytes(identical.sha256, sha256Bytes(await nextServer.attachmentBytes(storedName)));
    evidence.continuity.nextTurnSettled = true;
    evidence.continuity.messagesAfterNextTurn = afterTurn.length;
    step("continuity", `the next turn settled with ${afterTurn.length} messages; the prior attachment still reads identical`);

    evidence.terminal = { ok: true, elapsedMs: Date.now() - started };
    writeFileSync(join(fixture.logs, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`[continuity] OK in ${Math.round((Date.now() - started) / 1000)}s: ${OLD_PACKAGE.version} -> ${candidateVersion}, real keyring, isolated session`);
  } finally {
    for (const server of servers) await server.stop();
    if (keyring) keyring.stop();
    writeFileSync(join(fixture.logs, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    if (process.env.OMB_KEEP_CONTINUITY_FIXTURE === "1") console.log(`[continuity] kept ${fixture.root}`);
    // Stop the owned children even when the root is kept for inspection.
    // Leaving them attached keeps this process's event loop alive, so the job
    // hangs until its timeout and the real failure is never reported.
    for (const restore of [...fixture.stopped].reverse()) {
      try { restore(); } catch { /* teardown must not mask the real failure */ }
    }
    fixture.stopped.length = 0;
    if (process.env.OMB_KEEP_CONTINUITY_FIXTURE !== "1") fixture.stop();
    execFileSync("sudo", ["dpkg", "--purge", CANDIDATE_PACKAGE.name], { stdio: "ignore" });
    execFileSync("sudo", ["dpkg", "--purge", OLD_PACKAGE.name], { stdio: "ignore" });
  }
}

await main().catch((error) => {
  console.error(`[continuity] FAILED: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
// The runner's timeout must never be how this run reports itself: stop anything
// still holding the loop open, then leave on the recorded exit code.
process.exit(process.exitCode ?? 0);