import { describe, expect, it } from "vitest";

import {
  SETTINGS_SECTIONS,
  availableSettingsSections,
  backupsSurfaces,
  remoteAccessTabs,
  remoteSections,
  resolveBackupsSurface,
  resolveRemoteAccessTab,
  resolveSettingsSection,
  settingsSectionMatches,
  visibleSettingsSections,
  type SectionLabel,
  type SettingsAvailability,
  type SettingsSection,
} from "./settings-view";

const EN: Record<string, string> = {
  "settings.section.general": "General",
  "settings.section.desktopWorkspaces": "Workspaces",
  "settings.section.organization": "Organization",
  "settings.section.appearance": "Appearance",
  "settings.section.experimental": "Experimental",
  "settings.section.connections": "Connections",
  "settings.section.engines": "Engines",
  "settings.section.companion": "Remote access",
  "settings.section.computer": "Computers",
  "settings.section.usage": "Usage",
  "settings.section.people": "People",
  "settings.section.backups": "Backups & recovery",
  "settings.section.workspaces": "Fleet",
};

const label: SectionLabel = (section) => EN[section.labelKey] ?? section.id;
const desktop: SettingsAvailability = {
  remoteClient: false,
  environments: true,
  organization: true,
  fleet: false,
  hostedPeople: false,
};
const ids = (sections: readonly SettingsSection[]) => sections.map((section) => section.id);

describe("the settings rail", () => {
  it("lists every section in the order the mockup's rail does", () => {
    expect(ids(SETTINGS_SECTIONS)).toEqual([
      "general",
      "desktopWorkspaces",
      "organization",
      "appearance",
      "experimental",
      "connections",
      "engines",
      "companion",
      "computer",
      "usage",
      "people",
      "backups",
      "workspaces",
    ]);
  });

  it("gives every section an icon and at least one keyword", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.icon).toBeTruthy();
      expect(section.keywords.length).toBeGreaterThan(0);
    }
  });

  it("hides the sections a build cannot offer", () => {
    const sections = availableSettingsSections({
      remoteClient: false,
      environments: false,
      organization: false,
      fleet: false,
      hostedPeople: false,
    });
    expect(ids(sections)).not.toContain("desktopWorkspaces");
    expect(ids(sections)).not.toContain("organization");
    expect(ids(sections)).not.toContain("workspaces");
    expect(ids(sections)).not.toContain("people");
    expect(ids(sections)).toContain("backups");
  });

  it("keeps a full-capability desktop down the four sections its build owns", () => {
    const sections = availableSettingsSections({ ...desktop, fleet: true, hostedPeople: true });
    expect(ids(sections)).toEqual(SETTINGS_SECTIONS.map((section) => section.id));
  });

  it("offers a paired remote client only looks, workspaces and remote access", () => {
    const sections = availableSettingsSections({
      remoteClient: true,
      environments: true,
      organization: true,
      fleet: true,
      hostedPeople: true,
    });
    expect(ids(sections)).toEqual(["desktopWorkspaces", "appearance", "companion"]);
    expect(new Set(ids(sections))).toEqual(new Set(remoteSections()));
  });
});

describe("settings search", () => {
  it("matches an empty query as everything", () => {
    expect(visibleSettingsSections(SETTINGS_SECTIONS, "   ", label)).toHaveLength(SETTINGS_SECTIONS.length);
  });

  it("matches the drawn label", () => {
    const found = visibleSettingsSections(SETTINGS_SECTIONS, "recovery", label);
    expect(ids(found)).toEqual(["backups"]);
  });

  it("matches an English keyword a person types and the label does not have", () => {
    expect(ids(visibleSettingsSections(SETTINGS_SECTIONS, "tailscale", label))).toEqual(["companion"]);
    expect(ids(visibleSettingsSections(SETTINGS_SECTIONS, "invoices", label))).toEqual([]);
  });

  it("ignores case and surrounding space", () => {
    expect(settingsSectionMatches(SETTINGS_SECTIONS[3]!, "  APPEARANCE ", label)).toBe(true);
  });
});

describe("resolving the requested section", () => {
  const visible = SETTINGS_SECTIONS;

  it("keeps a section that is on screen", () => {
    expect(resolveSettingsSection("engines", visible, false)).toBe("engines");
  });

  it("sends a remote client asking for Engines to remote access", () => {
    expect(resolveSettingsSection("engines", visible, true)).toBe("companion");
  });

  it("treats the legacy remote id as remote access", () => {
    expect(resolveSettingsSection("remote", visible, false)).toBe("companion");
  });

  it("falls to the first visible section when the search filtered this one away", () => {
    const filtered = visibleSettingsSections(SETTINGS_SECTIONS, "tailscale", label);
    expect(resolveSettingsSection("engines", filtered, false)).toBe("companion");
  });

  it("never resolves to a section the rail is not offering", () => {
    const remoteOnly = availableSettingsSections({ ...desktop, remoteClient: true });
    expect(resolveSettingsSection("backups", remoteOnly, true)).toBe("companion");
  });
});

describe("the two tabbed settings screens", () => {
  it("offers company snapshots only when an organization connection has them", () => {
    expect(backupsSurfaces(false)).toEqual(["archive"]);
    expect(backupsSurfaces(true)).toEqual(["archive", "company"]);
  });

  it("falls back to the portable archive when company snapshots are not offered", () => {
    expect(resolveBackupsSurface("company", backupsSurfaces(false))).toBe("archive");
    expect(resolveBackupsSurface("company", backupsSurfaces(true))).toBe("company");
  });

  it("gives a paired remote client the server device list and nothing else", () => {
    expect(remoteAccessTabs({ remoteClient: true })).toEqual(["server"]);
    expect(remoteAccessTabs({ remoteClient: false })).toEqual(["server", "companion", "domain"]);
  });

  it("falls back to the first tab when the one asked for is not on offer", () => {
    expect(resolveRemoteAccessTab("domain", remoteAccessTabs({ remoteClient: true }))).toBe("server");
  });
});