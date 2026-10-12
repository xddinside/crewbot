// The crew roster, derived.
//
// Crew is a *view* of the workspace the user already has: a team is a sidebar
// section, its lead is that section's Chief of Staff, and its specialists are
// the rest of its bots. Nothing here renames, regroups or writes anything —
// Atlas / Nova / Sage are presentation names in the mockup, and a user whose
// leads are called Tracker and Wrench sees Tracker and Wrench.
//
// Pure on purpose, and free of component imports (the same convention as
// `sidebar-attention.ts`): every claim the Crew page makes about a workspace
// is a function of data already in the store, so the page can be tested by
// reading its markup back rather than by driving the app.

import type { Bot, Task } from "@/state/store";
import { visibleMessages } from "@/state/store";
import { peerLine } from "./peer-message";

/** The unsectioned team's key. Its *name* is the catalog's "General" string,
 *  which the page passes in — never a second copy that can drift. */
export const GENERAL_TEAM_KEY = "";

export interface CrewColumn {
  /** the section id; "" is the unsectioned ("General") team */
  key: string;
  /** the column heading: the team the bots are actually in */
  label: string;
  /** the team's Chief of Staff, when it has one */
  lead: Bot | null;
  /** everyone else in the team, in roster order */
  specialists: Bot[];
  /** every bot shown in the column, lead first */
  members: Bot[];
  /** total members before the search filter */
  total: number;
}

/** One bot's attention signals, folded across its threads. The precedence —
 *  waiting beats working, working beats queued, unread never hides another
 *  signal — is the sidebar tree's, so a roster dot and a tree dot can never
 *  disagree about the same bot. */
export interface BotSignals {
  waiting: boolean;
  working: boolean;
  queued: boolean;
  unread: boolean;
  /** the harness has lost this bot, so nothing it says is going to arrive */
  offline: boolean;
}

/** The subset of a task the signals need. Structural on purpose: the rules
 *  below are about state, not about the Task type, and a test can state a
 *  thread in three words. */
type SignalTask = Pick<Task, "threadId" | "busy" | "activity" | "unread"> & { queued?: boolean };

function signalTasks(bot: Bot, pendingQueued: Record<string, unknown[]>): SignalTask[] {
  const tasks: SignalTask[] = bot.tasks
    ? bot.tasks
    : [
        // A bot with no task list still has its own thread; the aggregate
        // flags are that thread's flags.
        {
          threadId: bot.threadId,
          busy: bot.busy,
          activity: bot.activity,
          unread: bot.unread,
        },
      ];
  return tasks
    .filter((task) => !("routineRunId" in task && task.routineRunId))
    .map((task) => ({ ...task, queued: Boolean(pendingQueued[task.threadId]?.length) }));
}

export function botSignals(bot: Bot, pendingQueued: Record<string, unknown[]> = {}): BotSignals {
  const tasks = signalTasks(bot, pendingQueued);
  const waiting = bot.activity === "waiting-on-you" || tasks.some((task) => task.activity === "waiting-on-you");
  const working =
    !waiting && (Boolean(bot.busy) || tasks.some((task) => task.busy || task.activity === "working"));
  return {
    waiting,
    working,
    queued: tasks.some((task) => task.queued),
    unread: bot.unread || tasks.some((task) => task.unread),
    offline: bot.activity === "dead" || bot.activity === "no-signal",
  };
}

/** The one line under a name: the visible branch's tail. `bot.messages` holds
 *  every fork, so its last entry can belong to a version the user switched
 *  away from — hence `visibleMessages`. Busy and waiting bots say nothing
 *  here; their state is the dot, and a half-written line beside it reads as
 *  a settled message. */
export function botPreview(bot: Bot): string {
  if (bot.activity === "waiting-on-you" || bot.busy) return "";
  const last = visibleMessages(bot).at(-1);
  if (!last) return "";
  if (last.kind === "options" && last.card) return last.card.title;
  if (last.kind === "activity" && last.tool) return last.tool.name;
  if (last.kind === "screen") return "";
  const peer = peerLine(last);
  if (peer) return `${peer.name}: ${peer.body}`;
  return (last.text ?? "").replace(/\s+/g, " ").trim();
}

export function matchesCrewQuery(bot: Bot, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [bot.name, bot.title, bot.description, bot.section ?? ""].some((part) =>
    part.toLowerCase().includes(q),
  );
}

/** Teams in the order the user arranged them: `sections` first (that is the
 *  saved order), then any team that only exists because a bot is in it, and
 *  the unsectioned General team last. A saved section with no bots is not a
 *  column — an empty team has nothing to show and the team map is where it
 *  gets created. */
export function crewTeamOrder(bots: readonly Bot[], sections: readonly string[] = []): string[] {
  const inUse = new Set<string>();
  for (const bot of bots) if (!bot.hidden) inUse.add(bot.section?.trim() ?? GENERAL_TEAM_KEY);
  const ordered = sections.map((name) => name.trim()).filter((name) => name !== "" && inUse.has(name));
  for (const key of inUse) if (key !== "" && !ordered.includes(key)) ordered.push(key);
  if (inUse.has(GENERAL_TEAM_KEY)) ordered.push(GENERAL_TEAM_KEY);
  return ordered;
}

export interface CrewRosterInput {
  bots: readonly Bot[];
  sections?: readonly string[];
  /** label for the unsectioned team; the page passes the catalog string */
  generalLabel: string;
  /** search text from the roster's own filter */
  query?: string;
}

/**
 * The roster the Crew page draws.
 *
 * A team with no Chief still gets a column: its bots are listed and the
 * column says so. Appointing a lead the user never chose would be exactly the
 * quiet authority the audit warns against, and the roster's own bot menu is
 * where a Chief is made.
 */
export function crewRoster({ bots, sections = [], generalLabel, query = "" }: CrewRosterInput): CrewColumn[] {
  const visible = bots.filter((bot) => !bot.hidden);
  const columns: CrewColumn[] = [];
  for (const key of crewTeamOrder(visible, sections)) {
    const team = visible.filter((bot) => (bot.section?.trim() ?? GENERAL_TEAM_KEY) === key);
    if (team.length === 0) continue;
    // The first Chief in roster order heads the column. A workspace with two
    // shows both as Chiefs everywhere else; picking one to draw here is a
    // view, not a change.
    const chief = team.find((bot) => bot.chiefOfStaff) ?? null;
    const matches = team.filter((bot) => matchesCrewQuery(bot, query));
    if (matches.length === 0) continue;
    const lead = chief && matchesCrewQuery(chief, query) ? chief : null;
    const specialists = team.filter((bot) => bot !== chief && matchesCrewQuery(bot, query));
    columns.push({
      key,
      label: key === GENERAL_TEAM_KEY ? generalLabel : key,
      lead,
      specialists,
      members: lead ? [lead, ...specialists] : specialists,
      total: team.length,
    });
  }
  return columns;
}

/** How many bots report to this column's lead. A team with no lead reports
 *  its whole membership as specialists. */
export function specialistCount(column: CrewColumn): number {
  return column.total - (column.lead ? 1 : 0);
}