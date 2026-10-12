// App settings, as a real page rather than one long panel.
//
// The page stands on the sky: the rail, the search box, the page title and
// every heading sit directly on the canvas, and the only frosted surfaces are
// the cards where work happens — the same rule the rest of the redesign
// follows. Which sections exist, how they are searched and which one a
// request resolves to are decisions rather than rendering, so they live in
// `lib/settings-view.ts` and the rail reads one answer.
//
// Per-bot settings (persona, model, computer) live in BotSettingsDialog — this
// is the stuff shared by every bot: who you are, your keys, and the
// machine your bots can borrow.
import { useEffect, useRef, useState } from "react";
import { Archive, Boxes, Coins, FlaskConical, KeyRound, Monitor, Palette, Search, TabletSmartphone, Terminal, User, Users, X, Building2 } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { analyticsEnabled, setAnalyticsEnabled } from "@/lib/analytics";
import { browserAvailable, browserUnavailableReason, builtInBrowserEnabled, showToolCallsEnabled, skillAuthoringEnabled } from "@/lib/feature-flags";
import { localeChoices } from "@/locales";
import { t } from "@/lib/i18n";
import { withTourReset } from "@/lib/guided-tour";
import { completionPatch } from "@/lib/onboarding";
import {
  availableSettingsSections,
  backupsSurfaces,
  remoteAccessTabs,
  resolveBackupsSurface,
  resolveRemoteAccessTab,
  resolveSettingsSection,
  visibleSettingsSections,
  type BackupsSurface,
  type RemoteAccessTab,
  type SettingsSection,
  type SettingsSectionIcon,
} from "@/lib/settings-view";
import { ApiKeyRow, OpenAiCompatUrl, VpsConnection } from "./ApiKeys";
import { useUpdaterState } from "@/lib/updater";
import { McpAccessSettings } from "./McpAccessSettings";
import { EnginesSettings } from "./EnginesSettings";
import { LocalComputerSection } from "./LocalComputerSection";
import { CompanionSection } from "./CompanionSection";
import { ServerPairingCard } from "./ServerPairingCard";
import { PeopleSection } from "./PeopleSection";
import { CustomDomainSettings } from "./CustomDomainSettings";
import { BrowserProfilesManager } from "./BrowserProfilesManager";
import { RemoteComputerSection } from "./RemoteComputerSection";
import { ConnectedWorkspacesSettings } from "./ConnectedWorkspacesSettings";
import { OrganizationSettings } from "./OrganizationSettings";
import { Card, SettingRow, Switch } from "./SettingsPrimitives";
import { shortcutLabel } from "./ShortcutHint";
import { UsageSection } from "./UsageSection";
import { WorkspacesSection, workspacesAvailable } from "./WorkspacesSection";
import { SkinPicker } from "./SkinPicker";
import { RoomTurnTimeoutSettings } from "./RoomTurnTimeoutSettings";
import { ThreadConcurrencySettings } from "./ThreadConcurrencySettings";
import { WorkspaceBackupSettings } from "./WorkspaceBackupSettings";
import { CompanyBackupSettings, companyBackupsReachable } from "./CompanyBackupSettings";
import { GlassPanel, SEGMENT_ACTIVE, SEGMENT_IDLE, SEGMENT_RAIL } from "./Glass";
import {
  APP_REPOSITORY,
  DOCS_URL,
  FEEDBACK_URL,
  HELP_CENTER_URL,
  LICENSE_URL,
  RELEASES_URL,
  appVersion,
  openExternalLink,
} from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { setShowThreads, useShowThreads } from "@/lib/thread-preferences";

// Icons stay here so the registry in `lib/settings-view.ts` is plain data and
// its rules can be tested without a renderer.
const SECTION_ICONS: Record<SettingsSectionIcon, typeof User> = {
  user: User,
  workspaces: Building2,
  organization: Building2,
  palette: Palette,
  flask: FlaskConical,
  key: KeyRound,
  terminal: Terminal,
  remote: TabletSmartphone,
  monitor: Monitor,
  coins: Coins,
  people: Users,
  backups: Archive,
  fleet: Boxes,
};

const sectionLabel = (section: SettingsSection) => t(section.labelKey);

// `labelKey`, not a label: t() reads the active pack when it is called, so a
// label resolved here at module scope would freeze the language the app booted
// in. The English keywords stay untranslated — they are a search index, and a
// pack that omits them still matches what people type.
/** Name + email, persisted to /api/config {profile} on blur.
 *
 * Labelled rows rather than placeholder-only fields: a field that shows its
 * label only while it is empty cannot be read at a glance, and these two are
 * the first thing anyone sets. Each saves on blur, so a person who tabs
 * through the page has already filled both in. */
function ProfileFields() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(state.config?.profile?.name ?? "");
  const [email, setEmail] = useState(state.config?.profile?.email ?? "");
  useEffect(() => {
    setName(state.config?.profile?.name ?? "");
    setEmail(state.config?.profile?.email ?? "");
  }, [state.config?.profile?.name, state.config?.profile?.email]);

  const save = (field: "name" | "email", value: string) => {
    const next = field === "name" ? { name: value.trim(), email: email.trim().toLowerCase() } : { name: name.trim(), email: value.trim().toLowerCase() };
    void fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: next }),
    })
      .then((r) => r.json())
      .then((config) => dispatch({ type: "configStatus", config }))
      .catch(() => {});
  };

  const field =
    "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:border-focus focus:outline-none";
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:items-start sm:gap-4">
      <div className="flex items-center gap-3 sm:flex-col sm:items-start">
        <span className="flex size-14 items-center justify-center rounded-full bg-raised text-[18px] font-semibold text-ink-secondary ring-1 ring-hairline/50">
          {(name || state.config?.profile?.email || "?").trim().slice(0, 1).toUpperCase()}
        </span>
        <p className="text-[12px] leading-relaxed text-ink-secondary sm:mt-1">{t("settings.profile.subtitle")}</p>
      </div>
      <div className="grid min-w-0 gap-3">
        <label className="grid gap-1.5 text-[12px] font-medium text-ink-secondary">
          {t("settings.profile.name")}
          <input aria-label={t("settings.profile.name")} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => save("name", name)} placeholder={t("settings.profile.namePlaceholder")} className={field} />
        </label>
        <label className="grid gap-1.5 text-[12px] font-medium text-ink-secondary">
          {t("settings.profile.emailLabel")}
          <input type="email" aria-label={t("settings.profile.emailLabel")} value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => save("email", email)} placeholder="you@example.com" className={field} />
        </label>
      </div>
    </div>
  );
}

function UpdatesRow() {
  const s = useUpdaterState();
  if (!window.ogb?.updater) return null;
  const updater = window.ogb.updater;
  const label =
    s?.status === "checking"
      ? t("settings.updates.checking")
      : s?.status === "available"
        ? t("settings.updates.available", { version: s.version ?? "" })
        : s?.status === "downloading"
          ? s.percent == null
            ? t("settings.updates.startingDownload")
            : t("settings.updates.downloading", { percent: Math.round(s.percent) })
          : s?.status === "preparing"
            ? t("settings.updates.preparing")
            : s?.status === "downloaded"
              ? s.installMode === "handoff"
                ? t("settings.updates.readyInstall", { version: s.version ?? "" })
                : t("settings.updates.ready", { version: s.version ?? "" })
              : s?.status === "installing"
                ? s.message ||
                  (s.installMode === "handoff"
                    ? t("settings.updates.openingTerminal")
                    : t("settings.updates.restarting"))
                : s?.status === "handed-off"
                  ? t("settings.updates.handedOff")
                  : s?.status === "error"
                    ? t("settings.updates.failed", { message: s.message ?? t("settings.updates.unknownError") })
                    : t("settings.updates.latest");
  return (
    <SettingRow title={t("settings.updates.title")} subtitle={label}>
      <button
        onClick={() => {
          if (s?.status === "available") return void updater.download();
          if (s?.status === "downloaded") return void updater.install();
          void updater.check();
        }}
        disabled={
          s?.status === "checking" || s?.status === "downloading" || s?.status === "preparing" ||
          s?.status === "installing" || s?.retryable === false
        }
        className="ui-button"
      >
        {s?.retryable === false
          ? t("settings.updates.quitReopen")
          : s?.status === "available"
            ? t("settings.updates.download")
            : s?.status === "downloaded"
              ? s.installMode === "handoff"
                ? t("settings.updates.install")
                : t("settings.updates.restart")
              : s?.status === "preparing"
                ? t("settings.updates.preparingShort")
                : s?.status === "installing"
                  ? s.installMode === "handoff"
                    ? t("settings.updates.opening")
                    : t("settings.updates.restartingShort")
                  : t("settings.updates.check")}
      </button>
    </SettingRow>
  );
}

/** Usage analytics, on by default and switchable here. Naming what is sent
 * matters more than the switch: people who cannot see the scope assume the
 * worst, and the worst — conversation text — is exactly what this never
 * sends (autocapture is off; see lib/analytics.ts). */
function AnalyticsRow() {
  const [on, setOn] = useState(analyticsEnabled);
  return (
    <SettingRow title={t("settings.analytics.title")} subtitle={t("settings.analytics.subtitle")}>
      <Switch
        checked={on}
        aria-label={t("settings.analytics.aria")}
        onClick={() => {
          const next = !on;
          setAnalyticsEnabled(next);
          setOn(next);
        }}
      />
    </SettingRow>
  );
}

/** Clears the tour's steps and opens it again on the live interface. */
function ReplayAppTourButton() {
  const { state, dispatch } = useStore();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div>
      <button
        disabled={saving}
        onClick={() => {
          setSaving(true);
          setFailed(false);
          void api("/api/config", {
            method: "PUT",
            body: JSON.stringify({ onboarding: {
              // Upgraded users may have completed only the legacy browser gate.
              ...(!state.config?.onboarding?.completedAt ? completionPatch().onboarding : {}),
              hintsSeen: withTourReset(state.config?.onboarding),
            } }),
            signal: AbortSignal.timeout(10_000),
          })
            .then((config) => {
              dispatch({ type: "configStatus", config });
              dispatch({ type: "toggleTour", open: true });
            })
            .catch(() => setFailed(true))
            .finally(() => setSaving(false));
        }}
        className="ui-button"
      >
        {t("settings.welcome.appTour")}
      </button>
      {failed && <p role="alert" className="mt-2 text-[13px] text-danger">{t("onboarding.tour.error")}</p>}
    </div>
  );
}

function ReplayTourRow() {
  const { dispatch } = useStore();
  return (
    <SettingRow title={t("settings.welcome.title")} subtitle={t("settings.welcome.subtitle")}>
      <div className="flex flex-wrap gap-2">
        <ReplayAppTourButton />
        <button
          onClick={() => dispatch({ type: "toggleWelcome", open: true })}
          className="ui-button"
        >
          {t("settings.welcome.replay")}
        </button>
      </div>
    </SettingRow>
  );
}

function LanguageRow() {
  const { state, dispatch } = useStore();
  const current = state.config?.language ?? "";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (language: string) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ language }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.language.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow
      title={t("settings.language.title")}
      subtitle={t("settings.language.subtitle")}
      message={error ? <p role="alert" className="text-danger">{error}</p> : null}
    >
      <select
        value={current}
        disabled={saving}
        aria-label={t("settings.language.aria")}
        onChange={(event) => void save(event.target.value)}
        className="min-h-8 w-full max-w-[240px] rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 text-[13px] text-ink focus:border-focus disabled:cursor-wait disabled:opacity-50"
      >
        <option value="">{t("settings.language.system")}</option>
        {localeChoices.map(({ code, label }) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}

function ShowThreadsRow() {
  const enabled = useShowThreads();
  return (
    <SettingRow title={t("settings.threadDisplay.title")} subtitle={t("settings.threadDisplay.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.threadDisplay.show")}
        onClick={() => setShowThreads(!enabled)}
      />
    </SettingRow>
  );
}

function ToolCallsRow() {
  const { state, dispatch } = useStore();
  const enabled = showToolCallsEnabled(state.config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { showToolCalls: !enabled } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.toolCalls.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow
      title={t("settings.toolCalls.title")}
      subtitle={<>{t("settings.toolCalls.subtitle")} {t("settings.toolCalls.detail")}</>}
      message={error ? <p role="alert" className="text-danger">{error}</p> : null}
    >
      <Switch
        checked={enabled}
        aria-label={t("settings.toolCalls.aria")}
        disabled={saving}
        onClick={() => void toggle()}
        className="disabled:cursor-wait disabled:opacity-50"
      />
    </SettingRow>
  );
}

function ExperimentalFeaturesRow() {
  const { state, dispatch } = useStore();
  const skillAuthoring = skillAuthoringEnabled(state.config);
  const browser = builtInBrowserEnabled(state.config);
  const desktopBrowser = browserAvailable(state.config);
  const browserInstallable = state.config?.browserEngine?.installable === true;
  const browserBlockedOnWindows = window.ogb?.platform === "win32" && !desktopBrowser && !browserInstallable;
  const [saving, setSaving] = useState<"skillAuthoring" | "browser" | null>(null);
  const [error, setError] = useState("");

  const toggle = async (feature: "skillAuthoring" | "browser", next: boolean) => {
    if (saving) return;
    setSaving(feature);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { [feature]: next } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.experimental.error"));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card title={t("settings.experimental.title")} subtitle={t("settings.experimental.subtitle")}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink">{t("settings.experimental.skillAuthoring")}</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">
            {t("settings.experimental.skillAuthoringDetail")}
          </div>
        </div>
        <Switch
          checked={skillAuthoring}
          aria-label={t("settings.experimental.skillAuthoringAria")}
          disabled={saving !== null}
          onClick={() => void toggle("skillAuthoring", !skillAuthoring)}
          className="disabled:cursor-wait disabled:opacity-50"
        />
      </div>
      <div className="mt-4 flex items-center justify-between gap-4 border-t border-hairline/30 pt-4">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink">{t("settings.experimental.browser")}</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">
            {desktopBrowser
              ? browser
                ? t("settings.experimental.browserOn")
                : t("settings.experimental.browserOff")
              : browserBlockedOnWindows
                ? t("settings.experimental.browserWindows")
                : browserUnavailableReason(state.config)}
          </div>
        </div>
        <Switch
          checked={browser}
          aria-label={t("settings.experimental.browserAria")}
          disabled={saving !== null || (!browser && !desktopBrowser && !browserInstallable)}
          onClick={() => void toggle("browser", !browser)}
          className="disabled:cursor-wait disabled:opacity-50"
        />
      </div>
      {error ? <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p> : null}
    </Card>
  );
}

function BrowserProfilesRow() {
  const { state } = useStore();
  const profiles = state.config?.browserProfiles ?? [];
  if (!builtInBrowserEnabled(state.config) && profiles.length === 0) return null;
  return (
    <Card title={t("settings.profiles.title")} subtitle={t("settings.profiles.sharedSubtitle")}>
      <BrowserProfilesManager />
    </Card>
  );
}

/** Writes a redacted diagnostics file to a location the user picks. The
 * report holds versions, configured-or-not booleans and the server.log tail —
 * never credential values (the desktop shell does not read secret fields). */
function DiagnosticsRow() {
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const exportDiagnostics = async () => {
    if (!window.ogb?.exportDiagnostics || exporting) return;
    setExporting(true);
    setResult(null);
    try {
      const path = await window.ogb.exportDiagnostics();
      if (path) setResult({ kind: "success", message: t("settings.diagnostics.saved", { path }) });
    } catch (e) {
      setResult({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <SettingRow
      title={t("settings.diagnostics.title")}
      subtitle={t("settings.diagnostics.subtitle")}
      message={result ? (
        <p role={result.kind === "error" ? "alert" : "status"} className={cn("break-all", result.kind === "error" ? "text-danger" : "text-success")}>
          {result.message}
        </p>
      ) : null}
    >
      <button
        onClick={() => void exportDiagnostics()}
        disabled={exporting}
        aria-label={t("settings.diagnostics.aria")}
        className="ui-button"
      >
        {exporting ? t("settings.diagnostics.exporting") : t("settings.diagnostics.export")}
      </button>
    </SettingRow>
  );
}

/** Backups & recovery is two different things that share a screen: the
 * portable encrypted archive of *this* workspace, and the organization's
 * server-side snapshots. The mockup draws them as two tabs and they are two
 * different data sources, so the tab decides which one is on screen and a
 * workspace with no company connection never gets a dead tab. */
function BackupsSection() {
  const [requested, setRequested] = useState<BackupsSurface>("archive");
  const surfaces = backupsSurfaces(companyBackupsReachable());
  const surface = resolveBackupsSurface(requested, surfaces);
  return (
    <div className="flex flex-col gap-4">
      <SectionTabs
        label={t("settings.section.backups")}
        options={surfaces.map((id) => ({ id, label: t(`settings.backups.tab.${id}`) }))}
        active={surface}
        onSelect={setRequested}
      />
      {surface === "archive" ? <WorkspaceBackupSettings /> : <CompanyBackupSettings />}
    </div>
  );
}

/** Remote access, split the way the mockup splits it. `Server devices` is
 * always there — minting a code is the one remote path a paired client can
 * still use, because its requests already carry the server's session
 * (MOCA-84). The companion route and the domain belong to the machine that
 * owns the server, so a paired client is not offered them. */
function RemoteAccessSection({ remoteActive }: { remoteActive: boolean }) {
  const { state } = useStore();
  const [requested, setRequested] = useState<RemoteAccessTab>("server");
  const tabs = remoteAccessTabs({ remoteClient: remoteActive });
  const tab = resolveRemoteAccessTab(requested, tabs);
  return (
    <div className="flex flex-col gap-4">
      <SectionTabs
        label={t("settings.section.companion")}
        options={tabs.map((id) => ({ id, label: t(`settings.remote.tab.${id}`) }))}
        active={tab}
        onSelect={setRequested}
      />
      {tab === "server" && (
        <>
          <RemoteComputerSection />
          {/* mints an admin/client session token for anything that isn't the phone companion
              flow (MCP clients, `crewbot pair`, a second desktop app), and pairs phones to a
              hosted server. Shown for the desktop app's own server (#950) AND when this desktop is
              a remote client of a hosted workspace: its requests carry that server's session, and
              Settings there is the only place that server's phones can be paired from (MOCA-84).
              The server decides who may act — an owner or an admin session — not this gate. */}
          <ServerPairingCard />
        </>
      )}
      {tab === "companion" && <CompanionSection profileEmail={state.config?.profile?.email} />}
      {tab === "domain" && <CustomDomainSettings />}
    </div>
  );
}

/** The pill that switches a section between two or three surfaces of the same
 * subject. One shape, from `Glass.tsx`, so it is the same control as the top
 * bar's destination nav rather than a third recipe. */
function SectionTabs<T extends string>({
  label,
  options,
  active,
  onSelect,
}: {
  label: string;
  options: Array<{ id: T; label: string }>;
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className={SEGMENT_RAIL}>
      {options.map(({ id, label: text }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={active === id}
          onClick={() => onSelect(id)}
          className={cn(active === id ? SEGMENT_ACTIVE : SEGMENT_IDLE, "transition-colors motion-reduce:transition-none")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** The mockup's footer row: the outward links, small and unmissable, at the
 * bottom of the page rather than buried in an About dialog. Everything here
 * already existed in the profile menu and the About window — this is the same
 * set of links in one line, including the licence attribution. */
function SettingsFooter() {
  const links = [
    { label: t("settings.footer.help"), url: HELP_CENTER_URL },
    { label: t("settings.footer.feedback"), url: FEEDBACK_URL },
    { label: t("settings.footer.docs"), url: DOCS_URL },
    { label: t("settings.footer.releases"), url: RELEASES_URL },
    { label: t("settings.footer.repository"), url: APP_REPOSITORY },
    { label: t("settings.footer.license"), url: LICENSE_URL },
  ];
  return (
    <footer className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline/30 pt-4 text-[12px] text-ink-secondary">
      <span className="text-ink">{t("settings.footer.version", { version: appVersion() })}</span>
      {links.map(({ label, url }) => (
        <button key={url} type="button" onClick={() => void openExternalLink(url)} className="rounded transition-colors hover:text-ink">
          {label}
        </button>
      ))}
    </footer>
  );
}

export function SettingsModal() {
  const { state, dispatch } = useStore();
  const remoteActive = window.ogb?.remoteClient?.active === true;
  const pageRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => window.ogb?.environments?.onOpenSettings?.(() => setQuery("")), []);

  const availableSections = availableSettingsSections({
    remoteClient: remoteActive,
    environments: Boolean(window.ogb?.environments),
    organization: Boolean(window.ogb?.organization),
    // the operator's screen for other workspaces exists only where a fleet agent does
    fleet: workspacesAvailable(state.config),
    // sign-in by email is a hosted server's; the desktop app pairs devices under Remote access
    hostedPeople: !window.ogb,
  });
  const visibleSections = visibleSettingsSections(availableSections, query, sectionLabel);
  const section = resolveSettingsSection(state.appSettingsSection, visibleSections, remoteActive);
  const nextVisibleSection = visibleSections.some((entry) => entry.id === section) ? undefined : visibleSections[0]?.id;

  useEffect(() => {
    // Translated matches can change without the query changing. Follow the
    // rendered results instead of a second filter with stale effect inputs.
    if (nextVisibleSection) dispatch({ type: "toggleAppSettings", open: true, section: nextVisibleSection });
  }, [dispatch, nextVisibleSection]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const page = pageRef.current;
    const search = page?.querySelector<HTMLInputElement>("[data-settings-search]");
    if (search?.checkVisibility()) search.focus();
    else page?.focus();

    // A page, not a dialog over a scrim: there is no backdrop to click and no
    // Tab trap to strand the top bar above it. Escape and the X close it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dispatch({ type: "toggleAppSettings", open: false });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [dispatch]);

  const currentLabel = visibleSections.find((entry) => entry.id === section)?.labelKey;

  return (
    <div
      ref={pageRef}
      role="dialog"
      aria-labelledby="app-settings-title"
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
    >
      <span id="app-settings-title" className="sr-only">
        {currentLabel ? t(currentLabel) : t("settings.title")}
      </span>

      {/* The rail and the page heading stand on the sky. The only frosted
          surface here is the search box, which is a control that needs to read
          as raised. */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pb-8 pt-5 sm:px-8 lg:flex-row lg:gap-10">
        <nav aria-label={t("settings.title")} className="w-full shrink-0 lg:w-[228px]">
          <div className="flex min-h-9 items-center gap-2 rounded-full bg-raised/70 px-3.5 py-2 ring-1 ring-hairline/40 focus-within:ring-focus">
            <Search size={14} className="shrink-0 text-ink-secondary" />
            <input
              data-settings-search
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.stopPropagation();
                if (query) setQuery("");
                else dispatch({ type: "toggleAppSettings", open: false });
              }}
              placeholder={t("settings.search")}
              aria-label={t("settings.searchAria")}
              className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </div>
          {visibleSections.length === 0 ? (
            <p className="mt-4 px-1 text-[12.5px] leading-relaxed text-ink-secondary">{t("settings.noMatch", { query: query.trim() })}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-0.5 lg:mt-4">
              {visibleSections.map(({ id, labelKey, icon }) => {
                const Icon = SECTION_ICONS[icon];
                const active = section === id;
                return (
                  <li key={id}>
                    <button
                      data-settings-section={id}
                      onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: id })}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors motion-reduce:transition-none",
                        active ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/50 hover:text-ink",
                      )}
                    >
                      <Icon size={15} className={cn("shrink-0", active && "text-accent-text")} />
                      {t(labelKey)}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <div className="min-w-0 flex-1">
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">
                {currentLabel ? t(currentLabel) : t("settings.title")}
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{t("settings.subtitle")}</p>
            </div>
            <button
              onClick={() => dispatch({ type: "toggleAppSettings", open: false })}
              aria-label={t("settings.close")}
              title={`${t("settings.close")} (${shortcutLabel("close-panel")})`}
              className="ui-icon-button shrink-0"
            >
              <X size={18} />
            </button>
          </header>

          <div className="mt-5 flex flex-col gap-4">
            {section === "desktopWorkspaces" && <ConnectedWorkspacesSettings />}
            {section === "organization" && window.ogb?.organization && !remoteActive && <OrganizationSettings />}
            {section === "general" && (
              <>
                <Card title={t("settings.profile.title")}>
                  <ProfileFields />
                </Card>
                <GlassPanel className="px-4">
                  <LanguageRow />
                  <AnalyticsRow />
                </GlassPanel>
                <Card title={t("settings.roomTurns.title")} subtitle={t("settings.roomTurns.subtitle")}>
                  <RoomTurnTimeoutSettings />
                </Card>
                <ThreadConcurrencySettings />
                <GlassPanel className="px-4">
                  {!remoteActive && <ReplayTourRow />}
                  <UpdatesRow />
                  <DiagnosticsRow />
                </GlassPanel>
              </>
            )}

            {section === "appearance" && (
              <>
                <Card title={t("settings.skin.title")} subtitle={t("settings.skin.subtitle")}>
                  <SkinPicker />
                </Card>
                <GlassPanel className="px-4">
                  <ShowThreadsRow />
                  {!remoteActive && <ToolCallsRow />}
                </GlassPanel>
              </>
            )}

            {section === "experimental" && (
              <>
                <ExperimentalFeaturesRow />
                <BrowserProfilesRow />
              </>
            )}

            {section === "connections" && (
              <>
                <McpAccessSettings />
                <Card title={t("settings.connections.title")} subtitle={t("settings.connections.subtitle")}>
                  <div className="flex flex-col gap-4">
                    {state.config?.composio.mode === "managed" ? (
                      <div className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-[13px] text-success">
                        {t("settings.connections.ready")}
                      </div>
                    ) : null}
                    <div className="text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary">{t("keys.providers.title")}</div>
                    <p className="-mt-3 text-[12px] leading-relaxed text-ink-secondary">{t("keys.providers.subtitle")}</p>
                    <ApiKeyRow section="anthropic" testProvider="anthropic" />
                    <ApiKeyRow section="openaiCompat" testProvider="openaiCompat" />
                    <OpenAiCompatUrl />
                    <ApiKeyRow section="xai" testProvider="xai" />
                    <div className="pt-2 text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary">{t("keys.integrations.title")}</div>
                    <ApiKeyRow section="box" />
                    <VpsConnection />
                    <ApiKeyRow section="opencodeGo" />
                    <details className="rounded-lg border border-hairline/40 bg-inset px-3 py-2">
                      <summary className="cursor-pointer text-[13px] text-ink-secondary">{t("settings.connections.selfHost")}</summary>
                      <div className="mt-3">
                        <ApiKeyRow section="composio" />
                      </div>
                    </details>
                  </div>
                </Card>
              </>
            )}

            {section === "engines" && <EnginesSettings />}

            {section === "backups" && <BackupsSection />}

            {section === "companion" && <RemoteAccessSection remoteActive={remoteActive} />}

            {section === "computer" && <LocalComputerSection />}

            {section === "usage" && <UsageSection />}
            {section === "people" && <PeopleSection />}
            {section === "workspaces" && <WorkspacesSection />}
          </div>

          <SettingsFooter />
        </div>
      </div>
    </div>
  );
}
