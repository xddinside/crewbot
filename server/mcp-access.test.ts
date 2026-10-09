import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpAccess } from "./mcp-access.ts";
const roots: string[] = [];
const file = () => { const root = mkdtempSync(join(tmpdir(), "crewbot-mcp-access-")); roots.push(root); return join(root, "mcp-access.json"); };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("MCP credential persistence", () => {
  it("fails closed on corrupt settings and rejects unknown or empty bot scopes", () => {
    const path = file(); writeFileSync(path, '{"enabled":true,"clients":[{"tokenHash":"bad"}]}');
    const access = new McpAccess(path);
    expect(access.settings()).toEqual({ enabled: false, clients: [] });
    expect(access.create({ name: "Empty", botIds: [], readOnly: true }, ["allowed"]).ok).toBe(false);
    expect(access.create({ name: "Unknown", botIds: ["other"], readOnly: false }, ["allowed"]).ok).toBe(false);
  });
  it("writes private hashes, persists revocation and returns independent metadata", () => {
    const path = file(); const access = new McpAccess(path); access.setEnabled(true);
    const created = access.create({ name: "Fixture", botIds: ["allowed"], readOnly: true }, ["allowed"]);
    if (!created.ok) throw new Error(created.error);
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    const metadata = access.settings(); metadata.clients[0].botIds.push("forbidden");
    expect(access.authenticate(created.token)?.botIds).toEqual(["allowed"]);
    expect(access.revoke(created.client.id)).toEqual({ ok: true });
    const reloaded = new McpAccess(path);
    expect(reloaded.settings().enabled).toBe(true);
    expect(reloaded.authenticate(created.token)).toBeNull();
    expect(reloaded.authenticateCurrent(created.client.id)).toBe(false);
  });
  it("does not enable access or issue credentials when persistence fails", () => {
    const access = new McpAccess(join(file(), "not-a-directory", "settings.json"));
    expect(access.setEnabled(true)).toMatchObject({ ok: false, status: 500 });
    expect(access.settings().enabled).toBe(false);
    expect(access.create({ name: "Fixture", botIds: ["allowed"], readOnly: false }, ["allowed"])).toMatchObject({ ok: false, status: 500 });
    expect(access.settings().clients).toEqual([]);
  });
});
