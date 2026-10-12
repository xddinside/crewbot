import { describe, expect, it } from "vitest";

import {
  ALL_BOTS,
  automationCounts,
  automationTabs,
  botFilterOptions,
  callAvailability,
  callMatchesBotFilter,
  keepAwakeNote,
  matchesBotFilter,
  recentRunRows,
  recurrenceOptions,
  relativeAge,
} from "@/lib/automations-view";
import type { CalendarCall } from "@/lib/calendar-calls";
import type { Routine, RoutineRun } from "@/lib/routines";

function routine(patch: Partial<Routine> = {}): Routine {
  return {
    id: "r1",
    name: "Morning brief",
    prompt: "",
    target: "bot",
    botId: "atlas",
    runOn: "maus",
    enabled: true,
    schedule: { type: "daily", time: "09:00", weekdays: [1] },
    durationMinutes: 30,
    nextRunAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

function run(patch: Partial<RoutineRun> = {}): RoutineRun {
  return {
    id: "run1",
    routineId: "r1",
    routineName: "Morning brief",
    target: "bot",
    botId: "atlas",
    runOn: "maus",
    scheduledFor: 1_000,
    createdAt: 1_000,
    status: "completed",
    manual: false,
    ...patch,
  };
}

describe("automations tabs", () => {
  it("offers schedule, logs and webhooks, and suppresses the last two for a remote client", () => {
    expect(automationTabs({ section: "schedule", routinesOnly: false, unseenFailures: 0, webhookCount: 0 }).map((tab) => tab.id)).toEqual([
      "schedule",
      "logs",
      "webhooks",
    ]);
    expect(
      automationTabs({ section: "schedule", routinesOnly: true, unseenFailures: 0, webhookCount: 3 }).map((tab) => tab.id),
    ).toEqual(["schedule", "logs"]);
  });

  it("labels the schedule tab by what this client actually offers", () => {
    const tabs = automationTabs({ section: "schedule", routinesOnly: true, unseenFailures: 0, webhookCount: 0 });
    expect(tabs[0].labelKey).toBe("automations.tab.routines");
    expect(automationTabs({ section: "schedule", routinesOnly: false, unseenFailures: 0, webhookCount: 0 })[0].labelKey).toBe(
      "automations.tab.schedule",
    );
  });

  it("badges unseen failures on both tabs that can reach them, and webhooks with their own count", () => {
    const tabs = automationTabs({ section: "schedule", routinesOnly: false, unseenFailures: 2, webhookCount: 4 });
    expect(tabs[0].badge).toBe(2);
    expect(tabs[1].badge).toBe(2);
    expect(tabs[2].badge).toBe(4);
  });
});

describe("automation counts", () => {
  it("counts only unseen failed or missed runs as failures", () => {
    const counts = automationCounts({
      routines: [routine(), routine({ id: "r2", enabled: false }), routine({ id: "r3", enabled: false })],
      runs: [
        run({ id: "a", status: "failed" }),
        run({ id: "b", status: "missed", seenAt: 5 }),
        run({ id: "c", status: "failed", seenAt: 5 }),
        run({ id: "d", status: "completed" }),
        run({ id: "e", status: "running" }),
        run({ id: "f", status: "queued" }),
      ],
      webhooks: 1,
      visibleBots: 4,
    });
    expect(counts.unseenFailures).toBe(1);
    expect(counts.paused).toBe(2);
    expect(counts.running).toBe(2);
    expect(counts.webhooks).toBe(1);
  });

  it("reports zero rather than a negative count for an empty workspace", () => {
    const counts = automationCounts({ routines: [], runs: [], webhooks: 0, visibleBots: 0 });
    expect(counts).toMatchObject({ paused: 0, running: 0, unseenFailures: 0, routines: 0 });
  });
});

describe("recurrence options", () => {
  it("offers the full set for a routine, in the order the editor shows it", () => {
    expect(recurrenceOptions({ kind: "routine" }).map((option) => option.id)).toEqual([
      "none",
      "interval",
      "daily",
      "weekdays",
      "weekly",
      "custom",
      "monthly",
      "yearly",
      "cron",
    ]);
  });

  it("withholds interval and cron from a call, which is a moment rather than a cadence", () => {
    const ids = recurrenceOptions({ kind: "call" }).map((option) => option.id);
    expect(ids).not.toContain("interval");
    expect(ids).not.toContain("cron");
    expect(ids).toEqual(["none", "daily", "weekdays", "weekly", "custom"]);
  });
});

describe("relative age", () => {
  it("reads as just now, minutes, hours or days rather than a raw timestamp", () => {
    const now = 10_000_000;
    expect(relativeAge(now, now)).toBe("just now");
    expect(relativeAge(now - 3 * 60_000, now)).toBe("3m ago");
    expect(relativeAge(now - 2 * 3_600_000, now)).toBe("2h ago");
    expect(relativeAge(now - 3 * 86_400_000, now)).toBe("3d ago");
  });

  it("returns null when there is no time to describe", () => {
    expect(relativeAge(null, Date.now())).toBeNull();
  });
});

describe("recent runs", () => {
  const bots = [
    { id: "atlas", name: "Atlas" },
    { id: "nova", name: "Nova" },
  ];
  const groups = [{ id: "room", name: "Launch v1.0" }];

  it("keeps the newest run per routine and sorts that by schedule time", () => {
    const rows = recentRunRows({
      bots,
      groups,
      now: 10_000_000,
      runs: [
        run({ id: "old", scheduledFor: 1_000 }),
        run({ id: "new", scheduledFor: 5_000 }),
        run({ id: "mid", routineId: "r2", routineName: "Launch copy", scheduledFor: 3_000, status: "failed" }),
      ],
    });
    expect(rows.map((row) => row.title)).toEqual(["Morning brief", "Launch copy"]);
    expect(rows[0].run.id).toBe("new");
    expect(rows[1].tone).toBe("bad");
  });

  it("names the owning bot, and names nothing rather than guessing when it is gone", () => {
    const rows = recentRunRows({
      bots,
      groups,
      now: 10_000_000,
      runs: [run({ id: "a", scheduledFor: 2_000 }), run({ id: "b", routineId: "r2", botId: "deleted", scheduledFor: 1_000 })],
    });
    expect(rows[0].ownerName).toBe("Atlas");
    expect(rows[1].ownerName).toBeNull();
  });

  it("names the group for a team goal rather than its lead", () => {
    const rows = recentRunRows({
      bots,
      groups,
      runs: [run({ target: "room-goal", groupId: "room", botId: "atlas" })],
    });
    expect(rows[0].ownerName).toBe("Launch v1.0");
  });

  it("marks a run whose execution thread is gone so the row can omit the link", () => {
    const rows = recentRunRows({
      bots,
      groups,
      runs: [run({ threadId: "exec" }), run({ id: "b", routineId: "r2", scheduledFor: 2_000 })],
    });
    expect(rows.find((row) => row.run.id === "run1")?.hasExecution).toBe(true);
    expect(rows.find((row) => row.run.id === "b")?.hasExecution).toBe(false);
  });

  it("keeps a missed run visible rather than dropping it as empty", () => {
    const rows = recentRunRows({ bots, groups, runs: [run({ status: "missed" })] });
    expect(rows).toHaveLength(1);
    expect(rows[0].tone).toBe("bad");
    expect(rows[0].statusKey).toBe("routines.status.missed");
  });

  it("honours its limit", () => {
    const rows = recentRunRows({
      bots,
      groups,
      limit: 2,
      runs: [
        run({ id: "a", scheduledFor: 1 }),
        run({ id: "b", routineId: "r2", scheduledFor: 2 }),
        run({ id: "c", routineId: "r3", scheduledFor: 3 }),
      ],
    });
    expect(rows).toHaveLength(2);
  });

  it("does not invent a destination for a run that never happened", () => {
    expect(recentRunRows({ bots, groups, runs: [] })).toEqual([]);
  });
});

describe("scheduled call availability", () => {
  it("names Linux as the reason instead of hiding the entry", () => {
    expect(callAvailability({ host: "linux", callsSupported: false })).toEqual({
      available: false,
      reasonKey: "automations.callUnavailableLinux",
    });
  });

  it("allows the entry when the host really supports it", () => {
    expect(callAvailability({ host: "mac", callsSupported: true })).toEqual({ available: true });
  });

  it("still explains itself on a host we do not recognise", () => {
    expect(callAvailability({ host: "haiku", callsSupported: false }).available).toBe(false);
  });
});

describe("keep awake note", () => {
  it("returns null when the switch may be offered and the key when it may not", () => {
    expect(keepAwakeNote({ supported: true })).toBeNull();
    expect(keepAwakeNote({ supported: false })).toBe("automations.keepAwakeUnavailable");
  });
});

describe("bot filter", () => {
  it("lists every bot, with the unnamed all-sentinel first", () => {
    expect(botFilterOptions([{ id: "atlas", name: "Atlas" }])).toEqual([
      { id: ALL_BOTS, name: null },
      { id: "atlas", name: "Atlas" },
    ]);
  });

  it("keeps a routine under all, and only under its own bot otherwise", () => {
    expect(matchesBotFilter({ botId: "atlas", filter: ALL_BOTS })).toBe(true);
    expect(matchesBotFilter({ botId: "atlas", filter: "nova" })).toBe(false);
    expect(matchesBotFilter({ botId: "atlas", filter: "atlas" })).toBe(true);
  });

  it("keeps a multi-bot call when any invited bot is the one being filtered to", () => {
    const call = { id: "c", name: "Standup", description: "", botIds: ["atlas", "nova"], durationMinutes: 30, createdAt: 0, schedule: { type: "daily" as const, time: "09:00", weekdays: [1] } } as CalendarCall;
    expect(callMatchesBotFilter(call, "nova")).toBe(true);
    expect(callMatchesBotFilter(call, "sage")).toBe(false);
    expect(callMatchesBotFilter(call, ALL_BOTS)).toBe(true);
  });
});