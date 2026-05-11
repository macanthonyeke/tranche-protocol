import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { useAccount } from "wagmi";
import type { Escrow, Milestone } from "../lib/types";
import { EscrowState, MilestoneState, getRole } from "../lib/types";
import { useMilestones } from "../hooks/useEscrows";
import { useEscrowMeta, rememberCreatedAt } from "../hooks/useEscrowMeta";
import {
  escrowReference,
  formatUSDC,
  shortAddress,
  timeUntil,
  relativeTime,
} from "../lib/format";
import { EscrowStateBadge, RoleBadge } from "./StateBadge";
import { ChainBadge } from "./ChainBadge";

export function EscrowCard({ escrow, index }: { escrow: Escrow; index: number }) {
  const { address } = useAccount();
  const role = getRole(escrow, address);
  const { milestones } = useMilestones(escrow.id, escrow.milestoneCount);
  const { projectName, createdAt } = useEscrowMeta(escrow.id);

  // First time we see this escrow, stamp a creation timestamp so we always
  // have a "Created X ago" label even though the contract doesn't store it.
  useEffect(() => {
    if (!createdAt) {
      rememberCreatedAt(escrow.id, Math.floor(Date.now() / 1000));
    }
  }, [createdAt, escrow.id]);

  const completedCount = milestones.filter(
    (m) =>
      m.state === MilestoneState.RELEASED ||
      m.state === MilestoneState.REFUNDED,
  ).length;
  const totalCount = Number(escrow.milestoneCount);

  const counterparty =
    role === "depositor" ? escrow.recipient : escrow.depositor;

  const nextActionable = milestones.find((m) => actionableState(m));
  const hasDispute = milestones.some(
    (m) => m.state === MilestoneState.DISPUTED,
  );

  const deadline =
    escrow.state === EscrowState.ACTIVE && escrow.deadline > 0n
      ? timeUntil(escrow.deadline)
      : null;

  const primaryLabel =
    projectName ?? escrowReference(escrow.invoiceHash, escrow.totalAmount);

  const createdLabel = createdAt
    ? `Created ${relativeTime(createdAt)}`
    : "Created recently";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      layout
    >
      <Link
        to={`/escrow/${escrow.id}`}
        className="glass glass-hover block p-6 group"
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {role !== "none" && <RoleBadge role={role === "both" ? "both" : role} />}
              <EscrowStateBadge state={escrow.state} />
              {hasDispute && (
                <span className="pill border bg-warn/10 text-warn-soft border-warn/30">
                  Dispute open
                </span>
              )}
              {escrow.depositorApproveCancel && escrow.recipientApproveCancel && (
                <span className="pill border bg-bad/10 text-bad-soft border-bad/20">
                  Cancellation pending
                </span>
              )}
            </div>
            <div className="font-display text-xl text-fg-strong truncate">
              {primaryLabel}
            </div>
            <div className="text-xs text-muted-soft mt-1">
              with{" "}
              <span className="font-mono text-fg">
                {shortAddress(counterparty)}
              </span>
              {!projectName && (
                <span className="text-muted">
                  {"  ·  "}
                  Ref {escrowReference(escrow.invoiceHash, escrow.totalAmount).split(" · ")[0]}
                </span>
              )}
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="font-display text-2xl text-fg-strong mono-amount">
              {formatUSDC(escrow.totalAmount, false)}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted">
              USDC locked
            </div>
            <div className="mt-1 flex justify-end">
              <ChainBadge domain={escrow.destinationDomain} size="sm" showName={false} />
            </div>
          </div>
        </div>

        {totalCount > 0 && (
          <div className="mb-4">
            <div className="flex justify-between text-[11px] uppercase tracking-widest text-muted mb-1.5">
              <span>Milestones</span>
              <span>
                {completedCount} / {totalCount}
              </span>
            </div>
            <div className="h-1.5 bg-surface/70 rounded-full overflow-hidden flex gap-[2px]">
              {milestones.map((m) => (
                <div
                  key={m.index}
                  className={`flex-1 h-full ${milestoneSegmentColor(m)}`}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 text-xs flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-muted">{createdLabel}</span>
            {deadline && (
              <span
                className={`inline-flex items-center gap-1.5 ${
                  deadline.expired ? "text-bad-soft" : "text-muted-soft"
                }`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                Deadline {deadline.label}
              </span>
            )}
          </div>

          {nextActionable ? (
            <span className="pill border bg-accent/10 text-accent border-accent/30">
              {actionLabelFor(nextActionable, role)}
            </span>
          ) : escrow.state === EscrowState.ACTIVE ? (
            <span className="text-muted-soft">In progress</span>
          ) : null}
        </div>
      </Link>
    </motion.div>
  );
}

function milestoneSegmentColor(m: Milestone): string {
  switch (m.state) {
    case MilestoneState.RELEASED:
      return "bg-ok";
    case MilestoneState.REFUNDED:
      return "bg-bad/60";
    case MilestoneState.FULFILLED:
      return "bg-accent";
    case MilestoneState.DISPUTED:
      return "bg-warn";
    case MilestoneState.PENDING:
    default:
      return "bg-surface";
  }
}

function actionableState(m: Milestone): boolean {
  return (
    m.state === MilestoneState.PENDING ||
    m.state === MilestoneState.FULFILLED ||
    m.state === MilestoneState.DISPUTED
  );
}

function actionLabelFor(m: Milestone, role: ReturnType<typeof getRole>): string {
  if (m.state === MilestoneState.PENDING) {
    return role === "depositor" ? "Approve milestone" : "Awaiting depositor";
  }
  if (m.state === MilestoneState.FULFILLED) {
    return role === "recipient" || role === "depositor"
      ? "Review period open"
      : "Awaiting release";
  }
  if (m.state === MilestoneState.DISPUTED) return "In dispute";
  return "View";
}
