import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectLegacyDataDirServiceRecovery, migrateLegacyDataDir, recoverLegacyDataDirForService } from "./legacy-data-dir.mjs";
import { rebasePersistedMessage } from "./rebase-data-paths.mjs";

const roots = [];

function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), "crewbot-legacy-migration-"));
  roots.push(home);
  const source = path.join(home, ".openmausbot");
  const destination = path.join(home, ".crewbot");
  mkdirSync(path.join(source, "workspaces", "bot", "tasks", "thread"), { recursive: true });
  writeFileSync(path.join(source, "workspaces", "bot", "tasks", "thread", "notes.txt"), "prior attachment");
  return { home, source, destination };
}

function seedMessagesDb(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, "messages.db"));
  db.exec("CREATE TABLE messages(thread_id TEXT, id TEXT, text TEXT, json TEXT, PRIMARY KEY(thread_id, id)); CREATE TABLE chat_followups(id TEXT PRIMARY KEY, payload TEXT)");
  const attachmentPath = path.join(dataDir, "workspaces", "bot", "tasks", "thread", "notes.txt");
  const externalPath = "/work/customer/repo";
  const message = {
    role: "user",
    text: `Please inspect this file.\n\n<attached-file path="${attachmentPath}" name="notes.txt" />\n\n\`\`\`text\n<attached-file path="${attachmentPath}" name="example" />\n\`\`\`\n\n<!-- example\n<attached-file path="${attachmentPath}" name="comment" />\n-->\n\n<pasted-text index="1">\n<attached-file path="${attachmentPath}" name="paste" />\n</pasted-text>\n\n<div>\n<attached-file path="${attachmentPath}" name="html block" />\n</div>\n\nThe old root was ${dataDir}.`,
    attachments: [{ kind: "file", path: attachmentPath, name: "notes.txt" }],
    cwd: externalPath,
  };
  db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?)").run("thread", "message", message.text, JSON.stringify(message));
  db.prepare("INSERT INTO chat_followups VALUES (?, ?)").run("followup", JSON.stringify({ text: "continue", attachments: [{ path: attachmentPath }] }));
  db.close();
  return { attachmentPath, externalPath };
}

test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("rebases encoded attachment paths without changing examples in HTML or pasted blocks", () => {
  const source = path.join(tmpdir(), "old", "root");
  const destination = path.join(tmpdir(), "new", "root");
  const oldPath = path.join(source, "workspace", 'has & "quote"\nline.txt');
  const encoded = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("\n", "&#10;");
  const newTag = `<attached-file path="${encoded(oldPath)}" name="notes.txt" />`;
  const preservedTag = `<attached-file path="${path.join(source, "workspace", "example.txt")}" name="example" />`;
  const message = {
    text: `${newTag}\n\n<!-- example\n${preservedTag}\n-->\n\n<pasted-text index="1">\n${preservedTag}\n</pasted-text>`,
    attachments: [{ path: oldPath }],
  };

  rebasePersistedMessage(message, source, destination);

  const rebasedPath = path.join(destination, "workspace", 'has & "quote"\nline.txt');
  assert.equal(message.attachments[0].path, rebasedPath);
  assert.ok(message.text.includes(`<attached-file path="${encoded(rebasedPath)}"`));
  assert.equal(message.text.split(preservedTag).length - 1, 2);
});

test("migrates saved cwd and attachment paths while preserving external paths and a recovery copy", () => {
  const { home, source, destination } = fixture();
  const taskCwd = path.join(source, "workspaces", "bot", "tasks", "thread");
  const externalPath = "/work/customer/repo";
  writeFileSync(path.join(source, "bots.json"), JSON.stringify([{
    id: "bot", threadId: "thread", cwd: taskCwd, resumeCursors: { claude: "private-session" },
    projects: [{ path: externalPath }],
    tasks: [
      { threadId: "thread", cwd: taskCwd, resumeCursors: { claude: "private-session" }, handedMessages: { claude: { session: "private-session" } } },
      { threadId: "external", cwd: externalPath, resumeCursors: { claude: "external-session" }, handedMessages: { claude: { session: "external-session" } } },
    ],
  }]));
  writeFileSync(path.join(source, "groups.json"), JSON.stringify([{ cwd: taskCwd, pinnedCwd: taskCwd }]));
  writeFileSync(path.join(source, "room-continuations.json"), JSON.stringify({ version: 1, records: [{
    version: 1, groupId: "group", threadId: "room-thread", botId: "bot",
    cursors: { claude: "room-private-session" }, lastInstanceId: "claude",
    selection: { instanceId: "claude", model: "fixture" }, deliveredThroughMessageId: "old-anchor",
    deliveredEligibleMessages: 2, generation: 4,
  }] }));
  writeFileSync(path.join(source, "config.json"), JSON.stringify({ dataDir: source, external: { path: "/work/customer/repo" } }));
  const { attachmentPath } = seedMessagesDb(source);

  migrateLegacyDataDir(destination, {
    home,
    legacyDataDirs: [source],
    assertLegacyDataDirIsNotInUse: () => {},
  });

  const nextCwd = path.join(destination, "workspaces", "bot", "tasks", "thread");
  assert.equal(existsSync(source), false);
  const migratedBot = JSON.parse(readFileSync(path.join(destination, "bots.json"), "utf8"))[0];
  assert.equal(migratedBot.cwd, nextCwd);
  assert.equal(migratedBot.projects[0].path, externalPath);
  assert.deepEqual(migratedBot.resumeCursors, {});
  assert.equal(migratedBot.tasks[0].cwd, nextCwd);
  assert.deepEqual(migratedBot.tasks[0].resumeCursors, {});
  assert.deepEqual(migratedBot.tasks[0].handedMessages, {});
  assert.equal(migratedBot.tasks[1].cwd, externalPath);
  assert.deepEqual(migratedBot.tasks[1].resumeCursors, { claude: "external-session" });
  assert.deepEqual(migratedBot.tasks[1].handedMessages, { claude: { session: "external-session" } });
  assert.equal(JSON.parse(readFileSync(path.join(destination, "groups.json"), "utf8"))[0].pinnedCwd, nextCwd);
  assert.deepEqual(JSON.parse(readFileSync(path.join(destination, "room-continuations.json"), "utf8")).records[0], {
    version: 1, groupId: "group", threadId: "room-thread", botId: "bot", cursors: {},
    lastInstanceId: "claude", selection: { instanceId: "claude", model: "fixture" },
    deliveredEligibleMessages: 0, generation: 4,
  });
  assert.equal(JSON.parse(readFileSync(path.join(destination, "config.json"), "utf8")).dataDir, destination);
  assert.equal(existsSync(path.join(destination, "workspaces", "bot", "tasks", "thread", "notes.txt")), true);
  assert.equal(existsSync(path.join(destination, ".crewbot-migration", "recovery")), true);

  const db = new DatabaseSync(path.join(destination, "messages.db"), { readOnly: true });
  try {
    const message = JSON.parse(db.prepare("SELECT json FROM messages WHERE id = ?").get("message").json);
    assert.equal(message.attachments[0].path, attachmentPath.replace(source, destination));
    assert.equal(message.cwd, externalPath);
    assert.match(message.text, new RegExp(attachmentPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(message.text.includes(`<attached-file path="${attachmentPath.replace(source, destination)}"`));
    assert.ok(message.text.includes(`<attached-file path="${attachmentPath}" name="example`));
    assert.ok(message.text.includes(`<attached-file path="${attachmentPath}" name="comment`));
    assert.ok(message.text.includes(`<attached-file path="${attachmentPath}" name="paste`));
    assert.ok(message.text.includes(`<attached-file path="${attachmentPath}" name="html block`));
    const followup = JSON.parse(db.prepare("SELECT payload FROM chat_followups WHERE id = ?").get("followup").payload);
    assert.equal(followup.attachments[0].path, attachmentPath.replace(source, destination));
  } finally { db.close(); }
});

test("restores the original data root if a supported metadata file cannot be parsed", () => {
  const { home, source, destination } = fixture();
  writeFileSync(path.join(source, "bots.json"), "not json");

  assert.throws(() => migrateLegacyDataDir(destination, {
    home,
    legacyDataDirs: [source],
    assertLegacyDataDirIsNotInUse: () => {},
  }), /original data was restored/i);

  assert.equal(existsSync(source), true);
  assert.equal(existsSync(destination), false);
  assert.equal(readFileSync(path.join(source, "bots.json"), "utf8"), "not json");
  assert.equal(existsSync(path.join(source, ".crewbot-migration", "recovery")), true);
});

test("rolls an interrupted move back and completes it before allowing startup", () => {
  const { home, source, destination } = fixture();
  const id = "12345678-1234-4234-8234-123456789abc";
  const cwd = path.join(source, "workspaces", "bot");
  writeFileSync(path.join(source, "bots.json"), JSON.stringify([{ id: "bot", cwd }]));
  const recovery = path.join(source, ".crewbot-migration", "recovery", id);
  mkdirSync(recovery, { recursive: true });
  copyFileSync(path.join(source, "bots.json"), path.join(recovery, "bots.json"));
  writeFileSync(path.join(source, ".crewbot-migration", "journal.json"), JSON.stringify({
    id, source, destination, phase: "applying", files: ["bots.json"],
  }));
  renameSync(source, destination);

  migrateLegacyDataDir(destination, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });

  assert.equal(existsSync(source), false);
  assert.equal(JSON.parse(readFileSync(path.join(destination, "bots.json"), "utf8"))[0].cwd, path.join(destination, "workspaces", "bot"));
  assert.equal(existsSync(path.join(destination, ".crewbot-migration", "journal.json")), false);
  assert.equal(JSON.parse(readFileSync(path.join(destination, ".crewbot-migration", "recovery", id, "receipt.json"), "utf8")).phase, "rolled-back");
});

test("finishes a completed migration journal on the next launch", () => {
  const { home, source, destination } = fixture();
  const id = "12345678-1234-4234-8234-123456789abc";
  mkdirSync(path.join(destination, ".crewbot-migration"), { recursive: true });
  mkdirSync(path.join(destination, ".crewbot-migration", "recovery", id), { recursive: true });
  writeFileSync(path.join(destination, ".crewbot-migration", "journal.json"), JSON.stringify({
    id, source, destination, phase: "complete", files: ["bots.json"],
  }));

  migrateLegacyDataDir(destination, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });

  assert.equal(existsSync(path.join(destination, ".crewbot-migration", "journal.json")), false);
  assert.equal(JSON.parse(readFileSync(path.join(destination, ".crewbot-migration", "recovery", id, "receipt.json"), "utf8")).phase, "complete");
});

test("preserves both directories when a journal tries to recover to another path", () => {
  const { home, source, destination } = fixture();
  const id = "12345678-1234-4234-8234-123456789abc";
  mkdirSync(path.join(destination, ".crewbot-migration"), { recursive: true });
  writeFileSync(path.join(destination, ".crewbot-migration", "journal.json"), JSON.stringify({
    id, source: path.join(home, "unrelated"), destination, phase: "applying", files: [],
  }));

  assert.throws(() => migrateLegacyDataDir(destination, { home, legacyDataDirs: [source] }), /paths do not match/i);
  assert.equal(existsSync(source), true);
  assert.equal(existsSync(destination), true);
});

test("restores the legacy service data root while preserving the migrated workspace", () => {
  const { home, source, destination } = fixture();
  const cwd = path.join(source, "workspaces", "bot");
  writeFileSync(path.join(source, "bots.json"), JSON.stringify([{ id: "bot", cwd }]));
  migrateLegacyDataDir(destination, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });
  const earlier = "22345678-1234-4234-8234-123456789abc";
  mkdirSync(path.join(destination, ".crewbot-migration", "recovery", earlier), { recursive: true });
  writeFileSync(path.join(destination, ".crewbot-migration", "recovery", earlier, "receipt.json"), JSON.stringify({
    id: earlier, phase: "rolled-back", source, destination, recoveredAt: new Date().toISOString(),
  }));
  writeFileSync(path.join(destination, "service-created.txt"), "new service state");

  const recovery = inspectLegacyDataDirServiceRecovery(destination);
  assert.equal(recovery?.source, source);
  assert.deepEqual(recoverLegacyDataDirForService(destination), { source, destination, id: recovery.id });

  assert.equal(JSON.parse(readFileSync(path.join(source, "bots.json"), "utf8"))[0].cwd, cwd);
  assert.equal(readFileSync(path.join(source, "service-created.txt"), "utf8"), "new service state");
  assert.equal(readFileSync(path.join(destination, "service-created.txt"), "utf8"), "new service state");
  assert.equal(JSON.parse(readFileSync(path.join(destination, "bots.json"), "utf8"))[0].cwd, path.join(destination, "workspaces", "bot"));
});

test("refuses a conflicting legacy path before changing either data root", () => {
  const { home, source, destination } = fixture();
  writeFileSync(path.join(source, "bots.json"), JSON.stringify([{ id: "bot", cwd: source }]));
  migrateLegacyDataDir(destination, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });
  mkdirSync(source);
  writeFileSync(path.join(source, "keep.txt"), "unrelated legacy state");

  assert.throws(() => recoverLegacyDataDirForService(destination), /will not replace the existing legacy data directory/i);
  assert.equal(readFileSync(path.join(source, "keep.txt"), "utf8"), "unrelated legacy state");
  assert.equal(JSON.parse(readFileSync(path.join(destination, "bots.json"), "utf8"))[0].cwd, destination);
});

test("refuses symlinked migrated metadata without writing through to its external target", () => {
  const { home, source, destination } = fixture();
  writeFileSync(path.join(source, "bots.json"), JSON.stringify([{ id: "bot", cwd: source }]));
  migrateLegacyDataDir(destination, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });
  const sentinel = path.join(home, "external-sentinel.json");
  writeFileSync(sentinel, "preserve this external file");
  rmSync(path.join(destination, "bots.json"));
  symlinkSync(sentinel, path.join(destination, "bots.json"));

  assert.throws(() => recoverLegacyDataDirForService(destination), /symbolic link in migrated metadata/i);
  assert.equal(readFileSync(sentinel, "utf8"), "preserve this external file");
  assert.equal(existsSync(source), false);
  assert.equal(readFileSync(path.join(destination, "bots.json"), "utf8"), "preserve this external file");
});

test("refuses dangling metadata symlinks without creating their external targets", () => {
  const { home, source, destination } = fixture();
  writeFileSync(path.join(source, "bots.json"), JSON.stringify([{ id: "bot", cwd: source }]));
  migrateLegacyDataDir(destination, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });
  const missingTarget = path.join(home, "external-target-that-must-stay-missing.json");
  rmSync(path.join(destination, "bots.json"));
  symlinkSync(missingTarget, path.join(destination, "bots.json"));

  assert.throws(() => recoverLegacyDataDirForService(destination), /symbolic link in migrated metadata/i);
  assert.equal(existsSync(missingTarget), false);
  assert.equal(existsSync(source), false);
  assert.equal(existsSync(path.join(destination, "bots.json")), false);
});

test("does not trust an existing symlink as a previously restored legacy root", () => {
  const { home, source, destination } = fixture();
  writeFileSync(path.join(source, "bots.json"), "[]");
  migrateLegacyDataDir(destination, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });
  const recovery = inspectLegacyDataDirServiceRecovery(destination);
  const external = path.join(home, "external-root");
  mkdirSync(path.join(external, ".crewbot-migration", "recovery", recovery.id), { recursive: true });
  writeFileSync(path.join(external, "external.txt"), "keep external root");
  writeFileSync(path.join(external, ".crewbot-migration", "recovery", recovery.id, "service-rollback.json"), JSON.stringify({
    id: recovery.id, phase: "restored", source, destination,
  }));
  symlinkSync(external, source);

  assert.throws(() => recoverLegacyDataDirForService(destination), /unsupported existing legacy data path/i);
  assert.equal(readFileSync(path.join(external, "external.txt"), "utf8"), "keep external root");
  assert.equal(readFileSync(path.join(external, ".crewbot-migration", "recovery", recovery.id, "service-rollback.json"), "utf8"), JSON.stringify({
    id: recovery.id, phase: "restored", source, destination,
  }));
});

test("custom workspaces do not claim default legacy service recovery", () => {
  const { home, source } = fixture();
  const custom = path.join(home, "custom-workspace");
  mkdirSync(custom);
  writeFileSync(path.join(source, "state.txt"), "legacy");

  migrateLegacyDataDir(custom, { home, legacyDataDirs: [source] });

  assert.equal(inspectLegacyDataDirServiceRecovery(custom), null);
  assert.equal(readFileSync(path.join(source, "state.txt"), "utf8"), "legacy");
  assert.equal(existsSync(path.join(custom, "state.txt")), false);
});
