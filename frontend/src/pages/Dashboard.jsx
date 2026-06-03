import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { motion, AnimatePresence, useReducedMotion, useInView } from 'framer-motion'

import ConnectGate from '../components/ConnectGate.jsx'
import Skeleton from '../components/Skeleton.jsx'
import { useDashboard, useUsdcBalance } from '../hooks/useEscrows.js'
import { useRoles } from '../hooks/useRoles.jsx'
import { formatUSDC, formatUSDCNumber, countdown } from '../utils/format.js'

const PAGE_SIZE = 9

function useCountUp(target, duration = 2600) {
  const [value, setValue] = useState(0)
  const reduce = useReducedMotion()
  const rafRef = useRef(null)
  const prevRef = useRef(0)
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const from = prevRef.current
    if (reduce || target === from) { setValue(target); prevRef.current = target; return }
    // Initial load uses full duration; live updates use a snappier transition
    const dur = from === 0 ? duration : Math.min(duration * 0.45, 1100)
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - t, 4)
      setValue(from + (target - from) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else { setValue(target); prevRef.current = target }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration, reduce])
  return value
}

function useLiveCountdown(deadlineUnix) {
  const [text, setText] = useState(() => countdown(deadlineUnix))
  useEffect(() => {
    if (!deadlineUnix) return
    setText(countdown(deadlineUnix))
    const id = setInterval(() => setText(countdown(deadlineUnix)), 30_000)
    return () => clearInterval(id)
  }, [deadlineUnix])
  return text
}

const TILE_CONTAINER = {
  hidden: {},
  show: { transition: { staggerChildren: 0.16 } },
}
const TILE_ITEM = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
}

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
    <div className="flex flex-col gap-10 md:gap-14">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Dashboard</h1>
        <Link to="/create" className="btn-primary text-sm py-2.5 self-start sm:self-auto whitespace-nowrap">
          + New Escrow
        </Link>
      </header>

      {/* Stat tiles. Four real metrics, semantically distinct: two USDC values
          (wallet balance, claimable) and two integer counts (active, disputes).
          The Claimable tile is a Link to /settings when there's something to
          withdraw — that interaction shift is what keeps the row from reading
          as an identical card grid. */}
      <motion.section
        aria-label="Account summary"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        variants={TILE_CONTAINER}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={TILE_ITEM}>
          <StatTile label="USDC Balance" sublabel="In wallet" loading={isLoading}>
            <UsdcValue value={usdcBalance} />
          </StatTile>
        </motion.div>

        <motion.div variants={TILE_ITEM}>
          <StatTile label="Active Escrows" sublabel={activeCount === 1 ? 'In progress' : 'In progress'} loading={isLoading}>
            <CountValue value={activeCount} />
          </StatTile>
        </motion.div>

        <motion.div variants={TILE_ITEM}>
          <StatTile
            label="Open Disputes"
            sublabel={openDisputeCount > 0 ? 'Needs attention' : 'All clear'}
            tone={openDisputeCount > 0 ? 'warning' : 'default'}
            loading={isLoading}
          >
            <CountValue value={openDisputeCount} tone={openDisputeCount > 0 ? 'warning' : 'default'} />
          </StatTile>
        </motion.div>

        <motion.div variants={TILE_ITEM}>
          <ClaimableTile loading={isLoading} balance={refundBal} />
        </motion.div>
      </motion.section>

      <section>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-2xl font-bold text-ink tracking-tight">Your Escrows</h2>
          <div className="flex items-center gap-2 px-3 py-1 bg-sunk border border-rule rounded-md shrink-0">
            <span className="w-1.5 h-1.5 bg-ok rounded-full animate-pulse" />
            <span className="text-xs font-mono tabular-nums text-ink-2 tracking-widest uppercase whitespace-nowrap">
              {mySummaries.length} Total On-Chain
            </span>
          </div>
        </div>
        <p className="text-sm text-ink-2 mt-1">Manage your deposits, incoming payments, and refunds.</p>

        <div className="w-full mt-10 flex items-center justify-between gap-3 flex-wrap">
          <div
            role="tablist"
            aria-label="Filter escrows"
            className="inline-flex items-center gap-1 p-1 bg-sunk rounded-xl border border-rule overflow-x-auto scrollbar-hide max-w-full snap-x snap-mandatory"
          >
            {LEDGER_TABS.map((tab) => {
              const isActive = tab.key === activeTab
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.key)}
                  className={
                    `relative inline-flex items-center justify-center min-h-9 px-3.5 py-2 text-sm font-medium rounded-lg whitespace-nowrap snap-start ` +
                    `transition-colors duration-200 ` +
                    `focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-sunk ` +
                    (isActive ? 'text-ink' : 'text-ink-2 hover:text-ink')
                  }
                >
                  {isActive && (
                    <motion.span
                      layoutId="tab-pill"
                      className="absolute inset-0 rounded-lg bg-paper shadow-sm"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="Refresh escrow list"
            className="inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2.5 text-sm font-medium text-ink-2 hover:text-ink bg-paper border border-rule hover:bg-sunk rounded-xl transition-[background-color,color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            <RefreshCwIcon size={14} spinning={isRefreshing} />
            <span className="hidden sm:inline">Refresh</span>
            <span className="sm:hidden sr-only">Refresh</span>
          </button>
        </div>
        <div className="w-full mt-3 border-b border-rule/50" aria-hidden="true" />

        {isLoading ? (
          <DashboardSkeleton />
        ) : filteredEscrows.length === 0 ? (
          <div className="mt-8">
            <LedgerEmptyState />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
              <AnimatePresence mode="popLayout">
                {visibleEscrows.map((e, i) => (
                  <motion.div
                    key={e.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: i * 0.11 }}
                  >
                    <PremiumEscrowCard summary={e} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <nav aria-label="Escrow list pagination" className="mt-10">
              <div className="h-px w-full bg-rule/60" aria-hidden="true" />
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pt-6">
                <span
                  aria-live="polite"
                  className="font-mono text-xs uppercase tracking-wider text-ink-3 tabular-nums"
                >
                  Showing{' '}
                  <span className="text-ink tabular-nums">{pageStart + 1}–{pageEnd}</span>{' '}
                  of <span className="text-ink tabular-nums">{filteredEscrows.length}</span> escrows
                </span>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    aria-label="Previous page"
                    className="inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2.5 text-sm font-medium text-ink bg-paper border border-rule hover:bg-sunk rounded-xl transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                  >
                    <ChevronLeftIcon size={14} />
                    Prev
                  </button>
                  <span
                    className="px-2 text-ink-2 tabular-nums font-mono text-xs uppercase tracking-wider"
                    aria-current="page"
                  >
                    {safePage + 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={safePage >= totalPages - 1}
                    aria-label="Next page"
                    className="inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2.5 text-sm font-medium text-ink bg-paper border border-rule hover:bg-sunk rounded-xl transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                  >
                    Next
                    <ChevronRightIcon size={14} />
                  </button>
                </div>
              </div>
            </nav>
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

  const milestoneCount = Number(summary.milestoneCount) || 0
  const releasedCount = Number(summary.releasedMilestoneCount) || 0
  const progressPct = milestoneCount > 0
    ? Math.min(100, Math.max(0, (releasedCount / milestoneCount) * 100))
    : 0
  const dotCount = Math.min(milestoneCount, 8)

  const barRef = useRef(null)
  const barInView = useInView(barRef, { once: true, margin: '-40px' })
  const deadlineText = useLiveCountdown(summary.deadline ?? 0)

  return (
    <Link
      to={`/escrow/${summary.id}`}
      className="group block relative rounded-2xl p-6
                 bg-paper border border-rule
                 transition-[transform,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
                 hover:-translate-y-0.5 hover:shadow-md
                 hover:border-rule-2
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
    >
      <div className="flex justify-between items-start mb-4">
        <span className="text-sm font-mono tabular-nums text-ink-2">{inv}</span>
        <span className="px-2 py-1 text-[11px] font-mono uppercase tracking-wider bg-sunk border border-rule rounded-md text-ink-2">
          {roleLabel}
        </span>
      </div>

      <div className="text-3xl font-mono font-bold tracking-tight text-ink mt-3 tabular-nums">
        {formatUSDCNumber(summary.totalAmount)}{' '}
        <span className="text-base font-sans font-normal text-ink-2 ml-1">USDC</span>
      </div>

      <div className="h-px w-full bg-rule/70 my-5" />

      <div className="flex justify-between items-end gap-4">
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-mono tabular-nums text-ink-2 mb-1.5 block">
            {releasedCount} / {milestoneCount} Released
          </span>
          <div
            ref={barRef}
            className="w-full max-w-[120px] h-1.5 bg-sunk rounded-full overflow-hidden mb-1.5"
            role="progressbar"
            aria-valuenow={Math.round(progressPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${releasedCount} of ${milestoneCount} milestones released`}
          >
            <motion.div
              className="h-full w-full bg-clay origin-left"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: barInView ? progressPct / 100 : 0 }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
            />
          </div>
          {dotCount > 0 && (
            <div className="flex gap-1">
              {Array.from({ length: dotCount }).map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full ${i < releasedCount ? 'bg-clay' : 'bg-sunk dark:bg-ink/10'}`}
                />
              ))}
            </div>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider rounded-full shrink-0 ${status.badgeCls}`}
        >
          {status.pulse && (
            <span className={`w-1.5 h-1.5 rounded-full ${status.dotCls} animate-pulse`} aria-hidden="true" />
          )}
          <span>{status.label}</span>
        </span>
      </div>

      <div className="mt-5 pt-4 border-t border-rule/70 flex items-center justify-between gap-3">
        {deadlineText && summary.state === 0 ? (
          <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-ink-3 tabular-nums">
            {deadlineText}
          </span>
        ) : <span />}
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium font-mono uppercase tracking-wider
                     px-3 py-1.5 rounded-lg border border-rule text-ink-2
                     bg-transparent transition-colors duration-200
                     group-hover:bg-sunk group-hover:text-ink group-hover:border-rule-2"
        >
          View Details
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="m13 5 7 7-7 7" />
          </svg>
        </span>
      </div>
    </Link>
  )
}

function deriveStatus(summary) {
  if (summary.disputedMilestoneCount > 0) {
    return {
      label: 'Disputed',
      badgeCls: 'bg-warn/10 text-warn border border-warn/20',
      dotCls: 'bg-warn',
      pulse: true
    }
  }
  if (summary.state === 1) {
    return {
      label: 'Completed',
      badgeCls: 'bg-ok/10 text-ok border border-ok/20',
      dotCls: 'bg-ok',
      pulse: false
    }
  }
  if (summary.state === 2) {
    return {
      label: 'Cancelled',
      badgeCls: 'bg-sunk text-ink-3 border border-rule',
      dotCls: 'bg-ink-3',
      pulse: false
    }
  }
  return {
    label: 'Active',
    badgeCls: 'bg-clay/10 text-clay border border-clay/20',
    dotCls: 'bg-clay',
    pulse: true
  }
}

function LedgerEmptyState() {
  return (
    <div className="w-full bg-paper border border-rule rounded-2xl p-16 flex flex-col items-center justify-center">
      <div className="w-16 h-16 rounded-2xl bg-clay-soft text-clay flex items-center justify-center mb-6">
        <InboxIcon size={24} />
      </div>
      <h3 className="text-lg font-semibold text-ink">No escrows found</h3>
      <p className="text-sm text-ink-2 mt-2 max-w-sm text-center leading-relaxed">
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

/* ---------- Stat tiles ----------
   Compact stat cells. Label up top in mono-uppercase, value mid, sublabel below.
   Tone shifts the value color when something needs attention. Loading uses a
   width-pegged skeleton so the row doesn't reflow when data arrives. */
function StatTile({ label, sublabel, children, tone = 'default', loading = false }) {
  const sublabelCls = tone === 'warning' ? 'text-warn' : 'text-ink-3'
  return (
    <div className="bg-paper border border-rule rounded-2xl p-5 flex flex-col gap-2 shadow-lift-sm">
      <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-ink-3">
        {label}
      </span>
      <div className="min-h-[2.25rem] flex items-baseline">
        {loading ? <Skeleton className="h-7 w-24" /> : children}
      </div>
      {sublabel && (
        <span className={`text-xs ${sublabelCls}`}>
          {sublabel}
        </span>
      )}
    </div>
  )
}

function UsdcValue({ value }) {
  const raw = (value !== undefined && value !== null) ? Number(value) / 1e6 : 0
  const animated = useCountUp(raw)
  const formatted = animated.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <span className="font-mono tabular-nums text-2xl font-semibold tracking-tight text-ink leading-none">
      {formatted}
      <span className="text-sm font-sans font-medium text-ink-2 ml-1.5">USDC</span>
    </span>
  )
}

function CountValue({ value, tone = 'default' }) {
  const cls = tone === 'warning' ? 'text-warn' : 'text-ink'
  return (
    <span className={`font-mono tabular-nums text-2xl font-semibold tracking-tight leading-none ${cls}`}>
      {value}
    </span>
  )
}

/* The Claimable tile is a Link when there's something to withdraw, a static
   div when there isn't. The interaction shift is the load-bearing visual
   distinction between this tile and the other three. */
function ClaimableTileValue({ balance, hasFunds }) {
  const raw = (balance !== undefined && balance !== null) ? Number(balance) / 1e6 : 0
  const animated = useCountUp(raw)
  const formatted = animated.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <span className={`font-mono tabular-nums text-2xl font-semibold tracking-tight leading-none ${hasFunds ? 'text-clay' : 'text-ink'}`}>
      {formatted}
      <span className="text-sm font-sans font-medium text-ink-2 ml-1.5">USDC</span>
    </span>
  )
}

function ClaimableTile({ balance, loading }) {
  const hasFunds = balance > 0n

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-ink-3">
          Claimable Balance
        </span>
        {hasFunds && (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.18em] text-clay">
            Withdraw
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3 6h6M7 4l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </div>
      <div className="min-h-[2.25rem] flex items-baseline">
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <ClaimableTileValue balance={balance} hasFunds={hasFunds} />
        )}
      </div>
      <span className={`text-xs ${hasFunds ? 'text-clay' : 'text-ink-3'}`}>
        {hasFunds ? 'Ready to withdraw' : 'Nothing to claim'}
      </span>
    </>
  )

  if (hasFunds && !loading) {
    return (
      <Link
        to="/settings"
        aria-label={`Withdraw ${formatUSDC(balance)} USDC from your refund balance`}
        className="group bg-paper border border-clay/40 rounded-2xl p-5 flex flex-col gap-2
                   transition-[border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]
                   hover:-translate-y-0.5 hover:shadow-lift-md hover:border-clay
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        {inner}
      </Link>
    )
  }

  return (
    <div className="bg-paper border border-rule rounded-2xl p-5 flex flex-col gap-2">
      {inner}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="bg-paper border border-rule rounded-2xl p-6"
        >
          <div className="flex justify-between items-start mb-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-6 w-24 rounded-md" />
          </div>
          <Skeleton className="h-9 w-40 mt-3" />
          <div className="h-px w-full bg-rule/70 my-5" />
          <div className="flex justify-between items-end">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="mt-5 pt-4 border-t border-rule/70 flex justify-end">
            <Skeleton className="h-7 w-28 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ChevronLeftIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

function ChevronRightIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}
