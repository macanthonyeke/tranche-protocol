import { useCallback, useEffect, useState } from "react";
import type { MilestoneMeta } from "../lib/types";

interface EscrowMeta {
  projectName?: string;
  milestones?: MilestoneMeta[];
  createdAt?: number; // unix seconds (best-effort, captured at first sight)
}

const KEY = (escrowId: bigint) => `cce.escrow.${escrowId.toString()}`;

function readMeta(escrowId: bigint): EscrowMeta {
  try {
    const raw = localStorage.getItem(KEY(escrowId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as EscrowMeta;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function writeMeta(escrowId: bigint, meta: EscrowMeta) {
  try {
    localStorage.setItem(KEY(escrowId), JSON.stringify(meta));
  } catch {
    /* quota or private mode */
  }
}

export function loadEscrowMeta(escrowId: bigint): EscrowMeta {
  return readMeta(escrowId);
}

export function loadMilestoneMetaArr(escrowId: bigint): MilestoneMeta[] {
  return readMeta(escrowId).milestones ?? [];
}

export function saveProjectName(escrowId: bigint, name: string) {
  const m = readMeta(escrowId);
  if (name.trim()) m.projectName = name.trim();
  else delete m.projectName;
  writeMeta(escrowId, m);
}

export function saveMilestoneMeta(escrowId: bigint, milestones: MilestoneMeta[]) {
  const m = readMeta(escrowId);
  m.milestones = milestones;
  writeMeta(escrowId, m);
}

export function rememberCreatedAt(escrowId: bigint, unixSec: number) {
  const m = readMeta(escrowId);
  if (!m.createdAt) {
    m.createdAt = unixSec;
    writeMeta(escrowId, m);
  }
}

export function useEscrowMeta(escrowId: bigint | undefined) {
  const [meta, setMeta] = useState<EscrowMeta>({});

  useEffect(() => {
    if (escrowId === undefined) return;
    setMeta(readMeta(escrowId));
    // Listen for changes from other tabs/components
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY(escrowId)) setMeta(readMeta(escrowId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [escrowId]);

  const setName = useCallback(
    (name: string) => {
      if (escrowId === undefined) return;
      saveProjectName(escrowId, name);
      setMeta(readMeta(escrowId));
    },
    [escrowId],
  );

  const setMilestones = useCallback(
    (m: MilestoneMeta[]) => {
      if (escrowId === undefined) return;
      saveMilestoneMeta(escrowId, m);
      setMeta(readMeta(escrowId));
    },
    [escrowId],
  );

  return {
    meta,
    projectName: meta.projectName,
    milestones: meta.milestones ?? [],
    createdAt: meta.createdAt,
    setName,
    setMilestones,
  };
}
