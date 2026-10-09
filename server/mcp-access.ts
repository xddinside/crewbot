import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";
import type { McpAccessClient } from "../shared/mcp-access.ts";

const clientSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(100),
  botIds: z.array(z.string().regex(/^[\w-]{1,128}$/)).min(1).max(500),
  readOnly: z.boolean(), createdAt: z.number(), revokedAt: z.number().optional(),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const stateSchema = z.object({ enabled: z.boolean(), clients: z.array(clientSchema).max(500) }).strict();
const createSchema = clientSchema.omit({ id: true, createdAt: true, revokedAt: true, tokenHash: true });
type State = z.infer<typeof stateSchema>;
/** Expected access-settings failures, safe to return to the UI. */
export type McpAccessFailure = { ok: false; status: number; error: string };
const failure = (status: number, error: string): McpAccessFailure => ({ ok: false, status, error });
const hash = (token: string) => createHash("sha256").update(token).digest();
const publicClient = ({ tokenHash: _hash, ...client }: State["clients"][number]): McpAccessClient => structuredClone(client);

/** Owns durable MCP enablement and per-client hashed credentials. Invalid storage fails closed. */
export class McpAccess {
  private state: State = { enabled: false, clients: [] };
  private readonly path: string;
  constructor(path: string) {
    this.path = path;
    if (!existsSync(path)) return;
    try {
      const parsed = stateSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
      if (parsed.success) this.state = parsed.data;
      else console.warn("MCP access settings invalid; access disabled");
    } catch { console.warn("MCP access settings unreadable; access disabled"); }
  }
  /** Returns metadata only, including revoked clients for the owner's audit. */
  settings() { return { enabled: this.state.enabled, clients: this.state.clients.map(publicClient) }; }
  /** Explicit owner opt-in, persisted before it takes effect. */
  setEnabled(enabled: boolean): { ok: true } | McpAccessFailure {
    return this.save({ ...this.state, enabled });
  }
  /** Creates a token whose plaintext is returned once and never saved. */
  create(input: unknown, botIds: readonly string[]): { ok: true; client: McpAccessClient; token: string } | McpAccessFailure {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return failure(400, "Client name, bot allowlist and read-only setting are required");
    if (parsed.data.botIds.some(id => !botIds.includes(id))) return failure(400, "Choose existing bots for the allowlist");
    if (this.state.clients.length >= 500) return failure(409, "MCP client limit reached");
    const token = `crewbot_mcp_${randomBytes(32).toString("base64url")}`;
    const client = { ...parsed.data, botIds: [...new Set(parsed.data.botIds)], id: randomUUID(), createdAt: Date.now(), tokenHash: hash(token).toString("hex") };
    const saved = this.save({ ...this.state, clients: [...this.state.clients, client] });
    return saved.ok ? { ok: true, client: publicClient(client), token } : saved;
  }
  /** Revocation also invalidates already initialized clients on their next request. */
  revoke(id: string): { ok: true } | McpAccessFailure {
    if (!this.state.clients.some(c => c.id === id)) return failure(404, "No such MCP client");
    return this.save({ ...this.state, clients: this.state.clients.map(c => c.id === id ? { ...c, revokedAt: c.revokedAt ?? Date.now() } : c) });
  }
  /** Bearers authenticate independently of desktop sessions, cookies and loopback ownership. */
  authenticate(token: string | undefined): McpAccessClient | null {
    if (!this.state.enabled || !token || !/^crewbot_mcp_[\w-]{43}$/.test(token)) return null;
    const digest = hash(token);
    const client = this.state.clients.find(c => !c.revokedAt && timingSafeEqual(digest, Buffer.from(c.tokenHash, "hex")));
    return client ? publicClient(client) : null;
  }
  /** Checks continued access while a long bot reply is awaited. */
  authenticateCurrent(clientId: string): boolean {
    return this.state.enabled && this.state.clients.some(c => c.id === clientId && !c.revokedAt);
  }
  private save(state: State): { ok: true } | McpAccessFailure {
    try { writeFileAtomic(this.path, JSON.stringify(state, null, 2), { mode: 0o600 }); }
    catch { return failure(500, "Could not save MCP access settings"); }
    this.state = state;
    return { ok: true };
  }
}
