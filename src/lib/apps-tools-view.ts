// Apps & tools, and webhooks: the screens' pure layer.
//
// Three surfaces live here, because each one is mostly a *wording* decision
// dressed as layout:
//
//   • the connected-apps rail and its detail card (F092, F093)
//   • the MCP server sheet's three transports and its test result (F094, F095)
//   • a webhook's activation state and what its activity says (F128, F129)
//
// Nothing here talks to the server, so nothing in this file can connect an
// account, register a server, rotate a URL or delete an endpoint: it decides
// what the screen *says* and which controls it offers. Every action stays in
// the component.

import type { LocaleKey } from "@/locales";
import type { RoutineRun } from "@/lib/routines";
import type { WebhookAttempt, WebhookTrigger } from "@/lib/webhooks";

// ── Connected apps ──────────────────────────────────────────────────────────

export type AppTone = "connected" | "attention" | "idle" | "muted";

export interface AppConnectorState {
  connected?: boolean;
  pending?: boolean;
  status?: string;
  accounts?: ReadonlyArray<{ id: string; alias?: string; status: string }>;
}

/** The catalog's own card. `logo` and `domain` are what `ServiceIcon` falls
 *  back through, so the type carries them rather than a second cast at the
 *  call site. */
export interface AppCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  domain: string | null;
  noAuth?: boolean;
}

/** Everything the rail and the detail both need to know about one app,
 *  resolved once. Both surfaces read this, so a row can never say "Connected"
 *  while the card under it says "Sign in". */
export interface AppResolved {
  card: AppCard;
  accounts: ReadonlyArray<{ id: string; alias?: string; status: string }>;
  /** a no-auth toolkit, or a live connection with nothing left to authorise */
  included: boolean;
  pending: boolean;
  /** the OAuth URL survived the remount, so "Continue" can reopen it */
  canContinue: boolean;
  failed: boolean;
  /** the self-hosted build cannot offer this toolkit at all */
  unavailableReason: string | null;
  busy: boolean;
}

export function resolveApp(
  card: AppCard,
  status: AppConnectorState | undefined,
  input: { busy: boolean; unavailableReason: string | null; pendingUrl?: string },
): AppResolved {
  const accounts = status?.accounts ?? [];
  const pending = status?.pending === true;
  const failed = Boolean(status?.status && /^(expired|failed)$/i.test(status.status));
  return {
    card,
    accounts,
    included: card.noAuth === true || (status?.connected === true && !accounts.length && !pending && !failed),
    pending,
    canContinue: pending && Boolean(input.pendingUrl),
    failed,
    unavailableReason: input.unavailableReason,
    busy: input.busy,
  };
}

export interface AppLine {
  /** a literal, for text the app already owns (the app's own blurb, the
   *  self-hosted reason) */
  label?: string;
  /** a catalog key, for everything the app decides for itself */
  labelKey?: LocaleKey;
  params?: Record<string, string | number>;
}

/** The rail's second line: how many accounts are on this app, or what the one
 *  button on its detail card is about to say. One sentence, never a status
 *  dump — the card carries the rest. */
export function appRailSubtitle(app: AppResolved): AppLine {
  if (app.unavailableReason) return { label: app.unavailableReason };
  if (app.included) return { labelKey: "connectors.action.included" };
  if (app.failed && !app.accounts.length) return { labelKey: "connectors.authExpired" };
  if (app.pending) {
    return app.canContinue
      ? { labelKey: "connectors.finishSetup" }
      : { labelKey: "connectors.finishSetupOrDisconnect" };
  }
  if (app.accounts.length > 0) {
    return app.accounts.length === 1
      ? { labelKey: "connectors.accountsOne" }
      : { labelKey: "connectors.accountsMany", params: { count: app.accounts.length } };
  }
  if (app.card.blurb) return { label: app.card.blurb };
  return { labelKey: "connectors.action.connect" };
}

/** The detail card's status chip. Four states, and only four: the app is
 *  connected, it wants one more click, it is waiting on the person in the
 *  browser, or it is simply not connected. */
export function appDetailStatus(app: AppResolved): { labelKey: LocaleKey; tone: AppTone } {
  if (app.unavailableReason) return { labelKey: "connectors.action.unavailable", tone: "muted" };
  if (app.included) return { labelKey: "connectors.detail.connected", tone: "connected" };
  if (app.canContinue) return { labelKey: "connectors.detail.signInNeeded", tone: "attention" };
  if (app.pending) return { labelKey: "connectors.detail.checking", tone: "attention" };
  if (app.failed) return { labelKey: "connectors.detail.expired", tone: "attention" };
  if (app.accounts.length > 0) return { labelKey: "connectors.detail.connected", tone: "connected" };
  return { labelKey: "connectors.detail.notConnected", tone: "idle" };
}

/** The detail card's sections, in the order the card draws them. Data decides
 *  it; nothing here is a feature flag. */
export function appDetailSections(app: AppResolved): Array<"status" | "accounts" | "addAccount" | "alias" | "crew" | "composio"> {
  return [
    "status",
    ...(app.accounts.length > 0 || app.included ? ["accounts" as const] : []),
    ...(app.accounts.length > 0 || app.pending ? ["addAccount" as const] : []),
    ...(app.accounts.length > 0 ? ["alias" as const] : []),
    "crew",
    "composio",
  ];
}

// ── MCP servers ─────────────────────────────────────────────────────────────

/** The three ways a person reaches a server, which is three *transport*
 *  choices and not two: this app stores `stdio | remote` plus a `type` for the
 *  remote half, and the sheet offers the three the mockup draws. */
export type McpTransportChoice = "stdio" | "http" | "sse";

export interface McpTransportOption {
  id: McpTransportChoice;
  labelKey: LocaleKey;
}

export const MCP_TRANSPORTS: readonly McpTransportOption[] = [
  { id: "stdio", labelKey: "mcp.transport.localStdio" },
  { id: "http", labelKey: "mcp.transport.remoteHttp" },
  { id: "sse", labelKey: "mcp.transport.remoteSse" },
];

export interface McpTransportDraft {
  transport: "stdio" | "remote";
  type: "http" | "sse";
}

/** Which of the three pills is lit for the draft as it stands. `remote` on its
 *  own is never a state the sheet can be in, so it reads as HTTP. */
export function mcpTransportChoice(draft: McpTransportDraft): McpTransportChoice {
  if (draft.transport === "stdio") return "stdio";
  return draft.type === "sse" ? "sse" : "http";
}

/** The two fields the pill writes. Selecting a transport never touches the
 *  other half of the draft, so switching to Remote and back to Local keeps the
 *  command the person already typed. */
export function mcpDraftWithTransport<T extends McpTransportDraft>(draft: T, choice: McpTransportChoice): T {
  if (choice === "stdio") return { ...draft, transport: "stdio" };
  return { ...draft, transport: "remote", type: choice };
}

export interface McpProbe {
  ok: boolean;
  tools?: ReadonlyArray<{ name: string }>;
  error?: string;
}

/** What one line under a server row says after a test. A server that answers
 *  with no tools is connected, not broken — saying so is the difference between
 *  a useful result and a scary one. */
export function mcpProbeSummary(probe: McpProbe): {
  tone: "connected" | "danger";
  labelKey: LocaleKey;
  params?: Record<string, string | number>;
} {
  if (!probe.ok) return { tone: "danger", labelKey: "mcp.probe.failed" };
  const count = probe.tools?.length ?? 0;
  if (count === 0) return { tone: "connected", labelKey: "mcp.probe.noTools" };
  return { tone: "connected", labelKey: "mcp.probe.toolsMany", params: { count, names: probe.tools!.map((tool) => tool.name).join(", ") } };
}

// ── Webhooks ────────────────────────────────────────────────────────────────

export type WebhookState = "pending" | "ready" | "active" | "paused";

export interface WebhookStateView {
  state: WebhookState;
  labelKey: LocaleKey;
  tone: "attention" | "warning" | "connected" | "muted";
  dot: string;
}

/** One webhook's activation state, read off the three flags the store keeps.
 *  `verificationPending` outranks everything: a webhook nobody has proved can
 *  receive anything is not "paused", it is waiting, and the two words send a
 *  person to different places. */
export function webhookStateView(webhook: Pick<WebhookTrigger, "enabled" | "verifiedAt" | "verificationPending">): WebhookStateView {
  if (webhook.verificationPending) {
    return { state: "pending", labelKey: "webhooks.state.pending", tone: "attention", dot: "bg-accent animate-pulse" };
  }
  if (webhook.verifiedAt && !webhook.enabled) {
    return { state: "ready", labelKey: "webhooks.state.ready", tone: "warning", dot: "bg-warning" };
  }
  if (webhook.enabled) {
    return { state: "active", labelKey: "webhooks.state.active", tone: "connected", dot: "bg-success" };
  }
  return { state: "paused", labelKey: "webhooks.state.paused", tone: "muted", dot: "bg-ink-secondary/50" };
}

/** The banner the Setup tab shows above the command, and what it is allowed to
 *  offer. Turning a webhook on is the one action the store refuses while a
 *  test event is outstanding, so the banner is where that is said out loud
 *  rather than at the moment a button does nothing. */
export function webhookVerificationBanner(
  webhook: Pick<WebhookTrigger, "enabled" | "verifiedAt" | "verificationPending" | "verificationSample" | "name">,
): { tone: "warning" | "connected"; labelKey: LocaleKey; canEnable: boolean; sample?: string } | null {
  if (webhook.verificationPending) {
    return { tone: "warning", labelKey: "webhooks.verify.pending", canEnable: false };
  }
  if (!webhook.enabled && webhook.verifiedAt) {
    return {
      tone: "connected",
      labelKey: "webhooks.verify.received",
      canEnable: true,
      sample: webhook.verificationSample?.preview || undefined,
    };
  }
  return null;
}

export type WebhookOutcomeTone = "danger" | "attention" | "connected" | "muted";

/** What one delivery says. A run that is still going is `attention`, never
 *  `connected`: a webhook that swallowed an event is still an open task. */
export function webhookOutcome(
  outcome: WebhookAttempt["outcome"],
  run?: Pick<RoutineRun, "status">,
): { labelKey: LocaleKey; tone: WebhookOutcomeTone } {
  const status = run?.status;
  if (status === "waiting") return { labelKey: "webhooks.delivery.needsYou", tone: "attention" };
  if (status === "queued" || status === "running") return { labelKey: "webhooks.delivery.running", tone: "attention" };
  if (status === "completed") return { labelKey: "webhooks.delivery.accepted", tone: "connected" };
  if (status === "failed" || status === "missed") return { labelKey: "webhooks.delivery.failed", tone: "danger" };
  switch (outcome) {
    case "captured":
      return { labelKey: "webhooks.delivery.testReceived", tone: "connected" };
    case "duplicate":
      return { labelKey: "webhooks.delivery.duplicate", tone: "muted" };
    case "ignored":
      return { labelKey: "webhooks.delivery.ignored", tone: "muted" };
    case "rejected":
      return { labelKey: "webhooks.delivery.rejected", tone: "danger" };
    default:
      return { labelKey: "webhooks.delivery.accepted", tone: "connected" };
  }
}

export interface WebhookDelivery {
  id: string;
  at: number;
  outcome: WebhookAttempt["outcome"];
  eventName: string;
  preview: string;
  reason?: string;
  run?: RoutineRun;
}

/** The deliveries one endpoint gets, newest first, with a run's own status
 *  folded in. Attempts and legacy routine runs are merged (and de-duplicated by
 *  run id) so an endpoint created before the attempts ledger is not shown as
 *  having never fired. */
export function webhookDeliveries(input: {
  attempts: readonly WebhookAttempt[];
  runs: readonly RoutineRun[];
  webhookId: string;
  runById: Map<string, RoutineRun>;
  legacySummary?: (run: RoutineRun) => { eventName: string; preview: string };
  limit?: number;
}): WebhookDelivery[] {
  const attemptRuns = new Set(input.attempts.map((attempt) => attempt.runId).filter(Boolean));
  const fromAttempts: WebhookDelivery[] = input.attempts
    .filter((attempt) => attempt.webhookId === input.webhookId)
    .map((attempt) => ({
      id: attempt.id,
      at: attempt.receivedAt,
      outcome: attempt.outcome,
      eventName: attempt.eventName || (attempt.outcome === "rejected" ? "Rejected request" : "Webhook event"),
      preview: attempt.preview || "",
      reason: attempt.reason,
      run: attempt.runId ? input.runById.get(attempt.runId) : undefined,
    }));
  const legacy: WebhookDelivery[] = input.runs
    .filter((run) => run.webhookId === input.webhookId && !attemptRuns.has(run.id))
    .map((run) => {
      const summary = input.legacySummary?.(run) ?? { eventName: "Webhook event", preview: "" };
      return {
        id: run.id,
        at: run.scheduledFor,
        outcome: "accepted" as const,
        eventName: summary.eventName,
        preview: summary.preview,
        run,
      };
    });
  return [...fromAttempts, ...legacy].sort((a, b) => b.at - a.at).slice(0, input.limit ?? 30);
}
