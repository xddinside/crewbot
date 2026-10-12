// The three things a bot's profile has to fetch, lifted out of the dialog so
// the Crew profile page and the chat's settings panel show the *same* data
// through one code path.
//
// Overview and the prompt preview are fetched on entry and again whenever the
// fields the server reads change; History is file-backed, so it is read only
// when its section is opened. Rollback lives here too, because a restore and
// the list it changes are one operation and must not be split.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, useStore, type Bot } from "@/state/store";
import type { BotOverview } from "@/lib/bot-overview-types";
import type { PromptPreviewData } from "./PromptPreview";
import type { HistoryRow } from "./HistorySection";

export interface BotProfileData {
  overview: BotOverview | null;
  /** true once a refetch failed *after* a good load — data wins over it */
  overviewRefreshError: boolean;
  overviewError: boolean;
  prompt: PromptPreviewData | null;
  promptError: boolean;
  historyRows: HistoryRow[] | null;
  historyError: boolean;
  historyRevision: string | null;
  rollingBack: boolean;
  /** non-null while the restore confirmation is up */
  rollbackTarget: { id: string; expectedRevision: string } | null;
  requestRollback: (id: string) => void;
  cancelRollback: () => void;
  /** run the confirmed restore; the host owns the confirmation card */
  performRollback: () => Promise<void>;
}

export function useBotProfileData(bot: Bot, section: string): BotProfileData {
  const { state, dispatch, flushBotPatches } = useStore();

  const [overview, setOverview] = useState<BotOverview | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [prompt, setPrompt] = useState<PromptPreviewData | null>(null);
  const [promptError, setPromptError] = useState(false);
  const [historyRows, setHistoryRows] = useState<HistoryRow[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyRevision, setHistoryRevision] = useState<string | null>(null);
  const historyRequest = useRef(0);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<{ id: string; expectedRevision: string } | null>(null);

  // The bot-record fields the server-built overview and system-prompt preview
  // actually read. A streamed message or unread flag replaces the bot object
  // but must not refetch an unchanged overview.
  const factsSignature = useMemo(
    () =>
      JSON.stringify([
        bot.name,
        bot.title,
        bot.description,
        bot.soul,
        bot.computer,
        bot.cloudBackend,
        bot.cwd,
        bot.autoApprove,
        bot.approvePeerComms,
        bot.peers,
        bot.section,
        bot.composio,
        bot.browser,
        bot.mcpServers,
        bot.chiefOfStaff,
        bot.managedSections,
        bot.modelSelection,
      ]),
    [
      bot.name,
      bot.title,
      bot.description,
      bot.soul,
      bot.computer,
      bot.cloudBackend,
      bot.cwd,
      bot.autoApprove,
      bot.approvePeerComms,
      bot.peers,
      bot.section,
      bot.composio,
      bot.browser,
      bot.mcpServers,
      bot.chiefOfStaff,
      bot.managedSections,
      bot.modelSelection,
    ],
  );

  // Fetch on entry: skills and memory are files, not bot-record fields, so
  // returning from either editor must reload their overview/prompt too. Await
  // the existing write queue instead of racing a second debounce.
  useEffect(() => {
    if (section !== "overview") return;
    let cancelled = false;
    const fetchOverviewAndPrompt = async () => {
      await flushBotPatches(bot.id);
      if (cancelled) return;
      void api(`/api/bots/${bot.id}/overview`)
        .then((data: BotOverview) => {
          if (cancelled) return;
          setOverview(data);
          setOverviewError(false);
        })
        .catch(() => {
          if (!cancelled) setOverviewError(true);
        });
      void api(`/api/bots/${bot.id}/system-prompt`)
        .then((data: PromptPreviewData) => {
          if (cancelled) return;
          setPrompt(data);
          setPromptError(false);
        })
        .catch(() => {
          if (!cancelled) setPromptError(true);
        });
    };

    void fetchOverviewAndPrompt();
    return () => {
      cancelled = true;
    };
  }, [bot.id, section, factsSignature, state.routines, state.webhooks, flushBotPatches]);

  // Read the file-backed history only when its section is opened. A newer
  // load (or leaving History) invalidates older rows, revision, and errors.
  const loadHistory = useCallback(() => {
    const request = ++historyRequest.current;
    setHistoryError(false);
    return flushBotPatches(bot.id)
      .then(() => api(`/api/bots/${bot.id}/history?limit=100`))
      .then((data: { rows: HistoryRow[]; revision: string }) => {
        if (request !== historyRequest.current) return;
        setHistoryRows(data.rows);
        setHistoryRevision(data.revision);
      })
      .catch(() => {
        if (request === historyRequest.current) setHistoryError(true);
      });
  }, [bot.id, flushBotPatches]);

  useEffect(() => {
    if (section !== "history") return;
    void loadHistory();
    return () => {
      historyRequest.current++;
    };
  }, [section, loadHistory]);

  // A rollback failure (the row's soul text no longer round-trips the server's
  // validation, say) still reloads history so the list matches the server's
  // actual state, but also surfaces the server's message through the app's
  // error toast — mirrors SoulField's Apply/Discard.
  const rollbackHistory = async (target: { id: string; expectedRevision: string }) => {
    if (rollingBack) return;
    setRollbackTarget(null);
    setRollingBack(true);
    try {
      await flushBotPatches(bot.id);
      await api(`/api/bots/${bot.id}/history/rollback`, {
        method: "POST",
        body: JSON.stringify(target),
      });
    } catch (e: unknown) {
      dispatch({
        type: "error",
        message: e instanceof Error ? e.message : "Couldn't undo that change.",
      });
    } finally {
      await loadHistory();
      setRollingBack(false);
    }
  };

  return {
    overview,
    // Data wins over a transient refetch failure: once an overview has loaded
    // once, a later failed refetch keeps showing it rather than replacing a
    // fully populated card with an error block.
    overviewRefreshError: overview !== null && overviewError,
    overviewError,
    prompt,
    promptError,
    historyRows,
    historyError,
    historyRevision,
    rollingBack,
    rollbackTarget,
    requestRollback: (id) => {
      if (historyRevision) setRollbackTarget({ id, expectedRevision: historyRevision });
    },
    cancelRollback: () => setRollbackTarget(null),
    performRollback: () => (rollbackTarget ? rollbackHistory(rollbackTarget) : Promise.resolve()),
  };
}