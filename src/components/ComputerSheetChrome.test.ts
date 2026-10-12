import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({
  instances: [] as Array<{
    snapshot: { state: string };
    capabilities?: { computerMcp?: boolean; browserMcp?: boolean };
    driverKind?: string;
  }>,
  config: {} as Record<string, unknown>,
}));

// The globals have to exist before any module reads window at import time, so
// they are installed inside the hoisted block rather than at module scope.
vi.hoisted(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {}, ogb: undefined });
  vi.stubGlobal("document", { addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  vi.stubGlobal("navigator", { language: "en" });
});

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({
    state: {
      config: fixture.config,
      bots: [],
      instances: fixture.instances,
      computerControl: {},
      screens: {},
      routines: [],
      routineRuns: [],
    },
    dispatch: vi.fn(),
  }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import {
  ComputerSheetHeader,
  ComputerSheetTabs,
  ControlHandoffBanner,
  DesktopsStrip,
  InventoryFooter,
  RunsOnStrip,
} from "./ComputerSheetChrome";
import type { LocalVmInventoryInstance } from "./LocalComputerSection";

beforeEach(() => {
  fixture.instances = [];
  fixture.config = {};
});
afterAll(() => vi.unstubAllGlobals());

const bot = { id: "atlas", name: "Atlas", computer: "vm", modelSelection: { instanceId: "x" } } as Bot;
const vm = (patch: Partial<LocalVmInventoryInstance>): LocalVmInventoryInstance => ({
  botId: "atlas", name: "Atlas", destination: "vm", container: "running",
  ready: true, managed: true, problem: null, inUse: true, ...patch,
});
const html = (element: ReactElement) => renderToStaticMarkup(element);

describe("the computer sheet's header", () => {
  it("names the computer and says who is driving", () => {
    const markup = html(createElement(ComputerSheetHeader, {
      bot, state: "under-control", busy: true, onOpenSettings: () => {}, onClose: () => {},
    }));
    expect(markup).toContain("Atlas&#x27;s computer");
    expect(markup).toContain("Under your control");
    expect(markup).toContain("data-computer-sheet-header");
  });

  it("says watching rather than under control when the wheel is free", () => {
    const markup = html(createElement(ComputerSheetHeader, {
      bot, state: "watching", busy: false, onOpenSettings: () => {}, onClose: () => {},
    }));
    expect(markup).toContain("Watching");
    expect(markup).not.toContain("Under your control");
  });
});

describe("the computer sheet's rail", () => {
  const tabs = (props: Partial<Parameters<typeof ComputerSheetTabs>[0]>) => html(createElement(ComputerSheetTabs, {
    view: "computer", onSelect: () => {}, browserEnabled: true, androidCapable: true,
    livePlace: "vm", live: false, ...props,
  }));

  it("keeps android in the rail, tagged deferred rather than dropped", () => {
    const markup = tabs({});
    expect(markup).toContain("Android");
    expect(markup).toContain("Deferred");
    expect(markup).toContain('aria-selected="true"');
  });

  it("omits browser when the engine cannot fill it", () => {
    expect(tabs({ browserEnabled: false })).not.toContain(">Browser<");
  });

  it("keeps the tour hooks the guided tour already reaches for", () => {
    const markup = tabs({});
    expect(markup).toContain('data-tour="computer-tabs"');
    expect(markup).toContain('data-tour="computer-browser"');
  });
});

describe("the control handoff banner", () => {
  const banner = (props: Partial<Parameters<typeof ControlHandoffBanner>[0]>) => html(createElement(ControlHandoffBanner, {
    bot, state: "under-control", helpReason: null, pending: false,
    onTake: () => {}, onHandBack: () => {}, onDismiss: () => {}, showOpenHint: false, ...props,
  }));

  it("says the bot's input is paused while the person holds the wheel", () => {
    const markup = banner({});
    expect(markup).toContain('data-computer-banner="under-control"');
    expect(markup).toContain("input is paused");
    expect(markup).toContain("Hand back to Atlas");
  });

  it("shows the bot's own reason when it asks for hands", () => {
    const markup = banner({ state: "asked-help", helpReason: "a one-time sign-in" });
    expect(markup).toContain('data-computer-banner="asked-help"');
    expect(markup).toContain("a one-time sign-in");
    expect(markup).toContain("Dismiss");
  });

  it("says nothing at all while the person is only watching", () => {
    expect(banner({ state: "watching" })).toBe("");
  });
});

describe("the runs-on strip", () => {
  const strip = html(createElement(RunsOnStrip, {
    bot, cloudSummary: "Box", onPin: () => {}, onOpenDesktop: () => {},
    onOpenComputers: () => {}, openDesktopPending: false, twoDesktopsAvailable: true,
  }));

  it("names where the conversation runs and offers the three doors out", () => {
    expect(strip).toContain("Runs on");
    expect(strip).toContain("Cloud backend");
    expect(strip).toContain("Open desktop");
    expect(strip).toContain("Two desktops");
    expect(strip).toContain("Manage computers");
  });

  it("disables two desktops when the host cannot drive them", () => {
    const markup = html(createElement(RunsOnStrip, {
      bot, cloudSummary: "Box", onPin: () => {}, onOpenDesktop: () => {},
      onOpenComputers: () => {}, openDesktopPending: false, twoDesktopsAvailable: false,
    }));
    expect(markup).toMatch(/Two desktops[\s\S]{0,80}?disabled|disabled=""/);
  });
});

describe("the desktops strip", () => {
  it("marks the driven desktop and leaves the rest watch-only", () => {
    const markup = html(createElement(DesktopsStrip, {
      instances: [vm({}), vm({ botId: "forge", name: "Forge" })],
      controllingBotId: "atlas",
    }));
    expect(markup).toContain("Desktops");
    expect(markup).toContain("Controlling");
    expect(markup).toContain("Watch only");
    expect(markup).toContain("One active controller");
  });

  it("renders nothing rather than an empty shelf when there is no local VM", () => {
    expect(html(createElement(DesktopsStrip, { instances: [], controllingBotId: null }))).toBe("");
  });
});

describe("the inventory footer", () => {
  const footer = (props: Partial<Parameters<typeof InventoryFooter>[0]>) => html(createElement(InventoryFooter, {
    counts: { localVmUsed: 2, localVmMax: 4, boxes: 1, vps: 1, orphaned: 1 },
    loading: false, problem: null, onRefresh: () => {},
    onIsolationPolicy: () => {}, onPrepareImage: () => {}, onSharedFolders: () => {}, ...props,
  }));

  it("counts what the workspace owns and links to the places that act on it", () => {
    const markup = footer({});
    expect(markup).toContain("Local VM 2/4");
    expect(markup).toContain("Box 1");
    expect(markup).toContain("VPS 1");
    expect(markup).toContain("Orphaned 1");
    expect(markup).toContain("Isolation policy");
    expect(markup).toContain("Prepare image");
    expect(markup).toContain("Shared folders");
  });

  it("says the counts are unavailable instead of showing zeroes", () => {
    const markup = footer({ problem: "offline" });
    expect(markup).toContain("counts unavailable");
    expect(markup).not.toContain("Local VM 2/4");
  });
});