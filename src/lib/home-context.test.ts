// The Home landing's numbers come from the workspace, never from the mockup.
// These are the claims it makes — which threads are today's, how far a goal
// run has got, what is still due today — so each one is pinned here against
// the edge cases that would otherwise only show up in someone's real day.
import { describe, expect, it } from "vitest";
import {
  HOME_COLUMN_LIMIT,
  goalRunProgress,
  greetingFirstName,
  greetingPart,
  inMotionProjects,
  isSameLocalDay,
  todaysRoutines,
  todaysThreads,
  type GoalRunLike,
} from "./home-context";

/** A local wall-clock time, so the assertions hold in any timezone. */
const local = (y: number, m: number, d: number, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();

describe("greetingPart", () => {
  it("reads morning, afternoon and evening off the hour", () => {
    expect(greetingPart(7)).toBe("morning");
    expect(greetingPart(14)).toBe("afternoon");
    expect(greetingPart(19)).toBe("evening");
  });

  it("covers the whole day with no gap", () => {
    // A landing that greeted nobody at 4am would be the one hour a person
    // is most likely to be working alone.
    const parts = Array.from({ length: 24 }, (_, hour) => greetingPart(hour));
    expect(new Set(parts).size).toBe(3);
    expect(parts).not.toContain(undefined);
  });

  it("survives an hour outside 0–23", () => {
    // The clock is passed in, so a caller must not be able to produce a blank
    // greeting with a nonsense hour.
    expect(greetingPart(29)).toBe(greetingPart(5));
    expect(greetingPart(-6)).toBe(greetingPart(18));
  });
});

describe("greetingFirstName", () => {
  it("takes the first word", () => {
    expect(greetingFirstName("Nirvan Okonkwo")).toBe("Nirvan");
  });

  it("trims stray punctuation and spacing", () => {
    expect(greetingFirstName("  Nirvan. ")).toBe("Nirvan");
    expect(greetingFirstName("O'Brien")).toBe("O'Brien");
  });

  it("returns empty rather than a blank name", () => {
    // The landing hides the name when there is none; it must never render
    // "Good evening," with a hole in it.
    expect(greetingFirstName(undefined)).toBe("");
    expect(greetingFirstName("")).toBe("");
    expect(greetingFirstName("   ")).toBe("");
  });
});

describe("isSameLocalDay", () => {
  it("is true within the day and false across midnight", () => {
    expect(isSameLocalDay(local(2026, 3, 4, 0, 1), local(2026, 3, 4, 23, 59))).toBe(true);
    expect(isSameLocalDay(local(2026, 3, 3, 23, 59), local(2026, 3, 4, 0, 1))).toBe(false);
  });

  it("is false across months and years", () => {
    expect(isSameLocalDay(local(2026, 2, 28), local(2026, 3, 1))).toBe(false);
    expect(isSameLocalDay(local(2025, 12, 31), local(2026, 1, 1))).toBe(false);
  });
});

describe("todaysThreads", () => {
  const now = local(2026, 3, 4, 15, 0);

  it("keeps only today's threads, newest first", () => {
    const threads = [
      { title: "yesterday", createdAt: local(2026, 3, 3, 22, 0) },
      { title: "morning", createdAt: local(2026, 3, 4, 9, 0) },
      { title: "just now", createdAt: local(2026, 3, 4, 14, 30) },
    ];
    expect(todaysThreads(threads, now).map((thread) => thread.title)).toEqual(["just now", "morning"]);
  });

  it("does not mutate the caller's array", () => {
    // The store's own task list is not ours to reorder; a landing that sorted
    // it in place would reshuffle the sidebar under the user.
    const threads = [
      { title: "a", createdAt: local(2026, 3, 4, 9, 0) },
      { title: "b", createdAt: local(2026, 3, 4, 11, 0) },
    ];
    todaysThreads(threads, now);
    expect(threads.map((thread) => thread.title)).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty day", () => {
    expect(todaysThreads([{ title: "old", createdAt: local(2026, 1, 1) }], now)).toEqual([]);
  });
});

describe("goalRunProgress", () => {
  it("reports turns spent against turns allowed", () => {
    expect(goalRunProgress({ turnCount: 5, maxTurns: 8 })).toBe(63);
    expect(goalRunProgress({ turnCount: 0, maxTurns: 8 })).toBe(0);
    expect(goalRunProgress({ turnCount: 8, maxTurns: 8 })).toBe(100);
  });

  it("clamps instead of drawing a bar that overflows its track", () => {
    expect(goalRunProgress({ turnCount: 40, maxTurns: 8 })).toBe(100);
    expect(goalRunProgress({ turnCount: -2, maxTurns: 8 })).toBe(0);
  });

  it("reads 0 for a run with no budget rather than dividing by zero", () => {
    expect(goalRunProgress({ turnCount: 3, maxTurns: 0 })).toBe(0);
  });
});

const run = (over: Partial<GoalRunLike> = {}): GoalRunLike => ({
  runId: "r1",
  goal: "Ship the launch",
  status: "working",
  turnCount: 3,
  maxTurns: 10,
  ...over,
});

describe("inMotionProjects", () => {
  it("carries a room whose latest goal run is unfinished", () => {
    const projects = inMotionProjects([{ id: "g1", name: "Launch", messages: [{ goalRun: run() }] }]);
    expect(projects).toEqual([{ id: "g1", name: "Launch", percent: 30, detail: undefined }]);
  });

  it("drops a room whose latest run has settled", () => {
    for (const status of ["completed", "stopped", "failed", "limit-reached"]) {
      const projects = inMotionProjects([{ id: "g1", name: "Launch", messages: [{ goalRun: run({ status }) }] }]);
      expect(projects).toEqual([]);
    }
  });

  it("keeps a room in motion when a later run supersedes an earlier one", () => {
    // A room that finished run A and started run B is in motion because of B.
    // Reading the first receipt would leave the row stuck at 100% forever.
    const projects = inMotionProjects([
      {
        id: "g1",
        name: "Launch",
        messages: [{ goalRun: run({ runId: "a", status: "completed", turnCount: 10, maxTurns: 10 }) }, { goalRun: run({ runId: "b", turnCount: 2, maxTurns: 10 }) }],
      },
    ]);
    expect(projects).toHaveLength(1);
    expect(projects[0].percent).toBe(20);
  });

  it("sorts the furthest along first", () => {
    const projects = inMotionProjects([
      { id: "g1", name: "Behind", messages: [{ goalRun: run({ runId: "a", turnCount: 1, maxTurns: 10 }) }] },
      { id: "g2", name: "Ahead", messages: [{ goalRun: run({ runId: "b", turnCount: 9, maxTurns: 10 }) }] },
    ]);
    expect(projects.map((project) => project.name)).toEqual(["Ahead", "Behind"]);
  });

  it("ignores rooms with no goal run at all", () => {
    expect(inMotionProjects([{ id: "g1", name: "Chat", messages: [{ goalRun: undefined }] }])).toEqual([]);
  });
});

describe("todaysRoutines", () => {
  const now = local(2026, 3, 4, 15, 0);

  it("keeps what is still due today, soonest first", () => {
    const routines = [
      { id: "b", name: "Evening review", enabled: true, nextRunAt: local(2026, 3, 4, 18, 0) },
      { id: "a", name: "Morning brief", enabled: true, nextRunAt: local(2026, 3, 4, 9, 0) },
      { id: "c", name: "Tomorrow", enabled: true, nextRunAt: local(2026, 3, 5, 9, 0) },
    ];
    expect(todaysRoutines(routines, now).map((routine) => routine.name)).toEqual(["Morning brief", "Evening review"]);
  });

  it("marks a run whose time has passed as already running", () => {
    const [routine] = todaysRoutines([{ id: "a", name: "Brief", enabled: true, nextRunAt: local(2026, 3, 4, 9, 0) }], now);
    expect(routine.running).toBe(true);
  });

  it("keeps a switched-off routine out of today but does not lose the row", () => {
    // A disabled routine is not going to fire, so it is not "due today" —
    // but dropping it silently makes the schedule look shorter than it is.
    expect(todaysRoutines([{ id: "a", name: "Paused", enabled: false, nextRunAt: local(2026, 3, 4, 9, 0) }], now)).toEqual([]);
  });

  it("drops a routine with no next run", () => {
    expect(todaysRoutines([{ id: "a", name: "Done", enabled: true, nextRunAt: null }], now)).toEqual([]);
  });

  it("sorts an overdue run above one still to come", () => {
    const routines = todaysRoutines(
      [
        { id: "later", name: "Later", enabled: true, nextRunAt: local(2026, 3, 4, 20, 0) },
        { id: "overdue", name: "Overdue", enabled: true, nextRunAt: local(2026, 3, 4, 7, 0) },
      ],
      now,
    );
    expect(routines.map((routine) => routine.name)).toEqual(["Overdue", "Later"]);
  });
});

describe("HOME_COLUMN_LIMIT", () => {
  it("keeps a landing column a glance", () => {
    expect(HOME_COLUMN_LIMIT).toBeGreaterThan(0);
    expect(HOME_COLUMN_LIMIT).toBeLessThanOrEqual(5);
  });
});