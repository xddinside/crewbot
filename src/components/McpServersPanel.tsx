import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  CirclePower,
  ClipboardPaste,
  FlaskConical,
  Globe,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ServerCog,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { GlassCard, GlassSheet, useSheetFocus } from "@/components/Glass";
import { claudeUserMcpEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import {
  MCP_TRANSPORTS,
  mcpDraftWithTransport,
  mcpProbeSummary,
  mcpTransportChoice,
} from "@/lib/apps-tools-view";
import { updateMcpServers } from "@/lib/mcp-servers";
import { api, useStore, type ConfigStatus } from "@/state/store";

import { Switch } from "./SettingsPrimitives";

/** A server this computer starts (a command) or one reached at a URL —
 * the two shapes the server stores. Secrets arrive as names only. */
interface StdioMcpListing {
  name: string;
  command: string;
  args: string[];
  envKeys: string[];
  enabled: boolean;
}
interface RemoteMcpListing {
  name: string;
  type: "http" | "sse";
  url: string;
  headerKeys: string[];
  enabled: boolean;
}
export type McpServerListing = StdioMcpListing | RemoteMcpListing;

export function isRemoteMcpListing(server: McpServerListing): server is RemoteMcpListing {
  return "url" in server;
}

type McpTransport = "stdio" | "remote";

interface McpDraft {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  env: string;
  type: "http" | "sse";
  url: string;
  headers: string;
}

interface ProbeResult {
  ok: boolean;
  tools?: Array<{ name: string; description?: string }>;
  error?: string;
}

interface McpMessage {
  key: LocaleKey;
  params?: Record<string, string | number>;
}

const EMPTY_DRAFT: McpDraft = { name: "", transport: "stdio", command: "", args: "", env: "", type: "http", url: "", headers: "" };
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;

export function parseMcpArguments(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function parseMcpEnvironment(
  value: string,
  savedKeys: readonly string[] = [],
): { ok: true; env: Record<string, string | true> } | { ok: false; error: McpMessage } {
  const saved = new Set(savedKeys);
  const env: Record<string, string | true> = {};
  for (const original of value.split(/\r?\n/)) {
    const line = original.trim();
    if (!line) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) return { ok: false, error: { key: "mcp.env.useKeyValue", params: { line } } };
    const key = line.slice(0, equals).trim();
    const secret = line.slice(equals + 1);
    if (!ENV_NAME.test(key)) return { ok: false, error: { key: "mcp.env.invalidName", params: { key } } };
    if (Object.hasOwn(env, key)) return { ok: false, error: { key: "mcp.env.duplicate", params: { key } } };
    env[key] = secret === "" && saved.has(key) ? true : secret;
  }
  return { ok: true, env };
}

/** `Name: value` per line, the way headers are written everywhere. A blank
 * value beside a saved header keeps the saved value, as with env above. */
export function parseMcpHeaders(
  value: string,
  savedKeys: readonly string[] = [],
): { ok: true; headers: Record<string, string | true> } | { ok: false; error: McpMessage } {
  const saved = new Set(savedKeys);
  const headers: Record<string, string | true> = {};
  for (const original of value.split(/\r?\n/)) {
    const line = original.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) return { ok: false, error: { key: "mcp.headers.useColon", params: { line } } };
    const key = line.slice(0, colon).trim();
    const secret = line.slice(colon + 1).trim();
    if (!HEADER_NAME.test(key)) return { ok: false, error: { key: "mcp.headers.invalidName", params: { key } } };
    if (Object.hasOwn(headers, key)) return { ok: false, error: { key: "mcp.headers.duplicate", params: { key } } };
    headers[key] = secret === "" && saved.has(key) ? true : secret;
  }
  return { ok: true, headers };
}


function draftFor(server: McpServerListing): McpDraft {
  // Values are intentionally never returned by the server. A blank value
  // beside an existing key is a write-only “keep saved value” placeholder.
  if (isRemoteMcpListing(server)) {
    return {
      ...EMPTY_DRAFT,
      name: server.name,
      transport: "remote",
      type: server.type,
      url: server.url,
      headers: server.headerKeys.map((key) => `${key}: `).join("\n"),
    };
  }
  return {
    ...EMPTY_DRAFT,
    name: server.name,
    command: server.command,
    args: server.args.join("\n"),
    env: server.envKeys.map((key) => `${key}=`).join("\n"),
  };
}
interface McpSheetProps {
  label: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}

/** One sheet frame for both the editor and the importer: a pale veil, a
 *  frosted sheet, a header with a real close button, a scrolling body and a
 *  footer that owns the two answers. The focus behaviour is the shared hook,
 *  so neither form has to remember it. */
function McpSheet({ label, onClose, children, footer }: McpSheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  useSheetFocus(ref, onClose);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-5"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <GlassSheet
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="flex max-h-[86vh] w-full max-w-[560px] flex-col overflow-hidden"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{label}</div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("mcp.sheetHint")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("mcp.sheetCloseAria")}
            className="shrink-0 rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">{children}</div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-hairline/30 px-5 py-4">{footer}</div>
      </GlassSheet>
    </div>
  );
}

/** Every text field in the sheet. One class, so the form cannot end up with a
 *  hairline in one corner and an inset plate in the next. */
const FIELD = "w-full rounded-xl border border-hairline/45 bg-transparent px-3.5 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-secondary/60 focus:border-accent disabled:opacity-60";
const FIELD_MONO = `${FIELD} font-mono text-[12px]`;

function McpServerForm({
  editing,
  draft,
  setDraft,
  error,
  busy,
  onSave,
  onClose,
}: {
  editing: string | "new";
  draft: McpDraft;
  setDraft: (next: McpDraft) => void;
  error: string | McpMessage | null;
  busy: string | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const choice = mcpTransportChoice(draft);
  return (
    <McpSheet
      label={editing === "new" ? t("mcp.editorNew") : t("mcp.editorEdit", { name: editing })}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-[12.5px] text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink"
          >
            {t("mcp.cancel")}
          </button>
          <button
            type="button"
            data-initial-focus=""
            disabled={busy !== null}
            onClick={onSave}
            className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[12.5px] font-medium text-[var(--color-accent-ink)] transition hover:brightness-110 disabled:opacity-40"
          >
            {busy === "save" && <Loader2 size={13} className="animate-spin" />} {t("mcp.save")}
          </button>
        </>
      }
    >
      {/* The three transports the mockup draws: a command this computer starts,
          a URL it reaches over HTTP, and the same over SSE. */}
      <div
        className="glass-panel flex w-fit items-center gap-0.5 rounded-full p-1"
        role="radiogroup"
        aria-label={t("mcp.field.type")}
      >
        {MCP_TRANSPORTS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={choice === option.id}
            onClick={() => setDraft(mcpDraftWithTransport(draft, option.id))}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors motion-reduce:transition-none",
              choice === option.id
                ? "bg-accent text-[var(--color-accent-ink)]"
                : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
            )}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      {draft.transport === "remote" ? (
        <>
          <label className="block">
            <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.url")}</span>
            <input
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              placeholder="https://mcp.example.com/mcp"
              className={`mt-1.5 ${FIELD}`}
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.headers")}</span>
            <textarea
              value={draft.headers}
              onChange={(event) => setDraft({ ...draft, headers: event.target.value })}
              placeholder="Authorization: Bearer …"
              rows={4}
              className={`mt-1.5 resize-y ${FIELD_MONO}`}
            />
            <span className="mt-1.5 block text-[11px] leading-relaxed text-ink-secondary">{t("mcp.headersHint")}</span>
          </label>
        </>
      ) : (
        <>
          <label className="block">
            <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.name")}</span>
            <input
              disabled={editing !== "new"}
              value={draft.name}
              maxLength={32}
              onChange={(event) => setDraft({ ...draft, name: event.target.value.toLowerCase() })}
              placeholder="github"
              className={`mt-1.5 ${FIELD} font-mono`}
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.command")}</span>
            <input
              value={draft.command}
              onChange={(event) => setDraft({ ...draft, command: event.target.value })}
              placeholder="npx"
              className={`mt-1.5 ${FIELD} font-mono`}
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.args")}</span>
            <textarea
              value={draft.args}
              onChange={(event) => setDraft({ ...draft, args: event.target.value })}
              placeholder={"-y\n@modelcontextprotocol/server-github"}
              rows={4}
              className={`mt-1.5 resize-y ${FIELD_MONO}`}
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.env")}</span>
            <textarea
              value={draft.env}
              onChange={(event) => setDraft({ ...draft, env: event.target.value })}
              placeholder="GITHUB_TOKEN=…"
              rows={4}
              className={`mt-1.5 resize-y ${FIELD_MONO}`}
            />
            {editing !== "new" && <span className="mt-1.5 block text-[11px] leading-relaxed text-ink-secondary">{t("mcp.envHint")}</span>}
          </label>
        </>
      )}

      {draft.transport === "remote" && (
        <label className="block">
          <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.name")}</span>
          <input
            disabled={editing !== "new"}
            value={draft.name}
            maxLength={32}
            onChange={(event) => setDraft({ ...draft, name: event.target.value.toLowerCase() })}
            placeholder="docs"
            className={`mt-1.5 ${FIELD} font-mono`}
          />
        </label>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">
          {typeof error === "string" ? error : t(error.key, error.params)}
        </div>
      )}
    </McpSheet>
  );
}

function McpImportSheet({
  text,
  setText,
  busy,
  onImport,
  onClose,
}: {
  text: string;
  setText: (next: string) => void;
  busy: string | null;
  onImport: () => void;
  onClose: () => void;
}) {
  return (
    <McpSheet
      label={t("mcp.import")}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-[12.5px] text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            data-initial-focus=""
            disabled={busy !== null || !text.trim()}
            onClick={onImport}
            className="rounded-full bg-accent px-4 py-2 text-[12.5px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40"
          >
            {busy === "import" && <Loader2 size={13} className="mr-1.5 inline animate-spin" />}
            {t("mcp.importAction")}
          </button>
        </>
      }
    >
      <p className="text-[12px] leading-relaxed text-ink-secondary">{t("mcp.importHint")}</p>
      <textarea
        aria-label={t("mcp.import")}
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        rows={10}
        placeholder={'{\n  "mcpServers": {\n    "notes": { "command": "npx", "args": ["-y", "@example/notes-mcp"], "env": { "NOTES_TOKEN": "…" } },\n    "docs": { "type": "http", "url": "https://mcp.example.com/mcp", "headers": { "Authorization": "Bearer …" } }\n  }\n}'}
        className={`resize-y ${FIELD_MONO}`}
      />
    </McpSheet>
  );
}

export function McpServersPanel() {
  const [servers, setServers] = useState<McpServerListing[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<McpDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | McpMessage | null>(null);
  const [notice, setNotice] = useState<(McpMessage & { stateKey?: LocaleKey }) | null>(null);
  const [probe, setProbe] = useState<Record<string, ProbeResult>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const loadGeneration = useRef(0);

  // Paste-to-add: the same block Claude Code, Cursor and Claude Desktop
  // write. The server applies the form's rules and adds them switched off.
  const importServers = async () => {
    if (!importText.trim()) return;
    const generation = ++loadGeneration.current;
    setBusy("import");
    setError(null);
    setNotice(null);
    try {
      const result = await api("/api/mcp/servers/import", {
        method: "POST",
        body: JSON.stringify({ json: importText }),
      });
      updateMcpServers(result.servers ?? []);
      if (generation !== loadGeneration.current) return;
      setServers(result.servers ?? []);
      setNotice({ key: "mcp.imported", params: { names: (result.added ?? []).join(", ") } });
      setImportText("");
      setImportOpen(false);
    } catch (cause) {
      if (generation === loadGeneration.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === loadGeneration.current) setBusy(null);
    }
  };

  const load = useCallback(() => {
    const generation = ++loadGeneration.current;
    setBusy("load");
    setError(null);
    return api("/api/mcp/servers")
      .then((result) => {
        if (generation === loadGeneration.current) {
          setServers(result.servers ?? []);
          updateMcpServers(result.servers ?? []);
        }
      })
      .catch((cause) => {
        if (generation === loadGeneration.current) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (generation === loadGeneration.current) setBusy(null);
      });
  }, []);

  useEffect(() => {
    void load();
    return () => { loadGeneration.current += 1; };
  }, [load]);

  const closeEditor = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  };

  /** The request body for the draft, or the message that stops it. */
  const draftBody = (
    existing: McpServerListing | undefined,
  ): { ok: true; body: Record<string, unknown> } | { ok: false; error: McpMessage } => {
    const name = draft.name.trim();
    if (draft.transport === "remote") {
      const url = draft.url.trim();
      if (!name || !/^https?:\/\//i.test(url)) return { ok: false, error: { key: "mcp.err.nameAndUrl" } };
      const parsed = parseMcpHeaders(draft.headers, existing && isRemoteMcpListing(existing) ? existing.headerKeys : []);
      if (!parsed.ok) return parsed;
      return { ok: true, body: { type: draft.type, url, headers: parsed.headers } };
    }
    const command = draft.command.trim();
    if (!name || !command) return { ok: false, error: { key: "mcp.err.nameAndCommand" } };
    const parsed = parseMcpEnvironment(draft.env, existing && !isRemoteMcpListing(existing) ? existing.envKeys : []);
    if (!parsed.ok) return parsed;
    return { ok: true, body: { command, args: parseMcpArguments(draft.args), env: parsed.env } };
  };

  const save = async () => {
    const name = draft.name.trim();
    const existing = editing === "new" ? undefined : servers?.find((server) => server.name === editing);
    const prepared = draftBody(existing);
    if (!prepared.ok) {
      setError(prepared.error);
      return;
    }
    setBusy("save");
    loadGeneration.current += 1;
    setNotice(null);
    try {
      const result = await api(
        editing === "new" ? "/api/mcp/servers" : `/api/mcp/servers/${encodeURIComponent(name)}`,
        {
          method: editing === "new" ? "POST" : "PUT",
          body: JSON.stringify({
            ...(editing === "new" ? { name } : {}),
            ...prepared.body,
            ...(existing ? { enabled: existing.enabled } : {}),
          }),
        },
      );
      setServers(result.servers ?? []);
      updateMcpServers(result.servers ?? []);
      setNotice({ key: editing === "new" ? "mcp.saved" : "mcp.updated", params: { name } });
      setEditing(null);
      setDraft(EMPTY_DRAFT);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (server: McpServerListing) => {
    setBusy(`toggle:${server.name}`);
    loadGeneration.current += 1;
    setError(null);
    try {
      const result = await api(`/api/mcp/servers/${server.name}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      setServers(result.servers ?? []);
      updateMcpServers(result.servers ?? []);
      setNotice({
        key: "mcp.toggled",
        params: { name: server.name },
        stateKey: server.enabled ? "mcp.state.off" : "mcp.state.on",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const test = async (server: McpServerListing) => {
    setBusy(`test:${server.name}`);
    loadGeneration.current += 1;
    setError(null);
    setProbe((current) => {
      const next = { ...current };
      delete next[server.name];
      return next;
    });
    try {
      const result: ProbeResult = await api(`/api/mcp/servers/${server.name}/test`, { method: "POST" });
      setProbe((current) => ({ ...current, [server.name]: result }));
    } catch (cause) {
      setProbe((current) => ({
        ...current,
        [server.name]: { ok: false, error: cause instanceof Error ? cause.message : String(cause) },
      }));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (server: McpServerListing) => {
    if (!window.confirm(t("mcp.removeConfirm", { name: server.name }))) return;
    setBusy(`delete:${server.name}`);
    loadGeneration.current += 1;
    setError(null);
    try {
      const result = await api(`/api/mcp/servers/${server.name}`, { method: "DELETE" });
      setServers(result.servers ?? []);
      updateMcpServers(result.servers ?? []);
      setProbe((current) => {
        const next = { ...current };
        delete next[server.name];
        return next;
      });
      if (editing === server.name) closeEditor();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    // The MCP half of the page. The header and the list stand on the sky; the
    // only glass here is a server card (something with its own state and its
    // own controls) and the two sheets.
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-5 sm:px-8">
      <div className="mx-auto max-w-[900px]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-ink">{t("mcp.title")}</h2>
            <p className="mt-1 max-w-[560px] text-[12.5px] leading-relaxed text-ink-secondary">{t("mcp.subtitle")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={busy !== null}
              className="rounded-lg p-2 text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink disabled:opacity-40"
              aria-label={t("mcp.refreshAria")}
            >
              <RefreshCw size={16} className={cn(busy === "load" && "animate-spin")} />
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setImportOpen(true);
                setError(null);
                setNotice(null);
              }}
              className="flex items-center gap-1.5 rounded-full border border-hairline/40 px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-raised/60 disabled:opacity-40"
            >
              <ClipboardPaste size={14} aria-hidden="true" /> {t("mcp.import")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setEditing("new");
                setDraft(EMPTY_DRAFT);
                setError(null);
                setNotice(null);
              }}
              className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-medium text-[var(--color-accent-ink)] transition hover:brightness-110 disabled:opacity-40"
            >
              <Plus size={14} aria-hidden="true" /> {t("mcp.addServer")}
            </button>
          </div>
        </div>

        <ClaudeMcpSwitch />

        {/* Trust copy is a sentence, not a plate. */}
        <p className="mt-4 max-w-[640px] text-[12px] leading-relaxed text-ink-secondary">{t("mcp.trustNotice")}</p>

        {error && !editing && !importOpen && (
          <div role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[12px] text-danger">
            {typeof error === "string" ? error : t(error.key, error.params)}
          </div>
        )}
        {notice && (
          <div role="status" className="mt-3 rounded-xl border border-success/30 bg-success/10 px-3.5 py-2.5 text-[12px] text-success">
            {t(notice.key, { ...notice.params, ...(notice.stateKey ? { state: t(notice.stateKey) } : {}) })}
          </div>
        )}

        {servers === null ? (
          <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-ink-secondary">
            <Loader2 size={14} className="animate-spin" /> {t("mcp.loading")}
          </div>
        ) : servers.length === 0 ? (
          <div className="mt-6 flex min-h-56 flex-col items-center justify-center text-center">
            <div aria-hidden="true" className="flex size-11 items-center justify-center rounded-2xl border border-hairline/40 text-ink-secondary">
              <ServerCog size={21} />
            </div>
            <div className="mt-3 text-[14px] font-medium text-ink">{t("mcp.empty.title")}</div>
            <div className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-ink-secondary">{t("mcp.empty.desc")}</div>
          </div>
        ) : (
          <div className="mt-5 space-y-2.5">
            {servers.map((server) => {
              const result = probe[server.name];
              const summary = result ? mcpProbeSummary(result) : null;
              return (
                <GlassCard key={server.name} className="px-4 py-3.5 sm:px-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div
                      aria-hidden="true"
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-xl",
                        server.enabled ? "bg-success/12 text-success" : "bg-raised text-ink-secondary",
                      )}
                    >
                      {isRemoteMcpListing(server) ? <Globe size={19} /> : <ServerCog size={19} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-[13.5px] font-medium text-ink">{server.name}</span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                            server.enabled ? "bg-success/12 text-success" : "bg-raised text-ink-secondary",
                          )}
                        >
                          {t(server.enabled ? "mcp.badge.on" : "mcp.badge.off")}
                        </span>
                      </div>
                      <div className="mt-1 truncate font-mono text-[11.5px] text-ink-secondary">
                        {isRemoteMcpListing(server) ? server.url : [server.command, ...server.args].join(" ")}
                      </div>
                      {isRemoteMcpListing(server)
                        ? server.headerKeys.length > 0 && <div className="mt-1 truncate text-[11px] text-ink-secondary">{t("mcp.headersSaved", { keys: server.headerKeys.join(", ") })}</div>
                        : server.envKeys.length > 0 && <div className="mt-1 truncate text-[11px] text-ink-secondary">{t("mcp.secretsSaved", { keys: server.envKeys.join(", ") })}</div>}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                      <button type="button" disabled={busy !== null} onClick={() => void test(server)} className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink disabled:opacity-40">
                        {busy === `test:${server.name}` ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} aria-hidden="true" />} {t("mcp.test")}
                      </button>
                      <button type="button" disabled={busy !== null} onClick={() => void toggle(server)} className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink disabled:opacity-40" aria-label={t("mcp.toggleAria", {
                        name: server.name,
                        state: t(server.enabled ? "mcp.state.off" : "mcp.state.on"),
                      })}>
                        {busy === `toggle:${server.name}` ? <Loader2 size={14} className="animate-spin" /> : <CirclePower size={14} aria-hidden="true" />} {t(server.enabled ? "mcp.turnOff" : "mcp.turnOn")}
                      </button>
                      <button type="button" disabled={busy !== null} onClick={() => { setEditing(server.name); setDraft(draftFor(server)); setError(null); setNotice(null); }} className="rounded-full p-2 text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink disabled:opacity-40" aria-label={t("mcp.editAria", { name: server.name })}><Pencil size={14} /></button>
                      <button type="button" disabled={busy !== null} onClick={() => void remove(server)} className="rounded-full p-2 text-ink-secondary transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40" aria-label={t("mcp.removeAria", { name: server.name })}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  {result && summary && (
                    <div
                      role="status"
                      className={cn(
                        "mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-[11.5px]",
                        summary.tone === "connected" ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
                      )}
                    >
                      {summary.tone === "connected" && <CheckCircle2 size={13} className="mt-px shrink-0" aria-hidden="true" />}
                      {result.ok ? (
                        <span>
                          {t("mcp.probe.connected")} {t(summary.labelKey, summary.params)}
                        </span>
                      ) : (
                        result.error
                      )}
                    </div>
                  )}
                </GlassCard>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <McpServerForm
          editing={editing}
          draft={draft}
          setDraft={setDraft}
          error={error}
          busy={busy}
          onSave={() => void save()}
          onClose={closeEditor}
        />
      )}
      {importOpen && (
        <McpImportSheet
          text={importText}
          setText={setImportText}
          busy={busy}
          onImport={() => void importServers()}
          onClose={() => {
            setImportOpen(false);
            setImportText("");
          }}
        />
      )}
    </div>
  );
}

/** The one Claude-only setting on this page, in the words a person would
 *  use. Claude bots normally see just the servers listed here; this switch
 *  also gives them the MCP servers and connectors of this machine's own
 *  Claude Code setup — what Codex bots already do with their config. Saved
 *  on the workspace; the next message picks it up. */
function ClaudeMcpSwitch() {
  const { state, dispatch } = useStore();
  const enabled = claudeUserMcpEnabled(state.config);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { claudeUserMcp: !enabled } }),
      });
      dispatch({ type: "configStatus", config });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassCard className="mt-5 flex items-start justify-between gap-4 px-4 py-4 sm:px-5">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-ink">{t("mcp.claude.title")}</div>
        <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-ink-secondary">{t("mcp.claude.desc")}</p>
        {failed && <p role="alert" className="mt-1 text-[12px] text-danger">{t("mcp.claude.error")}</p>}
      </div>
      <Switch
        checked={enabled}
        aria-label={t("mcp.claude.aria")}
        disabled={saving}
        onClick={() => void toggle()}
        className="mt-0.5 shrink-0 disabled:cursor-wait disabled:opacity-50"
      />
    </GlassCard>
  );
}
