// The right column of Home.
//
// Three glances, stacked, and nothing else: what needs you, what is moving,
// what is due today. Each is a column of the workspace read through the same
// selectors the rest of the app uses, so the bell, the sidebar and this column
// can never disagree about what is waiting.
//
// It sits directly on the sky. Headings and rows are transparent; only the
// rows are hoverable, and nothing here is a container.

import { BellDot, CalendarDays, ChevronRight, CircleAlert, Clock3 } from "lucide-react";
import { useStore, formatTime, type Bot, type Group } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { crossBotAttentionThreads, type AttentionThread } from "./SidebarBotActivity";
import { HOME_COLUMN_LIMIT, inMotionProjects, todaysRoutines, type InMotionProject } from "@/lib/home-context";

function ContextSection({
  label,
  count,
  moreLabel,
  onMore,
  children,
}: {
  label: string;
  count?: number;
  moreLabel: string;
  onMore: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="flex items-center gap-1 pb-1.5">
        <h2 className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-semibold tracking-[0.02em] text-ink">
          <span className="truncate">{label}</span>
          {count !== undefined && count > 0 && <span className="text-[12px] font-medium tabular-nums text-ink-secondary">{count}</span>}
        </h2>
        <button
          type="button"
          onClick={onMore}
          aria-label={moreLabel}
          title={moreLabel}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <ChevronRight aria-hidden="true" size={15} />
        </button>
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

const rowClass =
  "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/50 focus-visible:ring-2 focus-visible:ring-accent/60";

/* ── Needs you ──────────────────────────────────────────────────────────── */

/** Rooms whose member holding the floor is waiting on the person. A room has
 *  no activity field of its own, so this reads that member's — the same signal
 *  the sidebar's room row reads. Labelled as a redesign addition: rooms were
 *  never in the attention list before. */
function waitingRooms(groups: readonly Group[], bots: readonly Bot[]): Array<{ id: string; name: string; bot: Bot }> {
  return groups.flatMap((group) => {
    const bot = bots.find((candidate) => candidate.id === group.busyBotId);
    return bot && bot.activity === "waiting-on-you" ? [{ id: group.id, name: group.name, bot }] : [];
  });
}

function NeedsYou({ onMore }: { onMore: () => void }) {
  const { state, dispatch } = useStore();
  // The same rule and the same order as the bell and the sidebar tree, so the
  // three can never count the same workspace three different ways.
  const attention = crossBotAttentionThreads(state.bots, state.pendingQueued);
  const rooms = waitingRooms(state.groups, state.bots);
  // A room row already stands for its waiting member; showing that member's own
  // thread underneath it would say the same thing twice.
  const waiting = new Set(rooms.map((room) => room.bot.id));
  const threads = attention.filter((entry) => !waiting.has(entry.botId)).slice(0, HOME_COLUMN_LIMIT);
  const count = threads.length + rooms.length;

  return (
    <ContextSection label={t("home.context.needsYou")} count={count} moreLabel={t("home.context.needsYouMore")} onMore={onMore}>
      {count === 0 ? (
        <p className="px-1.5 py-1 text-[13px] text-ink-secondary/80">{t("attention.empty")}</p>
      ) : (
        <>
          {rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              onClick={() => dispatch({ type: "select", id: room.id })}
              className={rowClass}
            >
              <CircleAlert aria-hidden="true" size={16} className="shrink-0 text-warning" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-ink">{room.name}</span>
                <span className="block truncate text-[11.5px] text-ink-secondary">{t("task.waiting")}</span>
              </span>
              <BotAvatar bot={room.bot} state="happy" size={20} animated={false} />
              <ChevronRight aria-hidden="true" size={14} className="shrink-0 text-ink-secondary/70" />
            </button>
          ))}
          {threads.map((entry) => (
            <AttentionRow key={`${entry.botId}-${entry.task.threadId}`} entry={entry} />
          ))}
        </>
      )}
    </ContextSection>
  );
}

function AttentionRow({ entry }: { entry: AttentionThread }) {
  const { state, dispatch } = useStore();
  const waiting = entry.task.activity === "waiting-on-you";
  const working = !waiting && (entry.task.busy || entry.task.activity === "working");
  const status = waiting ? t("task.waiting") : working ? t("chat.activity.working") : entry.task.queued ? t("task.queued") : t("task.unread");
  const Icon = waiting ? CircleAlert : working ? Clock3 : BellDot;
  const bot = state.bots.find((candidate) => candidate.id === entry.botId);
  const label = t("attention.item", { title: entry.task.title, name: entry.botName, status });
  return (
    <button type="button" aria-label={label} title={label} onClick={() => dispatch({ type: "switchTask", botId: entry.botId, threadId: entry.task.threadId })} className={rowClass}>
      <Icon aria-hidden="true" size={16} className={cn("shrink-0", working ? "text-accent" : waiting ? "text-warning" : "text-ink-secondary")} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] text-ink">{entry.task.title}</span>
        <span className="block truncate text-[11.5px] text-ink-secondary">
          {entry.botName} · {status}
        </span>
      </span>
      {bot && <BotAvatar bot={bot} state="happy" size={20} animated={false} />}
      <ChevronRight aria-hidden="true" size={14} className="shrink-0 text-ink-secondary/70" />
    </button>
  );
}

/* ── In motion ──────────────────────────────────────────────────────────── */

function ProgressRow({ project }: { project: InMotionProject }) {
  const { dispatch } = useStore();
  return (
    <button
      type="button"
      aria-label={t("home.context.progressRowAria", { name: project.name, percent: project.percent })}
      onClick={() => dispatch({ type: "select", id: project.id })}
      className={cn(rowClass, "flex-col items-stretch gap-1.5")}
    >
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{project.name}</span>
        <span className="shrink-0 text-[12px] tabular-nums text-ink-secondary">{project.percent}%</span>
      </span>
      <span
        role="progressbar"
        aria-valuenow={project.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("home.context.progressAria", { name: project.name })}
        className="h-1.5 w-full overflow-hidden rounded-full bg-ink-secondary/20"
      >
        <span className="block h-full rounded-full bg-accent transition-[width] duration-[var(--motion-slow)] ease-[var(--motion-curve)]" style={{ width: `${project.percent}%` }} />
      </span>
    </button>
  );
}

function InMotion({ onMore }: { onMore: () => void }) {
  const { state } = useStore();
  const projects = inMotionProjects(state.groups).slice(0, HOME_COLUMN_LIMIT);
  return (
    <ContextSection label={t("home.context.inMotion")} moreLabel={t("home.context.inMotionMore")} onMore={onMore}>
      {projects.length === 0 ? (
        <p className="px-1.5 py-1 text-[13px] text-ink-secondary/80">{t("home.context.inMotionEmpty")}</p>
      ) : (
        projects.map((project) => <ProgressRow key={project.id} project={project} />)
      )}
    </ContextSection>
  );
}

/* ── Today ──────────────────────────────────────────────────────────────── */

function Today({ onMore }: { onMore: () => void }) {
  const { state, dispatch } = useStore();
  const routines = todaysRoutines(state.routines, Date.now()).slice(0, HOME_COLUMN_LIMIT);
  return (
    <ContextSection label={t("home.context.today")} moreLabel={t("home.context.todayMore")} onMore={onMore}>
      {routines.length === 0 ? (
        <p className="px-1.5 py-1 text-[13px] text-ink-secondary/80">{t("home.context.todayEmpty")}</p>
      ) : (
        routines.map((routine) => (
          <button
            key={routine.id}
            type="button"
            onClick={() => dispatch({ type: "showRoutines", section: "schedule", routineId: routine.id })}
            className={rowClass}
          >
            <CalendarDays aria-hidden="true" size={16} className="shrink-0 text-ink-secondary" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-ink">{routine.name}</span>
              <span className="block truncate text-[11.5px] text-ink-secondary">
                {routine.running ? t("home.context.running") : routine.at !== null ? formatTime(routine.at) : ""}
              </span>
            </span>
            <ChevronRight aria-hidden="true" size={14} className="shrink-0 text-ink-secondary/70" />
          </button>
        ))
      )}
    </ContextSection>
  );
}

/**
 * The right column. `onOpenAll` is the rail's escape to the whole workspace;
 * `onGoProjects` and `onShowAutomations` are the two destinations its section
 * headings open, so nothing here is a dead end.
 */
export function HomeContext({ onOpenAll, onGoProjects, onShowAutomations }: {
  onOpenAll: () => void;
  onGoProjects: () => void;
  onShowAutomations: () => void;
}) {
  return (
    <aside aria-label={t("home.context.aria")} data-home-context="" className="hidden w-[272px] shrink-0 overflow-y-auto px-1 pb-6 lg:block">
      <NeedsYou onMore={onOpenAll} />
      <InMotion onMore={onGoProjects} />
      <Today onMore={onShowAutomations} />
    </aside>
  );
}