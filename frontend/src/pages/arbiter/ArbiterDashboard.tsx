import { useMemo, useState } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { useAllEscrows, useHasArbiterRole } from "../../hooks/useEscrows";
import { ConnectGate } from "../../components/ConnectGate";
import { CardSkeleton, EmptyState } from "../../components/CardSkeleton";
import { ESCROW_ADDRESS } from "../../lib/config";
import { escrowAbi } from "../../lib/escrowAbi";
import {
  EscrowState,
  MilestoneState,
  type Escrow,
  type Milestone,
} from "../../lib/types";
import { DisputeCase } from "./DisputeCase";
import { AdminPanel } from "../../components/AdminPanel";
import { DomainsPanel } from "../../components/DomainsPanel";

type Tab = "disputes" | "admin" | "domains";

export function ArbiterDashboard() {
  const { address, isConnected } = useAccount();
  const { data: hasRole, isLoading: roleLoading } = useHasArbiterRole(address);
  const { escrows, isLoading } = useAllEscrows();
  const [tab, setTab] = useState<Tab>("disputes");

  const activeEscrows = useMemo(
    () => escrows.filter((e) => e.state === EscrowState.ACTIVE),
    [escrows],
  );

  const milestoneCalls = useMemo(() => {
    const calls: { e: Escrow; idx: number; call: ReturnType<typeof buildCall> }[] = [];
    for (const e of activeEscrows) {
      const count = Number(e.milestoneCount);
      for (let i = 0; i < count; i++) {
        calls.push({ e, idx: i, call: buildCall(e.id, i) });
      }
    }
    return calls;
  }, [activeEscrows]);

  const milestoneReads = useReadContracts({
    contracts: milestoneCalls.map((c) => c.call),
    allowFailure: true,
    query: {
      enabled: milestoneCalls.length > 0 && hasRole === true,
      refetchInterval: 12_000,
    },
  });

  const disputed = useMemo(() => {
    if (!milestoneReads.data) return [];
    const out: { escrow: Escrow; milestone: Milestone }[] = [];
    milestoneReads.data.forEach((r, i) => {
      if (r.status !== "success" || !r.result) return;
      const arr = r.result as unknown as readonly unknown[];
      const m: Milestone = {
        index: milestoneCalls[i].idx,
        amount: arr[0] as bigint,
        conditionMetTimestamp: arr[1] as bigint,
        state: arr[2] as MilestoneState,
        deliveredAt: (arr[3] as bigint) ?? 0n,
      };
      if (m.state === MilestoneState.DISPUTED) {
        out.push({ escrow: milestoneCalls[i].e, milestone: m });
      }
    });
    return out;
  }, [milestoneReads.data, milestoneCalls]);

  const releasable = useMemo(() => {
    if (!milestoneReads.data) return [];
    const out: { escrow: Escrow; milestone: Milestone }[] = [];
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    milestoneReads.data.forEach((r, i) => {
      if (r.status !== "success" || !r.result) return;
      const arr = r.result as unknown as readonly unknown[];
      const m: Milestone = {
        index: milestoneCalls[i].idx,
        amount: arr[0] as bigint,
        conditionMetTimestamp: arr[1] as bigint,
        state: arr[2] as MilestoneState,
        deliveredAt: (arr[3] as bigint) ?? 0n,
      };
      if (
        m.state === MilestoneState.FULFILLED &&
        nowSec > m.conditionMetTimestamp + milestoneCalls[i].e.disputeWindow
      ) {
        out.push({ escrow: milestoneCalls[i].e, milestone: m });
      }
    });
    return out;
  }, [milestoneReads.data, milestoneCalls]);

  if (!isConnected) {
    return <ConnectGate title="Connect to access the Arbiter Panel" />;
  }

  if (roleLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        <CardSkeleton count={2} />
      </div>
    );
  }

  if (!hasRole) {
    return (
      <div className="max-w-xl mx-auto popover-surface p-10 text-center mt-16">
        <div className="mx-auto w-12 h-12 rounded-full bg-bad/10 text-bad flex items-center justify-center mb-4">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div className="font-display text-2xl text-fg-strong mb-2">
          Access Denied
        </div>
        <p className="text-sm text-muted-soft">
          This wallet does not have permission to view this page.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-4xl md:text-5xl text-gold-soft uppercase tracking-tight">
          Arbiter Panel
        </h1>
        <p className="text-muted-soft mt-2">
          Manage disputes, admin controls, and supported destination chains.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-8 border-b border-gold/10">
        {(["disputes", "admin", "domains"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-gold text-gold-soft"
                : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {t === "disputes" ? (
              <>
                Disputes
                {disputed.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-gold/10 text-gold-soft">
                    {disputed.length}
                  </span>
                )}
              </>
            ) : t === "admin" ? (
              "Admin"
            ) : (
              "Domains"
            )}
          </button>
        ))}
      </div>

      {/* Disputes tab */}
      {tab === "disputes" && (
        <>
          <div className="grid sm:grid-cols-3 gap-4 mb-10">
            <ArbiterStat label="Open disputes" value={disputed.length} tone="amber" />
            <ArbiterStat label="Ready to release" value={releasable.length} />
            <ArbiterStat label="Active escrows" value={activeEscrows.length} />
          </div>

          <section className="mb-12">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-2xl text-fg-strong">Open disputes</h2>
              <span className="text-xs text-muted">{disputed.length} open</span>
            </div>

            {isLoading || milestoneReads.isLoading ? (
              <CardSkeleton count={2} />
            ) : disputed.length === 0 ? (
              <EmptyState
                title="No open disputes"
                hint="When a depositor or recipient raises a dispute, it shows up here."
              />
            ) : (
              <div className="grid gap-4">
                {disputed.map(({ escrow, milestone }) => (
                  <DisputeCase
                    key={`${escrow.id}-${milestone.index}`}
                    escrow={escrow}
                    milestone={milestone}
                    onResolved={() => milestoneReads.refetch()}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-2xl text-fg-strong">
                Ready to release
              </h2>
              <span className="text-xs text-muted">{releasable.length}</span>
            </div>

            {releasable.length === 0 ? (
              <EmptyState
                title="Nothing to release"
                hint="Milestones whose review period ended without a dispute will appear here."
              />
            ) : (
              <div className="grid gap-3">
                {releasable.map(({ escrow, milestone }) => (
                  <DisputeCase
                    key={`r-${escrow.id}-${milestone.index}`}
                    escrow={escrow}
                    milestone={milestone}
                    releaseMode
                    onResolved={() => milestoneReads.refetch()}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Admin tab */}
      {tab === "admin" && <AdminPanel />}

      {/* Domains tab */}
      {tab === "domains" && <DomainsPanel />}
    </div>
  );
}

function buildCall(escrowId: bigint, milestoneIndex: number) {
  return {
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "milestones" as const,
    args: [escrowId, BigInt(milestoneIndex)] as const,
  };
}

function ArbiterStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "amber";
}) {
  return (
    <div className="glass-amber p-5">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
        {label}
      </div>
      <div
        className={`font-display text-3xl mono-amount mt-3 ${tone === "amber" ? "text-gold-soft" : "text-fg-strong"}`}
      >
        {value}
      </div>
    </div>
  );
}
