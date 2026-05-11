import { motion } from "framer-motion";
import { useReadContracts } from "wagmi";
import type { Escrow, Milestone } from "../lib/types";
import { MilestoneState } from "../lib/types";
import { MilestoneStateBadge } from "./StateBadge";
import { formatUSDC, shortHash } from "../lib/format";
import { CopyButton } from "./CopyButton";
import { ESCROW_ADDRESS } from "../lib/config";
import { escrowAbi } from "../lib/escrowAbi";
import { useMemo } from "react";

function formatCountdown(targetSec: number): {
  label: string;
  expired: boolean;
} {
  const now = Math.floor(Date.now() / 1000);
  const diff = targetSec - now;
  if (diff <= 0) return { label: "expired", expired: true };
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return { label: parts.join(" "), expired: false };
}

interface Props {
  escrow: Escrow;
  milestones: Milestone[];
  metaTitles: string[];
  metaDescriptions: string[];
}

export function MilestoneTimeline({ escrow, milestones, metaTitles, metaDescriptions }: Props) {
  // Read dispute data for any milestone in DISPUTED state
  const disputedIndices = useMemo(
    () => milestones.filter((m) => m.state === MilestoneState.DISPUTED).map((m) => m.index),
    [milestones],
  );

  const disputeReads = useReadContracts({
    contracts: disputedIndices.map((idx) => ({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "disputes" as const,
      args: [escrow.id, BigInt(idx)] as const,
    })),
    allowFailure: true,
    query: { enabled: disputedIndices.length > 0 },
  });

  const disputeMap = useMemo(() => {
    const m = new Map<number, DisputeInfo>();
    if (!disputeReads.data) return m;
    disputeReads.data.forEach((r, i) => {
      if (r.status === "success" && r.result) {
        const arr = r.result as unknown as readonly unknown[];
        m.set(disputedIndices[i], {
          disputedBy: arr[0] as `0x${string}`,
          evidenceHash: arr[1] as `0x${string}`,
          evidenceURI: arr[2] as string,
          reason: arr[3] as string,
          counterEvidenceHash: arr[4] as `0x${string}`,
          counterEvidenceURI: arr[5] as string,
          resolutionHash: arr[6] as `0x${string}`,
          raisedAt: (arr[7] as bigint) ?? 0n,
        });
      }
    });
    return m;
  }, [disputeReads.data, disputedIndices]);

  return (
    <div className="space-y-3">
      {milestones.map((m, i) => {
        const disp = disputeMap.get(m.index);
        const reviewEndSec =
          m.conditionMetTimestamp > 0n
            ? Number(m.conditionMetTimestamp + escrow.disputeWindow)
            : null;
        const reviewCountdown =
          m.state === MilestoneState.FULFILLED && reviewEndSec
            ? formatCountdown(reviewEndSec)
            : null;
        const approvedDate =
          m.conditionMetTimestamp > 0n
            ? new Date(Number(m.conditionMetTimestamp) * 1000)
            : null;

        return (
          <motion.div
            key={m.index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.04 }}
            className="relative"
          >
            <div className="flex gap-4">
              {/* Rail */}
              <div className="flex flex-col items-center">
                <NodeDot state={m.state} />
                {i < milestones.length - 1 && (
                  <div className="w-px flex-1 bg-surface my-1" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 pb-4">
                <div className="glass p-5">
                  <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted mb-1">
                        Milestone {m.index + 1}
                      </div>
                      <div className="font-display text-lg text-fg-strong">
                        {metaTitles[m.index] ?? `Milestone ${m.index + 1}`}
                      </div>
                      {metaDescriptions[m.index] && (
                        <div className="text-sm text-muted-soft mt-1">
                          {metaDescriptions[m.index]}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-lg text-fg-strong mono-amount">
                        {formatUSDC(m.amount, false)}
                      </div>
                      <div className="text-[10px] uppercase tracking-widest text-muted">
                        USDC
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap mt-3">
                    <MilestoneStateBadge state={m.state} />
                    {m.state === MilestoneState.PENDING && m.deliveredAt > 0n && (
                      <DeliverySignaledPill
                        deliveredAt={m.deliveredAt}
                        deliveryNoticeWindow={escrow.deliveryNoticeWindow}
                      />
                    )}
                    {reviewCountdown && !reviewCountdown.expired && (
                      <span className="pill bg-warn/10 text-warn-soft border border-warn/30">
                        Review period ends in {reviewCountdown.label}
                      </span>
                    )}
                    {reviewCountdown && reviewCountdown.expired && (
                      <span className="pill bg-ok/10 text-ok-soft border border-ok/20">
                        Review period expired, ready to release
                      </span>
                    )}
                  </div>

                  {(m.state === MilestoneState.FULFILLED ||
                    m.state === MilestoneState.RELEASED ||
                    m.state === MilestoneState.DISPUTED) &&
                    approvedDate && (
                      <div className="text-xs text-muted-soft mt-2">
                        Approved on {approvedDate.toLocaleString()}
                      </div>
                    )}

                  {disp && <DisputeBlock disp={disp} />}
                </div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

interface DisputeInfo {
  disputedBy: `0x${string}`;
  evidenceHash: `0x${string}`;
  evidenceURI: string;
  reason: string;
  counterEvidenceHash: `0x${string}`;
  counterEvidenceURI: string;
  resolutionHash: `0x${string}`;
  raisedAt: bigint;
}

function DisputeBlock({ disp }: { disp: DisputeInfo }) {
  const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
  return (
    <div className="mt-4 rounded-xl border border-warn/15 bg-warn/[0.04] p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-warn animate-pulse" />
        <span className="font-display text-sm uppercase tracking-widest text-warn-soft">
          Dispute open
        </span>
      </div>
      {disp.reason && (
        <div className="text-sm text-fg mb-3 italic">"{disp.reason}"</div>
      )}
      <div className="grid sm:grid-cols-2 gap-3 text-xs">
        <DisputeField label="Evidence hash" value={shortHash(disp.evidenceHash)} fullValue={disp.evidenceHash} />
        <DisputeField label="Evidence URI" value={disp.evidenceURI} link />
        {disp.counterEvidenceHash !== ZERO && (
          <>
            <DisputeField
              label="Counter-evidence hash"
              value={shortHash(disp.counterEvidenceHash)}
              fullValue={disp.counterEvidenceHash}
            />
            <DisputeField label="Counter-evidence URI" value={disp.counterEvidenceURI} link />
          </>
        )}
        {disp.resolutionHash === ZERO ? (
          <div className="sm:col-span-2 text-warn-soft/80 italic mt-1">
            Waiting for an arbiter to review and decide.
          </div>
        ) : (
          <DisputeField label="Resolution hash" value={shortHash(disp.resolutionHash)} fullValue={disp.resolutionHash} />
        )}
      </div>
    </div>
  );
}

function DisputeField({
  label,
  value,
  fullValue,
  link,
}: {
  label: string;
  value: string;
  fullValue?: string;
  link?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="uppercase tracking-widest text-[10px] text-muted mb-1">{label}</div>
      <div className="flex items-center gap-1.5 min-w-0">
        {link && value ? (
          <a href={value} target="_blank" rel="noreferrer" className="font-mono text-accent truncate">
            {value}
          </a>
        ) : (
          <span className="font-mono text-fg truncate">{value || "Not set"}</span>
        )}
        {fullValue && <CopyButton value={fullValue} label="hash" />}
      </div>
    </div>
  );
}

function DeliverySignaledPill({
  deliveredAt,
  deliveryNoticeWindow,
}: {
  deliveredAt: bigint;
  deliveryNoticeWindow: bigint;
}) {
  const ends = Number(deliveredAt + deliveryNoticeWindow);
  const cd = formatCountdown(ends);

  if (cd.expired) {
    return (
      <span className="pill bg-ok/10 text-ok-soft border border-ok/20">
        Notice window expired, ready for silent release
      </span>
    );
  }

  // Compact "Xd Yh" view next to the badge.
  const lessThanADay = ends - Math.floor(Date.now() / 1000) < 86400;
  return (
    <span
      className={`pill ${
        lessThanADay
          ? "bg-bad/10 text-bad-soft border border-bad/20"
          : "bg-warn/10 text-warn-soft border border-warn/30"
      }`}
    >
      Delivery Signaled · Depositor review ends in {cd.label}
    </span>
  );
}

function NodeDot({ state }: { state: MilestoneState }) {
  const map: Record<MilestoneState, string> = {
    [MilestoneState.PENDING]: "bg-surface",
    [MilestoneState.FULFILLED]: "bg-accent shadow-[0_0_0_4px_rgba(0,240,255,0.15)]",
    [MilestoneState.DISPUTED]: "bg-warn shadow-[0_0_0_4px_rgba(245,158,11,0.18)]",
    [MilestoneState.RELEASED]: "bg-ok",
    [MilestoneState.REFUNDED]: "bg-bad/70",
  };
  return <div className={`w-3 h-3 rounded-full ${map[state]}`} />;
}
