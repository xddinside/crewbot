#!/usr/bin/env node
// Native systemd cutover and rollback proof for the standalone Crewbot service.
//
// What this establishes, and only on an explicitly disposable runner that really
// runs systemd as PID 1:
//
//   * the production `crewbot service install` output, executed verbatim, moves a
//     real enabled `openmausbot.service` onto a real `crewbot.service` that runs
//     against the migrated data root, and retires the old unit;
//   * the failure boundaries the ticket names (legacy stop, an interrupted data
//     cutover, a new service that cannot start) all leave recoverable originals;
//   * production `crewbot service rollback` puts the legacy unit back, active,
//     against its own data root, with the conversation, its attachment bytes and
//     its next turn working again;
//   * malformed receipts and unsafe paths refuse before anything destructive.
//
// Every command here is a real command. The one injected failure refuses an
// exact argv and delegates everything else to the real sudo; it can only turn a
// command into a real failure, never into a fake success.
//
// Usage: node scripts/smoke-linux-service-cutover.mjs
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  chmodSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIXTURE_TAG, OwnedResources, api, apiOk, controlOmb, ensureDirectory, fail, journalExcerpt, note,
  parseControlOmb, processCwd, processEnvironment, productionCli, removeQuietly, requireNativeSystemd, reservePortBlock,
  run, runOk, serviceOwner, sha256, step, stdout, systemctl, systemctlProp, tokenizePrintedCommand,
  tokenizeQuotedCommand, unitIsActive, unitIsEnabled, unitSnapshot, waitForHealth, writeFailingSudoShim,
} from "./testing/linux-service-fixture.mjs";
import { legacyUnitProvenance, renderLegacySystemdUnit } from "./testing/linux-legacy-unit.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CREWBOT_UNIT = "crewbot.service";
const LEGACY_UNIT = "openmausbot.service";
const LEGACY_BACKUP = `${LEGACY_UNIT}.crewbot-backup`;
const UNIT_DIRECTORY = "/etc/systemd/system";
const OWNED_UNITS = [CREWBOT_UNIT, LEGACY_UNIT];

const SEED_TEXT = "legacy anchor conversation for the service cutover proof";
const REPLY_TEXT = "next turn after the service cutover";
const ATTACHMENT_MIME = "image/png";
const ATTACHMENT_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const CANDIDATE_ARTIFACT_ID = "11215642565";
const CANDIDATE_RUN = "36982252699";
const OLD_PACKAGE_SHA256 = "c34b4d95c26b6edb4992ec6766ebfa9e47b0a740d172ea8aec5df1d14968d017";

const evidence = { steps: [], assertions: [], cleanup: null, environment: null, legacyUnit: null, inputs: null };
const owned = new OwnedResources();

function record(name, detail) {
  evidence.steps.push({ name, detail: detail ?? null });
  step(name);
  if (detail !== undefined && detail !== null) note(typeof detail === "string" ? detail : JSON.stringify(detail));
}

function assert(condition, message) {
  if (!condition) fail(`assertion failed: ${message}`);
  evidence.assertions.push(message);
}

function unitFile(name) {
  return join(UNIT_DIRECTORY, name);
}

function sleep(ms) {
  spawnSync("sleep", [String(ms / 1000)]);
}

function systemctlOk(args) {
  const result = run("systemctl", args, { allowFailure: true });
  if (result.status !== 0) fail(`systemctl ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result;
}

function stopUnit(unit) {
  const before = unitMainPid(unit);
  systemctl(["stop", unit], { allowFailure: true });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    // Leaving `active` is not the same as being gone: systemd marks the unit
    // stopped before the process has necessarily exited and dropped the
    // data-dir lease it still owns. Wait for the pid to disappear, so a
    // following migration is not refused against a server that is on its way
    // out.
    if (systemctlProp(unit, "ActiveState") !== "active" && !pidIsAlive(before)) return;
    sleep(200);
  }
  fail(`${unit} was still active 60 s after systemctl stop`);
}

/** The pid systemd reports as the unit's main process, before it is stopped. */
function unitMainPid(unit) {
  const value = systemctlProp(unit, "MainPID");
  return Number.isInteger(value) && value > 0 ? value : null;
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the pid exists but this account cannot signal it.
    return error?.code === "EPERM";
  }
}

/** Everything that must be true of a live unit that owns a data root. */
async function assertLiveServiceOwnsRoot(unit, { dataDir, port, home, label }) {
  assert(unitIsActive(unit), `${label}: ${unit} is active`);
  const mainPid = Number(systemctlProp(unit, "MainPID"));
  assert(Number.isInteger(mainPid) && mainPid > 1, `${label}: ${unit} reports a real MainPID (${mainPid})`);
  const environment = processEnvironment(mainPid);
  assert(
    environment.OMB_DATA_DIR === dataDir,
    `${label}: the live ${unit} process (pid ${mainPid}) has OMB_DATA_DIR=${dataDir} (CREWBOT_DATA_DIR=${environment.CREWBOT_DATA_DIR})`,
  );
  assert(processCwd(mainPid) === home, `${label}: the live ${unit} process (pid ${mainPid}) runs from the fixture home ${home}`);
  const execStart = systemctlProp(unit, "ExecStart") ?? "";
  assert(execStart.includes(dataDir), `${label}: systemd's own ExecStart for ${unit} names ${dataDir}`);
  const health = await waitForHealth(port, { label: `${label} ${unit} on port ${port}` });
  assert(health.app === "openmausbot", `${label}: ${unit} answers /api/health on 127.0.0.1:${port}`);
  return { mainPid, execStart };
}

/** Read the transcript back through the live service that owns the root. */
async function assertConversationReadable(port, expectedTexts, label) {
  const listing = await apiOk(`http://127.0.0.1:${port}`, "GET", "/api/bots?messages=200");
  const messages = (listing.bots ?? []).flatMap((bot) => (bot.messages ?? []).map((message) => String(message.text ?? "")));
  for (const expected of expectedTexts) {
    assert(
      messages.some((text) => text.includes(expected)),
      `${label}: the live service on port ${port} serves a transcript containing ${JSON.stringify(expected)}`,
    );
  }
}

async function assertAttachmentReadable(port, attachment, label) {
  const served = await api(`http://127.0.0.1:${port}`, "GET", `/api/attachments/${attachment.name}`);
  assert(served.status === 200, `${label}: GET /api/attachments/${attachment.name} returned ${served.status}`);
  assert(
    sha256(served.bytes) === sha256(ATTACHMENT_BYTES),
    `${label}: the attachment served from port ${port} is byte-identical to the bytes stored before the cutover`,
  );
}

async function runNextTurn(port, bot, text, label) {
  const url = `http://127.0.0.1:${port}`;
  const send = parseControlOmb(controlOmb(["send", "--bot", bot.id, "--task", bot.taskId, "--text", text], { url, repoRoot: REPO_ROOT }), "send");
  assert(send?.success === true, `${label}: the send was accepted (${JSON.stringify(send)})`);
  const settled = parseControlOmb(controlOmb(["wait", "--bot", bot.id, "--task", bot.taskId, "--timeout", "120"], { url, repoRoot: REPO_ROOT }), "wait");
  assert(settled.status === "settled", `${label}: the turn settled through the live service (got ${JSON.stringify(settled.status)})`);
  const messages = parseControlOmb(controlOmb(["messages", "--bot", bot.id, "--task", bot.taskId, "--limit", "30"], { url, repoRoot: REPO_ROOT }), "messages");
  assert(
    (messages.messages ?? []).some((message) => String(message.text ?? "").includes(text)),
    `${label}: the turn's own text reads back through the live service`,
  );
  return settled;
}

/** Install and drive the legacy unit the historical renderer produced. */
async function startLegacyService({ home, owner, port, dataDir }) {
  const rendered = renderLegacySystemdUnit({
    node: process.execPath,
    script: join(REPO_ROOT, "server", "openmausbot.ts"),
    serveArgs: ["--port", String(port), "--data-dir", dataDir, "--no-pair"],
    dataDir,
    user: owner,
    home,
    bindsLowPorts: false,
  }, { repoRoot: REPO_ROOT });
  evidence.legacyUnit = { ...legacyUnitProvenance(REPO_ROOT), unitName: rendered.unitName, rendererSha256: rendered.rendererSha256, unit: rendered.unit };
  writeFileSync(unitFile(LEGACY_UNIT), rendered.unit, { mode: 0o644 });
  chmodSync(unitFile(LEGACY_UNIT), 0o644);
  record("installed the legacy unit rendered by the historical OpenMausBot CLI module", {
    rendererRevision: evidence.legacyUnit.rendererRevision,
    rendererSubject: evidence.legacyUnit.rendererSubject,
    rendererSha256: rendered.rendererSha256,
    unitName: rendered.unitName,
    file: unitFile(LEGACY_UNIT),
    unitSha256: sha256(rendered.unit),
  });
  systemctlOk(["daemon-reload"]);
  // Confirm systemd actually adopted the file before driving it, so a unit that
  // never loaded is reported as such instead of surfacing later as an opaque
  // `reset-failed ... not loaded`. A pre-start `reset-failed` also exits
  // non-zero for a unit that is loaded but has never failed, which is the normal
  // state here, so it stays tolerant.
  const loadState = systemctlProp(LEGACY_UNIT, "LoadState");
  assert(loadState === "loaded", `${LEGACY_UNIT} reports LoadState=${loadState ?? "unknown"} after daemon-reload, so the installed unit file was not adopted`);
  record("systemd adopted the legacy unit file", { unit: LEGACY_UNIT, loadState });
  systemctl(["reset-failed", LEGACY_UNIT], { allowFailure: true });
  systemctlOk(["enable", "--now", LEGACY_UNIT]);
  await waitForHealth(port, { label: `legacy ${LEGACY_UNIT}` });
  assert(unitIsActive(LEGACY_UNIT), `${LEGACY_UNIT} is active before the cutover`);
  assert(unitIsEnabled(LEGACY_UNIT), `${LEGACY_UNIT} is enabled before the cutover`);
  return rendered;
}

/** Seed a real conversation and real attachment bytes through the legacy service. */
async function seedLegacyData({ owner, port, dataDir }) {
  const wrapper = join(evidence.environment.fixtureRoot, "bin", "fixture-fake-claude.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env -S node --experimental-strip-types",
    "// Fixture-owned wrapper around the repository's fake engine. It sets the",
    "// scripted behaviour itself, so the systemd unit needs no extra environment.",
    "process.env.FAKE_CLAUDE_MODE = 'happy';",
    `await import(${JSON.stringify(join(REPO_ROOT, "server", "testing", "fake-claude-cli.ts"))});`,
    "",
  ].join("\n"), { mode: 0o755 });
  chmodSync(wrapper, 0o755);
  runOk("chown", [owner, wrapper]);
  owned.path(wrapper);

  const base = `http://127.0.0.1:${port}`;
  await apiOk(base, "PATCH", "/api/instances/claude", { cli: wrapper });
  const created = parseControlOmb(controlOmb(["new-bot", "--name", "Legacy anchor"], { url: base, repoRoot: REPO_ROOT }), "new-bot");
  const bot = { id: created.bot.id, taskId: created.bot.activeTaskId ?? created.bot.threadId };
  await runNextTurn(port, bot, SEED_TEXT, "legacy seed");
  const uploaded = await apiOk(base, "POST", "/api/attachments", ATTACHMENT_BYTES, { headers: { "content-type": ATTACHMENT_MIME } });
  const attachment = { path: uploaded.path, name: String(uploaded.path).split("/").pop() };
  assert(attachment.path.startsWith(`${join(dataDir, "attachments")}/`), `the attachment was stored inside the legacy root (${attachment.path})`);
  assert(sha256(readFileSync(attachment.path)) === sha256(ATTACHMENT_BYTES), "the stored attachment is byte-identical to what was uploaded");
  await assertAttachmentReadable(port, attachment, "legacy seed");
  await assertConversationReadable(port, [SEED_TEXT], "legacy seed");
  record("seeded a synthetic legacy conversation and attachment through the legacy unit", {
    root: dataDir, bot: bot.id, attachment: attachment.name, attachmentSha256: sha256(ATTACHMENT_BYTES),
  });
  return { bot, attachment, wrapper };
}

/** Ask production which commands to run, then run exactly those. */
function printedPlan(installOutput) {
  const lines = installOutput.split("\n").map((line) => line.trim());
  const commands = lines.filter((line) => line.startsWith("sudo "));
  if (!commands.length) fail("`crewbot service install` printed no installable commands");
  const rollbackLine = lines.find((line) => line.includes("service") && line.includes("rollback"));
  if (!rollbackLine) fail("`crewbot service install` printed no rollback command");
  return { commands, rollback: tokenizeQuotedCommand(rollbackLine) };
}

/** Read the same instructions out of production's own plan module, as a drift check. */
function productionPlan(dataDir, home) {
  const script = [
    `const { servicePlan } = await import(${JSON.stringify(join(REPO_ROOT, "server", "service-unit.ts"))});`,
    "process.stdout.write(JSON.stringify(servicePlan('linux', process.argv[1], process.argv[2])));",
  ].join("\n");
  const result = run(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, dataDir, home]);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`could not read the production service plan (${error instanceof Error ? error.message : String(error)}): ${result.stderr}`);
  }
}

/**
 * Run printed instructions without a shell. Commands before `failFrom` must
 * succeed; from `failFrom` on, the first command must fail for real and the
 * sequence stops there.
 */
function executePrinted(commands, { extraPath = [], failFrom = Number.POSITIVE_INFINITY } = {}) {
  const searchPath = [...extraPath, "/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"].join(":");
  const results = [];
  for (const [index, command] of commands.entries()) {
    const argv = tokenizePrintedCommand(command);
    if (argv[0] !== "sudo") fail(`printed instruction does not start with sudo: ${command}`);
    const result = run(argv[0], argv.slice(1), { env: { ...process.env, PATH: searchPath }, allowFailure: true });
    results.push({ command, status: result.status, stderr: result.stderr.trim().slice(0, 400) });
    if (index < failFrom) {
      if (result.status !== 0) fail(`printed instruction failed: ${command}\n${result.stdout}\n${result.stderr}`);
      continue;
    }
    if (result.status === 0) fail(`the injected step must fail for real: ${command}`);
    return results;
  }
  if (failFrom !== Number.POSITIVE_INFINITY) fail(`no instruction at index ${failFrom} to fail`);
  return results;
}

function runServiceInstall({ home, owner, port, dataDir, env = {} }) {
  const result = productionCli(["service", "install", "--port", String(port), "--data-dir", dataDir], {
    as: owner, home, repoRoot: REPO_ROOT, env,
  });
  if (result.status !== 0) fail(`\`crewbot service install\` exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  return result;
}

/** Production rollback. Boundaries under test are refusals, so this reports the
 * result and the caller decides whether a non-zero exit is the expected answer. */
function runServiceRollback({ home, owner, dataDir }) {
  return productionCli(["service", "rollback", "--data-dir", dataDir], { as: owner, home, repoRoot: REPO_ROOT });
}

function migrationReceipts(dataDir) {
  const recovery = join(dataDir, ".crewbot-migration", "recovery");
  if (!existsSync(recovery)) return [];
  return readdirSync(recovery)
    .map((entry) => join(recovery, entry, "receipt.json"))
    .filter((path) => existsSync(path))
    .map((path) => ({ ...JSON.parse(readFileSync(path, "utf8")), receiptPath: path }));
}

/** The migration bookkeeping as it actually sits on disk, names only.
 *
 * A missing receipt is ambiguous on its own: the same empty result means the
 * migration never ran, that it ran somewhere else, or that its bookkeeping was
 * removed. Listing the real tree turns that ambiguity into one readable fact. */
function migrationTree(dataDir) {
  const migrationDir = join(dataDir, ".crewbot-migration");
  const listing = (directory, prefix, depth) => {
    if (depth > 3) return [];
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); }
    catch { return []; }
    return entries.flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!entry.isDirectory()) return [relative];
      return [relative, ...listing(join(directory, entry.name), relative, depth + 1)];
    });
  };
  return {
    migrationDirPresent: existsSync(migrationDir),
    entries: listing(migrationDir, "", 0).slice(0, 200),
    dataDirEntries: existsSync(dataDir) ? readdirSync(dataDir).slice(0, 100) : null,
  };
}

function completedReceipt(dataDir) {
  const completed = migrationReceipts(dataDir).filter((receipt) => receipt.phase === "complete");
  if (!completed.length) fail(`no completed migration receipt under ${join(dataDir, ".crewbot-migration", "recovery")}`);
  return completed[completed.length - 1];
}

function conversationRows(dataDir) {
  const handle = new DatabaseSync(join(dataDir, "messages.db"), { readOnly: true });
  try {
    return handle.prepare("SELECT text FROM messages ORDER BY rowid").all().map((row) => String(row.text ?? ""));
  } finally {
    handle.close();
  }
}

/** The full stored message JSON, where rebased paths actually live. */
function conversationJson(dataDir) {
  const handle = new DatabaseSync(join(dataDir, "messages.db"), { readOnly: true });
  try {
    return handle.prepare("SELECT json FROM messages ORDER BY rowid").all().map((row) => String(row.json ?? ""));
  } finally {
    handle.close();
  }
}

function assertSoleSystemdOwner(dataDir, { label }) {
  const claiming = readdirSync(UNIT_DIRECTORY)
    .filter((entry) => entry.endsWith(".service"))
    .filter((entry) => readFileSync(join(UNIT_DIRECTORY, entry), "utf8").includes(dataDir));
  assert(
    claiming.length === 1 && claiming[0] === CREWBOT_UNIT,
    `${label}: ${CREWBOT_UNIT} is the only installed systemd unit that claims ${dataDir} (found ${JSON.stringify(claiming)})`,
  );
}

function assertLegacyUnitContract(contents, dataDir) {
  const lines = contents.split("\n");
  assert(lines.includes("Description=OpenMausBot"), `the restored unit carries the legacy description\n${contents}`);
  assert(lines.includes(`Environment=OMB_DATA_DIR=${dataDir}`), `the restored unit declares the legacy data root ${dataDir}\n${contents}`);
  assert(lines.some((line) => line.startsWith("ExecStart=")), `the restored unit has an ExecStart\n${contents}`);
  assert(!lines.some((line) => line.includes("CREWBOT_DATA_DIR")), `the restored unit is not a Crewbot unit\n${contents}`);
}

/** Remove everything a case created, so the next case starts from nothing. */
function resetRoots({ label }) {
  for (const unit of OWNED_UNITS) stopUnit(unit);
  systemctl(["disable", CREWBOT_UNIT, LEGACY_UNIT], { allowFailure: true });
  for (const name of [CREWBOT_UNIT, LEGACY_UNIT, LEGACY_BACKUP]) {
    const problem = removeQuietly(unitFile(name));
    if (problem) fail(`${label}: could not remove owned unit file ${unitFile(name)}: ${problem}`);
  }
  systemctlOk(["daemon-reload"]);
  // After the unit files are gone the manager has nothing loaded, and a
  // manager-wide `reset-failed` exits non-zero in exactly that state. The point
  // here is to clear stale state between cases, so tolerate an empty manager
  // instead of failing the case on a cleanup step.
  systemctl(["reset-failed"], { allowFailure: true });
  for (const name of [".openmausbot", ".crewbot"]) {
    const problem = removeQuietly(join(evidence.environment.home, name));
    if (problem) fail(`${label}: could not remove owned data root ${name}: ${problem}`);
  }
}

// ── Case 1: the legacy stop fails, originals stay recoverable, rollback works ─

async function caseLegacyStopFailure(context) {
  const { home, owner, legacyPort, crewbotPort } = context;
  const legacyRoot = join(home, ".openmausbot");
  const dataDir = join(home, ".crewbot");
  record("CASE 1 — legacy-stop failure, recoverable originals, production rollback");

  await startLegacyService({ home, owner, port: legacyPort, dataDir: legacyRoot });
  const seeded = await seedLegacyData({ owner, port: legacyPort, dataDir: legacyRoot });

  // The lease guard refuses to migrate a legacy root another live server still
  // owns. That refusal is correct, so prove it, then stop the legacy service
  // the way the real cutover does and confirm the guard lifts. Skipping straight
  // to the install would assert a migration ordering the product will not
  // perform while the old unit runs.
  const refused = productionCli(
    ["service", "install", "--port", String(crewbotPort), "--data-dir", dataDir],
    { as: owner, home, repoRoot: REPO_ROOT },
  );
  assert(
    refused.status !== 0 && String(refused.stderr).includes("another server may be using it"),
    `service install refuses to migrate a legacy root the running legacy unit still owns\nstatus: ${refused.status}\nstderr: ${refused.stderr}`,
  );
  assert(existsSync(legacyRoot), "the refused migration left the legacy root in place");
  record("the lease guard refused to migrate while the legacy unit still owned the root", {
    status: refused.status,
    stderr: String(refused.stderr).split("\n")[0],
  });

  stopUnit(LEGACY_UNIT);
  assert(!unitIsActive(LEGACY_UNIT), "the legacy unit is stopped before the cutover runs");

  // The stopped unit must have taken its data-dir lease with it. Report the
  // lease record itself when the guard still refuses, so the diagnosis names the
  // pid the guard still considers alive instead of only its message.
  const legacyLeasePath = join(legacyRoot, "openmausbot-server.lease");
  const legacyLease = existsSync(legacyLeasePath) ? readFileSync(legacyLeasePath, "utf8").trim() : "(absent)";
  record("legacy lease after stopping the unit", { leasePath: legacyLeasePath, lease: legacyLease.slice(0, 400) });

  // Production migrates the data root inside `service install`, before it prints
  // the plan. That is the real ordering the printed rollback has to survive.
  const plan = printedPlan(runServiceInstall({ home, owner, port: crewbotPort, dataDir }).stdout);
  const production = productionPlan(dataDir, home);
  const expected = [...(production.prepareLegacy ?? []), ...production.activate, ...(production.retireLegacy ?? [])];
  assert(
    JSON.stringify(plan.commands) === JSON.stringify(expected),
    `the executed instructions are exactly production's own plan\nprinted: ${JSON.stringify(plan.commands)}\nplan:    ${JSON.stringify(expected)}`,
  );
  const legacyStopIndex = plan.commands.findIndex((line) => line.includes("disable") && line.includes(LEGACY_UNIT));
  assert(legacyStopIndex >= 0, "the printed plan contains the legacy stop");
  assert(!existsSync(legacyRoot), `service install already moved the legacy root into ${dataDir}`);
  const receipt = completedReceipt(dataDir);
  assert(receipt.source === legacyRoot, `the migration receipt names the legacy root it came from (${receipt.source})`);
  for (const file of receipt.metadataFiles) {
    assert(
      existsSync(join(dataDir, ".crewbot-migration", "recovery", receipt.id, file)),
      `a pre-migration snapshot of ${file} is recoverable under ${dataDir}`,
    );
  }

  const shimDirectory = join(evidence.environment.fixtureRoot, "shim-legacy-stop");
  writeFailingSudoShim(shimDirectory, ["systemctl disable --now openmausbot.service"]);
  owned.path(shimDirectory);
  const injected = executePrinted(plan.commands, { extraPath: [shimDirectory], failFrom: legacyStopIndex });
  record("the legacy stop failed for real, through the injected control-flow refusal", injected);
  assert(String(injected.at(-1).stderr).includes("injected failure"), "the failing step was the injected legacy stop");
  assert(existsSync(unitFile(LEGACY_BACKUP)), `the legacy unit was backed up before the stop was attempted (${unitFile(LEGACY_BACKUP)})`);
  assert(
    readFileSync(unitFile(LEGACY_BACKUP), "utf8") === readFileSync(unitFile(LEGACY_UNIT), "utf8"),
    "the saved legacy backup is byte-identical to the legacy unit",
  );
  assert(!unitIsActive(LEGACY_UNIT), "the legacy service was still stopped after the injected stop failure, so the plan's own stop never succeeded");
  assert(!existsSync(unitFile(CREWBOT_UNIT)), "crewbot.service was never installed, because the printed plan stopped before activation");
  assert(!unitIsActive(CREWBOT_UNIT), "crewbot.service never ran");
  // The legacy unit was already stopped before the migration, because the lease
  // guard refuses to move a root a live server owns. So the plan's own stop has
  // nothing left to stop, and what this case proves is that a failing legacy
  // stop still leaves both data roots recoverable and both unit files intact.
  const strandedPid = Number(systemctlProp(LEGACY_UNIT, "MainPID"));
  assert(strandedPid === 0, `no legacy process is left owning the migrated tree (MainPID ${strandedPid})`);
  assert(existsSync(unitFile(LEGACY_UNIT)), "the legacy unit file itself survived the failed stop");
  assert(!existsSync(legacyRoot), "the legacy root stays moved until rollback republishes it");
  assert(conversationRows(dataDir).some((text) => text.includes(SEED_TEXT)), "the migrated conversation is recoverable after the failed stop");
  assert(
    sha256(readFileSync(join(dataDir, "attachments", seeded.attachment.name))) === sha256(ATTACHMENT_BYTES),
    "the attachment bytes are recoverable from the migrated root after the failed stop",
  );

  // The advertised recovery: the printed argv, run as the operator who owns the
  // service. Running it as root instead would republish the legacy root owned by
  // root, which the unprivileged legacy service could not then write to.
  const [printedNode, ...rollbackArgv] = plan.rollback;
  assert(printedNode === process.execPath, `the printed rollback command runs this same node binary (${printedNode})`);
  // Run the printed argv verbatim under the owning account. The argv already
  // carries its own node binary and `--experimental-strip-types`, so it must be
  // passed through untouched: dropping the binary handed the flag to sudo, and
  // substituting it duplicated the binary. What is under test is the command the
  // product prints, so execute exactly that.
  const rollback = run("sudo", ["-n", "-u", owner, "-H", printedNode, ...rollbackArgv], { cwd: REPO_ROOT });
  assert(rollback.status === 0, `the printed rollback command reported success (exit ${rollback.status}):\n${rollback.stdout}\n${rollback.stderr}`);
  record("the printed rollback command recovered the legacy service", rollback.stdout.trim());

  const restored = await assertLiveServiceOwnsRoot(LEGACY_UNIT, { dataDir: legacyRoot, port: legacyPort, home, label: "case 1 rollback" });
  assert(restored.mainPid > 1, `rollback brought the legacy unit back under a real pid (${restored.mainPid})`);
  assert(!unitIsActive(CREWBOT_UNIT), "crewbot.service is not active after the case 1 rollback");
  assert(!unitIsEnabled(CREWBOT_UNIT), "crewbot.service is not enabled after the case 1 rollback");
  assert(existsSync(dataDir), `the Crewbot data root is preserved at ${dataDir}`);
  assertLegacyUnitContract(readFileSync(unitFile(LEGACY_UNIT), "utf8"), legacyRoot);
  await assertConversationReadable(legacyPort, [SEED_TEXT], "case 1 rollback");
  await assertAttachmentReadable(legacyPort, seeded.attachment, "case 1 rollback");
  await runNextTurn(legacyPort, seeded.bot, REPLY_TEXT, "case 1 rollback");
  record("the recovered legacy service took a new turn against its own root", { mainPid: restored.mainPid });
}

// ── Case 2: interrupted cutover, refusal boundaries, failed start, rollback ──

/** Rebuild the crash window production itself would leave behind. */
function buildInterruptedCutover(dataDir, home) {
  // The real cutover stops the legacy unit before the move, because the lease
  // guard refuses to migrate a root a live server owns. Stop it here too,
  // otherwise this reconstructs nothing: the migration returns early and there
  // is no receipt to build the crash window from.
  stopUnit(LEGACY_UNIT);
  assert(!unitIsActive(LEGACY_UNIT), "the legacy unit is stopped before the interrupted cutover is reconstructed");
  // `migrateLegacyDataDir` only moves a legacy root that exists, into a
  // destination that either does not exist or already holds a migration
  // journal. State both, and what the migration then did, so a refusal is named
  // here instead of surfacing as a missing receipt several steps later.
  const legacyRoot = join(home, ".openmausbot");
  const destinationJournal = join(dataDir, ".crewbot-migration", "journal.json");
  assert(existsSync(legacyRoot), `the legacy root ${legacyRoot} must exist to be migrated`);
  assert(
    !existsSync(dataDir) || existsSync(destinationJournal),
    `the Crewbot root ${dataDir} already exists without a migration journal, so the real migration would refuse to move the legacy root into it`,
  );
  const script = [
    `const { migrateLegacyDataDir } = await import(${JSON.stringify(join(REPO_ROOT, "electron", "legacy-data-dir.mjs"))});`,
    "migrateLegacyDataDir(process.argv[1], { home: process.argv[2] });",
  ].join("\n");
  const migrated = run(process.execPath, ["--input-type=module", "-e", script, dataDir, home], { env: { ...process.env, HOME: home } });
  record("ran the real migration to rebuild the cutover window", {
    dataDir,
    home,
    exit: migrated.status,
    stdout: migrated.stdout.trim().slice(0, 400),
    stderr: migrated.stderr.trim().slice(0, 400),
  });
  const receipt = completedReceipt(dataDir);
  // The move has happened and the journal still says "applying": the exact
  // window between the rename and the completion receipt. Every field comes
  // from the receipt production itself wrote.
  writeFileSync(join(dataDir, ".crewbot-migration", "journal.json"), `${JSON.stringify({
    id: receipt.id, source: receipt.source, destination: dataDir, phase: "applying", files: receipt.metadataFiles,
  }, null, 2)}\n`, { mode: 0o600 });
  rmSync(join(dataDir, ".crewbot-migration", "recovery", receipt.id, "receipt.json"), { force: true });
  assert(existsSync(join(dataDir, ".crewbot-migration", "journal.json")), "the fixture left a real in-flight migration journal");
  assert(!existsSync(receipt.receiptPath), "the fixture removed the completion receipt");
  assert(!existsSync(receipt.source), "an interrupted cutover leaves no legacy root, so recovery must publish it again");
  return receipt;
}

async function caseInterruptedCutoverThenRollback(context) {
  const { home, owner, legacyPort, crewbotPort } = context;
  const legacyRoot = join(home, ".openmausbot");
  const dataDir = join(home, ".crewbot");
  record("CASE 2 — interrupted data cutover, refusal boundaries, new-start failure, production rollback");

  await startLegacyService({ home, owner, port: legacyPort, dataDir: legacyRoot });
  const seeded = await seedLegacyData({ owner, port: legacyPort, dataDir: legacyRoot });
  const interrupted = buildInterruptedCutover(dataDir, home);
  record("reconstructed production's interrupted-cutover window", { journalId: interrupted.id, source: interrupted.source });
  assert(conversationRows(dataDir).some((text) => text.includes(SEED_TEXT)), "the interrupted root still holds the seeded conversation");

  const installResult = runServiceInstall({ home, owner, port: crewbotPort, dataDir });
  const plan = printedPlan(installResult.stdout);
  // Read the migration bookkeeping on both sides of the printed plan. The plan
  // starts crewbot.service, so without this the record cannot say whether the
  // install failed to migrate or the started service undid it.
  const migrationState = (label) => record(`migration bookkeeping ${label}`, {
    dataDirPresent: existsSync(dataDir),
    legacyRootPresent: existsSync(legacyRoot),
    journalPresent: existsSync(join(dataDir, ".crewbot-migration", "journal.json")),
    receipts: migrationReceipts(dataDir).map((entry) => ({ id: entry.id, phase: entry.phase })),
    legacyRootReceipts: existsSync(legacyRoot)
      ? migrationReceipts(legacyRoot).map((entry) => ({ id: entry.id, phase: entry.phase }))
      : [],
    onDisk: migrationTree(dataDir),
  });
  migrationState("after service install, before the printed plan ran");
  const executed = executePrinted(plan.commands);
  record("case 2 install and its printed plan", {
    stdout: String(installResult.stdout).trim().slice(0, 600),
    stderr: String(installResult.stderr).trim().slice(0, 600),
    commands: plan.commands,
    executed: executed.map((entry) => ({ command: entry.command, status: entry.status })),
  });
  // Report every receipt production left, not just the first absent one: the
  // interesting states are a `rolled-back` receipt with no redo, and a redo
  // whose completion receipt landed somewhere other than the expected root.
  migrationState("after production redid the interrupted cutover and the plan ran");
  record("receipts after production redid the interrupted cutover", {
    dataDir,
    legacyRootPresent: existsSync(legacyRoot),
    receipts: migrationReceipts(dataDir).map((entry) => ({
      id: entry.id, phase: entry.phase, source: entry.source,
    })),
    legacyRootReceipts: existsSync(legacyRoot)
      ? migrationReceipts(legacyRoot).map((entry) => ({ id: entry.id, phase: entry.phase }))
      : [],
    onDisk: migrationTree(dataDir),
    legacyRootOnDisk: existsSync(legacyRoot) ? migrationTree(legacyRoot) : null,
  });
  // The interrupted cutover must leave the seeded conversation reachable. If the
  // receipt is gone and the conversation with it, the install completed against a
  // root that no longer holds the user's data — report that plainly rather than
  // as a missing receipt.
  const conversationSurvived = existsSync(dataDir) && conversationRows(dataDir).some((text) => text.includes(SEED_TEXT));
  assert(
    conversationSurvived,
    `the interrupted cutover lost the seeded conversation: no completed receipt under ${dataDir}, no legacy root at ${legacyRoot}, and the installed root does not hold the conversation. \`crewbot service install\` reported success and started crewbot.service against ${dataDir} regardless.`,
  );
  const receipt = completedReceipt(dataDir);
  const rolledBack = migrationReceipts(dataDir).filter((entry) => entry.phase === "rolled-back");
  assert(rolledBack.length >= 1, `production rolled the interrupted migration back before redoing it (${JSON.stringify(rolledBack.map((entry) => entry.id))})`);
  record("production rolled the interrupted cutover back and redid it", { rolledBack: rolledBack.map((entry) => entry.id), completed: receipt.id });
  await assertLiveServiceOwnsRoot(CREWBOT_UNIT, { dataDir, port: crewbotPort, home, label: "case 2 cutover" });
  assert(!existsSync(legacyRoot), "no legacy root survives a completed cutover");
  assert(!existsSync(unitFile(LEGACY_UNIT)), "the legacy unit file was retired once Crewbot was running");
  assert(systemctlProp(LEGACY_UNIT, "LoadState") === "not-found", "systemd no longer loads any legacy unit");
  assertSoleSystemdOwner(dataDir, { label: "case 2 cutover" });
  await assertConversationReadable(crewbotPort, [SEED_TEXT], "case 2 cutover");
  await assertAttachmentReadable(crewbotPort, seeded.attachment, "case 2 cutover");
  await runNextTurn(crewbotPort, seeded.bot, REPLY_TEXT, "case 2 cutover");
  const beforeRefusals = unitSnapshot(OWNED_UNITS);

  // Boundary: an unsafe metadata path must refuse before anything destructive.
  const externalTarget = join(evidence.environment.fixtureRoot, "external-metadata.json");
  const metadata = join(dataDir, "bots.json");
  const savedMetadata = readFileSync(metadata);
  unlinkSync(metadata);
  symlinkSync(externalTarget, metadata);
  const unsafe = runServiceRollback({ home, owner, dataDir });
  assert(unsafe.status !== 0, `rollback refused the dangling metadata link (exit ${unsafe.status})`);
  assert(/symbolic link in migrated metadata/i.test(unsafe.stderr), `the refusal names the unsafe link: ${unsafe.stderr.trim()}`);
  assert(!existsSync(externalTarget), "the external metadata target was never created");
  assert(JSON.stringify(unitSnapshot(OWNED_UNITS)) === JSON.stringify(beforeRefusals), "no systemd unit changed while refusing the unsafe path");
  writeFileSync(metadata, savedMetadata, { mode: 0o600 });
  record("refused a dangling metadata symlink before any systemd change", unsafe.stderr.trim());

  // Boundary: a damaged receipt must refuse before anything destructive.
  const savedReceipt = readFileSync(receipt.receiptPath);
  writeFileSync(receipt.receiptPath, "{ this is not a receipt", { mode: 0o600 });
  const damaged = runServiceRollback({ home, owner, dataDir });
  assert(damaged.status !== 0, `rollback refused the damaged receipt (exit ${damaged.status})`);
  assert(/damaged service migration receipt/i.test(damaged.stderr), `the refusal names the damaged receipt: ${damaged.stderr.trim()}`);
  assert(JSON.stringify(unitSnapshot(OWNED_UNITS)) === JSON.stringify(beforeRefusals), "no systemd unit changed while refusing the damaged receipt");
  assert(!existsSync(legacyRoot) && existsSync(dataDir), "both data directories stayed exactly where they were");
  writeFileSync(receipt.receiptPath, savedReceipt, { mode: 0o600 });
  record("refused a damaged migration receipt before any systemd change", damaged.stderr.trim());

  // Boundary: a new service that cannot start must leave recoverable originals.
  stopUnit(CREWBOT_UNIT);
  const installedUnit = readFileSync(unitFile(CREWBOT_UNIT), "utf8");
  writeFileSync(unitFile(CREWBOT_UNIT), installedUnit.replace(/^ExecStart=.*$/m, "ExecStart=/nonexistent/crewbot-node serve --no-pair"), { mode: 0o644 });
  systemctlOk(["daemon-reload"]);
  systemctlOk(["reset-failed", CREWBOT_UNIT]);
  const startResult = systemctl(["start", CREWBOT_UNIT], { allowFailure: true });
  const becameHealthy = await waitUntilUnhealthy(crewbotPort);
  assert(!becameHealthy, "the broken crewbot.service never served anything");
  record("the new unit genuinely failed to start", {
    systemctlStartExit: startResult.status,
    journal: journalExcerpt(CREWBOT_UNIT, 12).split("\n").slice(-8).join(" | "),
  });
  assert(existsSync(unitFile(LEGACY_BACKUP)), "the saved legacy unit is still recoverable after the failed start");
  assert(conversationRows(dataDir).some((text) => text.includes(SEED_TEXT)), "the migrated conversation is still recoverable after the failed start");
  assert(conversationRows(dataDir).some((text) => text.includes(REPLY_TEXT)), "the turn taken under crewbot.service is still recoverable after the failed start");
  assert(
    sha256(readFileSync(join(dataDir, "attachments", seeded.attachment.name))) === sha256(ATTACHMENT_BYTES),
    "the attachment bytes are still recoverable after the failed start",
  );
  assert(completedReceipt(dataDir).phase === "complete", "the completed migration receipt survived the failed start");
  writeFileSync(unitFile(CREWBOT_UNIT), installedUnit, { mode: 0o644 });
  systemctlOk(["daemon-reload"]);

  // The advertised recovery: production rollback, exactly as printed.
  assert(plan.rollback[0] === process.execPath, "the printed rollback command runs this same node binary");
  assert(plan.rollback.includes("service") && plan.rollback.includes("rollback"), `the printed rollback command is a service rollback: ${JSON.stringify(plan.rollback)}`);
  const rollback = runServiceRollback({ home, owner, dataDir });
  assert(rollback.status === 0, `production rollback reported success (exit ${rollback.status}):\n${rollback.stdout}\n${rollback.stderr}`);
  record("production rollback completed", rollback.stdout.trim());

  const restored = await assertLiveServiceOwnsRoot(LEGACY_UNIT, { dataDir: legacyRoot, port: legacyPort, home, label: "case 2 rollback" });
  assert(!unitIsActive(CREWBOT_UNIT), "crewbot.service is no longer active after rollback");
  assert(!unitIsEnabled(CREWBOT_UNIT), "crewbot.service is no longer enabled after rollback");
  assert(existsSync(dataDir), `the Crewbot data root is preserved at ${dataDir}`);
  assertLegacyUnitContract(readFileSync(unitFile(LEGACY_UNIT), "utf8"), legacyRoot);
  assert(conversationRows(legacyRoot).some((text) => text.includes(SEED_TEXT)), "the restored legacy root holds the pre-migration conversation");
  assert(
    !conversationJson(legacyRoot).some((json) => json.includes(dataDir)),
    `no rebased Crewbot path (${dataDir}) survived into the restored legacy transcript`,
  );
  await assertConversationReadable(legacyPort, [SEED_TEXT], "case 2 rollback");
  await assertAttachmentReadable(legacyPort, seeded.attachment, "case 2 rollback");
  await runNextTurn(legacyPort, seeded.bot, REPLY_TEXT, "case 2 rollback");
  record("the restored legacy service took a new turn against its own root", { mainPid: restored.mainPid });

  // Stable/development ownership: the development launch cannot claim the service.
  const development = productionCli(["service", "install", "--port", String(crewbotPort), "--data-dir", dataDir], {
    as: owner, home, repoRoot: REPO_ROOT, env: { CREWBOT_DEV_LAUNCH: "1" },
  });
  assert(development.status !== 0, `the development launch refused service management (exit ${development.status})`);
  assert(/disabled for the isolated development launch/i.test(development.stderr), `the refusal explains the separation: ${development.stderr.trim()}`);
  assert(!unitIsEnabled(CREWBOT_UNIT), "the development launch did not re-enable crewbot.service");
  record("the development launch cannot take stable service ownership", development.stderr.trim());
}

async function waitUntilUnhealthy(port) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return true;
    } catch { /* not serving, which is the point */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  return false;
}

// ── Cleanup ────────────────────────────────────────────────────────────────

function cleanUp() {
  const report = { removed: [], problems: [] };
  for (const unit of OWNED_UNITS) {
    stopUnit(unit);
    const disabled = systemctl(["disable", unit], { allowFailure: true });
    report.removed.push(`systemctl disable ${unit} -> exit ${disabled.status}`);
  }
  systemctl(["daemon-reload"], { allowFailure: true });
  // A manager-wide `reset-failed` exits non-zero when no unit is loaded, which
  // is the normal state late in teardown. Cleanup must still remove and report
  // what it owns, so tolerate that rather than failing on an empty manager.
  systemctl(["reset-failed"], { allowFailure: true });
  for (const name of [CREWBOT_UNIT, LEGACY_UNIT, LEGACY_BACKUP]) {
    const path = unitFile(name);
    const problem = removeQuietly(path);
    if (problem) report.problems.push(`unit file ${path}: ${problem}`);
    else report.removed.push(`unit file ${path}`);
  }
  systemctl(["daemon-reload"], { allowFailure: true });
  // A manager-wide `reset-failed` exits non-zero when no unit is loaded, which
  // is the normal state late in teardown. Cleanup must still remove and report
  // what it owns, so tolerate that rather than failing on an empty manager.
  systemctl(["reset-failed"], { allowFailure: true });
  for (const unit of OWNED_UNITS) {
    const state = systemctlProp(unit, "LoadState");
    if (state && state !== "not-found") report.problems.push(`${unit} still reports LoadState=${state}`);
  }
  for (const path of owned.report().paths) {
    const insideFixture = path.startsWith(evidence.environment.fixtureRoot) || path.startsWith(`${evidence.environment.home}/`);
    if (!insideFixture) {
      report.problems.push(`refusing to remove a path this fixture did not create: ${path}`);
      continue;
    }
    const problem = removeQuietly(path);
    if (problem) report.problems.push(`path ${path}: ${problem}`);
  }
  evidence.cleanup = report;
  return report;
}

function verifyOldPackageDigest() {
  const deb = process.env.OMB_OLD_PACKAGE;
  if (!deb) return { downloaded: false, note: "no old package was downloaded: the standalone service claim installs no package" };
  if (!existsSync(deb)) fail(`OMB_OLD_PACKAGE points at a missing file: ${deb}`);
  const actual = stdout("sha256sum", [deb]).split(/\s+/)[0];
  if (actual !== OLD_PACKAGE_SHA256) fail(`old package digest mismatch: expected ${OLD_PACKAGE_SHA256}, got ${actual}`);
  return { downloaded: true, path: deb, sha256: actual };
}

async function main() {
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp || !existsSync(runnerTemp) || !runnerTemp.startsWith("/")) {
    fail("RUNNER_TEMP must be an existing absolute CI path");
  }
  const host = requireNativeSystemd({ repoRoot: REPO_ROOT });
  const { owner, home, shell: ownerShell } = serviceOwner();
  note(`service owner ${owner} (home ${home}, shell ${ownerShell}) needs passwordless sudo, which this job depends on`);
  const runId = `${process.env.GITHUB_RUN_ID ?? "local"}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`;
  const fixtureRoot = join(runnerTemp, `omb-service-cutover-${runId}`);
  evidence.environment = {
    fixtureRoot, home, owner,
    node: process.execPath, nodeVersion: process.version,
    systemd: host.systemdVersion, init: host.init, systemctl: host.systemctl,
    repoRoot: REPO_ROOT, platform: process.platform,
  };
  step(`fixture root ${fixtureRoot}; service owner ${owner}; home ${home}`);

  // Refuse to touch anything this fixture did not create.
  for (const name of [".openmausbot", ".crewbot"]) {
    const path = join(home, name);
    if (existsSync(path) || lstatSync(path, { throwIfNoEntry: false })) fail(`refusing to touch a pre-existing data root: ${path}`);
  }
  for (const name of [CREWBOT_UNIT, LEGACY_UNIT, LEGACY_BACKUP]) {
    if (existsSync(unitFile(name))) fail(`refusing to replace a pre-existing unit: ${unitFile(name)}`);
  }
  const installed = run("dpkg-query", ["-W", "-f=${db:Status-Abbrev}", "crewbot"], { allowFailure: true });
  if (installed.status === 0 && installed.stdout.trim().startsWith("ii")) {
    fail("refusing to run against a package-installed Crewbot: package installation is a separate claim");
  }

  evidence.inputs = {
    sourceSha: process.env.OMB_FIXTURE_SOURCE_SHA ?? "unset",
    candidateArtifactId: CANDIDATE_ARTIFACT_ID,
    candidateRun: CANDIDATE_RUN,
    oldPackage: verifyOldPackageDigest(),
  };
  record("recorded the exact inputs", evidence.inputs);

  ensureDirectory(fixtureRoot, { mode: 0o755 });
  ensureDirectory(join(fixtureRoot, "bin"), { mode: 0o755 });
  owned.path(fixtureRoot);
  owned.unit(CREWBOT_UNIT);
  owned.unit(LEGACY_UNIT);
  owned.path(join(home, ".openmausbot"));
  owned.path(join(home, ".crewbot"));

  const legacyPorts = await reservePortBlock();
  const crewbotPorts = await reservePortBlock();
  const context = { home, owner, legacyPort: legacyPorts.port, crewbotPort: crewbotPorts.port };
  step(`reserved ports: legacy ${legacyPorts.port}, crewbot ${crewbotPorts.port}`);

  try {
    await caseLegacyStopFailure(context);
    resetRoots({ label: "between cases" });
    await caseInterruptedCutoverThenRollback(context);
    record("every native systemd assertion passed", { count: evidence.assertions.length });
  } finally {
    // Cleanup must not be able to hide the failure that got us here, and a
    // cleanup problem must still reach the report.
    try {
      const report = cleanUp();
      for (const line of report.removed) note(`cleanup: ${line}`);
      for (const problem of report.problems) console.error(`${FIXTURE_TAG} CLEANUP PROBLEM: ${problem}`);
    } catch (error) {
      evidence.cleanup ??= { removed: [], problems: [] };
      evidence.cleanup.problems.push(`cleanup threw: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`${FIXTURE_TAG} CLEANUP PROBLEM: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
  }
}

try {
  await main();
  const evidencePath = join(
    process.env.RUNNER_TEMP ?? ".",
    `omb-service-cutover-evidence-${process.env.GITHUB_RUN_ID ?? "local"}.json`,
  );
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
  step(`evidence written to ${evidencePath}`);
  if (evidence.cleanup?.problems.length) {
    console.error(`${FIXTURE_TAG} cleanup did not finish cleanly:\n${evidence.cleanup.problems.map((line) => `  ${line}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`${FIXTURE_TAG} OK: ${evidence.assertions.length} native systemd assertions passed`);
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  evidence.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  // A failed proof still has to be readable afterwards. The workflow uploads this
  // file on every run, so writing it here is what turns "it failed" into the
  // steps, receipts and unit state that explain why.
  try {
    const evidencePath = join(
      process.env.RUNNER_TEMP ?? ".",
      `omb-service-cutover-evidence-${process.env.GITHUB_RUN_ID ?? "local"}.json`,
    );
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
    console.error(`${FIXTURE_TAG} evidence written to ${evidencePath}`);
  } catch (writeError) {
    console.error(`${FIXTURE_TAG} the failure evidence could not be written: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
  }
  process.exit(1);
}
