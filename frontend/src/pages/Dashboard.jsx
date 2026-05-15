import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import ConnectGate from '../components/ConnectGate.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import { EscrowBadge, RoleBadge } from '../components/StatusBadge.jsx'
import SkeletonCard from '../components/SkeletonCard.jsx'
import { useDashboard, useUsdcBalance } from '../hooks/useEscrows.js'
import { formatUSDC } from '../utils/format.js'

export default function Dashboard() {
  return (
    <ConnectGate>
      <DashboardInner />
    </ConnectGate>
  )
}

function DashboardInner() {
  const { address } = useAccount()
  const { dashboard, isLoading } = useDashboard(address)
  const { balance: usdcBalance } = useUsdcBalance(address)

  const refundBal = dashboard?.refundBalance ?? 0n
  const activeCount = dashboard?.activeEscrowCount ?? 0
  const openDisputeCount = dashboard?.openDisputeCount ?? 0

  // Build a unified list of summaries with role attached, deduplicating in the
  // unlikely case the same wallet is both depositor and recipient.
  const mySummaries = useMemo(() => {
    if (!dashboard) return []
    const map = new Map()
    dashboard.asPayer.forEach((s) => s && map.set(s.id, { ...s, isPayer: true }))
    dashboard.asFreelancer.forEach((s) => {
      if (!s) return
      const existing = map.get(s.id)
      map.set(s.id, existing ? { ...existing } : { ...s, isPayer: false })
    })
    return Array.from(map.values())
  }, [dashboard])

  const activeEscrows = useMemo(() => mySummaries.filter((s) => s.state === 0), [mySummaries])

  // Heuristic for "action required" mirrors the prior contract-derived flags:
  //   - any disputed milestone in this escrow
  //   - freelancer with zero released milestones on an active escrow
  // (We no longer fetch per-milestone state here; the detail page handles the
  // finer signalled/fulfilled gating.)
  const actionRequired = useMemo(() => activeEscrows.filter((s) => {
    if (s.disputedMilestoneCount > 0) return true
    if (!s.isPayer && s.releasedMilestoneCount === 0) return true
    return false
  }), [activeEscrows])
  const awaiting = useMemo(
    () => activeEscrows.filter((s) => !actionRequired.includes(s)),
    [activeEscrows, actionRequired]
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-text-secondary text-sm mt-1">Your escrows at a glance.</p>
        </div>
        <Link to="/create" className="btn-primary text-sm py-2.5 self-start md:self-auto">
          + New Escrow
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Escrows" value={activeCount} loading={isLoading} />
        <StatCard
          label="Open Disputes"
          value={openDisputeCount}
          tone={openDisputeCount > 0 ? 'warning' : 'default'}
          loading={isLoading}
        />
        <StatCard label="USDC Balance" value={formatUSDC(usdcBalance)} mono loading={isLoading} />
        <StatCard
          label="Refund Available"
          value={formatUSDC(refundBal)}
          mono
          tone={refundBal > 0n ? 'accent' : 'default'}
          loading={isLoading}
          action={refundBal > 0n ? <Link to="/settings" className="text-accent text-xs">Withdraw →</Link> : null}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 flex flex-col gap-4"><SkeletonCard /><SkeletonCard /></div>
          <div className="lg:col-span-5 flex flex-col gap-4"><SkeletonCard /></div>
        </div>
      ) : activeEscrows.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <h2 className="text-xl font-semibold mb-2">No escrows yet</h2>
          <p className="text-sm text-text-secondary mb-6">When you create or receive an escrow, it'll appear here.</p>
          <Link to="/create" className="btn-primary inline-flex">Create your first escrow</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <section className="lg:col-span-7 flex flex-col gap-4">
            <SectionHeader title="Action Required" count={actionRequired.length} tone="warning" />
            {actionRequired.length === 0 ? (
              <EmptyPanel text="Nothing needs your attention. Sit tight." />
            ) : (
              actionRequired.map((e) => <EscrowCard key={e.id} summary={e} />)
            )}
          </section>

          <section className="lg:col-span-5 flex flex-col gap-4">
            <SectionHeader title="Awaiting" count={awaiting.length} />
            {awaiting.length === 0 ? (
              <EmptyPanel text="No escrows waiting." />
            ) : (
              awaiting.map((e) => <EscrowCard key={e.id} summary={e} />)
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function SectionHeader({ title, count, tone = 'default' }) {
  const dotCls = tone === 'warning' ? 'bg-status-warning' : 'bg-text-tertiary'
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotCls}`} />
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <span className="text-text-secondary text-sm">{count}</span>
    </div>
  )
}

function EmptyPanel({ text }) {
  return (
    <div className="card-surface p-6 text-sm text-text-secondary">{text}</div>
  )
}

function StatCard({ label, value, mono = false, tone = 'default', action = null, loading = false }) {
  const valueCls = tone === 'warning'
    ? 'text-status-warning'
    : tone === 'accent'
    ? 'text-accent'
    : 'text-text-primary'
  return (
    <div className="card-surface p-5 flex flex-col gap-1">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className={`text-2xl font-semibold ${valueCls} ${mono ? 'font-mono' : ''}`}>
        {loading ? <span className="inline-block animate-pulse rounded bg-background-tertiary h-7 w-20" /> : value}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

function EscrowCard({ summary }) {
  const role = summary.isPayer ? 'payer' : 'freelancer'
  const otherParty = summary.isPayer ? summary.recipient : summary.depositor
  const otherLabel = summary.isPayer ? 'Freelancer' : 'Payer'
  const inv = summary.invoiceHash
    ? `INV-${summary.invoiceHash.slice(2, 6).toUpperCase()}`
    : `ESC-${summary.id}`

  return (
    <Link
      to={`/escrow/${summary.id}`}
      className="card-surface p-5 hover:border-border-medium transition-colors flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-2">
        <RoleBadge role={role} />
        <EscrowBadge state={summary.state} />
      </div>

      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="font-mono text-sm text-text-secondary">{inv}</span>
        <span className="text-text-tertiary">·</span>
        <span className="font-mono text-lg text-text-primary">{formatUSDC(summary.totalAmount)}</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs text-text-secondary mb-1">{otherLabel}</div>
          <AddressDisplay address={otherParty} size="sm" />
        </div>
        <div className="text-right">
          <div className="text-xs text-text-secondary mb-1">Milestones</div>
          <div className="text-sm font-mono">{summary.releasedMilestoneCount} / {summary.milestoneCount} paid</div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
        <span className="text-xs text-text-tertiary">Escrow #{summary.id}</span>
        <span className="text-sm text-accent">Open →</span>
      </div>
    </Link>
  )
}
