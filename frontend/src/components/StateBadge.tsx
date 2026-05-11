import { EscrowState, MilestoneState } from "../lib/types";

export function EscrowStateBadge({ state }: { state: EscrowState }) {
  const map: Record<EscrowState, { label: string; cls: string }> = {
    [EscrowState.ACTIVE]: { label: "Active", cls: "bg-accent/10 text-accent border-accent/20" },
    [EscrowState.COMPLETED]: { label: "Completed", cls: "bg-ok/10 text-ok-soft border-ok/20" },
    [EscrowState.CANCELLED]: { label: "Cancelled", cls: "bg-bad/10 text-bad-soft border-bad/20" },
  };
  const { label, cls } = map[state];
  return <span className={`pill border ${cls}`}>{label}</span>;
}

export function MilestoneStateBadge({ state }: { state: MilestoneState }) {
  const map: Record<MilestoneState, { label: string; cls: string }> = {
    [MilestoneState.PENDING]: { label: "Pending", cls: "bg-surface/70 text-muted-soft border-line-strong" },
    [MilestoneState.FULFILLED]: { label: "Fulfilled", cls: "bg-accent/10 text-accent border-accent/20" },
    [MilestoneState.DISPUTED]: { label: "Disputed", cls: "bg-warn/10 text-warn-soft border-warn/30" },
    [MilestoneState.RELEASED]: { label: "Released", cls: "bg-ok/10 text-ok-soft border-ok/20" },
    [MilestoneState.REFUNDED]: { label: "Refunded", cls: "bg-bad/10 text-bad-soft border-bad/20" },
  };
  const { label, cls } = map[state];
  return <span className={`pill border ${cls}`}>{label}</span>;
}

export function RoleBadge({ role }: { role: "depositor" | "recipient" | "both" }) {
  const map = {
    depositor: { label: "You're paying", cls: "bg-accent/10 text-accent border-accent/20" },
    recipient: { label: "You're receiving", cls: "bg-warn/10 text-warn-soft border-warn/30" },
    both: { label: "Self-escrow", cls: "bg-surface/70 text-muted-soft border-line-strong" },
  };
  const { label, cls } = map[role];
  return <span className={`pill border ${cls}`}>{label}</span>;
}
