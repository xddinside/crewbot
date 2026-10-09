import { useEffect, useState } from "react";
import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import type { McpAccessClient, McpAccessSettings as Settings } from "../../shared/mcp-access";
import { Card, CommandLine, SettingRow, Switch } from "./SettingsPrimitives";

/** Owner controls for the optional external bot endpoint and one-time client tokens. */
export function McpAccessSettings() {
  const { state } = useStore();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [name, setName] = useState("");
  const [botIds, setBotIds] = useState<string[]>([]);
  const [readOnly, setReadOnly] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void api<Settings>("/api/mcp-access", { signal: controller.signal }).then(setSettings).catch(() => {
      if (!controller.signal.aborted) setError(t("mcpAccess.loadError"));
    });
    return () => controller.abort();
  }, []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); }
    catch { setError(t("mcpAccess.saveError")); }
    finally { setBusy(false); }
  };
  const bots = state.bots.filter(bot => !bot.hidden);
  return <Card title={t("mcpAccess.title")} subtitle={t("mcpAccess.subtitle")}>
    <SettingRow title={t("mcpAccess.enable")} subtitle={t("mcpAccess.permissions")}>
      <Switch aria-label={t("mcpAccess.enable")} checked={settings?.enabled ?? false} disabled={busy || !settings}
        onClick={() => void run(async () => {
          const saved = await api<Settings>("/api/mcp-access", { method: "PUT", body: JSON.stringify({ enabled: !settings?.enabled }) });
          setSettings(saved);
        })} />
    </SettingRow>
    {settings && <div className="mb-4 min-w-0">
      <p className="mb-2 text-[13px] text-ink-secondary">{t("mcpAccess.endpoint")}</p>
      <CommandLine command={settings.endpoint} copyLabel={t("mcpAccess.copyEndpoint")} />
      <p className="mt-2 text-[12px] text-ink-secondary">{t("mcpAccess.publish")}</p>
    </div>}
    {token ? <div className="rounded-lg border border-hairline/40 bg-inset p-3">
      <p role="status" className="mb-3 text-[13px]">{t("mcpAccess.tokenOnce")}</p>
      <CommandLine command={token} copyLabel={t("mcpAccess.copyToken")} />
      <button type="button" className="ui-button mt-3" onClick={() => setToken(null)}>{t("mcpAccess.done")}</button>
    </div> : <form className="flex flex-col gap-3" onSubmit={event => {
      event.preventDefault();
      if (!name.trim() || !botIds.length) { setError(t("mcpAccess.required")); return; }
      void run(async () => {
        const created = await api<{ client: McpAccessClient; token: string }>("/api/mcp-access/clients", {
          method: "POST", body: JSON.stringify({ name: name.trim(), botIds, readOnly }),
        });
        setToken(created.token); setName(""); setBotIds([]);
        setSettings(current => current ? { ...current, clients: [...current.clients, created.client] } : current);
      });
    }}>
      <label className="text-[13px]">{t("mcpAccess.clientName")}
        <input value={name} onChange={event => setName(event.target.value)} required maxLength={100} disabled={busy}
          className="mt-1 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-ink" />
      </label>
      <fieldset disabled={busy} className="rounded-lg border border-hairline/40 p-3">
        <legend className="px-1 text-[13px]">{t("mcpAccess.allowedBots")}</legend>
        <div className="flex max-h-48 flex-col gap-2 overflow-auto">
          {bots.map(bot => <label key={bot.id} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={botIds.includes(bot.id)} onChange={event => setBotIds(current => event.target.checked ? [...current, bot.id] : current.filter(id => id !== bot.id))} />
            {bot.name}
          </label>)}
          {!bots.length && <p className="text-[13px] text-ink-secondary">{t("mcpAccess.noBots")}</p>}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={readOnly} disabled={busy} onChange={event => setReadOnly(event.target.checked)} />
        {t("mcpAccess.readOnly")}
      </label>
      <button className="ui-button self-start" disabled={busy || !settings} type="submit">{t("mcpAccess.create")}</button>
    </form>}
    <div role="alert" className="mt-2 text-[13px] text-danger">{error}</div>
    <ul className="mt-4 flex flex-col gap-3">
      {settings?.clients.map(client => <li key={client.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/40 pt-3 text-[13px]">
        <div className="min-w-0">
          <p className="break-words font-medium">{client.name}</p>
          <p className="text-ink-secondary">{client.readOnly ? t("mcpAccess.readOnlyLabel") : t("mcpAccess.canMessage")} · {client.botIds.map(id => bots.find(bot => bot.id === id)?.name ?? t("mcpAccess.deletedBot")).join(", ")}</p>
        </div>
        {client.revokedAt ? <span>{t("mcpAccess.revoked")}</span> : <button type="button" className="ui-button" disabled={busy}
          aria-label={t("mcpAccess.revokeClient", { name: client.name })}
          onClick={() => void run(async () => {
            const saved = await api<Settings>(`/api/mcp-access/clients/${client.id}`, { method: "DELETE" });
            setSettings(saved); setToken(null);
          })}>{t("mcpAccess.revoke")}</button>}
      </li>)}
    </ul>
  </Card>;
}
