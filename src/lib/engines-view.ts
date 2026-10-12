// Engines & accounts, connections, models, usage and voice: the pure layer.
//
// Mockup 10 is a settings screen, and a settings screen is mostly a wording
// decision wearing a card. What each engine *is* (ready, needs a CLI, waiting
// on a person in another window), what each credential row *is* (configured,
// testable, clearable), what the month's usage adds up to, and which voice
// engines this machine can actually run are all derivable here.
//
// Nothing in this file talks to the server. It cannot install a CLI, sign
// anyone in, store a key or set a price — it decides what the screen says and
// which controls it offers, and the actions stay in the components.

import type { LocaleKey } from "@/locales";
import type { TaskUsage } from "@/state/store";
import { cachedInput, formatTokens, formatUsd, hasFiniteCost, sumUsage } from "@/lib/usage";

// ── Engines ─────────────────────────────────────────────────────────────────

export type EngineState = "ready" | "setup" | "attention";

/** The fields of an `InstanceInfo` these two functions read. Narrowed on
 *  purpose: the rule is about state and access, and a test can say so in four
 *  lines instead of building an instance. */
export interface EngineCardInput {
  access?: string;
  snapshot: {
    state: string;
    authenticated?: boolean;
    version?: string | null;
    account?: { email?: string } | null;
  };
}

/** Ready means the same thing it means in a real turn: the binary is there and
 *  the workspace is allowed to use it. `access === "custom"` skips the auth
 *  gate because a custom binary brings its own credentials. */
export function engineReady(instance: EngineCardInput): boolean {
  return instance.snapshot.state === "available" &&
    (instance.access === "custom" || instance.snapshot.authenticated !== false);
}

/** Four states, and the fourth is the one the mockup misses: an engine that is
 *  available but whose version moved under us, or that is warning, is not
 *  "ready" in the sense of "nothing to do here". */
export function engineStateView(instance: EngineCardInput, options: { update?: unknown; warning?: unknown } = {}): {
  state: EngineState;
  labelKey: LocaleKey;
  tone: "connected" | "attention" | "muted";
} {
  if (engineReady(instance)) {
    if (options.warning) return { state: "attention", labelKey: "engines.state.warning", tone: "attention" };
    if (options.update) return { state: "attention", labelKey: "engines.state.update", tone: "attention" };
    return { state: "ready", labelKey: "onboarding.engines.ready", tone: "connected" };
  }
  if (instance.snapshot.state === "unavailable") return { state: "setup", labelKey: "engines.state.notFound", tone: "attention" };
  if (instance.snapshot.authenticated === false) return { state: "setup", labelKey: "engines.state.signIn", tone: "muted" };
  return { state: "setup", labelKey: "onboarding.engines.needsSetup", tone: "muted" };
}

const PROVIDERS: Record<string, string> = {
  claudeAgent: "Anthropic", codex: "OpenAI", grok: "xAI", grokAgent: "xAI",
  kimiAgent: "Moonshot AI", droidAgent: "Factory", cursorAgent: "Cursor",
  antigravityAgent: "Google", opencodeGo: "OpenCode", qwenAgent: "Qwen",
  hermesAgent: "Nous Research", piAgent: "pi.dev",
};

/** The engine card's second line: who is signed in, or who makes this engine.
 *  Never a duplicated label such as "Grok · grok" — some CLIs return their own
 *  executable name as a version. */
export function engineCardSubtitle(
  instance: EngineCardInput & { driverKind: string },
  options: { accounts?: number } = {},
): string {
  if (options.accounts && options.accounts > 1) return `${options.accounts} accounts`;
  const email = instance.snapshot?.authenticated === true ? instance.snapshot.account?.email : undefined;
  if (email) return email;
  if (instance.access === "custom") return "Custom";
  return PROVIDERS[instance.driverKind] ?? instance.driverKind;
}

/** A CLI's reported version, minus the part that is just its own name. */
export function engineVersionLabel(version?: string | null): string | null {
  return version?.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?/)?.[0] ?? null;
}

// ── Connections ─────────────────────────────────────────────────────────────

export interface ConnectionRow {
  /** the server told us this credential exists; its value never comes back */
  configured: boolean;
  /** the key can be tried against the provider from here */
  testable: boolean;
  /** the row is not a secret (a base URL, an SSH alias) */
  optional: boolean;
}

/** What a credential row offers. A saved key is never shown again, so the row
 *  offers exactly three things: test it, replace it, clear it — and the field
 *  itself is write-only. An unconfigured row offers none of them, because all
 *  three need something to act on. */
export function connectionActions(row: ConnectionRow): {
  test: boolean;
  replace: boolean;
  clear: boolean;
} {
  return {
    test: row.configured && row.testable,
    replace: true,
    clear: row.configured,
  };
}

/** The dot and the word beside a credential's label. "Configured" is the
 *  honest word: it says the server holds a value, which is all anyone can
 *  verify about a secret that is never sent back. */
export function connectionState(configured: boolean): { labelKey: LocaleKey; tone: "connected" | "muted" } {
  return configured
    ? { labelKey: "connections.configured", tone: "connected" }
    : { labelKey: "connections.notConfigured", tone: "muted" };
}

// ── Usage ───────────────────────────────────────────────────────────────────

/** The three numbers the header shows: what it cost, how much it moved, and
 *  how much of that was cache reads. Cached input is reported separately
 *  because it is the cheapest token in the bill and the one people most often
 *  cannot see.
 *
 *  Cost stays null until one row actually has a figure: a workspace on a
 *  subscription has none, and "$0.00" would read as "this was free". */
export function usageHeadline(usages: TaskUsage[]): {
  costUsd: number | null;
  tokens: number;
  cachedInput: number;
  turns: number;
} {
  const total = sumUsage(usages);
  return {
    costUsd: total.costUsd,
    tokens: total.input + total.output,
    cachedInput: cachedInput(total),
    turns: total.turns,
  };
}

export function usageHeadlineCost(headline: { costUsd: number | null }): string {
  return hasFiniteCost(headline.costUsd) ? formatUsd(headline.costUsd) : "\u2014";
}

export function usageHeadlineTokens(tokens: number): string {
  return formatTokens(tokens);
}

// ── Voice ───────────────────────────────────────────────────────────────────

export type VoiceEngine = "elevenlabs" | "fish" | "system" | "chatterbox";

export interface VoiceOption {
  id: VoiceEngine;
  labelKey: LocaleKey;
  /** a workspace secret this engine needs before it can speak */
  needsKey: boolean;
  /** the machine has to be able to reach its server */
  needsUrl: boolean;
}

/** The voice engines in the order the card offers them. `system` is the
 *  built-in Mac voice and is only ever offered where the host can run it —
 *  the call site passes that in rather than deciding it here. */
export function voiceOptions(input: { hostPlatform?: string }): VoiceOption[] {
  const options: VoiceOption[] = [
    { id: "elevenlabs", labelKey: "voice.provider.elevenlabs", needsKey: true, needsUrl: false },
    { id: "fish", labelKey: "voice.provider.fish", needsKey: true, needsUrl: false },
  ];
  if (input.hostPlatform === "darwin") {
    options.splice(1, 0, { id: "system", labelKey: "voice.provider.system", needsKey: false, needsUrl: false });
  }
  options.push({ id: "chatterbox", labelKey: "voice.provider.chatterbox", needsKey: false, needsUrl: true });
  return options;
}

/** Whether a provider can be selected at all right now. A hosted voice engine
 *  with no key would fail on the next reply, so it stays offered but says why,
 *  the way the engine picker does. */
export function voiceOptionReason(option: VoiceOption, input: { hasKey: boolean; hasUrl: boolean; owner: boolean }): string | null {
  if (!input.owner) return "voice.reason.ownerOnly";
  if (option.needsKey && !input.hasKey) return "voice.reason.needsKey";
  if (option.needsUrl && !input.hasUrl) return "voice.reason.needsUrl";
  return null;
}
