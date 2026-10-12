// One renderer for the twelve profile sections.
//
// The profile has two homes after the redesign: the Crew page (section nav on
// the sky, one section at a time) and the chat's settings panel (an accordion,
// one section folded open). They are the same content with the same data, so
// the choice of body lives here rather than in either host — which is how the
// two can never show different controls for the same bot.

import { useStore, type Bot, type BotSettingsSection } from "@/state/store";
import { OverviewSection } from "./OverviewSection";
import { IdentitySection } from "./IdentitySection";
import { SoulSection } from "./SoulSection";
import { SkillsSection } from "./SkillsSection";
import { MemorySection } from "./MemorySection";
import { RoutinesSection } from "./RoutinesSection";
import { AccessSection } from "./AccessSection";
import { ModelSection } from "./ModelSection";
import { PermissionsSection } from "./PermissionsSection";
import { VoiceSection } from "./VoiceSection";
import { HistorySection } from "./HistorySection";
import { UsageSection } from "./UsageSection";
import { useBotSettingsDerived } from "./useBotSettingsDerived";
import type { BotProfileData } from "./useBotProfileData";

export interface BotSectionBodyProps {
  bot: Bot;
  section: BotSettingsSection;
  data: BotProfileData;
  /** Memory only fetches while it is on screen, and its host decides that. */
  memoryActive?: boolean;
}

export function BotSectionBody({ bot, section, data, memoryActive = true }: BotSectionBodyProps) {
  const { state, dispatch } = useStore();
  const derived = useBotSettingsDerived(bot);

  switch (section) {
    case "overview":
      return data.overview === null && data.overviewError ? (
        <div className="rounded-xl bg-card p-4 text-[13px] text-ink-secondary">Couldn’t load the overview.</div>
      ) : (
        <OverviewSection
          overview={data.overview}
          refreshError={data.overviewRefreshError}
          prompt={data.prompt}
          promptError={data.promptError}
          onOpen={(target) => dispatch({ type: "toggleSettings", open: true, section: target })}
          onSetup={
            derived.canCoordinate && !bot.busy
              ? () => {
                  dispatch({ type: "toggleSettings", open: false });
                  dispatch({ type: "send", botId: bot.id, text: "/setup", threadId: bot.threadId });
                }
              : undefined
          }
        />
      );
    case "identity":
      return (
        <IdentitySection
          bot={bot}
          patch={derived.patch}
          activeState={derived.activeState}
          mascotMotion={derived.mascotMotion}
        />
      );
    case "soul":
      return <SoulSection bot={bot} patch={derived.patch} />;
    case "skills":
      return <SkillsSection bot={bot} />;
    case "memory":
      return <MemorySection bot={bot} active={memoryActive} />;
    case "routines":
      return <RoutinesSection bot={bot} routines={derived.botRoutines} runs={state.routineRuns} />;
    case "access":
      return <AccessSection bot={bot} derived={derived} />;
    case "model":
      return <ModelSection bot={bot} />;
    case "permissions":
      return <PermissionsSection bot={bot} derived={derived} />;
    case "voice":
      return <VoiceSection bot={bot} derived={derived} />;
    case "history":
      return data.historyRows === null && data.historyError ? (
        <div className="rounded-xl bg-card p-4 text-[13px] text-ink-secondary">Couldn’t load history.</div>
      ) : (
        // Same precedence as the Overview: rows already on screen survive a
        // failed reload (after an undo, say) with a quiet note rather than
        // being replaced by an error block.
        <HistorySection
          bot={bot}
          rows={data.historyRows}
          refreshError={data.historyRows !== null && data.historyError}
          onRollback={data.requestRollback}
          rollingBack={data.rollingBack || !data.historyRevision}
        />
      );
    case "usage":
      return <UsageSection bot={bot} />;
    default:
      return null;
  }
}