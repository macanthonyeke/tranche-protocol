import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { motion, AnimatePresence } from 'framer-motion'

import ConnectGate from '../components/ConnectGate.jsx'
import Skeleton from '../components/Skeleton.jsx'
import { useDashboard, useUsdcBalance } from '../hooks/useEscrows.js'
import { useRoles } from '../hooks/useRoles.jsx'
import { formatUSDC, formatUSDCNumber } from '../utils/format.js'

const PAGE_SIZE = 9

const isActionNeeded = (e) => {
  if (e.state !== 0) return false
  if (e.disputedMilestoneCount > 0) return true
  if (!e.isPayer && e.releasedMilestoneCount === 0) return true
  return false
}

const LEDGER_TABS = [
  { key: 'all',           label: 'All',           filter: () => true },
  { key: 'action-needed', label: 'Action Needed', filter: isActionNeeded },
  { key: 'active',        label: 'Active',        filter: (e) => e.state === 0 },
  { key: 'deposited',     label: 'Deposited',     filter: (e) => e.state === 0 && e.releasedMilestoneCount === 0 && e.disputedMilestoneCount === 0 },
  { key: 'disputed',      label: 'Disputed',      filter: (e) => e.disputedMilestoneCount > 0 },
  { key: 'completed',     label: 'Completed',     filter: (e) => e.state === 1 },
  { key: 'cancelled',     label: 'Cancelled',     filter: (e) => e.state === 2 }
]

export default function Dashboard() {
  return (
    <ConnectGate>
      <DashboardInner />
    </ConnectGate>
  )
}

function DashboardInner() {
  const { address } = useAccount()
  const navigate = useNavigate()
  const { isArbiter, isAdmin, isLoading: rolesLoading } = useRoles()

  useEffect(() => {
    if (rolesLoading) return
    if (isArbiter) navigate('/arbiter', { replace: true })
    else if (isAdmin) navigate('/protocol', { replace: true })
  }, [rolesLoading, isArbiter, isAdmin, navigate])

  const { dashboard, isLoading, refetch } = useDashboard(address)
  const { balance: usdcBalance } = useUsdcBalance(address)

  const [activeTab, setActiveTab] = useState('all')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [page, setPage] = useState(0)

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

  const tabDef = LEDGER_TABS.find((t) => t.key === activeTab) ?? LEDGER_TABS[0]
  const filteredEscrows = useMemo(
    () => mySummaries.filter(tabDef.filter),
    [mySummaries, tabDef]
  )

  useEffect(() => { setPage(0) }, [activeTab, filteredEscrows.length])

  const totalPages = Math.max(1, Math.ceil(filteredEscrows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageStart = safePage * PAGE_SIZE
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filteredEscrows.length)
  const visibleEscrows = filteredEscrows.slice(pageStart, pageEnd)

  const handleRefresh = async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try { await refetch?.() } finally { setIsRefreshing(false) }
  }

  // While roles are resolving, or for privileged wallets that are about to be
  // redirected, suppress the consumer vault grid so it never flashes.
  if (rolesLoading || isArbiter || isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8 md:gap-12">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-text-secondary text-sm mt-1">Everything tied to your wallet, in one place.</p>
        </div>
        <Link to="/create" className="btn-primary text-sm py-2.5 self-start md:self-auto">
          + New Escrow
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Active Escrows" value={activeCount} loading={isLoading} />
        <StatCard
          label="Open Disputes"
          value={openDisputeCount}
          tone={openDisputeCount > 0 ? 'warning' : 'default'}
          loading={isLoading}
        />
        <StatCard
          label="Total Locked"
          value={`${formatUSDCNumber(usdcBalance)} USDC`}
          mono
          loading={isLoading}
          action={
            refundBal > 0n ? (
              <Link to="/settings" className="text-accent text-xs">
                +{formatUSDC(refundBal)} refund ready to withdraw →
              </Link>
            ) : null
          }
        />
      </div>

      <section>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-2xl font-bold text-text-primary tracking-tight">Your Escrows</h2>
          <div className="flex items-center gap-2 px-3 py-1 bg-background-tertiary border border-border-subtle rounded-md shrink-0">
            <span className="w-1.5 h-1.5 bg-status-success rounded-full animate-pulse" />
            <span className="text-xs font-mono text-text-secondary tracking-widest uppercase whitespace-nowrap">
              {mySummaries.length} Total On-Chain
            </span>
          </div>
        </div>
        <p className="text-sm text-text-secondary mt-1">Manage your deposits, incoming payments, and refunds.</p>

        <div className="flex items-center justify-between border-b border-border-subtle w-full mt-4">
          <div className="flex items-center gap-6 overflow-x-auto scrollbar-hide">
            {LEDGER_TABS.map((tab) => {
              const isActive = tab.key === activeTab
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  aria-pressed={isActive}
                  className={
                    isActive
                      ? '-mb-[1px] pb-4 border-b-2 font-medium text-sm border-accent-blue text-text-primary transition-colors whitespace-nowrap'
                      : 'pb-4 font-medium text-sm text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap'
                  }
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="pb-4 flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors disabled:opacity-60"
          >
            <RefreshCwIcon size={14} spinning={isRefreshing} /> Refresh
          </button>
        </div>

        {isLoading ? (
          <DashboardSkeleton />
        ) : filteredEscrows.length === 0 ? (
          <div className="mt-8">
            <LedgerEmptyState />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
              <AnimatePresence initial={false} mode="popLayout">
                {visibleEscrows.map((e) => (
                  <motion.div
                    key={e.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                  >
                    <PremiumEscrowCard summary={e} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="flex items-center justify-between w-full mt-10 pt-6 border-t border-border-subtle text-sm text-text-secondary font-mono">
              <span>
                Showing {pageStart + 1}-{pageEnd} of {filteredEscrows.length} escrows
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="px-3 py-1.5 border border-border-subtle rounded-lg hover:bg-background-tertiary text-text-primary text-xs font-sans transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  className="px-3 py-1.5 border border-border-subtle rounded-lg hover:bg-background-tertiary text-text-primary text-xs font-sans transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function PremiumEscrowCard({ summary }) {
  const inv = summary.invoiceHash
    ? `INV-${summary.invoiceHash.slice(2, 6).toUpperCase()}`
    : `ESC-${summary.id}`
  const roleLabel = summary.isPayer ? "You're Paying" : 'Receiving'
  const status = deriveStatus(summary)

  return (
    <Link
      to={`/escrow/${summary.id}`}
      className="block bg-background-secondary dark:bg-white/[0.01] border border-border-subtle rounded-2xl p-6 relative group hover:-translate-y-1 hover:border-border-focused/50 transition-all duration-300 backdrop-blur-sm hover:shadow-[0_20px_40px_rgba(0,0,0,0.2)] dark:hover:shadow-[0_20px_40px_rgba(0,0,0,0.6)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background-primary"
    >
      <div className="flex justify-between items-start mb-4">
        <span className="text-sm font-mono text-text-secondary">{inv}</span>
        <span className="px-2 py-1 text-xs font-medium bg-background-tertiary rounded-md text-text-secondary">
          {roleLabel}
        </span>
      </div>

      <div className="text-3xl font-mono font-bold tracking-tight text-text-primary mt-3 tabular">
        {formatUSDCNumber(summary.totalAmount)}{' '}
        <span className="text-base font-sans font-normal text-text-secondary ml-1">USDC</span>
      </div>

      <div className="h-px w-full bg-border-subtle my-5" />

      <div className="flex justify-between items-end">
        <span className="text-sm text-text-secondary">
          <span className="font-mono tabular">{summary.releasedMilestoneCount} / {summary.milestoneCount}</span> released
        </span>
        <span className={`flex items-center gap-2 text-sm font-medium transition-colors ${status.textCls} group-hover:opacity-80`}>
          <span
            className={`w-1.5 h-1.5 rounded-full ${status.dotCls} ${status.glowCls} ${status.pulse ? 'animate-pulse' : ''}`}
            aria-hidden="true"
          />
          <span>{status.label} →</span>
        </span>
      </div>
    </Link>
  )
}

function deriveStatus(summary) {
  if (summary.disputedMilestoneCount > 0) {
    return {
      label: 'Disputed',
      textCls: 'text-status-warning',
      dotCls: 'bg-status-warning',
      glowCls: 'shadow-[0_0_8px_rgba(234,88,12,0.55)]',
      pulse: true
    }
  }
  if (summary.state === 1) {
    return {
      label: 'Completed',
      textCls: 'text-status-success',
      dotCls: 'bg-status-success',
      glowCls: 'shadow-[0_0_8px_rgba(5,150,105,0.55)]',
      pulse: false
    }
  }
  if (summary.state === 2) {
    return {
      label: 'Cancelled',
      textCls: 'text-text-tertiary',
      dotCls: 'bg-text-tertiary',
      glowCls: '',
      pulse: false
    }
  }
  return {
    label: 'View',
    textCls: 'text-accent-blue',
    dotCls: 'bg-accent-blue',
    glowCls: 'shadow-[0_0_8px_rgba(51,119,255,0.55)]',
    pulse: true
  }
}

function LedgerEmptyState() {
  return (
    <div className="w-full bg-black/[0.02] dark:bg-white/[0.02] border border-border-subtle rounded-2xl p-16 flex flex-col items-center justify-center backdrop-blur-sm">
      <div className="w-16 h-16 rounded-2xl bg-accent-blue/10 border border-accent-blue/20 text-accent-blue shadow-[0_0_15px_rgba(51,119,255,0.15)] flex items-center justify-center mb-6">
        <InboxIcon size={24} />
      </div>
      <h3 className="text-lg font-semibold text-text-primary">No escrows found</h3>
      <p className="text-sm text-text-secondary mt-2 max-w-sm text-center leading-relaxed">
        You haven't interacted with any contracts yet. Create a new escrow above to secure your first cross-chain payment.
      </p>
    </div>
  )
}

function InboxIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  )
}

function RefreshCwIcon({ size = 14, spinning = false }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={spinning ? 'animate-spin' : undefined}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="bg-background-secondary dark:bg-white/[0.01] border border-border-subtle rounded-2xl p-6 backdrop-blur-sm"
        >
          <div className="flex justify-between items-start mb-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-6 w-24 rounded-md" />
          </div>
          <Skeleton className="h-9 w-40 mt-3" />
          <div className="h-px w-full bg-border-subtle my-5" />
          <div className="flex justify-between items-end">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      ))}
    </div>
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
      <div className={`text-2xl font-semibold ${valueCls} ${mono ? 'font-mono tabular' : ''}`}>
        {loading ? <Skeleton className="h-7 w-24 inline-block" /> : value}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
