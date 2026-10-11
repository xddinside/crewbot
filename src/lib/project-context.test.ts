import { describe, expect, it } from "vitest";

import {
  PROJECT_COLUMN_LIMIT,
  projectGoal,
  projectList,
  upNext,
  type ProjectLike,
} from "./project-context";

const room = (patch: Partial<ProjectLike> = {}): ProjectLike => ({
  id: "room-launch",
  name: "Launch v1.0",
  createdAt: 1,
  ...patch,
});

describe("projectList", () => {
  it("gives a room with conversations a row for each of them", () => {
    const entries = projectList({
      groups: [
        room({
          tasks: [
            { threadId: "t-1", title: "Website redesign", createdAt: 2 },
            { threadId: "t-2", title: "Investor update", createdAt: 3 },
          ],
        }),
      ],
      currentGroupId: "room-launch",
      currentThreadId: "t-2",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].current).toBe(true);
    expect(
      entries[0].threads.map((thread) => [thread.title, thread.current]),
    ).toEqual([
      ["Website redesign", false],
      ["Investor update", true],
    ]);
  });

  it("gives a room with no conversations one row — itself", () => {
    const entries = projectList({
      groups: [room()],
      currentGroupId: "room-launch",
      currentThreadId: "thread-only",
    });
    expect(entries[0].threads).toEqual([
      {
        threadId: "thread-only",
        title: "Launch v1.0",
        current: true,
        unread: false,
        queued: false,
      },
    ]);
  });

  it("leaves the bot⇄bot channel out — it is machinery, not a project", () => {
    const entries = projectList({
      groups: [room({ dm: true }), room({ id: "room-ops", name: "Ops" })],
    });
    expect(entries.map((entry) => entry.name)).toEqual(["Ops"]);
  });

  it("marks the unread and the queued conversations, and only there", () => {
    const entries = projectList({
      groups: [
        room({
          unread: true,
          tasks: [
            { threadId: "t-1", title: "Mobile app", createdAt: 2 },
            { threadId: "t-2", title: "Website redesign", createdAt: 3 },
          ],
        }),
      ],
      currentGroupId: "room-launch",
      currentThreadId: "t-2",
      pendingQueued: { "t-1": [{ id: "q" }] as never },
    });
    const [first, second] = entries[0].threads;
    // unread follows the room onto the conversation actually on screen
    expect([first.unread, second.unread]).toEqual([false, true]);
    expect([first.queued, second.queued]).toEqual([true, false]);
  });
});

describe("projectGoal", () => {
  it("reports the last run, not the sum of every run", () => {
    const goal = projectGoal([
      {
        goalRun: {
          runId: "a",
          goal: "ship the beta",
          status: "completed",
          turnCount: 4,
          maxTurns: 4,
        },
      },
      {
        goalRun: {
          runId: "b",
          goal: "ship the beta",
          status: "working",
          turnCount: 2,
          maxTurns: 8,
        },
      },
    ]);
    expect(goal?.runId).toBe("b");
    expect(goal?.percent).toBe(25);
    expect(goal?.running).toBe(true);
  });

  it("has nothing to show for a room that never ran a goal", () => {
    expect(projectGoal([{}, { goalRun: undefined }])).toBeNull();
  });

  it("keeps a finished run's bar — a settled goal is still the project's goal", () => {
    const goal = projectGoal([
      {
        goalRun: {
          runId: "a",
          goal: "public beta",
          status: "completed",
          turnCount: 6,
          maxTurns: 6,
        },
      },
    ]);
    expect(goal?.percent).toBe(100);
    expect(goal?.running).toBe(false);
  });

  it("reads 0% off a run with no turn budget instead of dividing by zero", () => {
    const goal = projectGoal([
      {
        goalRun: {
          runId: "a",
          goal: "open",
          status: "working",
          turnCount: 3,
          maxTurns: 0,
        },
      },
    ]);
    expect(goal?.percent).toBe(0);
  });
});

describe("upNext", () => {
  const threads = [
    { threadId: "t-1", title: "Website redesign" },
    { threadId: "t-2", title: "Investor update", unread: true },
  ];

  it("says nothing when the project owes nothing", () => {
    expect(
      upNext({
        members: [{ id: "atlas", name: "Atlas" }],
        threads: [{ threadId: "t-1", title: "Website redesign" }],
      }),
    ).toEqual([]);
  });

  it("names the member holding the floor and whether it stopped to ask", () => {
    const rows = upNext({
      members: [
        { id: "atlas", name: "Atlas" },
        { id: "forge", name: "Forge", activity: "waiting-on-you" },
      ],
      busyBotId: "forge",
      threads,
    });
    expect(rows[0]).toEqual({
      key: "member:forge",
      title: "Forge",
      status: "waiting",
    });
  });

  it("counts the words waiting on a conversation", () => {
    const rows = upNext({
      members: [],
      threads,
      activeThreadId: "t-2",
      pendingQueued: { "t-1": [{ id: "q" }, { id: "q2" }] as never },
    });
    expect(rows).toEqual([
      {
        key: "thread:t-1",
        title: "Website redesign",
        status: "queued",
        threadId: "t-1",
        queued: 2,
      },
    ]);
  });

  it("does not list the conversation already on screen as unread", () => {
    const rows = upNext({ members: [], threads, activeThreadId: "t-2" });
    expect(rows).toEqual([]);
  });

  it("prefers queued over unread on one conversation, and says only one thing about it", () => {
    const rows = upNext({
      members: [],
      threads: [{ threadId: "t-1", title: "Mobile app", unread: true }],
      pendingQueued: { "t-1": [{ id: "q" }] as never },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("queued");
  });

  it("caps the column at a glance", () => {
    expect(PROJECT_COLUMN_LIMIT).toBeGreaterThan(0);
    expect(PROJECT_COLUMN_LIMIT).toBeLessThanOrEqual(8);
  });
});
