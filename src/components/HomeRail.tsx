// The left column of Home.
//
// Four things, in the order a person reaches for them: who you are talking
// to, a new conversation, what happened today, and everything older. It
// floats on the sky — no panel fill, no right border, no drawer chrome —
// because the conversation is the only surface that needs glass here.
//
// Everything on this rail is a *view* of what the store already holds. The
// thread rows are the same `SidebarThreadRow` the sidebar tree uses, and
// switching bot is the same `select` dispatch, so the two can never disagree
// about which thread is open or which bot is current.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, PanelLeft, Plus, UserRoundPlus } from "lucide-react";
import { useStore, type Bot, type Task } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { GlassPopover } from "./Glass";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { SidebarThreadRow } from "./SidebarThreadRow";
import { DesktopWorkspaceSwitcher } from "./DesktopWorkspaceSwitcher";
import { HOME_COLUMN_LIMIT, isSameLocalDay, todaysThreads } from "@/lib/home-context";

/** Rows in this rail are one line, no preview, no byline — the sidebar tree
 *  is where the detail lives, and two densities in one screen reads as noise. */
const rowClass =
  "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[14px] text-ink outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/60 focus-visible:ring-2 focus-visible:ring-accent/60";

/* ── Who you are talking to ─────────────────────────────────────────────── */

/** Every visible bot, grouped the way the sidebar groups them. The landing
 *  calls the selected one a personal assistant; nothing is renamed — a user
 *  who named their bots Atlas, Nova and Sage sees exactly those names. */
function BotSwitcher({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bots = state.bots.filter((candidate) => !candidate.hidden);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !wrapRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("home.rail.switchAria", { name: bot.name })}
        onClick={() => setOpen((value) => !value)}
        className={cn(rowClass, "px-1.5 py-1.5", open && "bg-raised/60")}
      >
        <BotAvatar bot={bot} state="happy" size={28} animated={false} />
        <span className="min-w-0 flex-1 truncate font-semibold">{bot.name}</span>
        <ChevronDown aria-hidden="true" size={15} className={cn("shrink-0 text-ink-secondary transition-transform duration-[var(--motion-base)]", open && "rotate-180")} />
      </button>
      {open && (
        <GlassPopover role="listbox" aria-label={t("home.rail.switchList")} className="absolute left-0 top-full z-30 mt-1 max-h-[320px] w-[248px] overflow-y-auto p-1">
          {bots.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="option"
              aria-selected={candidate.id === bot.id}
              onClick={() => {
                setOpen(false);
                dispatch({ type: "select", id: candidate.id });
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/70 focus-visible:ring-2 focus-visible:ring-accent/60",
                candidate.id === bot.id && "bg-raised/70",
              )}
            >
              <BotAvatar bot={candidate} state="happy" size={26} animated={false} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink">{candidate.name}</span>
                {candidate.title.trim() && <span className="block truncate text-[11.5px] text-ink-secondary">{candidate.title.trim()}</span>}
              </span>
              {candidate.unread && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label={t("task.unreadMany")} />}
            </button>
          ))}
          {bots.length === 0 && <p className="px-2 py-3 text-[13px] text-ink-secondary">{t("home.rail.switchEmpty")}</p>}
          <div className="mt-1 border-t border-hairline/40 pt-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                dispatch({ type: "toggleNewBot", open: true });
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[14px] text-ink-secondary outline-none hover:bg-raised/70 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <UserRoundPlus aria-hidden="true" size={15} className="shrink-0" />
              {t("sidebar.newBot")}
            </button>
          </div>
        </GlassPopover>
      )}
    </div>
  );
}

/* ── Section headings ───────────────────────────────────────────────────── */

function RailSection({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="flex items-center gap-1.5 px-2.5 pb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-secondary">
        <span className="min-w-0 truncate">{label}</span>
        {count !== undefined && count > 0 && <span className="text-[11px] font-medium tabular-nums">{count}</span>}
      </h2>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

/** One thread row, wired to the same actions the sidebar row offers. */
function ThreadRow({ bot, task, current }: { bot: Bot; task: Task; current: boolean }) {
  const { state, dispatch } = useStore();
  return (
    <SidebarThreadRow
      task={{ ...task, queued: Boolean(state.pendingQueued[task.threadId]?.length) }}
      ownerId={bot.id}
      current={current}
      onSelect={() => {
        if (task.threadId !== bot.threadId) dispatch({ type: "switchTask", botId: bot.id, threadId: task.threadId });
        else dispatch({ type: "select", id: bot.id });
      }}
      onRename={(title) => dispatch({ type: "renameTask", botId: bot.id, threadId: task.threadId, title })}
      onDelete={() => dispatch({ type: "deleteTask", botId: bot.id, threadId: task.threadId })}
    />
  );
}

export function HomeRail({ bot, onOpenAll }: { bot: Bot; onOpenAll: () => void }) {
  const { dispatch } = useStore();
  // The clock is read once per minute: a landing that re-renders every second
  // would repaint the whole conversation column to keep a date label honest.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const threads = (bot.tasks ?? []).filter((task) => !task.routineRunId && task.archivedAt === undefined);
  const today = todaysThreads(threads, now);
  const earlier = threads.filter((task) => !isSameLocalDay(task.createdAt, now));
  // The thread you are in must never be hidden behind a collapsed disclosure:
  // if it is not today's, History opens by default.
  const currentIsToday = isSameLocalDay(
    threads.find((task) => task.threadId === bot.threadId)?.createdAt ?? 0,
    now,
  );
  const [historyOpen, setHistoryOpen] = useState(!currentIsToday);
  useEffect(() => setHistoryOpen(!currentIsToday), [currentIsToday, bot.id]);

  const recentEarlier = earlier
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, HOME_COLUMN_LIMIT);

  return (
    <aside
      aria-label={t("home.rail.aria")}
      data-home-rail=""
      className="hidden w-[264px] shrink-0 flex-col overflow-y-auto px-2 pb-6 md:flex"
    >
      <BotSwitcher bot={bot} />

      <button
        type="button"
        onClick={() => dispatch({ type: "newTask", botId: bot.id })}
        className={cn(rowClass, "mt-0.5 text-ink-secondary hover:text-ink")}
      >
        <Plus aria-hidden="true" size={15} className="shrink-0" />
        <span className="truncate">{t("home.rail.newConversation")}</span>
      </button>

      <RailSection label={t("home.rail.today")} count={today.length}>
        {today.length === 0 ? (
          <p className="px-2.5 py-1 text-[13px] text-ink-secondary/80">{t("home.rail.todayEmpty")}</p>
        ) : (
          today.slice(0, HOME_COLUMN_LIMIT).map((task) => (
            <ThreadRow key={task.threadId} bot={bot} task={task} current={task.threadId === bot.threadId} />
          ))
        )}
      </RailSection>

      {recentEarlier.length > 0 && (
        <RailSection label={t("home.rail.history")}>
          <button
            type="button"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)}
            className="flex w-full items-center gap-1 rounded-lg px-2.5 py-1 text-left text-[13px] text-ink-secondary outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <ChevronRight aria-hidden="true" size={13} className={cn("shrink-0 transition-transform duration-[var(--motion-base)]", historyOpen && "rotate-90")} />
            <span className="min-w-0 flex-1 truncate">{t("home.rail.historyOpen", { count: recentEarlier.length })}</span>
          </button>
          {historyOpen &&
            recentEarlier.map((task) => (
              <ThreadRow key={task.threadId} bot={bot} task={task} current={task.threadId === bot.threadId} />
            ))}
        </RailSection>
      )}

      {/* The whole workspace, not just this assistant: sections, rooms,
          archived bots, the tools row and the thread folders. Same component,
          opened over the canvas, so nothing the sidebar held is unreachable
          from Home. `data-tour="tools"` gives the guided tour a real anchor
          here — Automations and Apps moved to the avatar menu in phase 1 and
          left this step pointing at nothing. */}
      <div className="mt-auto space-y-0.5 pt-6">
        {/* Which computer's workspace this is, and the route to the others.
            It used to live only in the sidebar's footer — which above `md`
            this rail replaces — so switching workspace from Home or Projects
            had no route at all. The native menu is the desktop's own; this is
            the entry, not a second implementation. */}
        <DesktopWorkspaceSwitcher />
        <button
          type="button"
          data-tour="tools"
          aria-expanded={false}
          onClick={onOpenAll}
          className={cn(rowClass, "text-ink-secondary hover:text-ink")}
        >
          <PanelLeft aria-hidden="true" size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{t("home.rail.all")}</span>
        </button>
      </div>
    </aside>
  );
}