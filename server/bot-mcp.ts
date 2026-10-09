import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { McpAccessClient } from "../shared/mcp-access.ts";
import { McpAccess } from "./mcp-access.ts";
import { bearerToken, isAllowedOrigin, isSameOrigin } from "./request-auth.ts";

/** Result returned by bot operations, including normal admission/permission failures. */
export type BotMcpResult = { ok: true; value: unknown } | { ok: false; error: string };
/** Existing harness operations consumed by the external MCP adapter. */
export interface BotMcpHarness {
  listBots(): Array<{ id: string; name: string; model: string; description: string }>;
  getThread(client: McpAccessClient, botId: string, threadId: string | undefined, limit: number): BotMcpResult;
  sendMessage(client: McpAccessClient, botId: string, text: string, requestId: string, signal: AbortSignal): Promise<BotMcpResult>;
  audit(client: McpAccessClient, method: string, botId?: string): void;
}
const id = z.string().regex(/^[\w-]{1,128}$/);
const listArgs = z.object({}).strict();
const threadArgs = z.object({ bot_id: id, thread_id: id.optional(), limit: z.number().int().min(1).max(100).default(30) }).strict();
const sendArgs = z.object({ bot_id: id, text: z.string().trim().min(1).max(100_000), request_id: id }).strict();
const tools = [
  { name: "list_bots", description: "List allowed bots with name, model and description.", inputSchema: z.toJSONSchema(listArgs), annotations: { readOnlyHint: true } },
  { name: "get_thread", description: "Read recent messages and the memory index of an allowed bot. Defaults to this client's conversation, or the selected conversation before the first send.", inputSchema: z.toJSONSchema(threadArgs), annotations: { readOnlyHint: true } },
  { name: "send_message", description: "Send to an allowed bot in this client's separate conversation and await its reply. Approval requests wait in crewbot. Reuse request_id only to retrieve the same send after disconnect or timeout.", inputSchema: z.toJSONSchema(sendArgs), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } },
];
const rpcSchema = z.object({
  jsonrpc: z.literal("2.0"), id: z.union([z.string().max(128), z.number().int()]).optional(),
  method: z.string().min(1).max(100), params: z.record(z.string(), z.unknown()).optional(),
}).strict();
const versions = ["2025-03-26", "2025-06-18", "2025-11-25"];
const rpcError = (id: string | number | null, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const toolResult = (result: BotMcpResult) => ({
  content: [{ type: "text", text: result.ok ? JSON.stringify(result.value) : result.error }],
  ...(result.ok ? {} : { isError: true }),
});

/** Stateless Streamable HTTP: per-request auth, awaited JSON replies and no shared sessions. */
export function createBotMcp(access: McpAccess, harness: BotMcpHarness) {
  const active = new Map<string, AbortController>();
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader("cache-control", "no-store");
    const json = (status: number, value: unknown) => {
      if (res.destroyed) return;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (!access.settings().enabled) { console.warn("MCP request rejected: access disabled"); json(404, rpcError(null, -32000, "MCP access is disabled")); return; }
    // Originless clients include CLI/tunnel callers. Browsers must be local
    // or same-origin with the published endpoint; no CORS credentials emitted.
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    const token = bearerToken(req.headers.authorization);
    const client = access.authenticate(token);
    if (!client) {
      console.warn("MCP request rejected: invalid or missing credential");
      res.setHeader("www-authenticate", 'Bearer realm="crewbot-mcp"');
      json(401, rpcError(null, -32000, "A valid MCP client token is required")); return;
    }
    if (origin && !isAllowedOrigin(origin) && !isSameOrigin(req)) {
      harness.audit(client, "rejected-origin");
      json(403, rpcError(null, -32000, "Origin is not allowed")); return;
    }
    if (req.method !== "POST") {
      harness.audit(client, req.method ?? "GET");
      res.setHeader("allow", "POST");
      json(405, rpcError(null, -32000, "This endpoint does not offer a standalone SSE stream or sessions")); return;
    }
    const version = req.headers["mcp-protocol-version"];
    if (version !== undefined && (typeof version !== "string" || !versions.includes(version))) {
      harness.audit(client, "invalid-protocol-version");
      json(400, rpcError(null, -32600, "Unsupported MCP protocol version")); return;
    }
    if (!String(req.headers.accept).includes("application/json") || !String(req.headers.accept).includes("text/event-stream")) {
      harness.audit(client, "invalid-accept");
      json(406, rpcError(null, -32600, "Accept must include application/json and text/event-stream")); return;
    }
    if (!/^application\/json\b/i.test(String(req.headers["content-type"]))) {
      harness.audit(client, "invalid-content-type");
      json(415, rpcError(null, -32600, "Content-Type must be application/json")); return;
    }
    let raw: unknown;
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > 512_000) { harness.audit(client, "oversized-request"); json(413, rpcError(null, -32600, "Request is too large")); return; }
        chunks.push(buffer);
      }
      raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { harness.audit(client, "invalid-json"); json(400, rpcError(null, -32700, "Invalid JSON")); return; }
    const parsed = rpcSchema.safeParse(raw);
    if (!parsed.success) { harness.audit(client, "invalid-request"); json(400, rpcError(null, -32600, "Invalid JSON-RPC request")); return; }
    const frame = parsed.data;
    const botId = typeof frame.params?.arguments === "object" && frame.params.arguments !== null && "bot_id" in frame.params.arguments && typeof frame.params.arguments.bot_id === "string"
      ? frame.params.arguments.bot_id : undefined;
    harness.audit(client, frame.method === "tools/call" && typeof frame.params?.name === "string" ? `tools/call:${frame.params.name.slice(0, 100)}` : frame.method, botId);
    // A slow body upload may race disable/revoke. Authenticate again before effects.
    if (!access.authenticate(token)) { json(401, rpcError(frame.id ?? null, -32000, "MCP client access was revoked or disabled")); return; }
    if (frame.id === undefined) {
      if (frame.method === "notifications/cancelled") {
        const requestId = frame.params?.requestId;
        if (typeof requestId === "string" || typeof requestId === "number") active.get(`${client.id}:${requestId}`)?.abort();
      } else if (frame.method !== "notifications/initialized") {
        json(400, rpcError(null, -32600, "Unsupported notification")); return;
      }
      res.writeHead(202); res.end(); return;
    }
    const reply = (result: unknown) => json(200, { jsonrpc: "2.0", id: frame.id, result });
    if (frame.method === "initialize") {
      const init = z.object({ protocolVersion: z.string(), capabilities: z.record(z.string(), z.unknown()), clientInfo: z.object({ name: z.string(), version: z.string() }).passthrough() }).passthrough().safeParse(frame.params);
      if (!init.success) { json(200, rpcError(frame.id, -32602, "Invalid initialize parameters")); return; }
      reply({ protocolVersion: versions.includes(init.data.protocolVersion) ? init.data.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "crewbot-bots", version: "1" } }); return;
    }
    if (frame.method === "ping") { reply({}); return; }
    if (frame.method === "tools/list") { reply({ tools: tools.filter(t => !client.readOnly || t.name !== "send_message") }); return; }
    if (frame.method !== "tools/call") { json(200, rpcError(frame.id, -32601, "Method not found")); return; }
    const args = frame.params?.arguments ?? {};
    const denied = (error: string) => reply(toolResult({ ok: false, error }));
    switch (frame.params?.name) {
      case "list_bots":
        if (!listArgs.safeParse(args).success) { json(200, rpcError(frame.id, -32602, "Invalid list_bots arguments")); return; }
        reply(toolResult({ ok: true, value: { bots: harness.listBots().filter(b => client.botIds.includes(b.id)) } })); return;
      case "get_thread": {
        const input = threadArgs.safeParse(args);
        if (!input.success) { json(200, rpcError(frame.id, -32602, "Invalid get_thread arguments")); return; }
        if (!client.botIds.includes(input.data.bot_id)) { denied("Bot is outside this client's allowlist"); return; }
        reply(toolResult(harness.getThread(client, input.data.bot_id, input.data.thread_id, input.data.limit))); return;
      }
      case "send_message": {
        if (client.readOnly) { denied("This MCP client is read-only"); return; }
        const input = sendArgs.safeParse(args);
        if (!input.success) { json(200, rpcError(frame.id, -32602, "Invalid send_message arguments")); return; }
        if (!client.botIds.includes(input.data.bot_id)) { denied("Bot is outside this client's allowlist"); return; }
        const key = `${client.id}:${frame.id}`;
        if (active.has(key)) { denied("JSON-RPC request id is already active"); return; }
        if ([...active.keys()].filter(k => k.startsWith(`${client.id}:`)).length >= 16) { denied("Too many pending MCP requests for this client"); return; }
        const controller = new AbortController();
        const disconnected = () => controller.abort();
        res.once("close", disconnected);
        active.set(key, controller);
        try {
          const result = await harness.sendMessage(client, input.data.bot_id, input.data.text, input.data.request_id, controller.signal);
          if (!access.authenticate(token)) { denied("MCP client access was revoked or disabled"); return; }
          reply(toolResult(result));
        } catch {
          // Defect/unclassified dependency errors never carry credentials or paths.
          denied("MCP bot call failed; check the conversation in crewbot");
        } finally { active.delete(key); res.removeListener("close", disconnected); }
        return;
      }
      default: json(200, rpcError(frame.id, -32602, "Unknown tool"));
    }
  };
}
