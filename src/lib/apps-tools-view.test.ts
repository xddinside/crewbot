import { describe, expect, it } from "vitest";

import {
  MCP_TRANSPORTS,
  appDetailSections,
  appDetailStatus,
  appRailSubtitle,
  mcpDraftWithTransport,
  mcpProbeSummary,
  mcpTransportChoice,
  resolveApp,
  webhookDeliveries,
  webhookOutcome,
  webhookStateView,
  webhookVerificationBanner,
  type AppCard,
} from "./apps-tools-view";
import type { WebhookAttempt, WebhookTrigger } from "@/lib/webhooks";
import type { RoutineRun } from "@/lib/routines";

const card = (over: Partial<AppCard> = {}): AppCard => ({
  slug: "github",
  label: "GitHub",
  blurb: "Sync code, respond to issues.",
  logo: null,
  domain: "github.com",
  ...over,
});

describe("connected apps rail", () => {
  it("counts accounts rather than repeating the blurb", () => {
    const app = resolveApp(card(), { connected: true, accounts: [{ id: "a", status: "ACTIVE" }, { id: "b", status: "ACTIVE" }] }, { busy: false, unavailableReason: null });
    expect(appRailSubtitle(app)).toEqual({ labelKey: "connectors.accountsMany", params: { count: 2 } });
  });

  it("says one account in the singular and never zero", () => {
    const one = resolveApp(card(), { connected: true, accounts: [{ id: "a", status: "ACTIVE" }] }, { busy: false, unavailableReason: null });
    expect(appRailSubtitle(one)).toEqual({ labelKey: "connectors.accountsOne" });
  });

  it("keeps the app's own blurb when nothing is connected", () => {
    const app = resolveApp(card(), undefined, { busy: false, unavailableReason: null });
    expect(appRailSubtitle(app)).toEqual({ label: "Sync code, respond to issues." });
  });

  it("prefers the self-hosted reason over every status word", () => {
    const app = resolveApp(card(), { connected: true }, { busy: false, unavailableReason: "Only in a self-hosted build." });
    expect(appRailSubtitle(app)).toEqual({ label: "Only in a self-hosted build." });
  });

  it("tells a lost OAuth URL from one still on screen", () => {
    const lost = resolveApp(card(), { pending: true, status: "INITIATED" }, { busy: false, unavailableReason: null });
    const kept = resolveApp(card(), { pending: true, status: "INITIATED" }, { busy: false, unavailableReason: null, pendingUrl: "https://x" });
    expect(appRailSubtitle(lost).labelKey).toBe("connectors.finishSetupOrDisconnect");
    expect(appRailSubtitle(kept).labelKey).toBe("connectors.finishSetup");
  });

  it("treats a connected no-auth toolkit as included, not as a second account", () => {
    const app = resolveApp(card({ noAuth: true }), undefined, { busy: false, unavailableReason: null });
    expect(app.included).toBe(true);
    expect(appDetailStatus(app)).toEqual({ labelKey: "connectors.detail.connected", tone: "connected" });
  });

  it("is not 'included' while an authorisation is still in flight", () => {
    const app = resolveApp(card(), { connected: true, pending: true, status: "INITIATED" }, { busy: false, unavailableReason: null });
    expect(app.included).toBe(false);
    expect(appDetailStatus(app).tone).toBe("attention");
  });
});

describe("connected app detail", () => {
  it("has four states and no fifth", () => {
    const states = [
      resolveApp(card(), { connected: true }, { busy: false, unavailableReason: null }),
      resolveApp(card(), { connected: true, pending: true, status: "INITIATED" }, { busy: false, unavailableReason: null, pendingUrl: "https://x" }),
      resolveApp(card(), { connected: true, status: "EXPIRED", accounts: [] }, { busy: false, unavailableReason: null }),
      resolveApp(card(), undefined, { busy: false, unavailableReason: null }),
    ].map((app) => appDetailStatus(app));
    expect(states.map((entry) => entry.tone)).toEqual(["connected", "attention", "attention", "idle"]);
  });

  it("offers Add account once there is something to add one next to", () => {
    const none = appDetailSections(resolveApp(card(), undefined, { busy: false, unavailableReason: null }));
    const one = appDetailSections(resolveApp(card(), { connected: true, accounts: [{ id: "a", status: "ACTIVE" }] }, { busy: false, unavailableReason: null }));
    expect(none).not.toContain("addAccount");
    expect(one).toContain("addAccount");
    expect(one).toContain("alias");
  });

  it("always ends with the crew allowance and the Composio note", () => {
    const sections = appDetailSections(resolveApp(card(), undefined, { busy: false, unavailableReason: null }));
    expect(sections[sections.length - 1]).toBe("composio");
    expect(sections).toContain("crew");
  });
});

describe("MCP transports", () => {
  it("offers the three the sheet draws, in order", () => {
    expect(MCP_TRANSPORTS.map((option) => option.id)).toEqual(["stdio", "http", "sse"]);
  });

  it("reads the lit pill back off the two stored fields", () => {
    expect(mcpTransportChoice({ transport: "stdio", type: "http" })).toBe("stdio");
    expect(mcpTransportChoice({ transport: "remote", type: "http" })).toBe("http");
    expect(mcpTransportChoice({ transport: "remote", type: "sse" })).toBe("sse");
  });

  it("keeps the other half of the draft when the transport changes", () => {
    const draft = { transport: "stdio", type: "http", command: "npx" } as const;
    expect(mcpDraftWithTransport(draft, "sse")).toEqual({ transport: "remote", type: "sse", command: "npx" });
    // back to Local, and the command the person typed is still there
    expect(mcpDraftWithTransport({ ...draft, transport: "remote", type: "sse" }, "stdio")).toEqual({
      transport: "stdio",
      type: "sse",
      command: "npx",
    });
  });
});

describe("MCP test result", () => {
  it("calls a server with no tools connected rather than broken", () => {
    expect(mcpProbeSummary({ ok: true, tools: [] })).toEqual({ tone: "connected", labelKey: "mcp.probe.noTools" });
    expect(mcpProbeSummary({ ok: true })).toEqual({ tone: "connected", labelKey: "mcp.probe.noTools" });
  });

  it("names the tools a working server offered", () => {
    const summary = mcpProbeSummary({ ok: true, tools: [{ name: "search" }, { name: "create" }] });
    expect(summary.labelKey).toBe("mcp.probe.toolsMany");
    expect(summary.params).toEqual({ count: 2, names: "search, create" });
  });

  it("keeps a failure a failure", () => {
    expect(mcpProbeSummary({ ok: false, error: "boom" })).toEqual({ tone: "danger", labelKey: "mcp.probe.failed" });
  });
});

const trigger = (over: Partial<WebhookTrigger> = {}) =>
  ({ id: "w1", botId: "b1", name: "Support", prompt: "", enabled: false, ...over }) as WebhookTrigger;

describe("webhook activation", () => {
  it("reads four states off three flags", () => {
    expect(webhookStateView(trigger({ verificationPending: true })).state).toBe("pending");
    expect(webhookStateView(trigger({ verifiedAt: 1, enabled: false })).state).toBe("ready");
    expect(webhookStateView(trigger({ verifiedAt: 1, enabled: true })).state).toBe("active");
    expect(webhookStateView(trigger({ enabled: false })).state).toBe("paused");
  });

  it("never lets an unverified webhook read as active", () => {
    // enabled with no test event is still waiting; the store refuses the
    // enable, and the rail must say the same thing.
    const view = webhookStateView(trigger({ enabled: true, verificationPending: true }));
    expect(view.state).toBe("pending");
  });

  it("will not offer to enable a webhook that has proved nothing", () => {
    const banner = webhookVerificationBanner(trigger({ verificationPending: true }));
    expect(banner).toMatchObject({ tone: "warning", canEnable: false });
  });

  it("offers the turn-on once a sample arrived", () => {
    const banner = webhookVerificationBanner(
      trigger({ verifiedAt: 1, verificationSample: { preview: "ping" } as WebhookTrigger["verificationSample"] }),
    );
    expect(banner).toMatchObject({ tone: "connected", canEnable: true, sample: "ping" });
  });

  it("says nothing once the webhook is simply running", () => {
    expect(webhookVerificationBanner(trigger({ enabled: true, verifiedAt: 1 }))).toBeNull();
    expect(webhookVerificationBanner(trigger({ enabled: false }))).toBeNull();
  });
});

describe("webhook deliveries", () => {
  it("is never 'accepted' while the run is still going", () => {
    expect(webhookOutcome("accepted", { status: "running" }).tone).toBe("attention");
    expect(webhookOutcome("accepted", { status: "queued" }).tone).toBe("attention");
    expect(webhookOutcome("accepted", { status: "completed" }).tone).toBe("connected");
    expect(webhookOutcome("accepted", { status: "failed" }).tone).toBe("danger");
    expect(webhookOutcome("accepted", { status: "waiting" })).toMatchObject({
      labelKey: "webhooks.delivery.needsYou",
    });
  });

  it("names each receipt shape", () => {
    expect(webhookOutcome("captured").labelKey).toBe("webhooks.delivery.testReceived");
    expect(webhookOutcome("duplicate").tone).toBe("muted");
    expect(webhookOutcome("ignored").tone).toBe("muted");
    expect(webhookOutcome("rejected").tone).toBe("danger");
  });

  const run = (id: string, webhookId: string, scheduledFor: number, status: RoutineRun["status"] = "completed") =>
    ({ id, webhookId, scheduledFor, status, prompt: "Event: push\n\n{}", threadId: `t-${id}` }) as RoutineRun;
  const attempt = (over: Partial<WebhookAttempt> & Pick<WebhookAttempt, "id" | "webhookId" | "receivedAt">) =>
    ({ outcome: "accepted", eventName: "push", preview: "", ...over }) as WebhookAttempt;

  it("merges attempts and legacy runs, newest first, without doubling a run", () => {
    const runs = [run("r1", "w1", 100), run("r2", "w1", 300)];
    const attempts = [
      attempt({ id: "a1", webhookId: "w1", receivedAt: 200, runId: "r1" }),
      attempt({ id: "a2", webhookId: "w2", receivedAt: 900 }),
    ];
    const runById = new Map(runs.map((entry) => [entry.id, entry]));
    const deliveries = webhookDeliveries({ attempts, runs, webhookId: "w1", runById });
    expect(deliveries.map((entry) => entry.id)).toEqual(["r2", "a1"]);
  });

  it("honours the cap and keeps the newest", () => {
    const attempts = Array.from({ length: 40 }, (_, index) =>
      attempt({ id: `a${index}`, webhookId: "w1", receivedAt: index }),
    );
    const deliveries = webhookDeliveries({ attempts, runs: [], webhookId: "w1", runById: new Map(), limit: 5 });
    expect(deliveries).toHaveLength(5);
    expect(deliveries[0]!.at).toBe(39);
  });
});
