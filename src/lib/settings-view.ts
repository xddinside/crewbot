// The settings screen's decisions, as pure data.
//
// F078 keeps four things honest about this screen: the section list itself,
// the search that filters it, the subset a given build may offer, and which
// section a request actually resolves to. All four are decisions rather than
// rendering, so they live here and the page reads one answer — the rail row,
// the empty state and the section switcher can never disagree, and the rules
// are testable without a DOM.
//
// The registry is ordered the way the approved mockup's rail is, and the
// keywords are English on purpose: they are a search index over what people
// type, not copy anyone reads, and a translated pack that omits one still
// matches the rest.

import type { AppSettingsSection } from "@/state/store";
import type { LocaleKey } from "@/locales";

/** Icon identity, not the component. Keeping `lucide-react` out of this module
 *  is what lets the rules below be tested in plain Node. */
export type SettingsSectionIcon =
  | "user"
  | "workspaces"
  | "organization"
  | "palette"
  | "flask"
  | "key"
  | "terminal"
  | "remote"
  | "monitor"
  | "coins"
  | "people"
  | "backups"
  | "fleet";

export interface SettingsSection {
  id: AppSettingsSection;
  labelKey: LocaleKey;
  icon: SettingsSectionIcon;
  keywords: string[];
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "general", labelKey: "settings.section.general", icon: "user", keywords: ["profile", "name", "email", "analytics", "updates", "diagnostics", "language", "threads", "parallel", "concurrency", "tour", "welcome", "about", "help"] },
  { id: "desktopWorkspaces", labelKey: "settings.section.desktopWorkspaces", icon: "workspaces", keywords: ["workspace", "cloud", "hosted", "vps", "server", "connect", "pair", "switch", "local", "computer access", "sharing", "folders"] },
  { id: "organization", labelKey: "settings.section.organization", icon: "organization", keywords: ["company", "organization", "sign in", "enroll", "managed", "models", "disconnect"] },
  { id: "appearance", labelKey: "settings.section.appearance", icon: "palette", keywords: ["skin", "theme", "appearance", "tools", "tool calls", "threads", "show threads", "hide threads", "sidebar", "display", "density"] },
  { id: "experimental", labelKey: "settings.section.experimental", icon: "flask", keywords: ["early", "preview", "learn", "skill", "authoring", "browser", "profiles"] },
  { id: "connections", labelKey: "settings.section.connections", icon: "key", keywords: ["keys", "api", "composio", "box", "xai", "vps", "mcp", "tokens", "external", "bots"] },
  { id: "engines", labelKey: "settings.section.engines", icon: "terminal", keywords: ["models", "claude", "grok", "providers", "cli"] },
  { id: "companion", labelKey: "settings.section.companion", icon: "remote", keywords: ["companion", "device", "phone", "desktop", "client", "host", "pair", "pairing", "mobile", "https", "secure", "tailscale", "wifi", "remote", "advanced", "domain", "dns", "self-hosted", "server", "caddy", "code", "qr"] },
  { id: "computer", labelKey: "settings.section.computer", icon: "monitor", keywords: ["vm", "virtual", "desktop", "computer", "control", "seat"] },
  { id: "usage", labelKey: "settings.section.usage", icon: "coins", keywords: ["tokens", "cost", "billing"] },
  { id: "people", labelKey: "settings.section.people", icon: "people", keywords: ["people", "users", "invite", "sign in", "members", "admins", "access", "roles", "sessions"] },
  { id: "backups", labelKey: "settings.section.backups", icon: "backups", keywords: ["export", "import", "restore", "full backup", "password", "recovery", "snapshot", "archive", "company", "replace"] },
  { id: "workspaces", labelKey: "settings.section.workspaces", icon: "fleet", keywords: ["clients", "tenants", "fleet", "workspaces", "operator", "provision", "upgrade"] },
];

/** What this build can actually offer. Every one of these is a capability the
 *  screen must not pretend to have. */
export interface SettingsAvailability {
  /** this window is a paired client of someone else's workspace */
  remoteClient: boolean;
  /** the desktop bridge that saves and switches environments exists */
  environments: boolean;
  /** the trusted desktop bridge that enrols an organization exists */
  organization: boolean;
  /** a fleet agent answered, so the operator screen is real here */
  fleet: boolean;
  /** hosted email sign-in exists, which is where People lives */
  hostedPeople: boolean;
}

/** The two sections a paired remote client is ever offered (F078): its own
 *  looks, the workspaces it may switch, and the server's remote access —
 *  which is this client's only way to reach the server's paired phones. */
export function remoteSections(): AppSettingsSection[] {
  return ["appearance", "desktopWorkspaces", "companion"];
}

export function settingsSectionAvailable(section: SettingsSection, availability: SettingsAvailability): boolean {
  if (availability.remoteClient) return remoteSections().includes(section.id);
  if (section.id === "desktopWorkspaces") return availability.environments;
  if (section.id === "organization") return availability.organization;
  // the operator's screen for other workspaces exists only where a fleet agent does
  if (section.id === "workspaces") return availability.fleet;
  // sign-in by email is a hosted server's; the desktop app pairs devices under Remote access
  if (section.id === "people") return availability.hostedPeople;
  return true;
}

export function availableSettingsSections(availability: SettingsAvailability): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => settingsSectionAvailable(section, availability));
}

/** A label is resolved when it is drawn, never at module scope: `t()` reads
 *  the active pack when it is called, so a label frozen at import would keep
 *  the language the app booted in. */
export type SectionLabel = (section: SettingsSection) => string;

export function settingsSectionMatches(section: SettingsSection, query: string, label: SectionLabel): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [label(section), ...section.keywords].some((part) => part.toLowerCase().includes(needle));
}

export function visibleSettingsSections(
  sections: readonly SettingsSection[],
  query: string,
  label: SectionLabel,
): SettingsSection[] {
  return sections.filter((section) => settingsSectionMatches(section, query, label));
}

/** The section a request resolves to. A remote client asking for a section it
 *  cannot have lands on remote access; `remote` is the older id for that same
 *  screen; and a search that filtered the current section away falls to the
 *  first thing the person can actually see. */
export function resolveSettingsSection(
  requested: AppSettingsSection | undefined,
  visible: readonly SettingsSection[],
  remoteClient: boolean,
): AppSettingsSection {
  const allowed = remoteClient ? remoteSections() : undefined;
  // `remote` is the id this screen used to carry; both resolve to the same tab.
  const asked = requested === "remote" ? "companion" : requested;
  const wanted = allowed && (!asked || !allowed.includes(asked)) ? "companion" : (asked ?? "general");
  return visible.some((section) => section.id === wanted) ? wanted : (visible[0]?.id ?? wanted);
}

// ── Backups & recovery ─────────────────────────────────────────────────────
// Two different things that share a screen: a portable encrypted archive of
// this workspace, and the organization's server-side snapshots. The mockup
// draws them as two tabs; the store already keeps them apart.

export type BackupsSurface = "archive" | "company";

export function backupsSurfaces(companyAvailable: boolean): BackupsSurface[] {
  return companyAvailable ? ["archive", "company"] : ["archive"];
}

export function resolveBackupsSurface(requested: BackupsSurface, surfaces: readonly BackupsSurface[]): BackupsSurface {
  return surfaces.includes(requested) ? requested : surfaces[0]!;
}

// ── Remote access ───────────────────────────────────────────────────────────
// Server devices, the companion route, and the domain the server answers on.
// A paired remote client runs against someone else's server, so it is offered
// the server's own device list and neither of the other two.

export type RemoteAccessTab = "server" | "companion" | "domain";

export function remoteAccessTabs(availability: Pick<SettingsAvailability, "remoteClient">): RemoteAccessTab[] {
  return availability.remoteClient ? ["server"] : ["server", "companion", "domain"];
}

export function resolveRemoteAccessTab(requested: RemoteAccessTab, tabs: readonly RemoteAccessTab[]): RemoteAccessTab {
  return tabs.includes(requested) ? requested : tabs[0]!;
}