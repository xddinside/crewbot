import { describe, expect, it } from "vitest";

import {
  connectionActions,
  connectionState,
  engineCardSubtitle,
  engineReady,
  engineStateView,
  engineVersionLabel,
  usageHeadline,
  usageHeadlineCost,
  voiceOptionReason,
  voiceOptions,
} from "./engines-view";
import { EMPTY_USAGE } from "@/lib/usage";

const usage = (over: Partial<typeof EMPTY_USAGE> = {}) => ({ ...EMPTY_USAGE, ...over });

describe("engine readiness", () => {
  it("means the binary is there and the workspace may use it", () => {
    expect(engineReady({ snapshot: { state: "available", authenticated: true } })).toBe(true);
    expect(engineReady({ snapshot: { state: "available", authenticated: false } })).toBe(false);
    expect(engineReady({ snapshot: { state: "starting" } })).toBe(false);
  });

  it("lets a custom binary skip the auth gate, because it brings its own", () => {
    expect(engineReady({ access: "custom", snapshot: { state: "available", authenticated: false } })).toBe(true);
  });

  it("does not call an engine that wants a sign-in 'ready'", () => {
    const view = engineStateView({ snapshot: { state: "available", authenticated: false } });
    expect(view.state).toBe("setup");
    expect(view.labelKey).toBe("engines.state.signIn");
  });

  it("keeps an update or a warning out of the plain Ready state", () => {
    const ready = { snapshot: { state: "available", authenticated: true } } as const;
    expect(engineStateView(ready).labelKey).toBe("onboarding.engines.ready");
    expect(engineStateView(ready, { update: { version: "2" } }).labelKey).toBe("engines.state.update");
    expect(engineStateView(ready, { warning: "quota" }).labelKey).toBe("engines.state.warning");
  });

  it("says a missing binary is missing rather than merely unready", () => {
    expect(engineStateView({ snapshot: { state: "unavailable" } }).labelKey).toBe("engines.state.notFound");
  });
});

describe("engine card subtitle", () => {
  const instance = (over: Partial<Parameters<typeof engineCardSubtitle>[0]> = {}): Parameters<typeof engineCardSubtitle>[0] => ({
    driverKind: "grok",
    access: "managed",
    snapshot: { state: "available", authenticated: true, account: null },
    ...over,
  });

  it("names the signed-in account when there is one", () => {
    expect(engineCardSubtitle(instance({
      snapshot: { state: "available", authenticated: true, account: { email: "a@b.c" } },
    }))).toBe("a@b.c");
  });

  it("counts accounts before it names one of them", () => {
    expect(engineCardSubtitle(instance(), { accounts: 3 })).toBe("3 accounts");
    // one account is named, not counted
    expect(engineCardSubtitle(instance(), { accounts: 1 })).toBe("xAI");
  });

  it("falls back to the provider, and says Custom for a custom binary", () => {
    expect(engineCardSubtitle(instance())).toBe("xAI");
    expect(engineCardSubtitle(instance({ access: "custom", snapshot: { state: "available", authenticated: false } }))).toBe("Custom");
    expect(engineCardSubtitle(instance({ driverKind: "somethingNew" }))).toBe("somethingNew");
  });

  it("drops a version string that is only the CLI's own name", () => {
    expect(engineVersionLabel("grok")).toBeNull();
    expect(engineVersionLabel("Claude Code 2.1.4")).toBe("2.1.4");
    expect(engineVersionLabel(undefined)).toBeNull();
  });
});

describe("connection rows", () => {
  it("never shows a saved secret, only what it can do", () => {
    const saved = connectionActions({ configured: true, testable: true, optional: false });
    expect(saved).toEqual({ test: true, replace: true, clear: true });
    const fresh = connectionActions({ configured: false, testable: true, optional: false });
    expect(fresh).toEqual({ test: false, replace: true, clear: false });
  });

  it("does not offer a test on a provider that cannot be tested from here", () => {
    expect(connectionActions({ configured: true, testable: false, optional: true }).test).toBe(false);
  });

  it("says Configured, never the value", () => {
    expect(connectionState(true)).toEqual({ labelKey: "connections.configured", tone: "connected" });
    expect(connectionState(false).tone).toBe("muted");
  });
});

describe("usage headline", () => {
  it("adds up cost, tokens, cache reads and turns", () => {
    const headline = usageHeadline([
      usage({ input: 1000, output: 500, cachedInput: 800, costUsd: 1.5, turns: 3 }),
      usage({ input: 2000, output: 1000, cachedInput: 0, costUsd: 2.25, turns: 4 }),
    ]);
    expect(headline.tokens).toBe(4500);
    expect(headline.cachedInput).toBe(800);
    expect(headline.turns).toBe(7);
    expect(usageHeadlineCost(headline)).toBe("$3.75");
  });

  it("leaves cost null when nothing was metered, rather than claiming $0", () => {
    const headline = usageHeadline([usage({ input: 10, output: 10, turns: 1 })]);
    expect(headline.costUsd).toBeNull();
    expect(usageHeadlineCost(headline)).toBe("—");
  });

  it("never reports more cached input than input", () => {
    expect(usageHeadline([usage({ input: 100, cachedInput: 900 })]).cachedInput).toBe(100);
  });
});

describe("voice engines", () => {
  it("offers the hosted pair plus Chatterbox everywhere", () => {
    expect(voiceOptions({}).map((option) => option.id)).toEqual(["elevenlabs", "fish", "chatterbox"]);
  });

  it("offers the built-in Mac voices only on a Mac", () => {
    expect(voiceOptions({ hostPlatform: "darwin" }).map((option) => option.id)).toEqual([
      "elevenlabs", "system", "fish", "chatterbox",
    ]);
  });

  it("says why an option cannot be picked, and nothing when it can", () => {
    const [elevenlabs] = voiceOptions({});
    expect(voiceOptionReason(elevenlabs, { hasKey: false, hasUrl: false, owner: true })).toBe("voice.reason.needsKey");
    expect(voiceOptionReason(elevenlabs, { hasKey: true, hasUrl: false, owner: true })).toBeNull();
    expect(voiceOptionReason(elevenlabs, { hasKey: true, hasUrl: false, owner: false })).toBe("voice.reason.ownerOnly");
  });

  it("wants a URL from the self-hosted engine and not from the hosted ones", () => {
    const options = voiceOptions({});
    expect(options.find((option) => option.id === "chatterbox")!.needsUrl).toBe(true);
    expect(options.find((option) => option.id === "elevenlabs")!.needsUrl).toBe(false);
  });
});
