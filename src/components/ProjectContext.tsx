// The right column of Projects.
//
// What the project is for, what it still owes, and who is on it. Three
// glances stacked on the sky — no container, no panel, nothing to dismiss.
// The conversation is the screen; this is the margin next to it.
//
// Every number here is read off the workspace. The goal bar is the goal run's
// own turn budget, and "up next" only lists things that really happened — a
// member holding the floor, words waiting in the queue, a conversation with
// something unread. Where the mockup drew dated to-dos, the app has no task
// objects behind them, so this says what is true instead of inventing a row.

import { useEffect, useRef, useState } from "react";
import {
  BellDot,
  ChevronRight,
  CircleAlert,
  Clock3,
  Target,
} from "lucide-react";
import { useStore, type Bot, type Group } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  PROJECT_COLUMN_LIMIT,
  projectGoal,
  upNext,
  type UpNextRow,
  type UpNextStatus,
} from "@/lib/project-context";
import { goalRunStatusLabel } from "./GoalRunCard";
import { ManageMembersPanel } from "./ManageMembersPanel";

const rowClass =
  "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/50 focus-visible:ring-2 focus-visible:ring-accent/60";

const UP_NEXT_ICON: Record<UpNextStatus, typeof Clock3> = {
  working: Clock3,
  waiting: CircleAlert,
  queued: Clock3,
  unread: BellDot,
};

const UP_NEXT_TONE: Record<UpNextStatus, string> = {
  working: "text-accent",
  waiting: "text-warning",
  queued: "text-ink-secondary",
  unread: "text-ink-secondary",
};

function UpNextRowView({ row }: { row: UpNextRow }) {
  const { dispatch } = useStore();
  const { state } = useStore();
  const Icon = UP_NEXT_ICON[row.status];
  const open = () => {
    const room = state.groups.find((group) =>
      group.tasks?.some((task) => task.threadId === row.threadId),
    );
    if (!room || !row.threadId) return;
    dispatch({
      type: "switchGroupTask",
      groupId: room.id,
      threadId: row.threadId,
    });
  };
  // A held floor has no thread behind it — the room is already on screen — so
  // the row is a readout, not a link.
  if (!row.threadId) {
    return (
      <div className={cn(rowClass, "cursor-default hover:bg-transparent")}>
        <Icon
          aria-hidden="true"
          size={16}
          className={cn("shrink-0", UP_NEXT_TONE[row.status])}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] text-ink">
            {row.title}
          </span>
          <span className="block truncate text-[11.5px] text-ink-secondary">
            {row.status === "waiting"
              ? t("task.waiting")
              : t("chat.activity.working")}
          </span>
        </span>
      </div>
    );
  }
  return (
    <button type="button" onClick={open} className={rowClass}>
      <Icon
        aria-hidden="true"
        size={16}
        className={cn("shrink-0", UP_NEXT_TONE[row.status])}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] text-ink">
          {row.title}
        </span>
        <span className="block truncate text-[11.5px] text-ink-secondary">
          {row.status === "queued"
            ? t("project.context.queuedCount", { count: row.queued ?? 1 })
            : t("task.unread")}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        size={14}
        className="shrink-0 text-ink-secondary/70"
      />
    </button>
  );
}

function Goal() {
  const { state } = useStore();
  const group = state.groups.find(
    (candidate) => candidate.id === state.selectedId,
  );
  if (!group) return null;
  const goal = projectGoal(group.messages);
  if (!goal) return null;
  return (
    <section className="mb-6">
      <h2 className="flex min-w-0 items-center gap-1.5 pb-1.5 text-[13px] font-semibold tracking-[0.02em] text-ink">
        <Target
          aria-hidden="true"
          size={15}
          className="shrink-0 text-ink-secondary"
        />
        <span className="truncate">{t("project.context.goal")}</span>
      </h2>
      <p className="px-1.5 text-[13.5px] leading-snug text-ink">{goal.goal}</p>
      <p className="px-1.5 pb-1.5 pt-0.5 text-[11.5px] text-ink-secondary">
        {goalRunStatusLabel(goal.status)} · {goal.percent}%
      </p>
      <div
        role="progressbar"
        aria-valuenow={goal.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("project.context.goalProgress", { name: goal.goal })}
        className="mx-1.5 h-1.5 overflow-hidden rounded-full bg-ink-secondary/20"
      >
        <span
          className="block h-full rounded-full bg-accent transition-[width] duration-[var(--motion-slow)] ease-[var(--motion-curve)]"
          style={{ width: `${goal.percent}%` }}
        />
      </div>
    </section>
  );
}

function UpNext() {
  const { state } = useStore();
  const group = state.groups.find(
    (candidate) => candidate.id === state.selectedId,
  );
  if (!group) return null;
  const members: Bot[] = group.memberIds
    .map((id) => state.bots.find((bot) => bot.id === id))
    .filter((bot): bot is Bot => Boolean(bot));
  const threads = group.tasks?.length
    ? group.tasks.map((task) => ({
        threadId: task.threadId,
        title: task.title,
        unread: task.threadId === group.threadId && group.unread,
      }))
    : [{ threadId: group.threadId, title: group.name, unread: false }];
  const rows = upNext({
    members,
    busyBotId: group.busyBotId,
    threads,
    activeThreadId: group.threadId,
    pendingQueued: state.pendingQueued,
  }).slice(0, PROJECT_COLUMN_LIMIT);

  return (
    <section className="mb-6">
      <h2 className="px-1.5 pb-1.5 text-[13px] font-semibold tracking-[0.02em] text-ink">
        {t("project.context.upNext")}
      </h2>
      {rows.length === 0 ? (
        <p className="px-1.5 py-1 text-[13px] text-ink-secondary/80">
          {t("project.context.upNextEmpty")}
        </p>
      ) : (
        <div className="space-y-1">
          {rows.map((row) => (
            <UpNextRowView key={row.key} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Who is on this project. The avatar stack is the roster at a glance; the
 *  row opens the existing membership sheet, which is the only editor. */
function Staffing({ group }: { group: Group }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // An open sheet belongs to the room it was opened in.
  useEffect(() => setOpen(false), [group.id]);
  const members: Bot[] = group.memberIds
    .map((id) => state.bots.find((bot) => bot.id === id))
    .filter((bot): bot is Bot => Boolean(bot));
  const shown = members.slice(0, 4);
  const hidden = members.length - shown.length;

  return (
    <section className="mb-6">
      <h2 className="flex items-center gap-1 px-1.5 pb-1.5 text-[13px] font-semibold tracking-[0.02em] text-ink">
        <span className="truncate">{t("project.context.staffing")}</span>
        <span className="text-[12px] font-medium tabular-nums text-ink-secondary">
          {members.length}
        </span>
      </h2>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("project.context.staffingAria", { name: group.name })}
        className={cn(rowClass, "group")}
      >
        <span className="flex shrink-0 items-center">
          {shown.map((bot, index) => (
            <span
              key={bot.id}
              className={cn("inline-flex rounded-full", index > 0 && "-ml-1.5")}
              title={bot.name}
            >
              <BotAvatar bot={bot} state="happy" size={22} animated={false} />
            </span>
          ))}
          {hidden > 0 && (
            <span className="-ml-1 inline-flex size-[22px] items-center justify-center rounded-full bg-raised text-[10px] font-medium text-ink-secondary">
              +{hidden}
            </span>
          )}
        </span>
        <ChevronRight
          aria-hidden="true"
          size={14}
          className="ml-auto shrink-0 text-ink-secondary/70"
        />
      </button>
      {open && (
        <ManageMembersPanel
          group={group}
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
        />
      )}
    </section>
  );
}

export function ProjectContext({ group }: { group: Group }) {
  return (
    <aside
      aria-label={t("project.context.aria")}
      data-project-context=""
      className="hidden w-[272px] shrink-0 overflow-y-auto px-1 pb-6 lg:block"
    >
      <Goal />
      <UpNext />
      <Staffing group={group} />
    </aside>
  );
}
