import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";
import { RemoteMcpClient } from "./mcp-http.ts";
import type { McpAccessClient } from "../shared/mcp-access.ts";
import { McpAccess } from "./mcp-access.ts";

interface Bot { id: string; threadId: string; tasks: Array<{ threadId: string; title: string; busy: boolean; activity: string }>; }
interface ToolResult { content: Array<{ text: string }>; isError?: boolean; }
const decode = (result: unknown): ToolResult => {
  // SAFETY: RemoteMcpClient has parsed the JSON-RPC response from our real server.
  return result as ToolResult;
};

describe("external bot MCP through disposable harness fixtures", () => {
  let fixture: VerificationServer;
  const clients: RemoteMcpClient[] = [];
  let sockets: Socket[] = [];
  let bot: Bot;
  let other: Bot;
  async function api<T>(path: string, method = "GET", body?: unknown, origin = true): Promise<{ status: number; body: T }> {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json", ...(origin ? { origin: fixture.info.url } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as T }; // SAFETY: fixture API response parsed at test boundary.
  }
  async function create(readOnly = false, botIds = [bot.id]) {
    const created = await api<{ token: string; client: McpAccessClient }>("/api/mcp-access/clients", "POST", { name: "External fixture", botIds, readOnly });
    expect(created.status).toBe(201);
    return created.body;
  }
  async function client(token: string) {
    const mcp = new RemoteMcpClient({ type: "http", url: `${fixture.info.url}/mcp`, headers: { authorization: `Bearer ${token}` } });
    clients.push(mcp);
    await mcp.initialize("acceptance-fixture", AbortSignal.timeout(10_000));
    return mcp;
  }
  async function call(mcp: RemoteMcpClient, name: string, args: unknown = {}) {
    return decode(await mcp.request("tools/call", { name, arguments: args }, AbortSignal.timeout(30_000)));
  }
  async function rpc(token?: string, extra: Record<string, string> = {}) {
    return fetch(`${fixture.info.url}/mcp`, { method: "POST", headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra,
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  }
  beforeEach(async () => {
    fixture = await launchVerificationServer();
    bot = (await api<{ bot: Bot }>("/api/bots", "POST", { name: "Allowed MCP bot" })).body.bot;
    other = (await api<{ bot: Bot }>("/api/bots", "POST", { name: "Private bot" })).body.bot;
  }, 30_000);
  afterEach(async () => {
    for (const socket of sockets) socket.destroy(); sockets = [];
    await Promise.all(clients.splice(0).map(c => c.close()));
    if (!fixture) return;
    console.info(JSON.stringify({ fixture: fixture.info, acceptance: "bot-mcp" }));
    await fixture.close();
  });

  it("defaults off, requires Settings origin, stores only private hashes, and authenticates across restart", async () => {
    expect((await rpc()).status).toBe(404);
    expect((await api("/api/mcp-access", "PUT", { enabled: true }, false)).status).toBe(403);
    const issued = await create();
    const disk = readFileSync(join(fixture.info.dataDir, "mcp-access.json"), "utf8");
    expect(disk).not.toContain(issued.token);
    expect(JSON.parse(disk).clients[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await api("/api/mcp-access", "PUT", { enabled: true })).status).toBe(200);
    const restored = new McpAccess(join(fixture.info.dataDir, "mcp-access.json"));
    expect(restored.authenticate(issued.token)?.id).toBe(issued.client.id);
    const settings = await api("/api/mcp-access");
    expect(JSON.stringify(settings.body)).not.toContain("tokenHash");
    expect(JSON.stringify(settings.body)).not.toContain(issued.token);
    expect((await rpc(issued.token, { origin: "https://untrusted.example" })).status).toBe(403);
    expect((await rpc(issued.token, { "mcp-protocol-version": "unknown" })).status).toBe(400);
  });

  it("valid token lists only allowed bots, awaits a reply, reads history/memory and deduplicates retries", async () => {
    await api("/api/mcp-access", "PUT", { enabled: true });
    const issued = await create(); const mcp = await client(issued.token);
    const list = JSON.parse((await call(mcp, "list_bots")).content[0].text);
    expect(list.bots).toEqual([{ id: bot.id, name: "Allowed MCP bot", model: expect.any(String), description: expect.any(String) }]);
    const sent = await call(mcp, "send_message", { bot_id: bot.id, text: "MCP_ACCEPTED", request_id: "send-1" });
    expect(sent.isError).toBeUndefined();
    const reply = JSON.parse(sent.content[0].text);
    expect(reply.reply).toBeTruthy(); expect(reply.threadId).not.toBe(bot.threadId);
    const retried = await call(mcp, "send_message", { bot_id: bot.id, text: "MCP_ACCEPTED", request_id: "send-1" });
    expect(JSON.parse(retried.content[0].text).messageId).toBe(reply.messageId);
    const conflict = await call(mcp, "send_message", { bot_id: bot.id, text: "DIFFERENT", request_id: "send-1" });
    expect(conflict.isError).toBe(true);
    const thread = JSON.parse((await call(mcp, "get_thread", { bot_id: bot.id })).content[0].text);
    expect(thread.messages.filter((m: { role: string }) => m.role === "user")).toHaveLength(1);
    expect(thread.messages.some((m: { activity?: string }) => m.activity?.includes("tools/call:get_thread"))).toBe(true);
    expect(thread.memorySummary).toBeTypeOf("string");
    const escape = await call(mcp, "get_thread", { bot_id: bot.id, thread_id: other.threadId });
    expect(escape.isError).toBe(true);
    const ordinary = await fetch(`${fixture.info.url}/api/bots`, { headers: { authorization: `Bearer ${issued.token}` } });
    expect(ordinary.status).toBe(401);
  }, 40_000);

  it("rejects missing, invalid and revoked tokens, including initialized clients; disable cuts off access", async () => {
    await api("/api/mcp-access", "PUT", { enabled: true });
    const issued = await create(); const mcp = await client(issued.token);
    expect((await rpc()).status).toBe(401);
    expect((await rpc("crewbot_mcp_invalid")).status).toBe(401);
    await api(`/api/mcp-access/clients/${issued.client.id}`, "DELETE");
    expect((await rpc(issued.token)).status).toBe(401);
    await expect(call(mcp, "list_bots")).rejects.toMatchObject({ status: 401 });
    const fresh = await create();
    await api("/api/mcp-access", "PUT", { enabled: false });
    expect((await rpc(fresh.token)).status).toBe(404);
  });

  it("refuses read-only sends and out-of-allowlist bots without changing their conversations", async () => {
    const before = await api<{ messages: unknown[] }>(`/api/threads/${other.threadId}/messages`);
    await api("/api/mcp-access", "PUT", { enabled: true });
    const ro = await client((await create(true)).token);
    expect((await call(ro, "list_bots")).isError).toBeUndefined();
    expect((await call(ro, "get_thread", { bot_id: bot.id })).isError).toBeUndefined();
    expect((await call(ro, "send_message", { bot_id: bot.id, text: "NO_WRITE", request_id: "ro" })).isError).toBe(true);
    const rw = await client((await create()).token);
    for (const name of ["send_message", "get_thread"]) {
      const result = await call(rw, name, { bot_id: other.id, ...(name === "send_message" ? { text: "NO_ACCESS", request_id: "forbidden" } : {}) });
      expect(result.isError).toBe(true); expect(result.content[0].text).toContain("allowlist");
    }
    const history = await api<{ messages: unknown[] }>(`/api/threads/${other.threadId}/messages`);
    expect(history.body.messages).toEqual(before.body.messages);
  });

  it("forces Ask despite an elevated default and waits for the actual broker/card approval", async () => {
    const gate = join(fixture.info.dataDir, "permission-finish");
    const wrapper = join(fixture.info.dataDir, "gated-claude.mjs");
    const fake = pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href;
    writeFileSync(wrapper, ['#!/usr/bin/env node', 'process.env.FAKE_CLAUDE_MODE = "slow";',
      `process.env.FAKE_CLAUDE_SLOW_FINISH_GATE = ${JSON.stringify(gate)};`, `await import(${JSON.stringify(fake)});`].join("\n"), { mode: 0o700 });
    expect((await api("/api/instances/claude", "PATCH", { cli: wrapper })).status).toBe(200);
    expect((await api(`/api/bots/${bot.id}`, "PATCH", { approvalMode: "auto" })).status).toBe(200);
    await api("/api/mcp-access", "PUT", { enabled: true });
    const issued = await create(); const mcp = await client(issued.token);
    let settled = false;
    const pending = call(mcp, "send_message", { bot_id: bot.id, text: "APPROVAL_WAIT", request_id: "approval-send" }).then(result => { settled = true; return result; });
    const dumpPath = join(fixture.info.dataDir, "fake-claude-dump.json");
    await expect.poll(() => existsSync(dumpPath), { timeout: 15_000 }).toBe(true);
    const dump = JSON.parse(readFileSync(dumpPath, "utf8"));
    expect(dump.argv[dump.argv.indexOf("--permission-mode") + 1]).toBe("default");
    const socket = connect(dump.mcpConfig.mcpServers.ogb.args.at(-1)); sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    const answers: Array<{ id: string; behavior: string }> = [];
    createInterface({ input: socket }).on("line", line => answers.push(JSON.parse(line)));
    socket.write(`${JSON.stringify({ t: "ask", id: "mcp-risk", kind: "permission", tool: "Bash", input: { command: "touch ./fixture-only" } })}\n`);
    let threadId = "";
    await expect.poll(async () => {
      const bots = (await api<{ bots: Bot[] }>("/api/bots")).body.bots;
      const task = bots.find(b => b.id === bot.id)?.tasks.find(t => t.title.startsWith("MCP"));
      threadId = task?.threadId ?? "";
      return task?.activity;
    }, { timeout: 10_000 }).toBe("waiting-on-you");
    expect(answers).toEqual([]); expect(settled).toBe(false);
    const history = await api<{ messages: Array<{ card?: { requestId?: string } }> }>(`/api/threads/${threadId}/messages`);
    expect(history.body.messages.some(m => m.card?.requestId === "mcp-risk")).toBe(true);
    // Even an owner changing the durable level cannot auto-answer this MCP turn.
    expect((await api(`/api/bots/${bot.id}/tasks/${threadId}`, "PATCH", { approvalMode: "auto" })).status).toBe(409);
    const agentsToken = dump.mcpConfig.mcpServers.agents.env.OMB_COMMS_TOKEN;
    const delegated = await fetch(`${fixture.info.url}/api/internal/start-thread`, { method: "POST", headers: { authorization: `Bearer ${agentsToken}`, "content-type": "application/json" }, body: "{}" });
    expect(delegated.status).toBe(403);
    expect((await api(`/api/threads/${threadId}/respond`, "POST", { requestId: "mcp-risk", behavior: "allow" })).status).toBe(200);
    await expect.poll(() => answers.find(a => a.id === "mcp-risk")?.behavior).toBe("allow");
    writeFileSync(gate, "approved");
    expect((await pending).isError).toBeUndefined();
  }, 45_000);
});
