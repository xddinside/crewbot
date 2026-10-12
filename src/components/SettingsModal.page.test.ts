// The settings page after the redesign: a rail on the canvas, glass where work
// happens, and two screens split into tabs. These pin the parts that are
// decisions rather than pixels — which section the page is on, which tabs a
// build is offered, and which surface each tab actually mounts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { AppSettingsSection } from "@/state/store";
import { SettingsModal } from "./SettingsModal";
import { WorkspaceBackupSummaryView } from "./WorkspaceBackupSettings";

const fixture = vi.hoisted(() => ({ section: "general" as AppSettingsSection, company: false }));

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: fixture.section }, dispatch: vi.fn() }),
}));
// Each of these reaches for a bridge or a network call this suite does not
// own; a marker is enough to prove which one the section mounts.
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn() }));
vi.mock("./CompanionSection", () => ({ CompanionSection: () => "COMPANION_MARKER" }));
vi.mock("./CustomDomainSettings", () => ({ CustomDomainSettings: () => "DOMAIN_MARKER" }));
vi.mock("./ServerPairingCard", () => ({ ServerPairingCard: () => "SERVER_PAIRING_MARKER" }));
vi.mock("./RemoteComputerSection", () => ({ RemoteComputerSection: () => "REMOTE_CLIENT_MARKER" }));
vi.mock("./WorkspaceBackupSettings", async (importOriginal) => ({
  ...await importOriginal<typeof import("./WorkspaceBackupSettings")>(),
  WorkspaceBackupSettings: () => "ARCHIVE_MARKER",
}));
vi.mock("./CompanyBackupSettings", () => ({
  CompanyBackupSettings: () => "COMPANY_MARKER",
  companyBackupsReachable: () => fixture.company ?? false,
}));
vi.mock("./LocalComputerSection", () => ({ LocalComputerSection: () => "COMPUTER_MARKER" }));
vi.mock("./PeopleSection", () => ({ PeopleSection: () => "PEOPLE_MARKER" }));
vi.mock("./WorkspacesSection", async (importOriginal) => ({
  ...await importOriginal<typeof import("./WorkspacesSection")>(),
  WorkspacesSection: () => "FLEET_MARKER",
  workspacesAvailable: () => false,
}));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.section = "general";
  fixture.company = false;
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

const render = () => renderToStaticMarkup(createElement(SettingsModal));
const marker = (html: string, id: string) => html.match(new RegExp(`<button[^>]*data-settings-section="${id}"[^>]*>`))?.[0] ?? "";

describe("the settings page frame", () => {
  it("stands on the canvas: a rail, a title, and no window around it", () => {
    const html = render();
    expect(html).toContain('<nav aria-label="Settings"');
    expect(html).toContain('data-settings-section="general"');
    expect(html).toContain("Personalize crewbot to fit your workflow.");
    // The old modal was a centred opaque panel over a dimmed page.
    expect(html).not.toContain("bg-panel");
    expect(html).not.toContain("bg-black/50");
    expect(html).not.toContain("aria-modal");
  });

  it("keeps a card frosted while its surroundings stay on the sky", () => {
    const html = render();
    expect(html).toContain("glass-card");
    expect(html).toContain("glass-panel");
    expect(html).not.toContain("bg-card");
  });

  it("closes on Escape and on the labelled button, without trapping Tab", () => {
    const html = render();
    expect(html).toContain('aria-label="Close settings"');
    expect(html).toContain('placeholder="Search"');
  });
});

describe("Backups & recovery", () => {
  it("opens on the portable archive and offers company snapshots only when there is one", () => {
    fixture.section = "backups";
    const local = render();
    expect(local).toContain("ARCHIVE_MARKER");
    expect(local).not.toContain("COMPANY_MARKER");
    expect(local).toContain("Portable archive");
    expect(local).not.toContain("Company snapshots");

    fixture.company = true;
    const managed = render();
    expect(managed).toContain("Portable archive");
    expect(managed).toContain("Company snapshots");
    expect(managed).toContain('role="tablist"');
  });

  it("keeps the staged archive's counts, warnings and exclusions on glass", () => {
    const summary = renderToStaticMarkup(
      createElement(WorkspaceBackupSummaryView, {
        summary: {
          createdAt: 0,
          appVersion: "1.0.0",
          bots: 1,
          groups: 1,
          threads: 2,
          messages: 3,
          files: 4,
          bytes: 5,
          warnings: ["a warning"],
          exclusions: ["credentials"],
        } as never,
      }),
    );
    expect(summary).toContain("a warning");
    expect(summary).toContain("credentials");
    // Inside the archive card, a plain inset panel — the card above it is the
    // frosted surface.
    expect(summary).toContain("bg-inset/60");
  });
});

describe("Remote access", () => {
  it("opens on server devices and keeps the pairing card there", () => {
    fixture.section = "companion";
    const html = render();
    expect(html).toContain("Server devices");
    expect(html).toContain("REMOTE_CLIENT_MARKER");
    expect(html).toContain("SERVER_PAIRING_MARKER");
    expect(html).not.toContain("COMPANION_MARKER");
    expect(html).not.toContain("DOMAIN_MARKER");
  });

  it("offers companion and domain to the machine that owns the server", () => {
    fixture.section = "companion";
    const html = render();
    expect(html).toContain("Companion");
    expect(html).toContain("Domain");
  });

  it("offers a paired remote client the server's devices and nothing else", () => {
    fixture.section = "companion";
    vi.stubGlobal("window", { ogb: { remoteClient: { active: true } } });
    const html = render();
    expect(html).toContain("Server devices");
    expect(html).not.toContain(">Companion<");
    expect(html).not.toContain(">Domain<");
    // MOCA-84: this client's requests already carry the server's session, so
    // the card that mints a code has to be right there.
    expect(html).toContain("SERVER_PAIRING_MARKER");
  });

  it("routes a remote client asking for a section it cannot have to remote access", () => {
    fixture.section = "engines";
    vi.stubGlobal("window", { ogb: { remoteClient: { active: true } } });
    const html = render();
    expect(marker(html, "engines")).toBe("");
    expect(marker(html, "companion")).toContain('aria-current="page"');
    expect(html).toContain("SERVER_PAIRING_MARKER");
  });
});

describe("the section rail's capability subset", () => {
  it("hides Workspaces, Organisation and Fleet unless the build owns them", () => {
    const html = render();
    expect(marker(html, "desktopWorkspaces")).toBe("");
    expect(marker(html, "organization")).toBe("");
    expect(marker(html, "workspaces")).toBe("");
    expect(marker(html, "backups")).not.toBe("");
    // People is email sign-in, which a browser host has and a desktop does not.
    expect(marker(html, "people")).not.toBe("");
  });

  it("drops People inside the desktop app, where devices pair under Remote access", () => {
    vi.stubGlobal("window", { ogb: {} });
    expect(marker(render(), "people")).toBe("");
  });

  it("offers Workspaces and Organisation through the desktop bridges that own them", () => {
    vi.stubGlobal("window", { ogb: { environments: {}, organization: {} } });
    const html = render();
    expect(marker(html, "desktopWorkspaces")).not.toBe("");
    expect(marker(html, "organization")).not.toBe("");
  });

  it("keeps the labels the mockup's rail uses", () => {
    const html = render();
    expect(html).toContain("Backups &amp; recovery");
    expect(html).toContain("Computers");
  });
});