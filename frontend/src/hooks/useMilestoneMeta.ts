import { useEffect, useState } from "react";
import type { MilestoneMeta } from "../lib/types";
import { loadMilestoneMetaArr, saveMilestoneMeta } from "./useEscrowMeta";

export { saveMilestoneMeta };

export function loadMilestoneMeta(escrowId: bigint): MilestoneMeta[] {
  return loadMilestoneMetaArr(escrowId);
}

export function useMilestoneMeta(escrowId: bigint | undefined) {
  const [meta, setMeta] = useState<MilestoneMeta[]>([]);

  useEffect(() => {
    if (escrowId === undefined) return;
    setMeta(loadMilestoneMeta(escrowId));
  }, [escrowId]);

  return { meta };
}

export function getMilestoneTitle(meta: MilestoneMeta[], index: number): string {
  return meta[index]?.title ?? `Milestone ${index + 1}`;
}
