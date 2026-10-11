// What the Home landing reads out of the workspace.
//
// Every function here is pure and takes the clock as an argument, so the
// landing can be reasoned about — and tested — without a store, a server or
// a frozen global `Date`. The components pass `Date.now()` in.
//
// The rule for all of it: present what the user already has. Nothing is
// invented, renamed or counted into a number the app cannot support. Where
// the mockup showed a hand-written number (a project's percentage), the
// number comes from the goal run's own turn budget.

/* ── The greeting ───────────────────────────────────────────────────────── */

export type GreetingPart = "morning" | "afternoon" | "evening";

/** Three parts of the day, so the landing never says "Good evening" at 8am.
 *  Before 5 and after 17 both read as evening: one late-night bucket keeps
 *  the copy honest without inventing a fourth tone the catalog must carry. */
export function greetingPart(hour: number): GreetingPart {
  const normalized = ((Math.trunc(hour) % 24) + 24) % 24;
  if (normalized >= 5 && normalized < 12) return "morning";
  if (normalized >= 12 && normalized < 17) return "afternoon";
  return "evening";
}

/** "Nirvan Okonkwo" → "Nirvan". The first word, with any trailing punctuation
 *  trimmed. Empty in, empty out: the landing drops the name entirely rather
 *  than greeting nobody. */
export function greetingFirstName(fullName: string | undefined | null): string {
  const first = String(fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return first.replace(/[^\p{L}\p{N}'’-]/gu, "");
}

/* ── Threads ────────────────────────────────────────────────────────────── */

/** Same calendar day in the viewer's own timezone. `Date#getDate` rather than
 *  a UTC day, because "Today" is a local claim. */
export function isSameLocalDay(at: number, now: number): boolean {
  const left = new Date(at);
  const right = new Date(now);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** The threads created today, newest first. Input order is preserved for
 *  ties, so two threads stamped in the same millisecond keep stored order. */
export function todaysThreads<T extends { createdAt: number }>(threads: readonly T[], now: number): T[] {
  return threads
    .filter((thread) => isSameLocalDay(thread.createdAt, now))
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt);
}

/* ── In motion ──────────────────────────────────────────────────────────── */

/** A goal run that has not settled yet. `completed`, `stopped`, `failed` and
 *  `limit-reached` are finished answers and belong in history, not here. */
const IN_MOTION_STATUSES: ReadonlySet<string> = new Set(["working", "needs-input", "paused"]);

export interface GoalRunLike {
  runId: string;
  goal: string;
  status: string;
  turnCount: number;
  maxTurns: number;
  detail?: string;
}

export interface InMotionGroup {
  id: string;
  name: string;
  messages: ReadonlyArray<{ goalRun?: GoalRunLike }>;
}

export interface InMotionProject {
  /** the room's id, so a row can open the room it names */
  id: string;
  name: string;
  /** 0–100, from the run's own turn budget. 0 when the run has no budget. */
  percent: number;
  detail?: string;
}

/** Turns spent against the turns allowed, as a whole percentage. A run with no
 *  ceiling, or one that has somehow overrun it, reads as 0 / 100 rather than
 *  a bar that overflows its track. */
export function goalRunProgress(run: Pick<GoalRunLike, "turnCount" | "maxTurns">): number {
  if (!Number.isFinite(run.maxTurns) || run.maxTurns <= 0) return 0;
  const percent = Math.round((run.turnCount / run.maxTurns) * 100);
  return Math.min(100, Math.max(0, percent));
}

/** One row per room that is running a goal right now. A room's *last* goal
 *  run wins, because a receipt supersedes the ones before it — a room that
 *  finished run A and started run B is "in motion" because of B, not A. */
export function inMotionProjects(groups: readonly InMotionGroup[]): InMotionProject[] {
  const projects: InMotionProject[] = [];
  for (const group of groups) {
    let latest: GoalRunLike | undefined;
    for (const message of group.messages) {
      if (message.goalRun) latest = message.goalRun;
    }
    if (!latest || !IN_MOTION_STATUSES.has(latest.status)) continue;
    projects.push({
      id: group.id,
      name: group.name,
      percent: goalRunProgress(latest),
      detail: latest.detail,
    });
  }
  return projects.sort((left, right) => right.percent - left.percent);
}

/* ── Today (routines) ───────────────────────────────────────────────────── */

export interface RoutineLike {
  id: string;
  name: string;
  enabled: boolean;
  nextRunAt: number | null;
}

export interface TodayRoutine {
  id: string;
  name: string;
  /** when it next fires; null = no next run scheduled */
  at: number | null;
  running: boolean;
}

/** Routines still due today, soonest first. A paused routine keeps its row —
 *  dropping it would make the schedule look shorter than it is — but it sorts
 *  after everything that will actually fire, because it will not fire. */
export function todaysRoutines(routines: readonly RoutineLike[], now: number): TodayRoutine[] {
  return routines
    .filter((routine) => routine.enabled && routine.nextRunAt !== null && isSameLocalDay(routine.nextRunAt, now))
    .map((routine) => ({
      id: routine.id,
      name: routine.name,
      at: routine.nextRunAt,
      running: routine.nextRunAt !== null && routine.nextRunAt <= now,
    }))
    .sort((left, right) => {
      if (left.running !== right.running) return left.running ? -1 : 1;
      return (left.at ?? 0) - (right.at ?? 0);
    });
}

/** The most rows a landing column should carry before it stops being a
 *  glance and starts being a list. The full schedule is one click away. */
export const HOME_COLUMN_LIMIT = 4;