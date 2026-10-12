// Crew — the roster.
//
// One page, one job: show the bots this workspace already has, grouped the way
// it already groups them. A team is a sidebar section, its lead is that
// section's Chief of Staff, and the bots under it are its specialists. The
// mockup's Atlas / Nova / Sage are *presentation* — a user whose leads are
// called Tracker and Wrench sees Tracker and Wrench, and nothing here
// renames, regroups or writes a record.
//
// The page floats. No panel, no frame, no opaque column: the heading, the
// roster search, the team columns and the footer entries sit directly on the
// sky, and the only glass is what a row needs to say — the add sheet, the bot
// menus, and the popovers above them.
//
// Everything a row can do, it does through the app's own controls: the `…` is
// the sidebar's `BotContextMenu`, "Talk to" is a `select`, "New team" is the
// sidebar's `TeamDialog`, and Team map / Computers / Archived bots open the
// components they always opened.

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Archive,
  Crown,
  Library,
  MessageCircle,
  Monitor,
  Network,
  PanelLeft,
  Pin,
  Plus,
  Search,
  UserRoundPlus,
  Users,
} from "lucide-react";

import { api, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { botPreview, botSignals, crewRoster, specialistCount, type CrewColumn } from "@/lib/crew-roster";
import { BotAvatar } from "./Avatar";
import { ConfirmDialog } from "./ConfirmDialog";
import { GlassPopover } from "./Glass";
import { TeamDialog } from "./TeamDialog";
import {
  ArchivedBotsPanel,
  BotContextMenu,
  SectionPicker,
  botConfirmCopy,
  currentArchivableBot,
  type BotConfirmKind,
  type MenuState,
} from "./Sidebar";
import { BotProjectDialog } from "./BotProjects";
import { TeamLibraryPanel, type TeamTab } from "./TeamLibraryPanel";
import { AddSpecialistSheet } from "./AddSpecialistSheet";

/* ── One bot ────────────────────────────────────────────────────────────── */

function SignalDot({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const signals = botSignals(bot, state.pendingQueued);
  if (signals.waiting) {
    return (
      <span
        role="status"
        aria-label={t("sidebar.preview.waiting")}
        title={t("sidebar.preview.waiting")}
        className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-panel bg-warning"
      />
    );
  }
  if (signals.working) {
    return (
      <span
        data-testid="crew-working-dot"
        title={t("chat.activity.working")}
        aria-label={t("chat.activity.working")}
        className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-panel bg-success"
      />
    );
  }
  if (signals.queued) {
    return (
      <span
        role="status"
        aria-label={t("task.queued")}
        title={t("task.queued")}
        className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-panel bg-ink-secondary"
      />
    );
  }
  if (signals.offline) {
    return (
      <span
        title={t("crew.card.offline")}
        aria-label={t("crew.card.offline")}
        className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-panel bg-danger"
      />
    );
  }
  return null;
}

function BotMenuButton({ bot, onMenu }: { bot: Bot; onMenu: (menu: MenuState) => void }) {
  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-label={t("sidebar.bot.actions", { name: bot.name })}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        onMenu({ botId: bot.id, x: box.right - 228, y: box.bottom + 6 });
      }}
      className="rounded-lg p-1 text-ink-secondary opacity-70 outline-none transition-opacity duration-[var(--motion-fast)] hover:bg-raised/70 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/60 group-hover:opacity-100"
    >
      <span aria-hidden="true" className="text-[15px] leading-none">
        ⋯
      </span>
    </button>
  );
}

/** A specialist. Glass because it is a card in a column, not because a list
 *  row needs a surface — the lead row above it is the same shape. */
function SpecialistCard({ bot, onMenu, onOpen }: { bot: Bot; onMenu: (menu: MenuState) => void; onOpen: (bot: Bot) => void }) {
  const { state } = useStore();
  const signals = botSignals(bot, state.pendingQueued);
  const preview = botPreview(bot);
  return (
    <div className="glass-card group flex items-center gap-3 px-3 py-2.5">
      <button
        type="button"
        onClick={() => onOpen(bot)}
        className="relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        aria-label={t("crew.card.open", { name: bot.name })}
      >
        <BotAvatar bot={bot} state={signals.working ? "working" : "happy"} size={38} animated={signals.working || signals.unread} />
        <SignalDot bot={bot} />
      </button>
      <button
        type="button"
        onClick={() => onOpen(bot)}
        className="min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="block truncate text-[14px] font-semibold text-ink">
          {bot.name}
          {bot.pinned && <Pin size={12} aria-label={t("sidebar.bot.pin")} className="ms-1 inline text-ink-secondary" />}
        </span>
        <span className="block truncate text-[12px] text-ink-secondary">
          {signals.offline ? t("crew.card.offline") : bot.title.trim() || preview || t("crew.card.noTitle")}
        </span>
      </button>
      <BotMenuButton bot={bot} onMenu={onMenu} />
    </div>
  );
}

/** The lead. A mascot, the name the user gave it, the title it carries, and
 *  the two chips the mockup puts there: talk to it, and how many report to
 *  it. The Chief badge keeps its meaning — a crown, not a renamed column. */
function LeadCard({ bot, column, onMenu, onOpen }: { bot: Bot; column: CrewColumn; onMenu: (menu: MenuState) => void; onOpen: (bot: Bot) => void }) {
  const { state } = useStore();
  const signals = botSignals(bot, state.pendingQueued);
  return (
    <div className="group">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onOpen(bot)}
          className="relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          aria-label={t("crew.card.open", { name: bot.name })}
        >
          <BotAvatar bot={bot} state={signals.working ? "working" : "happy"} size={56} animated={signals.working || signals.unread} />
          <SignalDot bot={bot} />
        </button>
        <button type="button" onClick={() => onOpen(bot)} className="min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[18px] font-semibold tracking-[-0.01em] text-ink">{bot.name}</span>
            {bot.chiefOfStaff && <Crown size={14} aria-label={t("sidebar.bot.chiefOfStaff")} className="shrink-0 text-accent" />}
          </span>
          <span className="block truncate text-[13px] text-ink-secondary">{bot.title.trim() || t("crew.card.noTitle")}</span>
        </button>
        <BotMenuButton bot={bot} onMenu={onMenu} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onOpen(bot)}
          className="flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-ink outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/60 focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <MessageCircle size={14} aria-hidden="true" className="text-ink-secondary" />
          {t("crew.card.talkTo", { name: bot.name })}
        </button>
        <span className="rounded-full px-3 py-1.5 text-[12.5px] text-ink-secondary">
          {t("crew.card.specialists", { count: specialistCount(column) })}
        </span>
      </div>
    </div>
  );
}

function TeamColumn({ column, onMenu, onOpen, onAdd }: {
  column: CrewColumn;
  onMenu: (menu: MenuState) => void;
  onOpen: (bot: Bot) => void;
  onAdd: (team: string) => void;
}) {
  return (
    <section data-crew-team={column.key} className="flex w-[300px] shrink-0 flex-col">
      <header className="flex items-baseline gap-2">
        <h2 className="min-w-0 truncate text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-secondary">
          {column.label}
        </h2>
        <span className="shrink-0 text-[11.5px] tabular-nums text-ink-secondary">{column.members.length}</span>
      </header>

      {column.lead ? (
        <div className="mt-3">
          <LeadCard bot={column.lead} column={column} onMenu={onMenu} onOpen={onOpen} />
        </div>
      ) : (
        <p className="mt-3 text-[12.5px] text-ink-secondary">
          {t("crew.column.noLead")}
        </p>
      )}

      <div className="mt-3 space-y-2">
        {column.specialists.map((bot) => (
          <SpecialistCard key={bot.id} bot={bot} onMenu={onMenu} onOpen={onOpen} />
        ))}
        {column.specialists.length === 0 && column.lead && (
          <p className="px-1 py-1 text-[12.5px] text-ink-secondary">{t("crew.column.noSpecialists")}</p>
        )}
        <button
          type="button"
          onClick={() => onAdd(column.label)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Plus size={14} aria-hidden="true" />
          {t("crew.card.addSpecialist")}
        </button>
      </div>
    </section>
  );
}

/**
 * What "open this bot" means, in one place.
 *
 * The store owns the selection; the shell owns the hand-off to the profile.
 * Keeping the pair together means a roster row and the profile's own entry
 * points cannot disagree about what tapping a bot does.
 */
export function openCrewBot(
  dispatch: (action: { type: "select"; id: string }) => void,
  onOpenBot: (botId: string) => void,
  botId: string,
) {
  dispatch({ type: "select", id: botId });
  onOpenBot(botId);
}

/* ── The page ───────────────────────────────────────────────────────────── */

export interface CrewScreenProps {
  /** open a bot's profile — the other half of Crew */
  onOpenBot: (botId: string) => void;
  /** the crew map: lanes, handoffs, drag arrangement, team instructions */
  onOpenTeamMap: () => void;
  /** the crew map with its team-computer panel already open */
  onOpenTeamComputers: () => void;
  /** the whole workspace: rooms, sections, thread folders, tools */
  onOpenAll: () => void;
}

export function CrewScreen({ onOpenBot, onOpenTeamMap, onOpenTeamComputers, onOpenAll }: CrewScreenProps) {
  const { state, dispatch } = useStore();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [sectionPicker, setSectionPicker] = useState<MenuState | null>(null);
  const [confirm, setConfirm] = useState<{ kind: BotConfirmKind; bot: Bot } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addTeam, setAddTeam] = useState<string | null>(null);
  const [newTeam, setNewTeam] = useState(false);
  const [library, setLibrary] = useState<TeamTab | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [newFolderBotId, setNewFolderBotId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const libraryReturnRef = useRef<HTMLButtonElement>(null);

  const columns = useMemo(
    () => crewRoster({ bots: state.bots, sections: state.sections, generalLabel: t("crew.generalTeam"), query }),
    [state.bots, state.sections, query],
  );
  const archived = state.bots.filter((bot) => bot.hidden);
  const totalVisible = state.bots.filter((bot) => !bot.hidden).length;

  const openBot = useCallback(
    (bot: Bot) => openCrewBot(dispatch, onOpenBot, bot.id),
    [dispatch, onOpenBot],
  );

  const requestArchive = (bot: Bot) => {
    const current = currentArchivableBot(state.bots, bot.id);
    if (current) setConfirm({ kind: "archive", bot: current });
  };

  const archiveBot = async (bot: Bot) => {
    setFeedback(null);
    const active = state.bots.filter((candidate) => !candidate.hidden);
    try {
      const response = await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ hidden: true }) });
      dispatch({ type: "botPatched", bot: response.bot });
      if (state.selectedId === bot.id) {
        const next = active.find((candidate) => candidate.id !== bot.id);
        if (next) dispatch({ type: "select", id: next.id });
      }
      setFeedback(t("sidebar.bot.archived", { name: bot.name }));
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <main data-crew-screen="" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* The heading stands on the sky. Nothing here is a container. */}
      <header className="shrink-0 px-6 pb-1 pt-6 max-md:pl-12 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[34px] font-semibold leading-10 tracking-[-0.02em] text-ink">{t("crew.title")}</h1>
            <p className="mt-1 text-[15px] leading-[22px] text-ink-secondary">{t("crew.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-full px-3 py-2 text-[13px] text-ink-secondary">
              <Search size={14} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && setQuery("")}
                placeholder={t("crew.search")}
                aria-label={t("crew.searchAria")}
                className="w-[180px] bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
              />
            </div>
            {/* Creating a bot is available everywhere — a remote client keeps
                New bot in its plus menu too. Team creation, the library and
                the archive are the host-only controls, and say so by being
                absent rather than by failing when pressed. */}
            <button
              type="button"
              ref={addTriggerRef}
              onClick={() => { setAddTeam(null); setAddOpen(true); }}
              className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-[var(--color-accent-ink)] outline-none transition-[filter,background-color] duration-[var(--motion-fast)] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <UserRoundPlus size={15} aria-hidden="true" />
              {t("crew.addSpecialist")}
            </button>
            {!remoteClient && (
              <button
                type="button"
                onClick={() => setNewTeam(true)}
                className="flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <Users size={15} aria-hidden="true" />
                {t("team.create")}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* The roster scrolls sideways when a workspace has more teams than fit:
          a lead's specialists belong under that lead, so the columns stay
          side by side rather than stacking into one long list. */}
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto px-6 py-6 sm:px-8">
        {columns.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-[14px] text-ink-secondary">
              {query ? t("crew.searchEmpty", { query: query.trim() }) : t("crew.empty")}
            </p>
          </div>
        ) : (
          <div className="flex min-h-full items-start gap-8">
            {columns.map((column) => (
              <TeamColumn
                key={column.key || "general"}
                column={column}
                onMenu={setMenu}
                onOpen={openBot}
                onAdd={(team) => { setAddTeam(team); setAddOpen(true); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* The escape hatches Crew owns: the map, the team computers, and the
          archive. The map is where lanes, handoffs, drag arrangement and team
          instructions live; the roster is not a replacement for it. */}
      <footer className="shrink-0 px-6 py-4 sm:px-8">
        <nav aria-label={t("crew.footer.aria")} className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={onOpenTeamMap}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <Network size={15} aria-hidden="true" />
            {t("crew.footer.teamMap")}
          </button>
          {/* Crew replaces the sidebar above `md`, so the whole workspace
              needs a route from here — the same sheet Home and Projects open. */}
          <button
            type="button"
            onClick={onOpenAll}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <PanelLeft size={15} aria-hidden="true" />
            {t("crew.footer.all")}
          </button>
          {!remoteClient && (
            <>
              <span aria-hidden="true" className="size-1 rounded-full bg-ink-secondary/50" />
              <button
                type="button"
                onClick={onOpenTeamComputers}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <Monitor size={15} aria-hidden="true" />
                {t("crew.footer.computers")}
              </button>
              <span aria-hidden="true" className="size-1 rounded-full bg-ink-secondary/50" />
              <button
                type="button"
                onClick={() => setArchivedOpen(true)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <Archive size={15} aria-hidden="true" />
                {t("crew.footer.archived")}
                {archived.length > 0 && <span className="tabular-nums">{archived.length}</span>}
              </button>
              <span aria-hidden="true" className="size-1 rounded-full bg-ink-secondary/50" />
              <button
                type="button"
                onClick={() => { libraryReturnRef.current = addTriggerRef.current; setLibrary("explore"); }}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <Library size={15} aria-hidden="true" />
                {t("sidebar.teamLibrary")}
              </button>
            </>
          )}
        </nav>
      </footer>

      {menu && (
        <BotContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onArchive={requestArchive}
          onDelete={(bot) => setConfirm({ kind: "delete", bot })}
          onMoveToSection={(botId) => setSectionPicker({ botId, x: menu.x, y: menu.y })}
          onNewFolder={setNewFolderBotId}
        />
      )}
      {sectionPicker && (
        <SectionPicker
          current={state.bots.find((b) => b.id === sectionPicker.botId)?.section}
          anchor={sectionPicker}
          onClose={() => setSectionPicker(null)}
          onAssign={(section) => {
            if (remoteClient) {
              void api("/api/sidebar-sections", {
                method: "POST",
                body: JSON.stringify({ name: section, botIds: [sectionPicker.botId] }),
              })
                .then(({ bots }) => bots.forEach((patched: Bot) => dispatch({ type: "botPatched", bot: patched })))
                .catch((cause) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) }));
              return;
            }
            dispatch({ type: "updateBot", botId: sectionPicker.botId, patch: { section } });
          }}
        />
      )}
      {/* The menu's "New folder" row is a real control here, not a row that
          closes itself: the same dialog the sidebar opens. */}
      {newFolderBotId && state.bots.find((candidate) => candidate.id === newFolderBotId) && (
        <BotProjectDialog
          bot={state.bots.find((candidate) => candidate.id === newFolderBotId)!}
          onClose={() => setNewFolderBotId(null)}
        />
      )}
      <ConfirmDialog
        open={confirm !== null}
        {...(confirm ? botConfirmCopy(confirm.kind, confirm.bot.name) : botConfirmCopy("archive", ""))}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { kind, bot } = confirm;
          setConfirm(null);
          if (kind === "archive") void archiveBot(bot);
          else dispatch({ type: "deleteBot", botId: bot.id });
        }}
      />
      {addOpen && (
        <AddSpecialistSheet
          teamLabel={addTeam}
          onClose={() => setAddOpen(false)}
          onOpenLibrary={(tab) => { libraryReturnRef.current = addTriggerRef.current; setLibrary(tab); }}
          returnFocusRef={addTriggerRef}
        />
      )}
      {newTeam && <TeamDialog onClose={() => setNewTeam(false)} />}
      {!remoteClient && library && (
        <TeamLibraryPanel
          returnFocusRef={libraryReturnRef}
          initialTab={library}
          onClose={() => setLibrary(null)}
          onImported={(result) => {
            setLibrary(null);
            setFeedback(
              result.members === 1
                ? t("sidebar.teamImportedOne")
                : t("sidebar.teamImportedMany", { count: result.members }),
            );
          }}
        />
      )}
      {!remoteClient && archivedOpen && archived.length > 0 && (
        <ArchivedBotsPanel bots={archived} onClose={() => setArchivedOpen(false)} onRestored={setFeedback} />
      )}
      {feedback && (
        <GlassPopover role="status" className="fixed bottom-4 left-4 z-[60] max-w-[320px] px-3.5 py-2.5 text-[13px]">
          {feedback}
        </GlassPopover>
      )}
      <p className="sr-only" aria-live="polite">
        {t("crew.summary", { teams: columns.length, bots: totalVisible })}
      </p>
    </main>
  );
}

export { cn };