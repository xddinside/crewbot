// Drive the production server that a package actually ships.
//
// Both packages place their bundled server at
// `<installRoot>/resources/server/index.js`, and `scripts/smoke-packaged-server.mjs`
// already establishes that those bundles start with no `node_modules` in reach.
// This module launches that exact file against a chosen workspace and speaks
// its ordinary HTTP API: create a bot, upload an attachment, send a turn, read
// the transcript back, download the bytes. Nothing here writes a transcript
// file directly, so what the continuity check reads is production persistence.
//
// The engine is the repository's own fake CLI, named in the workspace config
// the way an operator names a real one. That keeps the run offline and
// deterministic; it does not stand in for the app, the server, or the store.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { openSync, closeSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Recursive digest of every regular file below a directory. Compared before
 * and after the migration, this is what proves a recovery snapshot holds the
 * original bytes and that no transcript path still points at the old root. */
export function digestTree(root, { skip = [] } = {}) {
  const digests = new Map();
  const walk = (directory, prefix) => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (skip.some((part) => relative === part || relative.startsWith(`${part}/`))) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path, relative);
      else if (entry.isFile()) digests.set(relative, sha256Bytes(readFileSync(path)));
    }
  };
  walk(root, "");
  return digests;
}

export function configWithFakeEngine({ fakeCli }) {
  return {
    instances: {
      claude: { driver: "claudeAgent", displayName: "Continuity fixture", config: { cli: fakeCli } },
    },
  };
}

export class ProductionServer {
  constructor({ child, url, port, dataDir, logPath }) {
    this.child = child;
    this.url = url;
    this.port = port;
    this.dataDir = dataDir;
    this.logPath = logPath;
    this.stopped = false;
  }

  async request(route, init = {}) {
    const response = await fetch(new URL(route, this.url), {
      redirect: "error",
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${route} failed: ${response.status} ${JSON.stringify(body)}`);
    return body;
  }

  async raw(route, init = {}) {
    const response = await fetch(new URL(route, this.url), { redirect: "error", ...init });
    if (!response.ok) throw new Error(`GET ${route} failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  createBot() {
    return this.request("/api/bots", { method: "POST", body: "{}" }).then((body) => body.bot ?? body);
  }

  /** The server's own bounded transcript page. There is no GET /api/bots/:id
   * that returns messages; the list route carries the page the renderer reads. */
  async bots({ messages = 50 } = {}) {
    return (await this.request(`/api/bots?messages=${messages}`)).bots ?? [];
  }

  async bot(id, options) {
    return (await this.bots(options)).find((entry) => entry.id === id) ?? null;
  }

  async threadMessages(threadId, limit = 50) {
    return (await this.request(`/api/threads/${encodeURIComponent(threadId)}/messages?limit=${limit}`)).messages ?? [];
  }

  async setBotCwd(id, cwd) {
    const body = await this.request(`/api/bots/${id}`, { method: "PATCH", body: JSON.stringify({ cwd }) });
    return body.bot ?? body;
  }

  /** Attachments are stored by production upload and referenced from the message
   * text as a standalone tag, which is the shape the composer sends and the
   * shape the migration rewrites. */
  uploadAttachment({ mime, bytes }) {
    return fetch(new URL("/api/attachments", this.url), {
      method: "POST",
      headers: { "content-type": mime },
      body: bytes,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`attachment upload failed: ${response.status} ${await response.text()}`);
      return response.json();
    });
  }

  send(botId, body) {
    return this.request(`/api/bots/${botId}/messages`, { method: "POST", body: JSON.stringify(body) });
  }

  attachmentBytes(name) {
    return this.raw(`/api/attachments/${encodeURIComponent(name)}`);
  }

  async waitFor(predicate, { budgetMs = 90_000, label = "condition", describe } = {}) {
    const deadline = Date.now() + budgetMs;
    let last = null;
    while (Date.now() < deadline) {
      last = await predicate().catch((error) => ({ error: String(error) }));
      if (last) return last;
      await delay(300);
    }
    throw new Error(`timed out waiting for ${label}: ${JSON.stringify(describe ? describe() : last)?.slice(0, 600)}`);
  }

  waitForBot(botId, predicate, options) {
    return this.waitFor(() => this.bot(botId).then((value) => (predicate(value) ? value : null)), {
      label: options?.label ?? "a bot state",
      budgetMs: options?.budgetMs,
      describe: async () => ({ messages: (await this.threadMessages((await this.bot(botId))?.threadId, 20))?.length }),
    });
  }

  waitForUserMessage(botId, predicate, options) {
    return this.waitFor(async () => {
      const bot = await this.bot(botId);
      if (!bot) return null;
      const messages = bot.messages ?? [];
      return messages.some(predicate) ? bot : null;
    }, { label: options?.label ?? "a persisted user message", budgetMs: options?.budgetMs });
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    const exited = new Promise((resolve) => this.child.once("close", resolve));
    try { process.kill(-this.child.pid, "SIGTERM"); } catch { /* already gone */ }
    const settled = await Promise.race([exited.then(() => true), delay(10_000).then(() => false)]);
    if (!settled) {
      try { process.kill(-this.child.pid, "SIGKILL"); } catch { /* already gone */ }
      await Promise.race([exited, delay(5_000)]);
    }
  }
}

/**
 * Start one package's shipped server against a workspace, with the fake engine
 * wired in the ordinary config way.
 *
 * @param options.serverEntry - `<installRoot>/resources/server/index.js`.
 * @param options.dataDir - Workspace root; the legacy build uses the fixture
 *   home default, so `undefined` is passed through as "no override".
 * @param options.fakeCli - Absolute path to the repository fake CLI.
 * @param options.replies - Scripted replies for deterministic turns.
 */
export async function startProductionServer({
  serverEntry,
  dataDir,
  env,
  fakeCli,
  replies,
  port,
  logPath,
  cwd,
}) {
  const configPath = join(dataDir, "config.json");
  let existing = {};
  try { existing = JSON.parse(readFileSync(configPath, "utf8")); } catch { /* first boot */ }
  writeFileSync(configPath, JSON.stringify({
    ...existing,
    ...configWithFakeEngine({ fakeCli }),
  }, null, 2), { mode: 0o600 });

  const childEnv = { ...env };
  if (dataDir) childEnv.CREWBOT_DATA_DIR = dataDir;
  childEnv.OMB_PORT = String(port);
  childEnv.OMB_WEBHOOK_PORT = String(port + 1);
  childEnv.FAKE_CLAUDE_MODE = "happy";
  childEnv.FAKE_CLAUDE_DUMP = join(dataDir, "fake-claude-dump.json");
  childEnv.FAKE_CLAUDE_REPLIES = JSON.stringify(replies);
  childEnv.FAKE_CLAUDE_REPLY_STATE = join(dataDir, "fake-claude-reply-state");

  const log = openSync(logPath, "a", 0o600);
  let child;
  try {
    child = spawn(process.execPath, [serverEntry], { cwd, detached: true, env: childEnv, stdio: ["ignore", log, log] });
  } finally {
    closeSync(log);
  }
  const url = `http://127.0.0.1:${port}`;
  const server = new ProductionServer({ child, url, port, dataDir, logPath });
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`the packaged server exited before it was ready (${child.exitCode ?? child.signalCode}); see ${logPath}`);
    }
    try {
      const health = await fetch(new URL("/api/health", url), { signal: AbortSignal.timeout(1_000) });
      if (health.ok && (await health.json())?.app === "openmausbot") return server;
    } catch { /* still starting */ }
    if (Date.now() >= deadline) {
      await server.stop();
      throw new Error(`the packaged server never became ready; see ${logPath}`);
    }
    await delay(200);
  }
}

/** Reserve a port pair this fixture owns and has not bound yet. */
export async function reservePortBlock() {
  const { createServer } = await import("node:net");
  const servers = await Promise.all([0, 1].map(() => new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  })));
  const [primary, webhook] = servers.map((server) => server.address().port);
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  return { port: primary, webhookPort: webhook };
}

export function isRealDirectory(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}