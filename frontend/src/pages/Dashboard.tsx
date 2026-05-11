import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount, useReadContracts } from "wagmi";
import { motion, AnimatePresence } from "framer-motion";
import { useUserEscrows, useRefundBalance } from "../hooks/useEscrows";
import { useUsdcBalance } from "../hooks/useUsdcBalance";
import { EscrowCard } from "../components/EscrowCard";
import { CardSkeleton, EmptyState } from "../components/CardSkeleton";
import { ConnectGate } from "../components/ConnectGate";
import { ESCROW_ADDRESS } from "../lib/config";
import { escrowAbi } from "../lib/escrowAbi";
import { EscrowState, MilestoneState, getRole } from "../lib/types";
import { formatUSDC } from "../lib/format";

type Filter =
  | "active"
  | "depositor"
  | "recipient"
  | "completed"
  | "disputed"
  | "cancelled";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "depositor", label: "As Depositor" },
  { id: "recipient", label: "As Recipient" },
  { id: "completed", label: "Completed" },
  { id: "disputed", label: "Disputed" },
  { id: "cancelled", label: "Cancelled" },
];

export function Dashboard() {
  const { address, isConnected } = useAccount();
  const { escrows, isLoading } = useUserEscrows();
  const { data: refundBalance } = useRefundBalance(address);
  const { data: usdcBalance } = useUsdcBalance(address);
  const [filter, setFilter] = useState<Filter>("active");

  // Load milestone state across all user escrows so we can filter by Disputed.
  // For a personal dashboard the volume is small.
  const milestoneCalls = useMemo(() => {
    const calls: { escrowId: bigint; idx: number }[] = [];
    for (const e of escrows) {
      const c = Number(e.milestoneCount);
      for (let i = 0; i < c; i++) calls.push({ escrowId: e.id, idx: i });
    }
    return calls;
  }, [escrows]);

  const milestoneReads = useReadContracts({
    contracts: milestoneCalls.map((c) => ({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "milestones" as const,
      args: [c.escrowId, BigInt(c.idx)] as const,
    })),
    allowFailure: true,
    query: { enabled: milestoneCalls.length > 0, refetchInterval: 12_000 },
  });

  const disputedEscrowIds = useMemo(() => {
    if (!milestoneReads.data) return new Set<string>();
    const set = new Set<string>();
    milestoneReads.data.forEach((r, i) => {
      if (r.status !== "success" || !r.result) return;
      const arr = r.result as unknown as readonly unknown[];
      const state = arr[2] as number;
      if (state === MilestoneState.DISPUTED) {
        set.add(milestoneCalls[i].escrowId.toString());
      }
    });
    return set;
  }, [milestoneReads.data, milestoneCalls]);

  const stats = useMemo(() => {
    const active = escrows.filter((e) => e.state === EscrowState.ACTIVE);
    let locked = 0n;
    for (const e of active) {
      if (address && e.depositor.toLowerCase() === address.toLowerCase()) {
        locked += e.totalAmount;
      }
    }
    return { activeCount: active.length, locked };
  }, [escrows, address]);

  const visible = useMemo(() => {
    if (!address) return [];
    return escrows.filter((e) => {
      const role = getRole(e, address);
      switch (filter) {
        case "depositor":
          return role === "depositor" || role === "both";
        case "recipient":
          return role === "recipient" || role === "both";
        case "active":
          return e.state === EscrowState.ACTIVE;
        case "completed":
          return e.state === EscrowState.COMPLETED;
        case "cancelled":
          return e.state === EscrowState.CANCELLED;
        case "disputed":
          return disputedEscrowIds.has(e.id.toString());
        default:
          return true;
      }
    });
  }, [escrows, filter, address, disputedEscrowIds]);

  if (!isConnected) {
    return <ConnectGate title="Connect to view your escrows" />;
  }

  const usdc = (usdcBalance as bigint | undefined) ?? 0n;
  const refunds = (refundBalance as bigint | undefined) ?? 0n;

  return (
    <div>
      <section className="mb-10">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
          <div>
            <h1 className="font-display text-4xl md:text-5xl text-fg-strong tracking-tight">
              Your escrows
            </h1>
            <p className="text-muted-soft mt-2">
              Milestone payments in USDC, with built-in dispute resolution.
            </p>
          </div>
          <Link to="/create" className="btn btn-primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Escrow
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Active escrows"
            value={String(stats.activeCount)}
            tone="cyan"
          />
          <StatCard
            label="Locked as depositor"
            value={formatUSDC(stats.locked, false)}
            unit="USDC"
            tone="white"
          />
          <StatCard
            label="Your USDC balance"
            value={formatUSDC(usdc, false)}
            unit="USDC"
            tone="white"
          />
          <StatCard
            label="Pending refunds"
            value={formatUSDC(refunds, false)}
            unit="USDC"
            tone={refunds > 0n ? "amber" : "white"}
            cta={
              refunds > 0n ? (
                <Link
                  to="/withdraw"
                  className="text-warn-soft text-xs underline"
                >
                  Withdraw
                </Link>
              ) : null
            }
          />
        </div>
      </section>

      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2 -mx-1 px-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={[
              "px-3.5 py-1.5 rounded-full text-xs font-medium tracking-wide transition-all whitespace-nowrap border",
              filter === f.id
                ? "bg-accent/10 text-accent border-accent/30"
                : "bg-surface/40 text-muted-soft border-line hover:text-fg-strong hover:border-line-strong",
            ].join(" ")}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && escrows.length === 0 ? (
        <CardSkeleton count={3} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={
            escrows.length === 0
              ? "No escrows yet"
              : "No escrows match this filter"
          }
          hint={
            escrows.length === 0
              ? "Once you create an escrow or someone funds you, it will appear here."
              : "Try a different filter or create a new escrow."
          }
          action={
            <Link to="/create" className="btn btn-primary">
              Create Escrow
            </Link>
          }
        />
      ) : (
        <motion.div layout className="grid gap-4">
          <AnimatePresence>
            {visible.map((e, i) => (
              <EscrowCard key={e.id.toString()} escrow={e} index={i} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  tone = "white",
  cta,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "white" | "cyan" | "amber";
  cta?: React.ReactNode;
}) {
  const toneClass =
    tone === "cyan"
      ? "text-accent"
      : tone === "amber"
        ? "text-warn-soft"
        : "text-fg-strong";
  return (
    <div className="glass p-5">
      <div className="flex justify-between items-start">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
          {label}
        </div>
        {cta}
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className={`font-display text-3xl mono-amount ${toneClass}`}>
          {value}
        </span>
        {unit && <span className="text-xs text-muted-soft">{unit}</span>}
      </div>
    </div>
  );
}
