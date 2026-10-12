import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Cloud,
  Copy,
  ExternalLink,
  Laptop,
  Loader2,
  Play,
  Plus,
  RotateCw,
  Send,
  Webhook,
  X,
} from "lucide-react";

import { BotAvatar } from "@/components/Avatar";
import { GlassCard, GlassSheet, useSheetFocus } from "@/components/Glass";
import {
  webhookDeliveries,
  webhookOutcome,
  webhookStateView,
  webhookVerificationBanner,
} from "@/lib/apps-tools-view";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { RoutineRun, RoutineRunOn } from "@/lib/routines";
import {
  loadWebhookCredentials,
  removeWebhookCredential,
  saveWebhookCredential,
  webhookCredentialStore,
} from "@/lib/webhook-credentials";
import { webhookActivationDefaults, type WebhookCredential, type WebhookTrigger, type WebhookTriggerInput } from "@/lib/webhooks";
import { api, useStore, type Bot } from "@/state/store";

/** One ink per state, shared by the rail and the delivery rows, so a webhook
 *  cannot read amber in the list and grey in the log. */
const TONE_TEXT = {
  danger: "text-danger",
  attention: "text-accent",
  warning: "text-warning",
  connected: "text-success",
  muted: "text-ink-secondary",
} as const;

const DELIVERY_DOT = {
  danger: "bg-danger",
  attention: "animate-pulse bg-accent",
  connected: "bg-success",
  muted: "bg-ink-secondary/50",
} as const;

function relativeTime(at?: number) {
  if (!at) return "Never";
  const elapsed = Math.max(0, Date.now() - at);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

function deliverySummary(run: RoutineRun) {
  const eventName = run.prompt?.match(/^Event: (.+)$/m)?.[1]?.trim() || "Webhook event";
  const eventData = run.prompt?.match(/\[UNTRUSTED WEBHOOK EVENT DATA\]\n([\s\S]*?)\n\[\/UNTRUSTED WEBHOOK EVENT DATA\]/)?.[1] ?? "";
  const payloadStart = eventData.indexOf("\n\n");
  const payload = (payloadStart >= 0 ? eventData.slice(payloadStart + 2) : eventData).replace(/\s+/g, " ").trim();
  return { eventName, preview: payload.slice(0, 240) };
}

function suggestedName(prompt: string, bot?: Bot) {
  const first = prompt.trim().split(/[.!?\n]/)[0]?.trim().slice(0, 60);
  return first || `${bot?.name ?? "MAUS"} webhook`;
}




function terminalCommand(credential: WebhookCredential) {
  return `curl -sS '${credential.url}' --json '{"task":"A customer wrote: This app saved me hours. Write a short thank-you reply."}'`;
}

function WebhookEditor({ webhook, bots, onClose, onCredential }: { webhook?: WebhookTrigger; bots: Bot[]; onClose: () => void; onCredential: (credential: WebhookCredential, webhookId: string) => void }) {
  const { state, dispatch } = useStore();
  const [botId, setBotId] = useState(webhook?.botId ?? bots[0]?.id ?? "");
  const [name, setName] = useState(webhook?.name ?? "");
  const [prompt, setPrompt] = useState(webhook?.prompt ?? "");
  const [runOn, setRunOn] = useState<RoutineRunOn>(webhook?.runOn ?? "maus");
  const [eventTypes, setEventTypes] = useState((webhook?.eventTypes ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const cloudInstance = state.instances.find((instance) => instance.driverKind === "boxAgent");
  const cloudReady = Boolean(state.config?.box.configured && cloudInstance?.snapshot.state === "available");

  useSheetFocus(dialogRef, onClose);

  const save = async () => {
    const bot = bots.find((candidate) => candidate.id === botId);
    const input: WebhookTriggerInput = { name: name.trim() || suggestedName(prompt, bot), prompt: prompt.trim(), botId, runOn, ...webhookActivationDefaults(webhook), eventTypes: eventTypes.split(",").map((value) => value.trim()).filter(Boolean) };
    setSaving(true);
    setError("");
    try {
      const response = await api(webhook ? `/api/webhooks/${webhook.id}` : "/api/webhooks", { method: webhook ? "PATCH" : "POST", body: JSON.stringify(input) });
      dispatch({ type: "webhookPatched", webhook: response.webhook });
      onClose();
      if (response.credential) onCredential(response.credential, response.webhook.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-5" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <GlassSheet ref={dialogRef} role="dialog" aria-modal="true" aria-label={webhook ? "Edit webhook" : "New webhook"} tabIndex={-1} className="flex max-h-[90vh] w-full max-w-[590px] flex-col overflow-hidden">
        <div className="flex items-start justify-between px-5 py-4"><div><div className="text-[17px] font-semibold text-ink">{webhook ? "Edit webhook" : "New webhook"}</div><div className="mt-1 text-[12px] text-ink-secondary">Each request starts a new task in the MAUS chat.</div></div><button onClick={onClose} aria-label="Close webhook editor" className="rounded-lg p-2 text-ink-secondary hover:bg-raised hover:text-ink"><X size={18} /></button></div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <div><div className="mb-2 text-[12px] font-medium text-ink-secondary">Who receives the tasks?</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{bots.map((bot) => <button key={bot.id} type="button" data-initial-focus={botId === bot.id ? "" : undefined} onClick={() => setBotId(bot.id)} className={cn("flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left", botId === bot.id ? "border-accent/70 bg-accent/10" : "border-hairline/40 hover:bg-raised/50")}><BotAvatar bot={bot} state={botId === bot.id ? "happy" : "idle"} size={38} animated={false} /><span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{bot.name}</span></button>)}</div></div>
          <div className="rounded-xl border border-accent/20 bg-accent/5 px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-secondary">Send the task in the request: <code className="text-ink">{`{"task":"Check the failed build"}`}</code>. The MAUS keeps its model, tools, permissions, and computer setup.</div>
          <details className="group rounded-xl border border-hairline/40 px-4 py-3" open={Boolean(webhook)}>
            <summary className="cursor-pointer text-[12.5px] font-medium text-ink">Advanced options</summary>
            <div className="mt-4 space-y-4">
              <label className="block"><span className="mb-1.5 block text-[11.5px] font-medium text-ink-secondary">Name <span className="font-normal">· optional</span></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={suggestedName(prompt, bots.find((bot) => bot.id === botId))} className="w-full rounded-xl border border-hairline/45 bg-transparent px-3.5 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-secondary/60 focus:border-accent/70" /></label>
              <label className="block"><span className="mb-1.5 block text-[11.5px] font-medium text-ink-secondary">Default instructions <span className="font-normal">· optional</span></span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} placeholder="For every event, summarize what happened and suggest the next step…" className="w-full resize-y rounded-xl border border-hairline/45 bg-transparent px-3.5 py-3 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-secondary/60 focus:border-accent/70" /><span className="mt-1.5 block text-[10.5px] leading-relaxed text-ink-secondary">Use this only when every event needs the same handling rule. Otherwise the request’s task is used.</span></label>
              <div><div className="mb-2 text-[11.5px] font-medium text-ink-secondary">Run on</div><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setRunOn("maus")} className={cn("rounded-xl border p-3 text-left", runOn === "maus" ? "border-accent/70 bg-accent/10" : "border-hairline/40 hover:bg-raised/50")}><div className="flex items-center gap-2 text-[12.5px] font-medium text-ink"><Laptop size={14} />This computer</div></button><button type="button" disabled={!cloudReady && runOn !== "cloud"} onClick={() => setRunOn("cloud")} className={cn("rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-45", runOn === "cloud" ? "border-accent/70 bg-accent/10" : "border-hairline/40 hover:bg-raised/50")}><div className="flex items-center gap-2 text-[12.5px] font-medium text-ink"><Cloud size={14} />Cloud VM</div></button></div></div>
              <label className="block"><span className="mb-1.5 block text-[11.5px] font-medium text-ink-secondary">Only accept event types <span className="font-normal">· optional</span></span><input value={eventTypes} onChange={(event) => setEventTypes(event.target.value)} placeholder="push, workflow_run" className="w-full rounded-xl border border-hairline/60 bg-panel px-3.5 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-secondary/60 focus:border-accent/70" /><span className="mt-1.5 block text-[10.5px] text-ink-secondary">Comma-separated values from the sender’s event-type header.</span></label>
            </div>
          </details>
          {error && <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline/30 px-5 py-4"><button onClick={onClose} className="rounded-xl px-4 py-2 text-[13px] text-ink-secondary transition hover:bg-raised/60 hover:text-ink">Cancel</button><button disabled={saving || !botId} onClick={() => void save()} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-[13px] font-medium text-[var(--color-accent-ink)] transition hover:brightness-110 disabled:opacity-40">{saving && <Loader2 size={14} className="animate-spin" />}{webhook ? "Save changes" : "Create webhook"}</button></div>
      </GlassSheet>
    </div>
  );
}

/** A destination-first webhook view: choose a MAUS endpoint on the left, then
 * either copy its setup command or inspect its deliveries on the right. */
export function WebhooksPanel({
  bots,
  createRequest,
  onCreateHandled,
}: {
  bots: Bot[];
  createRequest: number;
  onCreateHandled: () => void;
}) {
  const { state, dispatch } = useStore();
  const [editor, setEditor] = useState<WebhookTrigger | "new" | null>(null);
  const [credentials, setCredentials] = useState<Record<string, WebhookCredential>>(() =>
    loadWebhookCredentials(webhookCredentialStore()),
  );
  const [selectedId, setSelectedId] = useState<string | null>(state.webhooks[0]?.id ?? null);
  const [tab, setTab] = useState<"setup" | "activity">("setup");
  const [working, setWorking] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const runById = useMemo(() => new Map(state.routineRuns.map((run) => [run.id, run])), [state.routineRuns]);

  useEffect(() => {
    if (!state.webhooks.length) setSelectedId(null);
    else if (!selectedId || !state.webhooks.some((webhook) => webhook.id === selectedId)) setSelectedId(state.webhooks[0]!.id);
  }, [selectedId, state.webhooks]);

  useEffect(() => {
    if (createRequest > 0) {
      setEditor("new");
      onCreateHandled();
    }
  }, [createRequest, onCreateHandled]);

  const selected = state.webhooks.find((webhook) => webhook.id === selectedId) ?? null;
  const selectedBot = selected ? bots.find((bot) => bot.id === selected.botId) : undefined;
  const activity = useMemo(() => {
    if (!selected) return [];
    return webhookDeliveries({
      attempts: state.webhookAttempts,
      runs: state.routineRuns,
      webhookId: selected.id,
      runById,
      legacySummary: deliverySummary,
    });
  }, [runById, selected, state.routineRuns, state.webhookAttempts]);

  const invoke = async (webhook: WebhookTrigger, action: "toggle" | "delete") => {
    setWorking(`${webhook.id}:${action}`);
    setError("");
    try {
      if (action === "delete") {
        if (!window.confirm(`Delete “${webhook.name}”? Existing thread history will stay available.`)) return;
        await api(`/api/webhooks/${webhook.id}`, { method: "DELETE" });
        dispatch({ type: "webhookDeleted", webhookId: webhook.id });
        removeWebhookCredential(webhookCredentialStore(), webhook.id);
        setCredentials((current) => {
          const next = { ...current };
          delete next[webhook.id];
          return next;
        });
      } else {
        const enabling = !webhook.enabled;
        if (enabling && webhook.verificationPending) throw new Error("Send a request before turning this webhook on");
        const response = await api(`/api/webhooks/${webhook.id}`, { method: "PATCH", body: JSON.stringify({ enabled: enabling, verificationPending: false }) });
        dispatch({ type: "webhookPatched", webhook: response.webhook });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(null);
    }
  };

  const createAndCopyCommand = async (webhook: WebhookTrigger, replace = false) => {
    if (replace && !window.confirm("Replace this private URL? Every previously copied command will stop working.")) return;
    setWorking(`${webhook.id}:command`);
    setError("");
    try {
      let credential = replace ? undefined : credentials[webhook.id];
      if (!credential) {
        const response = await api(`/api/webhooks/${webhook.id}/rotate`, { method: "POST" });
        credential = response.credential;
        dispatch({ type: "webhookPatched", webhook: response.webhook });
        setCredentials((current) => ({ ...current, [webhook.id]: credential! }));
        saveWebhookCredential(webhookCredentialStore(), webhook.id, credential!);
      }
      if (!credential) throw new Error("Could not create a terminal command");
      await navigator.clipboard.writeText(terminalCommand(credential));
      setCopiedId(webhook.id);
      setTimeout(() => setCopiedId((current) => current === webhook.id ? null : current), 1_800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(null);
    }
  };

  const ingress = state.webhookIngress;
  const credential = selected ? credentials[selected.id] : undefined;
  const command = credential ? terminalCommand(credential) : "";
  const verification = selected ? webhookVerificationBanner(selected) : null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-[1120px] space-y-4">
        {error && <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">{error}</div>}
        {ingress && !ingress.available && <div className="flex items-center gap-2 rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3 text-[12px] text-danger"><span className="size-1.5 shrink-0 rounded-full bg-danger" />Webhook receiver unavailable{ingress.error ? `: ${ingress.error}` : "."}</div>}

        {state.webhooks.length === 0 ? (
          <div className="border-t border-hairline/40 px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Send size={23} /></div>
            <h3 className="text-[16px] font-semibold text-ink">Create your first webhook</h3>
            <p className="mx-auto mt-2 max-w-[420px] text-[12.5px] leading-relaxed text-ink-secondary">Choose a MAUS, copy one command, and every request becomes a new task in its chat.</p>
            <button onClick={() => setEditor("new")} disabled={bots.length === 0} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-40"><Plus size={15} />Create webhook</button>
            {bots.length === 0 && <p className="mt-3 text-[12px] text-warning">Create a MAUS first, then come back here.</p>}
          </div>
        ) : selected && (
          <div className="min-h-[580px] overflow-hidden md:grid md:grid-cols-[250px_minmax(0,1fr)]">
            <aside className="border-b border-hairline/30 p-2.5 md:border-r md:border-b-0">
              <div className="flex items-center justify-between px-2 py-2">
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-secondary">Your webhooks</span>
                <span className="text-[10px] tabular-nums text-ink-secondary">{state.webhooks.length}</span>
              </div>
              <nav className="flex gap-1 overflow-x-auto md:block md:space-y-1 md:overflow-visible">
                {state.webhooks.map((webhook) => {
                  const bot = bots.find((candidate) => candidate.id === webhook.botId);
                  const status = webhookStateView(webhook);
                  return (
                    <button key={webhook.id} onClick={() => { setSelectedId(webhook.id); setTab("setup"); setError(""); }} className={cn("flex min-w-[210px] items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors md:w-full md:min-w-0", webhook.id === selected.id ? "bg-accent/10 text-accent ring-1 ring-accent/30" : "text-ink-secondary hover:bg-raised/50 hover:text-ink")}>
                      {bot ? <BotAvatar bot={bot} state={webhook.enabled ? "idle" : "sleeping"} size={36} animated={false} label={bot.name} /> : <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary"><Webhook size={16} /></div>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">{webhook.name}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[10px]"><span className={cn("size-1.5 shrink-0 rounded-full", status.dot)} /><span className={cn("truncate", TONE_TEXT[status.tone])}>{t(status.labelKey)}</span></span>
                      </span>
                    </button>
                  );
                })}
              </nav>
            </aside>

            <GlassCard className="min-w-0 md:m-4">
        <section className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 md:px-7 md:pt-6">
                <div className="flex min-w-0 items-center gap-3">
                  {selectedBot ? <BotAvatar bot={selectedBot} state={selected.enabled ? "idle" : "sleeping"} size={44} animated={false} label={selectedBot.name} /> : <div aria-hidden="true" className="flex size-11 items-center justify-center rounded-xl border border-hairline/40 text-ink-secondary"><Webhook size={18} /></div>}
                  <div className="min-w-0">
                    <h3 className="truncate text-[17px] font-semibold tracking-[-0.015em] text-ink">{selected.name}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-secondary">
                      <span>{selectedBot?.name ?? "Deleted MAUS"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{selected.runOn === "cloud" ? "Cloud VM" : "This computer"}</span>
                    </div>
                  </div>
                </div>
                {/* Setup and Activity are two views of one endpoint, so they are
                    one segmented pill in the header rather than an underline
                    row that pushes the content down. */}
                <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-raised/60 p-1" role="tablist" aria-label="Webhook views">
                  <button role="tab" aria-selected={tab === "setup"} onClick={() => setTab("setup")} className={cn("rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors motion-reduce:transition-none", tab === "setup" ? "bg-accent text-[var(--color-accent-ink)]" : "text-ink-secondary hover:text-ink")}>Setup</button>
                  <button role="tab" aria-selected={tab === "activity"} onClick={() => setTab("activity")} className={cn("flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors motion-reduce:transition-none", tab === "activity" ? "bg-accent text-[var(--color-accent-ink)]" : "text-ink-secondary hover:text-ink")}>
                    Activity
                    {activity.length > 0 && <span className="rounded-full bg-raised px-1.5 py-0.5 text-[9.5px] tabular-nums text-ink-secondary">{activity.length}</span>}
                  </button>
                </div>
              </div>

              {tab === "setup" ? (
                <div className="px-5 py-6 md:px-7">
                  <div className="max-w-[720px]">
                    <h4 className="text-[14px] font-semibold text-ink">Send a task</h4>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">Copy this command into Terminal and press Return. It starts a real task in {selectedBot?.name ?? "this MAUS"}&apos;s chat; edit the task text for whatever you want done.</p>
                    {verification && (
                      /* The store refuses to enable an unverified webhook, so
                         this is where that refusal is said out loud instead of
                         at the moment a button quietly does nothing. */
                      <div className={cn("mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-3", verification.tone === "warning" ? "border-warning/30 bg-warning/10" : "border-success/30 bg-success/10")}>
                        <div className="min-w-0">
                          <div className={cn("flex items-center gap-2 text-[11.5px] font-medium", verification.tone === "warning" ? "text-warning" : "text-success")}>
                            {verification.tone === "warning" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                            {t(verification.labelKey)}
                          </div>
                          {verification.sample && <p className="mt-1 max-w-[520px] truncate font-mono text-[10.5px] text-ink-secondary">{verification.sample}</p>}
                        </div>
                        {verification.canEnable && (
                          <button disabled={Boolean(working)} onClick={() => void invoke(selected, "toggle")} className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11.5px] font-medium text-[var(--color-accent-ink)] transition hover:brightness-110 disabled:opacity-40"><Play size={12} />Turn on</button>
                        )}
                      </div>
                    )}
                    {credential ? (
                      <GlassCard className="mt-4 overflow-hidden p-0">
                        <div className="flex items-center justify-between border-b border-hairline/35 px-3.5 py-2"><span className="text-[9.5px] font-medium uppercase tracking-wider text-ink-secondary">Terminal</span><div className="flex items-center gap-1"><button onClick={() => void createAndCopyCommand(selected)} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-medium text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink">{copiedId === selected.id ? <Check size={12} className="text-success" /> : <Copy size={12} />}{copiedId === selected.id ? "Copied" : "Copy command"}</button><button onClick={() => void createAndCopyCommand(selected, true)} className="rounded-full p-1.5 text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink" title="Rotate private URL" aria-label="Rotate private URL"><RotateCw size={12} /></button></div></div>
                        <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-ink-secondary">{command}</pre>
                      </GlassCard>
                    ) : (
                      <div className="mt-4">
                        <p className="max-w-[560px] text-[10.5px] leading-relaxed text-ink-secondary">The private URL is shown once. Generate a replacement to copy your webhook command; any older command for this webhook will stop working.</p>
                        <button disabled={Boolean(working) || !ingress?.available} onClick={() => void createAndCopyCommand(selected)} className="mt-3 flex items-center gap-2 rounded-xl bg-accent px-3.5 py-2.5 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-40">{working === `${selected.id}:command` ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}Generate new private URL</button>
                      </div>
                    )}
                    <div className="mt-3 flex items-start gap-2 text-[10.5px] leading-relaxed text-ink-secondary"><Laptop size={12} className="mt-0.5 shrink-0" /><span>Keep crewbot open so it can receive requests.</span></div>


                    <div className="mt-6 grid gap-4 text-[11.5px] sm:grid-cols-2">
                      <div><div className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-secondary">Tasks go to</div><div className="mt-1.5 font-medium text-ink">{selectedBot?.name ?? "Deleted MAUS"}</div></div>
                      <div><div className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-secondary">Runs on</div><div className="mt-1.5 font-medium text-ink">{selected.runOn === "cloud" ? "Cloud VM" : "This computer"}</div></div>
                      <div><div className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-secondary">Event filter</div><div className="mt-1.5 font-medium text-ink">{selected.eventTypes?.length ? selected.eventTypes.join(", ") : "All events"}</div></div>
                      <div><div className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-secondary">Deliveries</div><div className="mt-1.5 font-medium text-ink">{selected.deliveryCount}</div></div>
                    </div>

                    <details className="group mt-5 border-t border-hairline/35 pt-4"><summary className="flex cursor-pointer list-none items-center justify-between text-[11.5px] font-medium text-ink"><span>Advanced</span><ChevronDown size={14} className="text-ink-secondary transition-transform group-open:rotate-180" /></summary><div className="mt-4 space-y-3 text-[10.5px] leading-relaxed text-ink-secondary">{selected.prompt ? <p><span className="font-medium text-ink">Default instruction:</span> {selected.prompt}</p> : <p>The task or message sent with each request becomes the MAUS instruction.</p>}{selected.eventTypes?.length ? <p><span className="font-medium text-ink">Accepted events:</span> {selected.eventTypes.join(", ")}</p> : <p>All event types are accepted.</p>}<p>Copying the command is all this does. It never opens a terminal, and the private URL belongs to this workspace alone.</p></div></details>

                    {/* Every action on this endpoint, in one row. The mockup puts
                        them here rather than behind a header ellipsis, and this
                        is the one place each of them appears. */}
                    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline/35 pt-4 text-[12.5px]">
                      <button onClick={() => void createAndCopyCommand(selected)} className="inline-flex items-center gap-1.5 font-medium text-accent transition-opacity hover:opacity-80">{copiedId === selected.id ? <Check size={13} className="text-success" /> : <Copy size={13} />}{copiedId === selected.id ? "Copied" : "Copy setup command"}</button>
                      <button onClick={() => setEditor(selected)} className="font-medium text-ink-secondary transition-colors hover:text-ink">Edit</button>
                      {!selected.verificationPending && (
                        <button disabled={Boolean(working)} onClick={() => void invoke(selected, "toggle")} className="font-medium text-ink-secondary transition-colors hover:text-ink disabled:opacity-40">{selected.enabled ? "Pause" : "Enable"}</button>
                      )}
                      <button disabled={Boolean(working)} onClick={() => void invoke(selected, "delete")} className="ml-auto font-medium text-danger transition-opacity hover:opacity-80 disabled:opacity-40">Delete</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="px-5 py-5 md:px-7">
                  <div className="mb-3"><h4 className="text-[13px] font-semibold text-ink">Recent deliveries</h4><p className="mt-1 text-[10.5px] text-ink-secondary">Accepted and rejected requests update automatically.</p></div>
                  <div className="space-y-2">
                    {activity.length === 0 ? <div className="py-12 text-center text-[11.5px] text-ink-secondary">No requests yet. Use the command in Setup to send one.</div> : activity.map((item) => {
                      const outcome = webhookOutcome(item.outcome, item.run);
                      return (
                        <GlassCard key={item.id} className="flex items-center gap-3 px-3.5 py-3">
                          <span className={cn("size-2 shrink-0 rounded-full", DELIVERY_DOT[outcome.tone])} aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 text-[12px]"><span className="truncate font-medium text-ink">{item.eventName}</span><span className="shrink-0 text-ink-secondary">· {relativeTime(item.at)}</span></div>
                            <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-secondary/85">{item.reason || item.preview || "Empty payload"}</div>
                          </div>
                          <span className={cn("shrink-0 text-[11px] font-medium", TONE_TEXT[outcome.tone])}>{t(outcome.labelKey)}</span>
                          {item.run?.threadId && selectedBot && <button onClick={() => { dispatch({ type: "select", id: selectedBot.id }); dispatch({ type: "switchTask", botId: selectedBot.id, threadId: item.run!.threadId! }); }} className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink" title="Open this execution in the MAUS chat"><ExternalLink size={11} />Open chat</button>}
                        </GlassCard>
                      );
                    })}
                  </div>
                </div>
              )}
        </section>
        </GlassCard>
          </div>
        )}
      </div>
      {editor && <WebhookEditor webhook={editor === "new" ? undefined : editor} bots={bots} onClose={() => setEditor(null)} onCredential={(newCredential, webhookId) => { saveWebhookCredential(webhookCredentialStore(), webhookId, newCredential); setCredentials((current) => ({ ...current, [webhookId]: newCredential })); setSelectedId(webhookId); setTab("setup"); }} />}
    </div>
  );
}
