import { randomUUID } from "node:crypto";
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmSync, rmdirSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { rebasePersistedFields, rebasePersistedMessage } from "./rebase-data-paths.mjs";

const LEGACY_DATA_DIR_NAMES = [".openmausbot", ".opengrokbot"];
const MIGRATION_DIR = ".crewbot-migration";
const JOURNAL_FILE = "journal.json";
const JSON_PATH_FILES = ["bots.json", "groups.json", "config.json", "routines.json", "calendar-calls.json"];
const MIGRATABLE_JSON_FILES = [...JSON_PATH_FILES, "room-continuations.json"];
const PATH_RECORD_KEYS = new Set(["cwd", "pinnedCwd", "workspace", "configDir", "profileDirectory", "agentDir", "dataDir", "home", "cli", "path", "filePath", "localPath"]);
const MIGRATABLE_FILES = new Set([...MIGRATABLE_JSON_FILES, "messages.db", "messages.db-wal", "messages.db-shm"]);

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function readJournal(dataDir) {
  const path = join(dataDir, MIGRATION_DIR, JOURNAL_FILE);
  if (!existsSync(path)) return null;
  let journal;
  try { journal = JSON.parse(readFileSync(path, "utf8")); }
  catch (cause) { throw new Error(`Crewbot found a damaged migration record at ${path}; both data directories were preserved.`, { cause }); }
  if (!record(journal) || typeof journal.id !== "string" || !/^[0-9a-f-]{36}$/.test(journal.id) ||
      typeof journal.source !== "string" || typeof journal.destination !== "string" ||
      !["prepared", "applying", "complete"].includes(journal.phase) ||
      !Array.isArray(journal.files) || !journal.files.every((file) => typeof file === "string" &&
        !file.includes("/") && !file.includes("\\") && (MIGRATABLE_FILES.has(file) || /^messages-[^/]+\.json$/.test(file)))) {
    throw new Error(`Crewbot found an invalid migration record at ${path}; both data directories were preserved.`);
  }
  return journal;
}

function backupPath(dataDir, id, file) {
  return join(dataDir, MIGRATION_DIR, "recovery", id, file);
}

const RECOVERY_ID = /^[0-9a-f-]{36}$/;

function serviceRecoveryReceipt(dataDir, entry) {
  if (!entry.isDirectory() || !RECOVERY_ID.test(entry.name)) {
    throw new Error(`Crewbot found an unsupported service migration recovery entry in ${join(dataDir, MIGRATION_DIR, "recovery")}; both data directories were preserved.`);
  }
  const recoveryDir = join(dataDir, MIGRATION_DIR, "recovery", entry.name);
  const receiptPath = join(recoveryDir, "receipt.json");
  const receiptStat = lstatSync(receiptPath);
  if (!receiptStat.isFile() || receiptStat.isSymbolicLink()) {
    throw new Error(`Crewbot found an unsupported service migration receipt at ${receiptPath}; both data directories were preserved.`);
  }
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath, "utf8")); }
  catch (cause) { throw new Error(`Crewbot found a damaged service migration receipt at ${receiptPath}; both data directories were preserved.`, { cause }); }
  if (!record(receipt) || receipt.id !== entry.name || !["complete", "rolled-back"].includes(receipt.phase) ||
      typeof receipt.source !== "string" || typeof receipt.destination !== "string") {
    throw new Error(`Crewbot found an invalid service migration receipt at ${receiptPath}; both data directories were preserved.`);
  }
  if (receipt.phase === "rolled-back") return null;
  if (!Array.isArray(receipt.metadataFiles) || !receipt.metadataFiles.every((file) => typeof file === "string" &&
      !file.includes("/") && !file.includes("\\") && (MIGRATABLE_FILES.has(file) || /^messages-[^/]+\.json$/.test(file))) ||
      typeof receipt.completedAt !== "string" || !Number.isFinite(Date.parse(receipt.completedAt))) {
    throw new Error(`Crewbot found an invalid service migration receipt at ${receiptPath}; both data directories were preserved.`);
  }

  if (resolve(receipt.destination) !== resolve(dataDir) || resolve(dirname(receipt.source)) !== resolve(dirname(dataDir)) ||
      ![".openmausbot", ".opengrokbot"].includes(basename(receipt.source))) {
    throw new Error(`Crewbot found a service migration receipt with unsupported data paths at ${receiptPath}; both data directories were preserved.`);
  }
  for (const file of receipt.metadataFiles) {
    const snapshot = backupPath(dataDir, receipt.id, file);
    const stat = lstatSync(snapshot);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Crewbot found an unsupported recovery snapshot at ${snapshot}; both data directories were preserved.`);
  }
  return { ...receipt, recoveryDir };
}

/** Validate and select the completed default-root migration used by service rollback. */
export function inspectLegacyDataDirServiceRecovery(dataDir) {
  const resolvedDataDir = resolve(dataDir);
  if (!existsSync(resolvedDataDir)) return null;
  const dataStat = lstatSync(resolvedDataDir);
  if (!dataStat.isDirectory() || dataStat.isSymbolicLink()) throw new Error(`Crewbot cannot recover a service workspace that is not a real directory: ${resolvedDataDir}`);
  const migrationDir = join(resolvedDataDir, MIGRATION_DIR);
  if (!existsSync(migrationDir)) return null;
  const migrationStat = lstatSync(migrationDir);
  if (!migrationStat.isDirectory() || migrationStat.isSymbolicLink()) throw new Error(`Crewbot found an unsupported migration recovery path at ${migrationDir}; both data directories were preserved.`);
  if (existsSync(join(migrationDir, JOURNAL_FILE))) throw new Error(`Crewbot found an unfinished data migration in ${migrationDir}; both data directories were preserved. Resolve that migration before restoring the legacy service.`);
  const recoveryDir = join(migrationDir, "recovery");
  if (!existsSync(recoveryDir)) return null;
  const recoveryStat = lstatSync(recoveryDir);
  if (!recoveryStat.isDirectory() || recoveryStat.isSymbolicLink()) throw new Error(`Crewbot found an unsupported recovery directory at ${recoveryDir}; both data directories were preserved.`);
  const migrations = readdirSync(recoveryDir, { withFileTypes: true })
    .map((entry) => serviceRecoveryReceipt(resolvedDataDir, entry))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.completedAt ?? "") - Date.parse(a.completedAt ?? ""));
  if (migrations.length === 0) return null;
  const selected = migrations[0];
  if (migrations.some((item) => resolve(item.source) !== resolve(selected.source))) {
    throw new Error(`Crewbot found conflicting legacy data roots in ${recoveryDir}; both data directories were preserved.`);
  }
  if (existsSync(selected.source)) throw new Error(`Crewbot will not replace the existing legacy data directory ${selected.source}; both data directories were preserved.`);
  const staging = join(dirname(selected.source), `.${basename(selected.source)}.crewbot-recovery-${selected.id}`);
  if (existsSync(staging)) throw new Error(`Crewbot will not replace the existing recovery directory ${staging}; both data directories were preserved.`);
  return { dataDir: resolvedDataDir, source: selected.source, id: selected.id, recoveryDir: selected.recoveryDir, metadataFiles: selected.metadataFiles, staging };
}

/** Build an old-path copy from the current workspace and the pre-migration metadata snapshot.
 * The migrated workspace remains in place. An existing source/staging path is never replaced.
 */
export function recoverLegacyDataDirForService(dataDir) {
  const recovery = inspectLegacyDataDirServiceRecovery(dataDir);
  if (!recovery) return null;
  try {
    cpSync(recovery.dataDir, recovery.staging, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true });
    const snapshotFiles = new Set(recovery.metadataFiles);
    for (const file of recovery.metadataFiles) {
      copyFileSync(backupPath(recovery.dataDir, recovery.id, file), join(recovery.staging, file));
      chmodSync(join(recovery.staging, file), 0o600);
    }
    for (const file of ["messages.db-wal", "messages.db-shm"]) {
      if (!snapshotFiles.has(file)) rmSync(join(recovery.staging, file), { force: true });
    }
  } catch (error) {
    throw new Error(`Crewbot could not prepare the legacy data recovery copy at ${recovery.staging}. The migrated workspace remains at ${recovery.dataDir}; preserve both paths while resolving the copy failure.`, { cause: error });
  }
  mkdirSync(recovery.source, { mode: 0o700 });
  try {
    renameSync(recovery.staging, recovery.source);
  } catch (error) {
    try { rmdirSync(recovery.source); } catch { /* Keep anything that appeared at the reserved original path. */ }
    throw new Error(`Crewbot prepared the legacy data recovery copy at ${recovery.staging}, but could not publish it to ${recovery.source}. The migrated workspace remains at ${recovery.dataDir}.`, { cause: error });
  }
  return { source: recovery.source, destination: recovery.dataDir, id: recovery.id };
}

function restoreFromBackup(dataDir, journal) {
  const snapshotted = new Set(journal.files);
  for (const file of journal.files) {
    const backup = backupPath(dataDir, journal.id, file);
    if (!existsSync(backup)) throw new Error(`Crewbot's migration recovery copy is incomplete: ${backup}`);
    const target = join(dataDir, file);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    copyFileSync(backup, target);
    chmodSync(target, 0o600);
  }
  for (const file of ["messages.db-wal", "messages.db-shm"]) {
    if (!snapshotted.has(file)) rmSync(join(dataDir, file), { force: true });
  }
}

function rollbackInterruptedMigration(dataDir, sourceDir, journal) {
  restoreFromBackup(dataDir, journal);
  const recovery = join(dataDir, MIGRATION_DIR, "recovery", journal.id);
  atomicJson(join(recovery, "receipt.json"), {
    id: journal.id,
    phase: "rolled-back",
    source: sourceDir,
    destination: dataDir,
    recoveredAt: new Date().toISOString(),
  });
  rmSync(join(dataDir, MIGRATION_DIR, JOURNAL_FILE), { force: true });
  if (existsSync(sourceDir)) {
    throw new Error(`Crewbot recovered the interrupted migration but found both data directories. Both are preserved at ${sourceDir} and ${dataDir}; keep them and use the supported import/recovery flow.`);
  }
  renameSync(dataDir, sourceDir);
}

function validateJournalPaths(journal, dataDir, legacyDataDirs) {
  if (resolve(journal.destination) !== resolve(dataDir) ||
      !legacyDataDirs.some((candidate) => resolve(candidate) === resolve(journal.source))) {
    throw new Error("Crewbot found a migration record whose paths do not match the selected workspace; both data directories were preserved.");
  }
}

function finishCompletedMigration(dataDir, journal) {
  const recovery = join(dataDir, MIGRATION_DIR, "recovery", journal.id);
  const receiptPath = join(recovery, "receipt.json");
  if (!existsSync(receiptPath)) {
    atomicJson(receiptPath, {
      id: journal.id,
      phase: "complete",
      source: journal.source,
      destination: dataDir,
      completedAt: new Date().toISOString(),
      metadataFiles: journal.files,
    });
  }
  rmSync(join(dataDir, MIGRATION_DIR, JOURNAL_FILE), { force: true });
}

function rebaseJsonFile(path, source, destination, transform) {
  if (!existsSync(path)) return;
  const value = JSON.parse(readFileSync(path, "utf8"));
  transform(value, source, destination);
  atomicJson(path, value);
}

function pathMovesWithDataRoot(value, source, destination) {
  if (typeof value !== "string") return false;
  const probe = { path: value };
  rebasePersistedFields(probe, source, destination);
  return probe.path !== value;
}

function rebaseBotState(value, source, destination) {
  const bots = Array.isArray(value) ? value : record(value) && Array.isArray(value.bots) ? value.bots : [];
  for (const bot of bots) {
    if (!record(bot) || !Array.isArray(bot.tasks)) continue;
    let activeTaskMoved = false;
    for (const task of bot.tasks) {
      if (!record(task) || !pathMovesWithDataRoot(task.cwd, source, destination)) continue;
      // A provider-native session was created in this private folder. Keep
      // the app's transcript, but force its next turn to rebuild from that
      // transcript in the moved directory instead of resuming stale CWD state.
      task.resumeCursors = {};
      if (record(task.handedMessages)) task.handedMessages = {};
      if (task.threadId === bot.threadId) activeTaskMoved = true;
    }
    if (activeTaskMoved && record(bot.resumeCursors)) bot.resumeCursors = {};
  }
  rebasePersistedFields(value, source, destination);
}

function rebaseRoomContinuations(value) {
  if (!record(value) || !Array.isArray(value.records)) return;
  for (const continuation of value.records) {
    if (!record(continuation)) continue;
    // A room's default workspace is derived from the moved data directory and
    // is not stored as a path in this file. Its provider cursor is still bound
    // to the old folder, so the next turn must rebuild from the transcript.
    continuation.cursors = {};
    delete continuation.deliveredThroughMessageId;
    continuation.deliveredEligibleMessages = 0;
    // Leave an in-flight marker intact. Startup will classify it as uncertain
    // and rotate instead of resuming or silently replaying that provider turn.
  }
}

function rebaseMessagesDatabase(path, source, destination) {
  if (!existsSync(path)) return;
  const db = new DatabaseSync(path);
  try {
    db.exec("BEGIN IMMEDIATE");
    const update = db.prepare("UPDATE messages SET json = ?, text = ? WHERE thread_id = ? AND id = ?");
    for (const row of db.prepare("SELECT thread_id, id, json FROM messages").iterate()) {
      const message = JSON.parse(String(row.json));
      rebasePersistedMessage(message, source, destination);
      const json = JSON.stringify(message);
      if (json !== row.json) update.run(json, record(message) && typeof message.text === "string" ? message.text : null, row.thread_id, row.id);
    }
    const hasFollowups = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_followups'").get();
    if (hasFollowups) {
      const updateFollowup = db.prepare("UPDATE chat_followups SET payload = ? WHERE id = ?");
      for (const row of db.prepare("SELECT id, payload FROM chat_followups").iterate()) {
        const payload = JSON.parse(String(row.payload));
        rebasePersistedMessage(payload, source, destination);
        if (record(payload)) rebasePersistedFields(payload, source, destination);
        const json = JSON.stringify(payload);
        if (json !== row.payload) updateFollowup.run(json, row.id);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* The transaction may already have rolled back. */ }
    throw error;
  } finally {
    db.close();
  }
}

function collectMetadataFiles(dataDir) {
  const files = new Set([...MIGRATABLE_JSON_FILES, "messages.db", "messages.db-wal", "messages.db-shm"]);
  for (const name of readdirSync(dataDir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name)) {
    if (/^messages-[^/]+\.json$/.test(name)) files.add(name);
  }
  return [...files].filter((file) => existsSync(join(dataDir, file)));
}

function verifyPathRecords(value, source, destination) {
  if (Array.isArray(value)) {
    for (const item of value) verifyPathRecords(item, source, destination);
  } else if (record(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (PATH_RECORD_KEYS.has(key) && typeof item === "string") {
        const clone = { [key]: item };
        rebasePersistedFields(clone, source, destination);
        if (clone[key] !== item) throw new Error(`An old data-directory path remains in the ${key} field.`);
      } else if (typeof item === "object") verifyPathRecords(item, source, destination);
    }
  }
}

function verifyJsonFile(path, source, destination, transform) {
  if (!existsSync(path)) return;
  const value = JSON.parse(readFileSync(path, "utf8"));
  const again = structuredClone(value);
  transform(again, source, destination);
  if (JSON.stringify(again) !== JSON.stringify(value)) throw new Error(`A supported path field remains in ${path}.`);
  verifyPathRecords(value, source, destination);
}

function verifyMessageDatabase(path, source, destination) {
  if (!existsSync(path)) return;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    for (const row of db.prepare("SELECT json FROM messages").iterate()) {
      const value = JSON.parse(String(row.json));
      const again = structuredClone(value);
      rebasePersistedMessage(again, source, destination);
      if (JSON.stringify(again) !== JSON.stringify(value)) throw new Error("A transcript attachment still points into the old data directory.");
    }
    for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_followups'").iterate()) {
      if (row.name !== "chat_followups") continue;
      for (const item of db.prepare("SELECT payload FROM chat_followups").iterate()) {
        const value = JSON.parse(String(item.payload));
        const again = structuredClone(value);
        rebasePersistedMessage(again, source, destination);
        rebasePersistedFields(again, source, destination);
        if (JSON.stringify(again) !== JSON.stringify(value)) throw new Error("A pending conversation attachment still points into the old data directory.");
      }
    }
  } finally { db.close(); }
}

function applyMigration(dataDir, sourceDir, journal) {
  for (const name of JSON_PATH_FILES) {
    rebaseJsonFile(join(dataDir, name), sourceDir, dataDir, (value, source, destination) =>
      name === "bots.json"
        ? rebaseBotState(value, source, destination)
        : rebasePersistedFields(value, source, destination));
  }
  rebaseJsonFile(join(dataDir, "room-continuations.json"), sourceDir, dataDir, rebaseRoomContinuations);
  for (const file of journal.files.filter((name) => /^messages-[^/]+\.json$/.test(name))) {
    rebaseJsonFile(join(dataDir, file), sourceDir, dataDir, (value, source, destination) => {
      if (Array.isArray(value)) for (const message of value) rebasePersistedMessage(message, source, destination);
      else if (record(value) && Array.isArray(value.messages)) for (const message of value.messages) rebasePersistedMessage(message, source, destination);
    });
  }
  rebaseMessagesDatabase(join(dataDir, "messages.db"), sourceDir, dataDir);
  for (const name of JSON_PATH_FILES) {
    verifyJsonFile(join(dataDir, name), sourceDir, dataDir, (value, source, destination) =>
      name === "bots.json"
        ? rebaseBotState(value, source, destination)
        : rebasePersistedFields(value, source, destination));
  }
  verifyJsonFile(join(dataDir, "room-continuations.json"), sourceDir, dataDir, rebaseRoomContinuations);
  for (const file of journal.files.filter((name) => /^messages-[^/]+\.json$/.test(name))) {
    verifyJsonFile(join(dataDir, file), sourceDir, dataDir, (value, source, destination) => {
      if (Array.isArray(value)) for (const message of value) rebasePersistedMessage(message, source, destination);
      else if (record(value) && Array.isArray(value.messages)) for (const message of value.messages) rebasePersistedMessage(message, source, destination);
    });
  }
  verifyMessageDatabase(join(dataDir, "messages.db"), sourceDir, dataDir);
}

function snapshotMetadata(sourceDir, id) {
  const files = collectMetadataFiles(sourceDir);
  for (const file of files) {
    const source = join(sourceDir, file);
    const stat = lstatSync(source);
    if (!stat.isFile()) throw new Error(`Crewbot cannot migrate a non-file metadata entry safely: ${source}`);
    const backup = backupPath(sourceDir, id, file);
    mkdirSync(dirname(backup), { recursive: true, mode: 0o700 });
    copyFileSync(source, backup);
    chmodSync(backup, 0o600);
  }
  return files;
}

function migrate(sourceDir, dataDir) {
  const stat = lstatSync(sourceDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Crewbot cannot migrate a legacy data path that is not a real directory: ${sourceDir}`);

  const id = randomUUID();
  mkdirSync(join(sourceDir, MIGRATION_DIR), { recursive: true, mode: 0o700 });
  const files = snapshotMetadata(sourceDir, id);
  const journal = { id, source: sourceDir, destination: dataDir, phase: "prepared", files };
  const journalPath = join(sourceDir, MIGRATION_DIR, JOURNAL_FILE);
  atomicJson(journalPath, journal);

  try {
    renameSync(sourceDir, dataDir);
  } catch (error) {
    rmSync(journalPath, { force: true });
    throw new Error(`Crewbot could not move the legacy data directory. The original data remains at ${sourceDir}; fix the reported filesystem issue and retry.`, { cause: error });
  }

  try {
    journal.phase = "applying";
    atomicJson(join(dataDir, MIGRATION_DIR, JOURNAL_FILE), journal);
    applyMigration(dataDir, sourceDir, journal);
    journal.phase = "complete";
    atomicJson(join(dataDir, MIGRATION_DIR, JOURNAL_FILE), journal);
    atomicJson(join(dataDir, MIGRATION_DIR, "recovery", id, "receipt.json"), {
      id,
      phase: "complete",
      source: sourceDir,
      destination: dataDir,
      completedAt: new Date().toISOString(),
      metadataFiles: files,
    });
    rmSync(join(dataDir, MIGRATION_DIR, JOURNAL_FILE), { force: true });
  } catch (error) {
    try {
      restoreFromBackup(dataDir, journal);
      atomicJson(join(dataDir, MIGRATION_DIR, "recovery", id, "receipt.json"), {
        id,
        phase: "rolled-back",
        source: sourceDir,
        destination: dataDir,
        recoveredAt: new Date().toISOString(),
      });
      rmSync(join(dataDir, MIGRATION_DIR, JOURNAL_FILE), { force: true });
      if (!existsSync(sourceDir)) renameSync(dataDir, sourceDir);
    } catch (rollbackError) {
      throw new Error(`Crewbot migration failed and automatic rollback needs attention. Both copies and the recovery files were preserved at ${sourceDir} and ${dataDir}.`, { cause: new AggregateError([error, rollbackError]) });
    }
    throw new Error(`Crewbot migration failed; the original data was restored to ${sourceDir}. The recovery snapshot remains beside it.`, { cause: error });
  }
}

function warnLegacyDataLeftBehind(legacyDataDirs, dataDir, defaultDataDir, movedSource) {
  const stranded = legacyDataDirs.filter((dir) => existsSync(dir));
  for (const dir of stranded) {
    let reason;
    if (movedSource) {
      reason = `another legacy directory was already migrated from ${movedSource}; only one directory moves automatically`;
    } else if (resolve(dataDir) !== resolve(defaultDataDir)) {
      reason = `${dataDir} is a custom data directory, and legacy data is only migrated into the default workspace`;
    } else {
      reason = `${dataDir} already exists and wins without merging`;
    }
    console.error(
      `legacy-data-dir: ${dir} was not migrated into ${dataDir} because ${reason}. Keep both directories intact. ` +
      `To inspect the older data, open a disposable copy as a separate Crewbot workspace or restore its backup to a ` +
      `separate data directory. Settings > Backups replaces its target; it does not merge. Back up any target before ` +
      `replacement. Keep both original directories; do not delete or merge them as part of this recovery.`,
    );
  }
}

/** Move the default legacy workspace with a recoverable, verified path migration.
 *
 * @param dataDir - The selected Crewbot workspace root.
 * @param options - Optional home, legacy candidates, and active-lease guard for the Electron entry point.
 * @returns Nothing. A failed or interrupted migration is reported before callers can read workspace state.
 */
export function migrateLegacyDataDir(dataDir, options = {}) {
  const home = options.home ?? homedir();
  const defaultDataDir = join(home, ".crewbot");
  const legacyDataDirs = options.legacyDataDirs ?? LEGACY_DATA_DIR_NAMES.map((name) => join(home, name));
  if (resolve(dataDir) !== resolve(defaultDataDir)) {
    warnLegacyDataLeftBehind(legacyDataDirs, dataDir, defaultDataDir);
    return;
  }

  const sourceDir = legacyDataDirs.map((dir) => resolve(dir)).find((dir) => existsSync(dir));
  const journal = existsSync(dataDir) ? readJournal(dataDir) : sourceDir ? readJournal(sourceDir) : null;
  if (journal) validateJournalPaths(journal, dataDir, legacyDataDirs);
  if (journal && journal.phase === "complete") {
    finishCompletedMigration(dataDir, journal);
    warnLegacyDataLeftBehind(legacyDataDirs, dataDir, defaultDataDir);
    return;
  }
  if (journal && existsSync(dataDir)) {
    rollbackInterruptedMigration(dataDir, journal.source, journal);
    const recoveredSource = legacyDataDirs.map((dir) => resolve(dir)).find((dir) => existsSync(dir));
    if (!recoveredSource) throw new Error(`Crewbot rolled back an interrupted migration, but its original data directory is missing: ${journal.source}`);
    options.assertLegacyDataDirIsNotInUse?.(recoveredSource);
    migrate(recoveredSource, dataDir);
    warnLegacyDataLeftBehind(legacyDataDirs, dataDir, defaultDataDir, recoveredSource);
    return;
  }
  if (!sourceDir) return;
  if (existsSync(dataDir)) {
    warnLegacyDataLeftBehind(legacyDataDirs, dataDir, defaultDataDir);
    return;
  }

  options.assertLegacyDataDirIsNotInUse?.(sourceDir);
  const preparedJournal = readJournal(sourceDir);
  if (preparedJournal) {
    if (preparedJournal.phase !== "prepared") throw new Error(`Crewbot found an interrupted migration in ${sourceDir}; both data directories were preserved for recovery.`);
    rmSync(join(sourceDir, MIGRATION_DIR, JOURNAL_FILE), { force: true });
  }
  migrate(sourceDir, dataDir);
  warnLegacyDataLeftBehind(legacyDataDirs, dataDir, defaultDataDir, sourceDir);
}
