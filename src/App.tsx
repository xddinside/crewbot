import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Menu } from "lucide-react";
import { StoreProvider, useStore } from "@/state/store";
import { WelcomeFlow } from "@/components/onboarding/WelcomeFlow";
import { FirstConversationTour } from "@/components/onboarding/FirstConversationTour";
import { GuidedTour } from "@/components/onboarding/GuidedTour";
import { welcomeDue } from "@/lib/onboarding";
import { ThreadRefsProvider } from "@/components/ThreadRefs";
import { emailGateDone, initAnalytics } from "@/lib/analytics";
import { Sidebar } from "@/components/Sidebar";
import { AsciiSky } from "@/components/AsciiSky";
import { AppTopBar } from "@/components/AppTopBar";
import { HomeScreen } from "@/components/HomeScreen";
import { ProjectScreen } from "@/components/ProjectScreen";
import { ChatView } from "@/components/ChatView";
import { GroupView } from "@/components/GroupView";
import { BotSettingsDialog } from "@/components/BotSettingsDialog";
import { RemoteAgentSettingsPanel } from "@/components/RemoteAgentSettingsPanel";
import { NewBotDialog } from "@/components/NewBotDialog";
import { PluginsPanel, preloadConnectedApps } from "@/components/PluginsPanel";
import { ComputerPanel } from "@/components/ComputerPanel";
import { RemoteDesktopPanel } from "@/components/remote-desktop-panel";
import { InspectorPanel } from "@/components/InspectorPanel";
import { SettingsModal } from "@/components/SettingsModal";
import { WorkspaceBackupRecovery } from "@/components/WorkspaceBackupSettings";
import { UpdateBanner } from "@/components/UpdateBanner";
import { DesktopCapabilitiesProvider, useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { WindowCaptionButtons } from "@/components/WindowCaptionButtons";
import { RoutinesPage } from "@/components/RoutinesPage";
import { NoEngines } from "@/components/NoEngines";
import { CommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { LocalVmWorkspace } from "@/components/LocalVmWorkspace";
import { TeamMapPage } from "@/components/TeamMapPage";
import { CrewScreen } from "@/components/CrewScreen";
import { BotProfilePage } from "@/components/BotProfilePage";
import { destinationFor, type Destination } from "@/lib/shell-nav";
import { setLocale } from "@/lib/i18n";
import { shouldOpenKeyboardShortcuts } from "@/lib/keyboard-shortcuts";

function Shell() {
  const { state, dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const unreadCount =
    state.bots.filter((bot) => !bot.hidden && bot.unread).length +
    state.groups.filter((group) => group.unread).length;
  const remoteClient = window.ogb?.remoteClient?.active === true;
  useEffect(() => {
    if (!window.ogb?.environments) return;
    const open = (computerId?: string | null) => {
      if (computerId) {
        const target = new URL(window.location.href);
        target.searchParams.set("share-computer", computerId);
        window.history.replaceState(null, "", `${target.pathname}${target.search}${target.hash}`);
      }
      dispatch({ type: "toggleAppSettings", open: true, section: "desktopWorkspaces" });
    };
    const url = new URL(window.location.href);
    if (url.searchParams.get("desktop-settings") === "workspaces") {
      url.searchParams.delete("desktop-settings");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      open();
    }
    return window.ogb.environments.onOpenSettings?.(open);
  }, [dispatch]);
  // Mobile-only drawer state. Above md, none of these properties are emitted
  // at all — Sidebar scopes every mobile class with max-md: rather than
  // cancelling them with md:, which would still emit a translate value and
  // turn the aside into a containing block for its fixed descendants (see
  // Sidebar.tsx's className comment).
  const [drawerOpen, setDrawerOpen] = useState(false);
  /* The Home rail's escape to the whole workspace: the same Sidebar, opened
     over the canvas as a sheet. Rooms, sections, archived bots, the tools row
     and the thread folders all live in there, so the landing never has to
     carry a second copy of them to stay lossless. */
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  // Apply the configured UI language the moment config arrives or changes;
  // "" follows the system. The epoch bump re-renders extracted strings —
  // t() reads a module variable, so React needs this nudge.
  const language = state.config?.language ?? "";
  const [, setLocaleEpoch] = useState(0);
  useEffect(() => {
    setLocale(language || globalThis.navigator?.language);
    setLocaleEpoch((epoch) => epoch + 1);
  }, [language]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // The destination pill and the Ctrl+K chord open the same palette. The
  // shell owns the boolean so the search entry in the top bar and the global
  // chord can never disagree about what is open.
  const [paletteRequested, setPaletteRequested] = useState(false);
  const [localVmWorkspaceBotId, setLocalVmWorkspaceBotId] = useState<string | null>(null);
  /* Crew is three views of one destination: the roster, the team map, and a
     bot's profile. Which one is a *view*, not a second source of navigation
     truth — `activeView === "team-map"` still says "Crew", exactly as before,
     and the pill still highlights while any of the three is up. */
  const [crewView, setCrewView] = useState<{ view: "roster" | "map" | "profile"; botId: string | null; computers?: boolean }>({
    view: "roster",
    botId: null,
  });
  // the Browser tab, expanded into the main column (the small preview in
  // the panel hands off to this and back)
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const previousViewRef = useRef(state.activeView);
  const calendarOriginRef = useRef<"chat" | "team-map">("chat");
  const group = state.groups.find((g) => g.id === state.selectedId);
  const bot = group ? undefined : (state.bots.find((b) => b.id === state.selectedId) ?? state.bots[0]);
  const calendarFocus = state.activeView === "routines";

  /* Where we are, derived from what is already selected rather than stored a
     second time. See lib/shell-nav.ts. */
  const destination = destinationFor({
    activeView: state.activeView,
    selectedId: state.selectedId,
    selectedIsGroup: Boolean(group),
  });

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  /* A destination is a *view* of the existing selection, so clicking a pill
     never invents state — it moves the selection to something that already
     exists, and leaves it alone when there is nothing to move to.

     Home is the personal chat, so it needs a bot selected; Projects is a
     conversation, so it needs a room. Both fall back to "stay where you
     are" rather than blanking the screen on an empty workspace: a user with
     no rooms clicking Projects should see their work, not an empty page. */
  const goToDestination = useCallback(
    (next: Destination) => {
      if (next === "crew") {
        // The pill means the roster. The map is one of the roster's own
        // footer entries, not a separate destination the pill can land on.
        setCrewView({ view: "roster", botId: null });
        dispatch({ type: "showTeamMap" });
        return;
      }
      const wantGroup = next === "projects";
      const current = wantGroup
        ? state.groups.find((g) => g.id === state.selectedId)
        : state.bots.find((b) => b.id === state.selectedId);
      const target = current ?? (wantGroup ? state.groups[0] : state.bots.find((b) => !b.hidden));
      if (target) dispatch({ type: "select", id: target.id });
      else dispatch({ type: "showChat" });
    },
    [dispatch, state.bots, state.groups, state.selectedId],
  );

  // Nothing on this machine can run a bot. A missing cloud login does not
  // count — that CLI can still host a local model. Wait for the first
  // /api/instances response before deciding: an empty list means "not asked
  // yet", and flashing the setup screen at every launch would be worse.
  const noEngines =
    state.connected &&
    state.instances.length > 0 &&
    !state.instances.some((i) => i.snapshot.state === "available");

  /* The Home landing takes over only when there is genuinely a conversation to
     frame. Every gate the chat already had stays in front of it — no engine to
     run anything, a workspace holding the column, a room rather than a bot,
     still connecting, no bots yet — so F001's recovery screens keep their own
     layout instead of gaining a greeting over an empty canvas. */
  const showHome = destination === "home" && Boolean(bot) && !noEngines && !localVmWorkspaceBotId;
  /* Projects is the same shape for a room: the conversation still owns the
     middle, and the project's own conversations plus its goal, up-next and
     staffing run down the canvas either side of it. Same gates, so a room
     waiting on engine setup still gets the setup card rather than columns. */
  const showProjects = destination === "projects" && Boolean(group) && !noEngines && !localVmWorkspaceBotId;
  /* Crew, like Home and Projects, is a gate rather than a mode: only the
     roster's own view (activeView "team-map") reaches it, so the Automations
     calendar — a secondary destination that borrows the pill — keeps its own
     screen. */
  const showCrew = destination === "crew" && state.activeView === "team-map";
  const crewBot = crewView.botId ? state.bots.find((candidate) => candidate.id === crewView.botId) : undefined;
  /* Leaving Crew for anywhere else takes its view with it: a pill click always
     lands on the roster, never on the map or a profile you left behind. */
  useEffect(() => {
    if (!showCrew) setCrewView({ view: "roster", botId: null });
  }, [showCrew]);

  // App-wide shortcuts: ⌘N new bot · ⌘1–9 jump to bot · ⌘⇧[ / ⌘⇧] prev/next · ⌘/ or ? shortcuts cheat sheet.
  // Kept deliberately small; every panel already closes on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || state.shortcutsOpen) return;
      if (shouldOpenKeyboardShortcuts(e)) {
        e.preventDefault();
        dispatch({ type: "toggleShortcuts", open: true });
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // ⌘K opens the search palette. The palette owned this chord itself
      // before the redesign; the shell holds it now, so the top bar's search
      // entry is the same action rather than a second one with its own state.
      if (e.key.toLowerCase() === "k" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setPaletteRequested((open) => !open);
        return;
      }
      const bots = state.bots.filter((b) => !b.hidden);
      if (e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "toggleNewBot", open: true });
      } else if (/^[1-9]$/.test(e.key)) {
        const target = bots[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          dispatch({ type: "select", id: target.id });
        }
      } else if (e.shiftKey && (e.key === "[" || e.key === "]")) {
        const idx = bots.findIndex((b) => b.id === state.selectedId);
        const next = bots[(idx + (e.key === "]" ? 1 : -1) + bots.length) % bots.length];
        if (next) {
          e.preventDefault();
          dispatch({ type: "select", id: next.id });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.bots, state.selectedId, state.shortcutsOpen, dispatch]);

  useEffect(() => {
    window.ogb?.setUnreadCount?.(unreadCount);
  }, [unreadCount]);

  // Warm connected-account state as soon as the local server is available.
  // The modal then opens with the correct Connect/Add account buttons and
  // quietly revalidates instead of rediscovering every account from scratch.
  useEffect(() => {
    if (!state.connected) return;
    void preloadConnectedApps().catch(() => {});
  }, [state.connected]);

  // Picking a conversation closes the drawer: on a phone the chat is what you
  // asked for, and leaving the list up would hide it. Watching activeView too
  // catches re-selecting the bot that is already current from another view —
  // the reducer switches the view without changing selectedId. pluginsOpen
  // and settingsOpen cover the same idea from a different trigger: close the
  // drawer whenever an action opens something over the chat.
  useEffect(() => {
    setDrawerOpen(false);
  }, [state.selectedId, bot?.threadId, group?.threadId, state.activeView, crewView, state.pluginsOpen, state.settingsOpen]);

  /* The workspace sheet belongs to Home and Projects. Leaving either — a bot
     selected from inside it, the Crew pill, the calendar — takes it down with
     us, rather than leaving a column of the sidebar floating over an unrelated
     screen. */
  useEffect(() => {
    if (!showHome && !showProjects && !showCrew) setWorkspaceOpen(false);
  }, [showHome, showProjects, showCrew]);

  useEffect(() => {
    if (state.activeView === "routines" && previousViewRef.current !== "routines") {
      calendarOriginRef.current = previousViewRef.current;
    }
    previousViewRef.current = state.activeView;
  }, [state.activeView]);

  useEffect(() => {
    if (
      localVmWorkspaceBotId &&
      (state.activeView !== "chat" || state.selectedId !== localVmWorkspaceBotId)
    ) {
      setLocalVmWorkspaceBotId(null);
    }
  }, [localVmWorkspaceBotId, state.activeView, state.selectedId]);

  const openLocalVmWorkspace = (botId: string) => {
    dispatch({ type: "toggleComputer", open: false });
    setLocalVmWorkspaceBotId(botId);
  };

  /* The sheet's "Manage computers" opens Crew's team-computers shelf when the
     bot is on a shared team computer, and Settings / Computers otherwise. The
     shell owns Crew's views, so the sheet asks rather than dispatching. */
  const openTeamComputers = useCallback(() => {
    setCrewView({ view: "map", botId: null, computers: true });
    dispatch({ type: "toggleComputer", open: false });
    dispatch({ type: "showTeamMap" });
  }, [dispatch]);

  const openComputerFromWorkspace = (botId: string) => {
    setLocalVmWorkspaceBotId(null);
    dispatch({ type: "select", id: botId });
    dispatch({ type: "toggleComputer", open: true });
  };

  const closeCalendar = useCallback(() => {
    if (calendarOriginRef.current === "team-map") {
      setCrewView({ view: "roster", botId: null });
      dispatch({ type: "showTeamMap" });
      return;
    }
    dispatch({ type: "select", id: state.selectedId });
  }, [dispatch, state.selectedId]);
  const openCalendarRoom = useCallback((id: string) => {
    dispatch({ type: "select", id });
  }, [dispatch]);

  const nativeViewOverlayOpen =
    drawerOpen ||
    paletteOpen ||
    state.settingsOpen ||
    state.computerOpen ||
    state.inspectorOpen ||
    state.appSettingsOpen ||
    state.pluginsOpen;

  // The macOS app menu's Preferences… item lives in the desktop shell, so the
  // shell signals the request over the bridge (Cmd+, accelerates the item).
  // Local-shell only: remote server pages never receive the channel, and ogb
  // is absent in the browser.
  useEffect(() => {
    return window.ogb?.onOpenAppSettings?.(() => dispatch({ type: "toggleAppSettings", open: true }));
  }, [dispatch]);

  // The viewer outlives ComputerPanel and can target any bot, so release control
  // here (always mounted) when a bot's viewer closes. release() is idempotent.
  useEffect(() => {
    return window.ogb?.desktopViewer?.onState((viewer) => {
      if (viewer.open || !viewer.contextId) return;
      const botId = viewer.contextId;
      void fetch(`/api/bots/${botId}/computer/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "release" }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((snap) => {
          if (snap) dispatch({ type: "computerControl", botId, held: snap.held === true, helpReason: snap.helpReason ?? null });
        })
        .catch(() => {});
      void fetch(`/api/bots/${botId}/computer/viewer-close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }).catch(() => {});
    });
  }, [dispatch]);

  return (
    // There is no app window. The shell is a transparent column over the sky:
    // a top bar, then whatever the destination holds, with the sidebar
    // floating on the canvas at the left rather than inside a bordered panel.
    <div className="relative flex h-full flex-col bg-transparent" data-app-shell="">
      {/* The sky. Fixed, behind everything, pointer-events-none — the whole
          app stands on it. */}
      <AsciiSky />
      {/* fixed-position popup, bottom-left — outside the layout flow */}
      <UpdateBanner />
      <AppTopBar
        destination={destination}
        onSelect={goToDestination}
        onOpenSearch={() => setPaletteRequested(true)}
      />
      <div className="relative z-10 flex min-h-0 flex-1">
      {/* The phone's way into the bot list. It lives outside the Home branch
          on purpose: below `md` the landing has no rail and no context column,
          so without this button a phone would have no route to rooms,
          sections, archived bots or tools at all. */}
      {!calendarFocus && <button
        type="button"
        ref={menuButtonRef}
        aria-label="Open bot list"
        aria-expanded={drawerOpen}
        onClick={() => setDrawerOpen(true)}
        className="glass-card absolute left-3 top-3 z-30 flex size-9 items-center justify-center text-ink-secondary md:hidden"
      >
        <Menu size={18} />
      </button>}
      {drawerOpen && !calendarFocus && (
        <div
          aria-hidden
          onMouseDown={(e) => e.target === e.currentTarget && setDrawerOpen(false)}
          className="app-scrim absolute inset-0 z-30 md:hidden"
        />
      )}
      {showHome ? (
        /* Home. The conversation is the screen; the greeting over it and the
           two context columns around it sit directly on the sky. Above `md`
           the sidebar is not in this branch — it opens as a sheet on request,
           so the landing never has to carry a second copy of rooms, sections,
           archived bots or tools to stay lossless. */
        <>
          <HomeScreen
            bot={bot!}
            onOpenAll={() => setWorkspaceOpen(true)}
            onGoProjects={() => goToDestination("projects")}
            onShowAutomations={() => dispatch({ type: "showRoutines" })}
          >
            <ChatView bot={bot!} />
          </HomeScreen>
          {/* Below `md` the landing has no rail, so the drawer is still the
              only route to the rest of the workspace. The wrapper is a plain
              block there — a zero-width flex item, with the sidebar's own
              `max-md:absolute` still resolving against the shell. */}
          <div className="md:hidden">
            {!calendarFocus && <Sidebar open={drawerOpen} onClose={closeDrawer} />}
          </div>
          {workspaceOpen && (
            <div className="fixed inset-0 z-30">
              <div aria-hidden className="app-scrim absolute inset-0" onMouseDown={() => setWorkspaceOpen(false)} />
              <div className="glass-sheet relative h-full w-[320px] max-sm:w-full">
                <Sidebar open onClose={() => setWorkspaceOpen(false)} />
              </div>
            </div>
          )}
        </>
      ) : showProjects ? (
        /* Projects. The room's conversation is the screen; its conversations
           run down the left on the sky and its goal, up-next and staffing run
           down the right. Same escape hatch as Home — above `md` the sidebar
           opens as a sheet on request rather than sitting beside the rail —
           so rooms, sections, archived bots and tools stay one click away. */
        <>
          <ProjectScreen group={group!} onOpenAll={() => setWorkspaceOpen(true)}>
            <GroupView key={group!.id} group={group!} />
          </ProjectScreen>
          <div className="md:hidden">
            <Sidebar open={drawerOpen} onClose={closeDrawer} />
          </div>
          {workspaceOpen && (
            <div className="fixed inset-0 z-30">
              <div aria-hidden className="app-scrim absolute inset-0" onMouseDown={() => setWorkspaceOpen(false)} />
              <div className="glass-sheet relative h-full w-[320px] max-sm:w-full">
                <Sidebar open onClose={() => setWorkspaceOpen(false)} />
              </div>
            </div>
          )}
        </>
      ) : showCrew ? (
        /* Crew. The roster, the team map and a bot's profile are three views
           of the same destination; none of them is a container. The sidebar is
           not in this branch above `md` — it opens as the same glass sheet Home
           and Projects use, from the roster's own footer. */
        <>
          {crewView.view === "profile" && crewBot ? (
            <BotProfilePage
              key={`profile:${crewBot.id}`}
              bot={crewBot}
              onBack={() => setCrewView({ view: "roster", botId: null })}
            />
          ) : crewView.view === "map" ? (
            <TeamMapPage
              openComputers={crewView.computers}
              onBack={() => setCrewView({ view: "roster", botId: null })}
            />
          ) : (
            <CrewScreen
              onOpenBot={(botId) => setCrewView({ view: "profile", botId })}
              onOpenTeamMap={() => setCrewView({ view: "map", botId: null })}
              onOpenTeamComputers={() => setCrewView({ view: "map", botId: null, computers: true })}
              onOpenAll={() => setWorkspaceOpen(true)}
            />
          )}
          <div className="md:hidden">
            <Sidebar open={drawerOpen} onClose={closeDrawer} />
          </div>
          {workspaceOpen && (
            <div className="fixed inset-0 z-30">
              <div aria-hidden className="app-scrim absolute inset-0" onMouseDown={() => setWorkspaceOpen(false)} />
              <div className="glass-sheet relative h-full w-[320px] max-sm:w-full">
                <Sidebar open onClose={() => setWorkspaceOpen(false)} />
              </div>
            </div>
          )}
        </>
      ) : (
        <>
      {/* The context column. It floats: no panel fill, no right border, a
          gutter so the lists have air against the sky. */}
      {!calendarFocus && (
        <Sidebar
          open={drawerOpen}
          onClose={closeDrawer}
          onShowCrewMap={() => {
            setCrewView({ view: "map", botId: null });
            dispatch({ type: "showTeamMap" });
          }}
        />
      )}
      {state.activeView === "routines" ? (
        <RoutinesPage onBack={closeCalendar} onOpenRoom={openCalendarRoom} />
      ) : !remoteClient && localVmWorkspaceBotId ? (
        <LocalVmWorkspace
          primaryBotId={localVmWorkspaceBotId}
          overlayOpen={nativeViewOverlayOpen}
          onClose={() => setLocalVmWorkspaceBotId(null)}
          onOpenComputer={openComputerFromWorkspace}
        />
      ) : noEngines ? (
        <NoEngines />
      ) : group ? (
        <GroupView key={group.id} group={group} />
      ) : bot ? (
        <ChatView bot={bot} />
      ) : (
        <main className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 text-ink-secondary">
          <Loader2 size={20} className="animate-spin" />
          <div className="text-[14px]">
            {state.connected ? "No bots yet" : "Connecting to the bot server…"}
          </div>
          {!state.connected && (
            <div className="text-[12px]">
              Start it with <code className="rounded bg-raised px-1.5 py-0.5">pnpm dev:server</code>
            </div>
          )}
        </main>
      )}
        </>
      )}
      {/* Settings and Apps & tools are *pages*, not overlays: each is a
          `flex-1` child of this column, which is what gives it its height and
          the scroll it owns. They stay in here while the dialogs below move
          out, because a page and a sheet need opposite things from a parent:
          the page needs the flex box, the sheet needs to escape the tier. */}
      {state.appSettingsOpen && <SettingsModal />}
      {state.pluginsOpen && <PluginsPanel />}
      </div>
      {/* The panels are siblings of the content column, not children of it.
          The column carries `z-10`, which is a stacking context: a sheet
          inside it can only ever paint inside that tier, so the top bar
          (`z-30`) drew *over* every dialog — its header covered the first
          56px of an open sheet and a click there landed on the header
          instead of the control underneath. Out here a sheet's own z-index is
          global again, and DOM order still keeps the palette above the
          modals. The keys still differ even though each is remounted per
          bot: two siblings keyed `bot.id` collide in React's keyed
          reconciliation whenever both are open (Computer panel, then the
          usage chip), so a fresh settings panel mounts and the old one never
          unmounts. */}
      {/* The panels below are siblings, so their keys must differ even
          though each is remounted per bot. Two siblings keyed `bot.id`
          collide in React's keyed reconciliation whenever both are open
          (Computer panel, then the usage chip): every re-render mounts a
          fresh settings panel and never removes the previous one, so the
          panels pile up and Close stops working. */}
      {state.settingsOpen && bot && (
        remoteClient
          ? <RemoteAgentSettingsPanel bot={bot} />
          : <BotSettingsDialog key={`settings:${bot.id}`} bot={bot} />
      )}
      {state.computerOpen && bot && (
        remoteClient ? (
          <RemoteDesktopPanel key={`computer:${bot.id}`} bot={bot} />
        ) : (
          <ComputerPanel
            key={`computer:${bot.id}`}
            bot={bot}
            onOpenVmWorkspace={openLocalVmWorkspace}
            onOpenTeamComputers={openTeamComputers}
          />
        )
      )}
      {!remoteClient && state.inspectorOpen && bot && <InspectorPanel key={bot.threadId} bot={bot} />}
      {state.newBotOpen && <NewBotDialog />}
      {state.shortcutsOpen && (
        <KeyboardShortcutsModal
          open={state.shortcutsOpen}
          onClose={() => dispatch({ type: "toggleShortcuts", open: false })}
        />
      )}
      {/* mounted after the modals: same z-50 tier, so DOM order keeps the
          palette on top when one of them is open underneath */}
      <CommandPalette onOpenChange={setPaletteOpen} open={paletteRequested} />

      {/* Renderer-drawn caption buttons for the overlay-less frameless
          Windows window. Deliberately the LAST child of the shell: Blink
          resolves -webkit-app-region in DOM-walk order, so these no-drag
          buttons must come after every drag-region header to actually
          subtract from it — earlier placement let the header's drag region
          swallow the buttons (dead clicks, no hover). z-40 keeps true
          modals (z-50, later in DOM) painting above the buttons. */}
      <WindowCaptionButtons
        visible={capabilities.windowChrome === "win-caption" && Boolean(window.ogb?.windowControls)}
      />
    </div>
  );
}

/** Opens the welcome flow on a fresh workspace (the server's onboarding
 * record says so) or on request from Settings. The decision waits for the
 * config to arrive, so a returning user never sees the tour flash. */
function WelcomeGate() {
  const { state, dispatch } = useStore();
  const [dismissed, setDismissed] = useState(false);
  const due =
    !dismissed &&
    welcomeDue(state.config, {
      remoteClient: window.ogb?.remoteClient?.active === true,
      legacyDone: emailGateDone(),
    });
  // Explicit desktop connection Settings need no local provider onboarding.
  // Organisation remains optional; closing Settings resumes the normal tour.
  if (state.appSettingsOpen && ["desktopWorkspaces", "organization"].includes(state.appSettingsSection)) return null;
  if (!state.welcomeOpen && !due) return null;
  const bot = state.bots.find((b) => !b.hidden) ?? null;
  const replay = state.welcomeOpen && !due;
  return (
    <WelcomeFlow
      bot={bot}
      replay={replay}
      onDone={() => {
        setDismissed(true);
        dispatch({ type: "toggleWelcome", open: false });
        // the first real finish hands over to the guided tour; a replay does not
        if (!replay) dispatch({ type: "toggleTour", open: true });
      }}
    />
  );
}

function Application() {
  useEffect(() => {
    initAnalytics();
  }, []);
  return (
    <DesktopCapabilitiesProvider>
      <StoreProvider>
        <ThreadRefsProvider>
          <Shell />
        </ThreadRefsProvider>
        <WelcomeGate />
        <GuidedTour />
        <FirstConversationTour />
      </StoreProvider>
    </DesktopCapabilitiesProvider>
  );
}

export default function App() {
  return <WorkspaceBackupRecovery><Application /></WorkspaceBackupRecovery>;
}
