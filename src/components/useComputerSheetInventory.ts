// The computer sheet's inventory read.
//
// One hook, four GETs, nothing else. Opening a sheet must never provision,
// wake, prepare or remove a machine — every paid lifecycle action stays a
// deliberate press in Settings / Computers or on the team map. The endpoints
// and their payload shapes are the Settings section's own, reused through
// `computerInventoryRequest`, so a strip count can never disagree with the
// inventory it summarises.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/state/store";
import {
  computerInventoryRequest,
  type CloudComputerInventoryInstance,
  type CloudComputerInventoryPayload,
  type LocalVmInventoryInstance,
  type VpsComputerInventoryInstance,
} from "@/components/LocalComputerSection";
import { computerInventoryCounts, type InventoryCounts } from "@/lib/computer-sheet";

export interface ComputerSheetInventory {
  localVms: LocalVmInventoryInstance[];
  boxes: CloudComputerInventoryInstance[];
  vps: VpsComputerInventoryInstance[];
  counts: InventoryCounts;
  loading: boolean;
  /** A read that failed is a quiet footnote, not a red banner: the sheet's job
   *  is the conversation's computer, and a count that cannot be fetched says
   *  so rather than showing a zero that reads as "nothing exists". */
  problem: string | null;
  refresh: () => void;
}

const EMPTY: Pick<ComputerSheetInventory, "localVms" | "boxes" | "vps"> = { localVms: [], boxes: [], vps: [] };

export function useComputerSheetInventory(enabled = true): ComputerSheetInventory {
  const [data, setData] = useState(EMPTY);
  const [maxInstances, setMaxInstances] = useState(0);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const read = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; read.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    const alive = () => mounted.current && !controller.signal.aborted;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    setLoading(true);
    void Promise.all([
      api(computerInventoryRequest("local-vms", signal)[0], { signal }),
      api(computerInventoryRequest("cloud", signal)[0], { signal }),
      api(computerInventoryRequest("vps", signal)[0], { signal }),
    ]).then(([local, cloud, remote]) => {
      if (!alive()) return;
      const vms = local as { instances?: LocalVmInventoryInstance[]; maxInstances?: number };
      setData({
        localVms: Array.isArray(vms.instances) ? vms.instances : [],
        boxes: Array.isArray((cloud as CloudComputerInventoryPayload).instances)
          ? (cloud as CloudComputerInventoryPayload).instances : [],
        vps: Array.isArray((remote as { instances?: VpsComputerInventoryInstance[] }).instances)
          ? (remote as { instances: VpsComputerInventoryInstance[] }).instances : [],
      });
      setMaxInstances(typeof vms.maxInstances === "number" ? vms.maxInstances : 0);
      setProblem(null);
    }).catch((cause) => {
      if (!alive()) return;
      setProblem(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (alive()) setLoading(false);
    });
  }, [enabled, nonce]);

  return {
    ...data,
    counts: computerInventoryCounts({ ...data, localVmMax: maxInstances }),
    loading,
    problem,
    refresh,
  };
}