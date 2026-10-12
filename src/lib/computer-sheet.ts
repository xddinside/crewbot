// The computer sheet's pure layer: which tabs it shows, who is driving it,
// what its desktop strip says, and what its inventory footer counts.
//
// Every fact here is read from data the app already has — the local VM
// inventory, the Box and VPS inventories, and the store's control map. Nothing
// in this file talks to the server, so none of it can provision, wake or stop a
// machine: the sheet describes what exists and links to the places that act.

import type { LocaleKey } from "@/locales";
import {
  cloudComputerInventoryStateKind,
  localVmInventoryStateKind,
  vpsComputerInventoryStateKind,
  type CloudComputerInventoryInstance,
  type ComputerStateKind,
  type LocalVmInventoryInstance,
  type VpsComputerInventoryInstance,
} from "@/components/LocalComputerSection";

/** The four things a computer sheet can show, in the order it shows them. */
export type SheetTab = "computer" | "browser" | "routines" | "android";

export interface SheetTabDescriptor {
  id: SheetTab;
  labelKey: LocaleKey;
  /** Android stays in the rail as a retained secondary tab. Its delivery is
   * parked, so the tab is tagged rather than hidden or treated as broken. */
  deferred: boolean;
}

/**
 * The rail. Browser appears only when the engine is there to fill it; Android
 * appears whenever this host can drive a device at all, and is tagged deferred
 * either way — a parked platform is retained, never recorded as passing.
 */
export function computerSheetTabs(input: {
  browserEnabled: boolean;
  androidCapable: boolean;
}): SheetTabDescriptor[] {
  return [
    { id: "computer", labelKey: "computer.tab.computer", deferred: false },
    ...(input.browserEnabled
      ? [{ id: "browser" as const, labelKey: "computer.tab.browser" as LocaleKey, deferred: false }]
      : []),
    { id: "routines", labelKey: "computer.tab.routines", deferred: false },
    ...(input.androidCapable
      ? [{ id: "android" as const, labelKey: "computer.tab.android" as LocaleKey, deferred: true }]
      : []),
  ];
}

/** Who is driving, as the sheet's header and its banner have to agree. */
export type HandoffState = "under-control" | "asked-help" | "watching";

export function controlHandoffState(input: {
  held: boolean;
  helpReason: string | null;
}): HandoffState {
  if (input.held) return "under-control";
  if (input.helpReason) return "asked-help";
  return "watching";
}

/** The header's one-line status. */
export function handoffStatusKey(state: HandoffState): LocaleKey {
  return state === "under-control"
    ? "computerSheet.underControl"
    : state === "asked-help"
      ? "computerSheet.askedHelp"
      : "computerSheet.watching";
}

export interface SheetDesktop {
  id: string;
  name: string;
  state: ComputerStateKind;
  controlling: boolean;
  /** A desktop this sheet can open: running and managed by the workspace. */
  openable: boolean;
}

/**
 * The desktops strip: one tile per local VM, the one this conversation drives
 * marked *Controlling* and the rest *Watch only*. Read-only — a tile never
 * starts, stops or removes anything.
 */
export function computerSheetDesktops(
  instances: readonly LocalVmInventoryInstance[],
  controllingBotId: string | null,
): SheetDesktop[] {
  return instances.map((instance) => ({
    id: instance.botId,
    name: instance.name,
    state: localVmInventoryStateKind(instance),
    controlling: instance.botId === controllingBotId,
    openable: instance.managed && instance.container === "running",
  }));
}

/**
 * The strip's trailing note. Only one controller exists at a time, so a second
 * "Controlling" tile means the hold is elsewhere and the sheet says so instead
 * of showing two live desktops.
 */
export function desktopControllerNote(
  desktops: readonly SheetDesktop[],
): "desktopStrip.oneController" | "desktopStrip.controllerElsewhere" | null {
  const controllers = desktops.filter((desktop) => desktop.controlling).length;
  if (controllers === 0) return null;
  return controllers === 1 ? "desktopStrip.oneController" : "desktopStrip.controllerElsewhere";
}

export interface InventoryCounts {
  localVmUsed: number;
  localVmMax: number;
  boxes: number;
  vps: number;
  orphaned: number;
}

/**
 * The footer strip's counts. `orphaned` counts machines nobody owns across Box
 * and VPS, because that is the one number no per-bot list can give and the one
 * a person most needs to see.
 */
export function computerInventoryCounts(input: {
  localVms: readonly LocalVmInventoryInstance[];
  localVmMax: number;
  boxes: readonly CloudComputerInventoryInstance[];
  vps: readonly VpsComputerInventoryInstance[];
}): InventoryCounts {
  return {
    localVmUsed: input.localVms.filter((instance) => instance.container === "running").length,
    localVmMax: input.localVmMax,
    boxes: input.boxes.length,
    vps: input.vps.length,
    orphaned: input.boxes.filter((instance) => instance.orphaned).length
      + input.vps.filter((instance) => instance.orphaned).length,
  };
}

/** The worst state across a set, for a single summary dot. */
export function worstInventoryState(states: readonly ComputerStateKind[]): ComputerStateKind | null {
  const order: ComputerStateKind[] = [
    "attention", "unmanaged", "going-to-sleep", "restarting", "removing",
    "paused", "starting", "stopped", "sleeping", "in-use", "running",
  ];
  for (const state of order) if (states.includes(state)) return state;
  return null;
}

export const inventoryStateOf = {
  box: cloudComputerInventoryStateKind,
  vps: vpsComputerInventoryStateKind,
};