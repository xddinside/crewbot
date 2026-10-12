// The bot profile — the other half of Crew.
//
// The same twelve sections the chat's settings panel folds into an accordion,
// presented as a page: the section list stands on the sky in the left column,
// the chosen section sits in a glass card in the middle, and a summary column
// on the right is a set of *jumps* — nothing here is a second editor, so the
// page can never offer a control the section below does not actually own.
//
// The Crew roster hands over a bot; this hands back. Selecting a section
// writes the store's own `botSettingsSection`, which is the same field the
// chat header's deep links and the team map's computer chip already write, so
// "open Access for this bot" means the same thing from either side.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Brain, ChevronRight, Coins, Cpu, History, Mic, MessageCircle, Search, ShieldCheck } from "lucide-react";

import { api, useStore, type Bot, type BotSettingsSection } from "@/state/store";
import { fetchMemoryOverview } from "@/lib/memory";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { botSignals, crewRoster } from "@/lib/crew-roster";
import { BotAvatar } from "./Avatar";
import { GlassCard } from "./Glass";
import { ConfirmDialog } from "./ConfirmDialog";
import { BOT_SECTIONS, sectionMatches } from "./bot-settings/sections";
import { BotSectionBody } from "./bot-settings/BotSectionBody";
import { useBotProfileData } from "./bot-settings/useBotProfileData";

/** Section ids, in the rail's own order. Re-exported so a host (or a test)
 *  can read the order without rendering the whole nav. */
export const PROFILE_SECTIONS = BOT_SECTIONS;

/** The one line under the profile's title: what this bot is, how much crew
 *  reports to it, and how many rooms it is in. All three are counted from
 *  the workspace, never typed in. */
export function profileSubtitle(bot: Bot, rosterBots: Bot[], groupCount: number): string {
  const colleagues = rosterBots.filter(
    (candidate) => !candidate.hidden && candidate.id !== bot.id && (candidate.section?.trim() ?? "") === (bot.section?.trim() ?? ""),
  );
  const parts = [bot.title.trim() || t("crew.card.noTitle")];
  parts.push(
    colleagues.length === 1
      ? t("crew.card.specialist")
      : t("crew.card.specialists", { count: colleagues.length }),
  );
  parts.push(
    groupCount === 1
      ? t("profile.overview.project", { count: groupCount })
      : t("profile.overview.projectsMany", { count: groupCount }),
  );
  return parts.join(" · ");
}

/** Counts for the summary column: two small reads the sections make anyway.
 *  A number that cannot be fetched stays null and reads "Loading…" rather than
 *  a zero that would look like "this bot has no skills". */
interface Counts {
  skills: number | null;
  topics: number | null;
}

function useProfileCounts(botId: string): Counts {
  const [counts, setCounts] = useState<Counts>({ skills: null, topics: null });
  useEffect(() => {
    let cancelled = false;
    void api(`/api/bots/${botId}/skills`)
      .then((result: { skills?: unknown[] }) => {
        if (!cancelled) setCounts((value) => ({ ...value, skills: result.skills?.length ?? 0 }));
      })
      .catch(() => {});
    void fetchMemoryOverview(botId)
      .then((overview) => {
        if (!cancelled) setCounts((value) => ({ ...value, topics: overview.topics.length }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [botId]);
  return counts;
}

/** A summary line that goes somewhere. */
function JumpRow({ icon: Icon, label, value, onOpen }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/50 focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <Icon size={15} className="shrink-0 text-ink-secondary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink">{label}</span>
        <span className="block truncate text-[11.5px] text-ink-secondary">{value}</span>
      </span>
      <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
    </button>
  );
}

export interface BotProfilePageProps {
  bot: Bot;
  /** back to the roster */
  onBack: () => void;
}

export function BotProfilePage({ bot, onBack }: BotProfilePageProps) {
  const { state, dispatch } = useStore();
  const section = state.botSettingsSection;
  const data = useBotProfileData(bot, section);
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const counts = useProfileCounts(bot.id);

  const open = (next: BotSettingsSection) => {
    // `open: false` writes the section without raising the chat's settings
    // panel: the page *is* the panel from here.
    dispatch({ type: "toggleSettings", open: false, section: next });
    contentRef.current?.scrollTo({ top: 0 });
  };

  const visibleSections = useMemo(
    () => BOT_SECTIONS.filter((entry) => sectionMatches(entry, query)),
    [query],
  );

  const signals = botSignals(bot, state.pendingQueued);
  const roster = crewRoster({ bots: state.bots, sections: state.sections, generalLabel: t("crew.generalTeam") });
  const team = roster.find((column) => (column.lead?.id === bot.id || column.members.some((member) => member.id === bot.id)) && column.key === (bot.section?.trim() ?? ""));
  const roomCount = state.groups.filter((group) => group.memberIds.includes(bot.id)).length;
  const grants = bot.alwaysAllow?.length ?? 0;
  const active = BOT_SECTIONS.find((entry) => entry.id === section) ?? BOT_SECTIONS[0];

  return (
    <main data-bot-profile="" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* The page title sits on the sky; the section it names is the glass. */}
      <header className="shrink-0 px-6 pb-1 pt-5 max-md:pl-12 sm:px-8">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {t("profile.back")}
        </button>
        <h1 className="mt-2 text-[22px] font-semibold leading-7 tracking-[-0.015em] text-ink">
          {t("profile.title", { name: bot.name })}
        </h1>
        <p className="mt-0.5 text-[13px] text-ink-secondary">{profileSubtitle(bot, state.bots, roomCount)}</p>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 px-6 pb-6 sm:px-8">
        {/* Left: who this is, and the section list. Both float. */}
        <aside aria-label={t("profile.back")} className="hidden w-[248px] shrink-0 flex-col overflow-y-auto md:flex">
          <div className="flex items-center gap-3 py-3">
            <span className="relative shrink-0">
              <BotAvatar bot={bot} state={signals.working ? "working" : "happy"} size={44} animated={signals.working || signals.unread} />
              {signals.waiting && (
                <span role="status" aria-label={t("sidebar.preview.waiting")} className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-panel bg-warning" />
              )}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-ink">{bot.name}</div>
              <div className="truncate text-[12px] text-ink-secondary">{bot.title.trim() || t("crew.card.noTitle")}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              // Talk means the conversation, not the profile: select, then
              // leave the crew view for the chat.
              dispatch({ type: "select", id: bot.id });
              dispatch({ type: "showChat" });
            }}
            className="mb-3 flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-ink outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/60 focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <MessageCircle size={14} aria-hidden="true" className="text-ink-secondary" />
            {t("profile.talkTo", { name: bot.name })}
          </button>

          <div className="flex items-center gap-2 px-1.5 py-1.5">
            <Search size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Escape" && setQuery("")}
              placeholder={t("profile.search")}
              aria-label={t("profile.searchAria")}
              className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </div>

          <nav aria-label={t("profile.searchAria")} className="mt-1.5 space-y-0.5">
            {visibleSections.map((entry) => {
              const Icon = entry.icon;
              const current = entry.id === section;
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-current={current ? "page" : undefined}
                  onClick={() => open(entry.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] outline-none transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-accent/60",
                    current ? "bg-raised/70 font-medium text-ink" : "text-ink-secondary hover:bg-raised/40 hover:text-ink",
                  )}
                >
                  <Icon size={15} aria-hidden="true" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                </button>
              );
            })}
            {visibleSections.length === 0 && (
              <p className="px-2.5 py-2 text-[12.5px] text-ink-secondary">{t("profile.searchEmpty", { query: query.trim() })}</p>
            )}
          </nav>
        </aside>

        {/* Middle: the section, in glass. */}
        <div ref={contentRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="md:hidden">
            <div className="flex items-center gap-2 overflow-x-auto py-3">
              {BOT_SECTIONS.map((entry) => {
                const current = entry.id === section;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-current={current ? "page" : undefined}
                    onClick={() => open(entry.id)}
                    className={cn(
                      "shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium outline-none transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-accent/60",
                      current ? "bg-accent text-[var(--color-accent-ink)]" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
                    )}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
          </div>
          <h2 className="pb-2 text-[13px] font-semibold uppercase tracking-[0.02em] text-ink-secondary">{active.label}</h2>
          <GlassCard className="p-4 sm:p-5">
            {/* Memory keeps its mount while another section is open: it holds
                an unsaved draft in component state, and a profile that loses
                it because you glanced at Usage is a bug, not a feature. */}
            {section === "memory" && <BotSectionBody bot={bot} section="memory" data={data} memoryActive />}
            {section !== "memory" && <BotSectionBody bot={bot} section={section} data={data} />}
          </GlassCard>
          {section !== "memory" && (
            <div hidden>
              <BotSectionBody bot={bot} section="memory" data={data} memoryActive={false} />
            </div>
          )}
        </div>

        {/* Right: the summary. Every row is a jump, never an editor. */}
        <aside aria-label={t("profile.title", { name: bot.name })} className="hidden w-[300px] shrink-0 overflow-y-auto xl:block">
          <GlassCard className="space-y-1 p-4">
            <h3 className="pb-1 text-[13px] font-semibold text-ink">{t("profile.details")}</h3>
            <div className="pb-1">
              <div className="text-[11.5px] uppercase tracking-[0.04em] text-ink-secondary">{t("profile.soulPreview")}</div>
              <p className="mt-1 line-clamp-4 text-[12.5px] leading-relaxed text-ink">
                {bot.soul?.trim() || t("profile.soulEmpty")}
              </p>
            </div>
            <JumpRow
              icon={sectionRef("skills").icon}
              label={sectionRef("skills").label}
              value={counts.skills === null ? t("profile.loading") : t("profile.count.n", { count: counts.skills })}
              onOpen={() => open("skills")}
            />
            <JumpRow
              icon={sectionRef("memory").icon}
              label={sectionRef("memory").label}
              value={counts.topics === null ? t("profile.loading") : t("profile.topics.n", { count: counts.topics })}
              onOpen={() => open("memory")}
            />
            <JumpRow
              icon={sectionRef("model").icon}
              label={sectionRef("model").label}
              value={bot.modelSelection.model || t("profile.model.unset")}
              onOpen={() => open("model")}
            />
            <JumpRow
              icon={sectionRef("permissions").icon}
              label={sectionRef("permissions").label}
              value={grants === 0 ? t("profile.grants.none") : t("profile.count.n", { count: grants })}
              onOpen={() => open("permissions")}
            />
            <JumpRow
              icon={sectionRef("usage").icon}
              label={sectionRef("usage").label}
              value={t("profile.usage.ledger")}
              onOpen={() => open("usage")}
            />
            <JumpRow
              icon={sectionRef("voice").icon}
              label={sectionRef("voice").label}
              value={bot.speakReplies ? t("profile.voice.on") : t("profile.voice.off")}
              onOpen={() => open("voice")}
            />
            <JumpRow
              icon={sectionRef("history").icon}
              label={sectionRef("history").label}
              value={t("profile.history.empty")}
              onOpen={() => open("history")}
            />
            {team && team.lead?.id !== bot.id && (
              <p className="px-1.5 pt-1 text-[11.5px] leading-relaxed text-ink-secondary">
                {t("profile.teamNote", { name: team.label })}
              </p>
            )}
          </GlassCard>
        </aside>
      </div>

      <ConfirmDialog
        open={data.rollbackTarget !== null}
        title="Restore previous instructions?"
        body="Replaces current SOUL with the version before this change. Current version stays in History."
        confirmLabel="Restore instructions"
        tone="neutral"
        onCancel={data.cancelRollback}
        onConfirm={() => void data.performRollback()}
      />
    </main>
  );
}

/* The summary column reuses the section rail's own glyphs, so Skills here and
   Skills in the rail are visibly the same place. */
const SUMMARY_ICONS = {
  skills: BookOpen,
  memory: Brain,
  model: Cpu,
  permissions: ShieldCheck,
  usage: Coins,
  voice: Mic,
  history: History,
} as const;

/** The rail's own label and glyph for a section, so a jump row and the nav
 *  entry it opens cannot be called two different things. */
function sectionRef(id: BotSettingsSection): { label: string; icon: React.ComponentType<{ size?: number; className?: string }> } {
  const entry = BOT_SECTIONS.find((candidate) => candidate.id === id);
  return { label: entry?.label ?? id, icon: SUMMARY_ICONS[id as keyof typeof SUMMARY_ICONS] ?? entry?.icon ?? Cpu };
}