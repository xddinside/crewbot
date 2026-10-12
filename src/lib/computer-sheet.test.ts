import { describe, expect, it } from "vitest";

import type {
  CloudComputerInventoryInstance,
  LocalVmInventoryInstance,
  VpsComputerInventoryInstance,
} from "@/components/LocalComputerSection";
import {
  computerInventoryCounts,
  computerSheetDesktops,
  computerSheetTabs,
  controlHandoffState,
  desktopControllerNote,
  handoffStatusKey,
  worstInventoryState,
} from "./computer-sheet";

const vm = (patch: Partial<LocalVmInventoryInstance> = {}): LocalVmInventoryInstance => ({
  botId: "bot-a", name: "Atlas", destination: "vm", container: "running",
  ready: true, managed: true, problem: null, inUse: true, ...patch,
});

describe("the computer sheet's rail", () => {
  it("lists computer, browser, routines and the retained android tab", () => {
    expect(computerSheetTabs({ browserEnabled: true, androidCapable: true }).map((tab) => tab.id))
      .toEqual(["computer", "browser", "routines", "android"]);
  });

  it("omits browser when the engine cannot fill it, and android when the host cannot drive one", () => {
    expect(computerSheetTabs({ browserEnabled: false, androidCapable: false }).map((tab) => tab.id))
      .toEqual(["computer", "routines"]);
  });

  it("tags android deferred rather than dropping it", () => {
    const android = computerSheetTabs({ browserEnabled: false, androidCapable: true })
      .find((tab) => tab.id === "android")!;
    expect(android.deferred).toBe(true);
    expect(computerSheetTabs({ browserEnabled: false, androidCapable: false })
      .every((tab) => !tab.deferred)).toBe(true);
  });
});

describe("control handoff", () => {
  it("reads the hold before the help request", () => {
    expect(controlHandoffState({ held: true, helpReason: "stuck on a sign-in" })).toBe("under-control");
    expect(controlHandoffState({ held: false, helpReason: "stuck on a sign-in" })).toBe("asked-help");
    expect(controlHandoffState({ held: false, helpReason: null })).toBe("watching");
  });

  it("gives each state its own header line", () => {
    expect(new Set([handoffStatusKey("under-control"), handoffStatusKey("asked-help"), handoffStatusKey("watching")]).size).toBe(3);
  });
});

describe("the desktops strip", () => {
  it("marks the driven desktop and leaves the rest watch-only", () => {
    const desktops = computerSheetDesktops(
      [vm(), vm({ botId: "bot-b", name: "Forge" }), vm({ botId: "bot-c", name: "Probe" })],
      "bot-a",
    );
    expect(desktops.filter((desktop) => desktop.controlling).map((desktop) => desktop.name)).toEqual(["Atlas"]);
    expect(desktops.filter((desktop) => !desktop.controlling).every((desktop) => desktop.openable)).toBe(true);
  });

  it("does not offer an unmanaged or stopped desktop as openable", () => {
    const [unmanaged, stopped] = computerSheetDesktops([
      vm({ botId: "a", managed: false }),
      vm({ botId: "b", container: "stopped" }),
    ], null);
    expect(unmanaged.openable).toBe(false);
    expect(stopped.openable).toBe(false);
  });

  it("names the single controller and reports a hold held elsewhere", () => {
    expect(desktopControllerNote(computerSheetDesktops([vm({ botId: "a" }), vm({ botId: "b" })], "a")))
      .toBe("desktopStrip.oneController");
    expect(desktopControllerNote(computerSheetDesktops([vm({ botId: "a" }), vm({ botId: "b" })], "a")
      .map((desktop) => ({ ...desktop, controlling: true })))).toBe("desktopStrip.controllerElsewhere");
    expect(desktopControllerNote(computerSheetDesktops([], null))).toBeNull();
  });
});

describe("the inventory footer", () => {
  const box = (patch: Partial<CloudComputerInventoryInstance> = {}): CloudComputerInventoryInstance => ({
    boxId: "box-a", name: "qa", state: "idle", ownerBotId: "bot-a", ownerName: "Atlas", orphaned: false, inUse: false, ...patch,
  });
  const vps = (patch: Partial<VpsComputerInventoryInstance> = {}): VpsComputerInventoryInstance => ({
    name: "vps-a", state: "running", ownerBotId: null, ownerName: null, orphaned: false, inUse: false, ...patch,
  });

  it("counts running local VMs against the workspace maximum", () => {
    expect(computerInventoryCounts({
      localVms: [vm(), vm({ botId: "b", container: "stopped" })], localVmMax: 4,
      boxes: [], vps: [],
    })).toEqual({ localVmUsed: 1, localVmMax: 4, boxes: 0, vps: 0, orphaned: 0 });
  });

  it("adds orphaned Box and VPS machines into one number", () => {
    expect(computerInventoryCounts({
      localVms: [], localVmMax: 2,
      boxes: [box(), box({ boxId: "box-b", orphaned: true })],
      vps: [vps({ orphaned: true })],
    })).toEqual({ localVmUsed: 0, localVmMax: 2, boxes: 2, vps: 1, orphaned: 2 });
  });

  it("reports the worst state first, so one attention machine is not hidden", () => {
    expect(worstInventoryState(["running", "in-use", "stopped"])).toBe("stopped");
    expect(worstInventoryState(["running", "attention"])).toBe("attention");
    expect(worstInventoryState([])).toBeNull();
  });
});