// The Automations screen's pure layer: the recurrence menu the editor offers,
// the header's counts, the recent-runs strip, and the states a scheduled call
// can be in.
//
// Everything here is derived from data the app already has — the store's
// routines and runs, the desktop capabilities. Nothing in this file talks to
// the server, so nothing in it can create, pause or delete an automation: it
// decides what the page *says* and which controls it offers, and the actions
// themselves stay in the components.

import type { LocaleKey } from "@/locales";
import type { CalendarCall } from "@/lib/calendar-calls";
import type { Routine, RoutineRun, RoutineRunStatus } from "@/lib/routines";

/** The three days across the top of the schedule, and the three ranges the
 *  week grid can be read at. Day is 1, three-day is 3, week is 7. */
export type ScheduleRangeDays = 1 | 3 | 7;

/** The automation type tabs. A remote client that suppresses calls and
 *  webhooks renders `schedule` under its own label; the tab set itself is the
 *  same function, so a tab cannot disappear without the reason being passed in
 *  rather than hard-coded at the call site. */
export type AutomationSection = "schedule" | "logs" | "webhooks";

export interface AutomationTab {
  id: AutomationSection;
  labelKey: LocaleKey;
  /** A count badge beside the label, when there is something to count. */
  badge?: number;
}

export function automationTabs(input: {
  section: AutomationSection;
  /** Routines-only usage (the remote client) suppresses calls and webhooks. */
  routinesOnly: boolean;
  unseenFailures: number;
  webhookCount: number;
}): AutomationTab[] {
  const tabs: AutomationTab[] = [
    {
      id: "schedule",
      labelKey: input.routinesOnly ? "automations.tab.routines" : "automations.tab.schedule",
      ...(input.unseenFailures > 0 ? { badge: input.unseenFailures } : {}),
    },
    { id: "logs", labelKey: "automations.tab.logs", ...(input.unseenFailures > 0 ? { badge: input.unseenFailures } : {}) },
  ];
  if (!input.routinesOnly) {
    tabs.push({
      id: "webhooks",
      labelKey: "automations.tab.webhooks",
      ...(input.webhookCount > 0 ? { badge: input.webhookCount } : {}),
    });
  }
  return tabs;
}

/** What the header's two chips count, and whether they are worth showing.
 *  A chip with nothing behind it is noise; the old header only rendered the
 *  paused chip when paused existed, and that behaviour is kept here. */
export interface AutomationCounts {
  running: number;
  paused: number;
  unseenFailures: number;
  webhooks: number;
  visibleBots: number;
  routines: number;
}

export function automationCounts(input: {
  routines: Routine[];
  runs: RoutineRun[];
  webhooks: number;
  visibleBots: number;
}): AutomationCounts {
  const paused = input.routines.filter((routine) => !routine.enabled).length;
  const running = input.runs.filter((run) => ["queued", "running", "waiting"].includes(run.status)).length;
  const unseenFailures = input.runs.filter((run) => (run.status === "failed" || run.status === "missed") && !run.seenAt).length;
  return {
    running,
    paused,
    unseenFailures,
    webhooks: input.webhooks,
    visibleBots: input.visibleBots,
    routines: input.routines.length,
  };
}

/** The recurrence choices the editor offers, in the order it offers them.
 *  These are the nine the mockup draws as the recurrence popover: once, an
 *  interval, daily, weekdays, weekly, selected days, monthly, yearly and raw
 *  cron. The value strings are the app's own `RecurrenceChoice`. */
export type RecurrenceChoice =
  | "none"
  | "interval"
  | "daily"
  | "weekdays"
  | "weekly"
  | "custom"
  | "monthly"
  | "yearly"
  | "cron";

export interface RecurrenceOption {
  id: RecurrenceChoice;
  labelKey: LocaleKey;
}

/** A call only understands once, daily, weekly and selected weekdays — it has
 *  no interval or cron, because a call is a moment, not a cadence. The editor
 *  hides the unsupported choices rather than offering something it would then
 *  refuse to save. */
export function recurrenceOptions(input: { kind: "routine" | "call" }): RecurrenceOption[] {
  const shared: RecurrenceOption[] = [
    { id: "none", labelKey: "automations.recurrence.once" },
    ...(input.kind === "routine"
      ? [{ id: "interval" as const, labelKey: "automations.recurrence.everyMinutes" as LocaleKey }]
      : []),
    { id: "daily", labelKey: "automations.recurrence.daily" },
    { id: "weekdays", labelKey: "automations.recurrence.weekdays" },
    { id: "weekly", labelKey: "automations.recurrence.weekly" },
    { id: "custom", labelKey: "automations.recurrence.selectedDays" },
    ...(input.kind === "routine"
      ? [
          { id: "monthly" as const, labelKey: "automations.recurrence.monthly" as LocaleKey },
          { id: "yearly" as const, labelKey: "automations.recurrence.yearly" as LocaleKey },
          { id: "cron" as const, labelKey: "automations.recurrence.customCron" as LocaleKey },
        ]
      : []),
  ];
  return shared;
}

// ---------------------------------------------------------------------------
// Recent runs
// ---------------------------------------------------------------------------

export type RecentRunTone = "neutral" | "good" | "busy" | "bad";

export interface RecentRunRow {
  run: RoutineRun;
  title: string;
  /** The chip's translated label, e.g. "Failed". */
  statusKey: LocaleKey;
  tone: RecentRunTone;
  /** A bot or group name for the " · Atlas" in the row, or null when the
   *  owner is gone (a deleted bot) and the row should not name it. */
  ownerName: string | null;
  botId: string;
  /** Short relative age — "3m ago" — or null when the run has no time yet. */
  age: string | null;
  formatted: string;
  hasExecution: boolean;
}

const RUN_STATUS_KEYS: Record<RoutineRunStatus, LocaleKey> = {
  queued: "routines.status.queued",
  running: "routines.status.running",
  waiting: "routines.status.waiting",
  completed: "routines.status.completed",
  failed: "routines.status.failed",
  missed: "routines.status.missed",
  cancelled: "routines.status.cancelled",
};

const RUN_TONES: Record<RoutineRunStatus, RecentRunTone> = {
  queued: "neutral",
  running: "busy",
  waiting: "busy",
  completed: "good",
  failed: "bad",
  missed: "bad",
  cancelled: "neutral",
};

function minutesAgo(at: number, now: number): number {
  return Math.max(0, Math.round((now - at) / 60_000));
}

/** "3m ago" / "2h ago" / "just now". A run with a future or absent time gets
 *  null rather than a negative age. */
export function relativeAge(at: number | null, now: number): string | null {
  if (at == null) return null;
  const minutes = minutesAgo(at, now);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * The recent-runs strip under the calendar. It is a *receipt*, not an
 * inbox: it shows the latest run per routine that has one, newest first, and
 * it never invents a destination. A run whose execution thread is gone gets
 * `hasExecution: false` so the row can omit "Open execution" rather than
 * offering a link that goes nowhere.
 */
export function recentRunRows(input: {
  runs: RoutineRun[];
  bots: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
  limit?: number;
  now?: number;
}): RecentRunRow[] {
  const now = input.now ?? Date.now();
  const limit = input.limit ?? 6;
  const botName = new Map(input.bots.map((bot) => [bot.id, bot.name]));
  const groupName = new Map(input.groups.map((group) => [group.id, group.name]));

  const latestPerKey = new Map<string, RoutineRun>();
  for (const run of input.runs) {
    const key = run.routineId;
    const seen = latestPerKey.get(key);
    if (!seen || run.scheduledFor > seen.scheduledFor) latestPerKey.set(key, run);
  }

  return [...latestPerKey.values()]
    .sort((left, right) => right.scheduledFor - left.scheduledFor)
    .slice(0, limit)
    .map((run) => {
      const ownerName = run.target === "room-goal" && run.groupId ? groupName.get(run.groupId) ?? null : botName.get(run.botId) ?? null;
      return {
        run,
        title: run.routineName ?? "Routine",
        statusKey: RUN_STATUS_KEYS[run.status],
        tone: RUN_TONES[run.status],
        ownerName,
        botId: run.botId,
        age: relativeAge(run.finishedAt ?? run.scheduledFor, now),
        formatted: new Date(run.scheduledFor).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
        hasExecution: Boolean(run.executionThreadId ?? run.threadId),
      };
    });
}

// ---------------------------------------------------------------------------
// Scheduled calls
// ---------------------------------------------------------------------------

export type CallAvailability = { available: true } | { available: false; reasonKey: LocaleKey };

/** Whether this device can place a scheduled call. Linux has no supported
 *  direct-call path today, so the entry stays in the header and explains
 *  itself rather than vanishing — a missing button reads as a missing feature,
 *  a disabled one with a reason reads as a boundary. */
export function callAvailability(input: { host: string | undefined; callsSupported: boolean }): CallAvailability {
  if (input.callsSupported) return { available: true };
  if (input.host === "linux") {
    return { available: false, reasonKey: "automations.callUnavailableLinux" };
  }
  return { available: false, reasonKey: "automations.callUnavailableHost" };
}

/** Why the "keep the computer awake" switch may be off-limits, or null when
 *  the app may offer it. The switch itself stays at the page level, next to
 *  the scheduler it belongs to; this only supplies its caption. */
export function keepAwakeNote(input: { supported: boolean }): LocaleKey | null {
  return input.supported ? null : "automations.keepAwakeUnavailable";
}

// ---------------------------------------------------------------------------
// Bot filter
// ---------------------------------------------------------------------------

export const ALL_BOTS = "all";

/** The bot filter's options, with `all` first. Hidden bots never appear — a
 *  schedule cannot be created for a bot that is not running. The `all` entry
 *  carries no name: it is a sentinel, and the caller labels it. */
export function botFilterOptions(bots: Array<{ id: string; name: string }>): Array<{ id: string; name: string | null }> {
  return [{ id: ALL_BOTS, name: null }, ...bots.map((bot) => ({ id: bot.id, name: bot.name }))];
}

/** Does this routine belong under the chosen filter? */
export function matchesBotFilter(input: { botId: string; filter: string }): boolean {
  return input.filter === ALL_BOTS || input.botId === input.filter;
}

/** Calls can invite several bots; a call is kept when the filter is `all` or
 *  when any invited bot is the one being filtered to. */
export function callMatchesBotFilter(call: CalendarCall, filter: string): boolean {
  return filter === ALL_BOTS || call.botIds.includes(filter);
}