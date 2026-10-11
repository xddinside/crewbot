// What the Projects screen reads out of the workspace.
//
// Same contract as home-context.ts: pure, clock passed in, nothing invented.
// A "project" here is a room the person works in — the app already calls a
// room a channel and holds its conversations in `tasks`; this module only
// renames the *view* of it, so no stored data is touched.
//
// Three reads, and they are the only three the mockup's columns need:
//
//   • the project list   — rooms, with their own conversations beneath
//   • the goal           — the room's latest goal run, and its real percentage
//   • up next            — what this project still owes the person
//
// Anything the mockup drew that the workspace cannot answer is simply absent:
// a column that has nothing real to say says so instead of inventing a row.

import { goalRunProgress, type GoalRunLike } from "./home-context";

/* ── The project list ────────────────────────────────────────────────────── */

export interface ProjectTaskLike {
  threadId: string;
  title: string;
  createdAt: number;
}

export interface ProjectLike {
  id: string;
  name: string;
  createdAt: number;
  unread?: boolean;
  /** the auto-created bot⇄bot channel — machinery, not a project */
  dm?: boolean;
  tasks?: ProjectTaskLike[];
}

export interface ProjectThread {
  threadId: string;
  title: string;
  current: boolean;
  unread: boolean;
  queued: boolean;
}

export interface ProjectEntry {
  id: string;
  name: string;
  unread: boolean;
  current: boolean;
  /** the room's own conversations; always at least the room itself */
  threads: ProjectThread[];
}

export interface ProjectListInput {
  groups: readonly ProjectLike[];
  /** threadId → the messages waiting on it */
  pendingQueued?: Readonly<Record<string, readonly unknown[]>>;
  currentGroupId?: string | null;
  currentThreadId?: string | null;
}

/**
 * Every room that is a project, with the conversations inside it.
 *
 * A bot⇄bot channel is left out: those are created by `ask_bot` to mirror an
 * exchange, not something a person opened, and a list of them would bury the
 * rooms they actually chose. They stay reachable in the workspace sheet, which
 * is the same list the sidebar always showed.
 *
 * A room with no `tasks` still gets one row — itself. That is the same
 * fallback the sidebar's room tree uses, so a fresh room and a room with
 * conversations cannot disagree about how many rows it has.
 */
export function projectList({
  groups,
  pendingQueued = {},
  currentGroupId = null,
  currentThreadId = null,
}: ProjectListInput): ProjectEntry[] {
  return groups
    .filter((group) => !group.dm)
    .map((group) => {
      const source = group.tasks?.length
        ? group.tasks
        : [{ threadId: "", title: group.name, createdAt: group.createdAt }];
      return {
        id: group.id,
        name: group.name,
        unread: Boolean(group.unread),
        current: group.id === currentGroupId,
        threads: source.map((task) => {
          const threadId = task.threadId || currentThreadId || "";
          return {
            threadId,
            title: task.title,
            current: threadId !== "" && threadId === currentThreadId,
            unread: Boolean(group.unread) && threadId === currentThreadId,
            queued:
              threadId !== "" && (pendingQueued[threadId]?.length ?? 0) > 0,
          };
        }),
      };
    });
}

/* ── The goal ────────────────────────────────────────────────────────────── */

export interface ProjectGoal extends GoalRunLike {
  /** 0–100 off the run's own turn budget; never a mockup's number */
  percent: number;
  /** true while the run is still going */
  running: boolean;
}

/**
 * The room's latest goal run, whatever its state.
 *
 * The *last* receipt wins because a receipt supersedes the ones before it: a
 * room that finished run A and started run B is showing B's goal and B's
 * progress, not a sum of both. A room that has never run a goal has no goal,
 * and the column says so rather than showing an empty bar.
 */
export function projectGoal(
  messages: ReadonlyArray<{ goalRun?: GoalRunLike }>,
): ProjectGoal | null {
  let latest: GoalRunLike | undefined;
  for (const message of messages) {
    if (message.goalRun) latest = message.goalRun;
  }
  if (!latest) return null;
  return {
    ...latest,
    percent: goalRunProgress(latest),
    running: latest.status === "working",
  };
}

/* ── Up next ─────────────────────────────────────────────────────────────── */

export type UpNextStatus = "working" | "waiting" | "queued" | "unread";

export interface UpNextRow {
  key: string;
  /** a member's name for a held floor, a conversation's title for a thread */
  title: string;
  status: UpNextStatus;
  /** the conversation this row opens; absent for a row that is not a thread */
  threadId?: string;
  /** how many messages are waiting, on a queued row */
  queued?: number;
}

export interface UpNextInput {
  /** the room's members, in the room's own order */
  members: ReadonlyArray<{
    id: string;
    name: string;
    activity?: string | null;
  }>;
  /** the member holding the floor, if any */
  busyBotId?: string | null;
  /** the room's conversations */
  threads: readonly { threadId: string; title: string; unread?: boolean }[];
  activeThreadId?: string | null;
  /** threadId → the messages waiting on it */
  pendingQueued?: Readonly<Record<string, readonly unknown[]>>;
}

/**
 * What this project still owes the person, most pressing first.
 *
 * Every row here is something real that happened: a member holding the floor,
 * a member that stopped to ask, words waiting in the queue, a conversation
 * with something unread. The mockup drew a checklist of dated tasks — the
 * workspace has no task objects behind that, so this says the truth instead
 * of dressing up a status line as a to-do.
 *
 * The conversation being read is left out of the unread rows: it is on screen.
 */
export function upNext({
  members,
  busyBotId = null,
  threads,
  activeThreadId = null,
  pendingQueued = {},
}: UpNextInput): UpNextRow[] {
  const rows: UpNextRow[] = [];
  const speaker = members.find((member) => member.id === busyBotId);
  if (speaker) {
    rows.push({
      key: `member:${speaker.id}`,
      title: speaker.name,
      status: speaker.activity === "waiting-on-you" ? "waiting" : "working",
    });
  }
  for (const thread of threads) {
    const queued = pendingQueued[thread.threadId]?.length ?? 0;
    const unread = Boolean(thread.unread) && thread.threadId !== activeThreadId;
    if (!queued && !unread) continue;
    rows.push({
      key: `thread:${thread.threadId}`,
      title: thread.title,
      status: queued > 0 ? "queued" : "unread",
      threadId: thread.threadId,
      ...(queued > 0 ? { queued } : {}),
    });
  }
  return rows;
}

/** The most rows a project column carries before it stops being a glance. */
export const PROJECT_COLUMN_LIMIT = 5;
