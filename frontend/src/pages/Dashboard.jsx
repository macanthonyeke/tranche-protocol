import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { motion, AnimatePresence, useReducedMotion, useInView, useAnimate } from 'framer-motion'

import ConnectGate from '../components/ConnectGate.jsx'
import Skeleton from '../components/Skeleton.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import { useDashboard, useUsdcBalance, useDisputedEscrows } from '../hooks/useEscrows.js'
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

/* Jump straight to any escrow by its numeric ID. Independent of the subgraph,
   so a recipient can open an escrow the moment the payer shares its ID — even
   before the indexer surfaces it in the Incoming requests section. */
function OpenByIdField() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const id = value.trim()
  const valid = id !== '' && /^\d+$/.test(id)

  const submit = (e) => {
    e.preventDefault()
    if (valid) navigate(`/escrow/${id}`)
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 font-mono text-sm">#</span>
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
          placeholder="Open by ID"
          aria-label="Open escrow by ID"
          className="w-32 pl-7 pr-3 py-2.5 text-sm bg-paper border border-rule rounded-xl text-ink placeholder:text-ink-3 font-mono tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-paper transition-colors"
        />
      </div>
      <button
        type="submit"
        disabled={!valid}
        aria-label="Open escrow"
        className="inline-flex items-center justify-center min-h-11 px-3 py-2.5 text-sm font-medium text-ink-2 hover:text-ink bg-paper border border-rule hover:bg-sunk rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14" />
          <path d="m13 5 7 7-7 7" />
        </svg>
      </button>
    </form>
  )
}

function ArbiterDisputeBanner() {
  const { escrows } = useDisputedEscrows()
  const count = escrows.length
  return (
    <div className="rounded-xl bg-clay-soft border border-clay/20 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
      <p className="text-[13px] text-clay leading-relaxed">
        {count === 0
          ? 'Arbiter panel — no open disputes right now.'
          : `Arbiter panel — ${count} open ${count === 1 ? 'dispute' : 'disputes'} awaiting review.`}
      </p>
      <Link
        to="/arbiter"
        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-clay/30 px-3 py-1.5 text-xs font-medium text-clay hover:bg-clay/10 transition-colors"
      >
        Review in Arbiter Panel →
      </Link>
    </div>
  )
}

function DashboardInner() {
  const { address } = useAccount()
  const { isArbiter } = useRoles()

  const { dashboard, isLoading, error: dashboardError, refetch } = useDashboard(address)
  const { balance: usdcBalance } = useUsdcBalance(address)

  const [activeTab, setActiveTab] = useState('all')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [page, setPage] = useState(0)
  const [refreshFlash, setRefreshFlash] = useState(0)

  const refundBal = dashboard?.refundBalance ?? 0n
  const activeCount = dashboard?.activeEscrowCount ?? 0

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

  // Incoming: freelancer role, active, no released/disputed milestones yet —
  // escrows the user hasn't engaged with. Shown in a separate section so new
  // requests don't blend into the user's own active work.
  const incomingEscrows = useMemo(
    () => mySummaries.filter((e) => !e.isPayer && e.state === 0 && e.releasedMilestoneCount === 0 && e.disputedMilestoneCount === 0),
    [mySummaries]
  )
  const mainEscrows = useMemo(
    () => mySummaries.filter((e) => e.isPayer || e.state !== 0 || e.releasedMilestoneCount > 0 || e.disputedMilestoneCount > 0),
    [mySummaries]
  )

  const totalOnChain = Math.round(useCountUp(mySummaries.length, 1400))

  // Needs-Action queue: pulls dispute/release-due items out of the flat list.
  const actionItems = useMemo(() => mySummaries.filter(isActionNeeded), [mySummaries])

  // Position-band headline: total value locked across the caller's own active
  // escrows (payer + freelancer, deduped) — the account's single financial figure.
  const inEscrowTotal = useMemo(
    () => mySummaries.reduce((sum, e) => (e.state === 0 ? sum + (e.totalAmount ?? 0n) : sum), 0n),
    [mySummaries]
  )

  const tabDef = LEDGER_TABS.find((t) => t.key === activeTab) ?? LEDGER_TABS[0]
  const filteredEscrows = useMemo(
    () => mainEscrows.filter(tabDef.filter),
    [mainEscrows, tabDef]
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
    try { await refetch?.() } finally {
      setIsRefreshing(false)
      setRefreshFlash((n) => n + 1)
    }
  }

  return (
    <div className="flex flex-col gap-10 md:gap-14">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Dashboard</h1>
        <div className="flex items-center gap-3 flex-wrap self-start sm:self-auto">
          <OpenByIdField />
          <Link to="/create" className="btn-primary text-sm py-2.5 whitespace-nowrap">
            + New Escrow
          </Link>
        </div>
      </header>

      {isArbiter && <ArbiterDisputeBanner />}

      {/* Financial Position band. Replaces the four equal-weight stat tiles
          with a single financial headline (total value locked across the
          caller's active escrows) plus three supporting mini-metrics. The
          Claimable metric keeps the existing "link only when withdrawable"
          behavior. */}
      <PositionBand
        total={inEscrowTotal}
        activeCount={activeCount}
        walletBalance={usdcBalance}
        claimable={refundBal}
        loading={isLoading}
        flash={refreshFlash}
      />

      {/* Needs-Action queue. Lifts dispute/release-due items out of the flat
          list to the top of the page — the load-bearing change of this
          redesign. Only renders when there's at least one actionable item. */}
      {!isLoading && actionItems.length > 0 && (
        <AttentionQueue items={actionItems} />
      )}

      {incomingEscrows.length > 0 && (
        <section>
          <div className="flex items-center justify-between gap-4 mb-2">
            <h2 className="text-xl font-bold text-ink tracking-tight">Incoming requests</h2>
            <span className="text-xs text-ink-3">{incomingEscrows.length} new</span>
          </div>
          <p className="text-sm text-ink-2 mb-6">Escrows you've been added to as a recipient but haven't started working on yet.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {incomingEscrows.map((e) => (
              <PremiumEscrowCard key={e.id} summary={e} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-2xl font-bold text-ink tracking-tight">All escrows</h2>
          <div className="flex items-center gap-2 px-3 py-1 bg-sunk border border-rule rounded-md shrink-0">
            <span className="w-1.5 h-1.5 bg-ok rounded-full animate-pulse" />
            <span className="text-xs font-mono tabular-nums text-ink-2 tracking-widest uppercase whitespace-nowrap">
              {totalOnChain} Total On-Chain
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

        <AnimatePresence mode="wait" initial={false}>
        {isLoading ? (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <DashboardSkeleton />
          </motion.div>
        ) : dashboardError ? (
          <motion.div key="error" className="mt-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="flex flex-col items-start gap-3 py-12">
              <p className="text-warn text-[14.5px]">Failed to load escrows — the indexer may be temporarily unavailable.</p>
              <p className="text-ink-3 text-[13px]">{dashboardError.message || String(dashboardError)}</p>
              <button className="btn-quiet text-[13px]" onClick={refetch}>Try again</button>
            </div>
          </motion.div>
        ) : filteredEscrows.length === 0 ? (
          <motion.div key="empty" className="mt-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <LedgerEmptyState />
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {/* Desktop (>=900px): table. Mobile/tablet: PremiumEscrowCard grid. */}
            <div className="hidden min-[900px]:block mt-8">
              <EscrowTable escrows={visibleEscrows} />
            </div>
            <div className="min-[900px]:hidden grid grid-cols-1 sm:grid-cols-2 gap-6 mt-8">
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
          </motion.div>
        )}
        </AnimatePresence>
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

  const deadlineMs = Number(summary.deadline ?? 0) * 1000
  const isUrgent = summary.state === 0 && deadlineMs > 0 &&
    deadlineMs > Date.now() && (deadlineMs - Date.now()) < 86_400_000

  return (
    <Link
      to={`/escrow/${summary.id}`}
      className="group block relative rounded-2xl p-6
                 bg-paper border border-rule
                 transition-[transform,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
                 hover:-translate-y-1.5 hover:shadow-[0_12px_32px_-8px_oklch(0_0_0/0.12)]
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
          <span className={`text-[10px] font-mono uppercase tracking-[0.14em] tabular-nums ${isUrgent ? 'text-bad animate-pulse' : 'text-ink-3'}`}>
            {isUrgent && '⚠ '}{deadlineText}
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
      pillCls: 'status-warn',
      dotCls: 'bg-warn',
      pulse: true
    }
  }
  if (summary.state === 1) {
    return {
      label: 'Completed',
      badgeCls: 'bg-ok/10 text-ok border border-ok/20',
      pillCls: 'status-ok',
      dotCls: 'bg-ok',
      pulse: false
    }
  }
  if (summary.state === 2) {
    return {
      label: 'Cancelled',
      badgeCls: 'bg-sunk text-ink-3 border border-rule',
      pillCls: 'status-muted',
      dotCls: 'bg-ink-3',
      pulse: false
    }
  }
  return {
    label: 'Active',
    badgeCls: 'bg-clay/10 text-clay border border-clay/20',
    pillCls: 'status-active',
    dotCls: 'bg-clay',
    pulse: true
  }
}

function LedgerEmptyState() {
  const reduce = useReducedMotion()
  return (
    <div className="w-full bg-paper border border-rule rounded-2xl p-16 flex flex-col items-center justify-center">
      <motion.div
        className="w-16 h-16 rounded-2xl bg-clay-soft text-clay flex items-center justify-center mb-6"
        animate={reduce ? undefined : { y: [-5, 5, -5] }}
        transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
      >
        <InboxIcon size={24} />
      </motion.div>
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

function WarningIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
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

/* ---------- Financial Position band ----------
   Single headline figure (total value locked across the caller's active
   escrows) with three supporting mini-metrics inline. Replaces the four
   equal-weight stat tiles — the in-escrow total is the account's one
   financial headline; balance/claimable/active are secondary. */
function PositionBand({ total, activeCount, walletBalance, claimable, loading, flash = 0 }) {
  const [scope, animate] = useAnimate()
  const prevFlashRef = useRef(0)
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!reduce && flash > 0 && flash !== prevFlashRef.current) {
      prevFlashRef.current = flash
      animate(scope.current, { scale: [1, 1.01, 1] }, { duration: 0.45, ease: [0.22, 1, 0.36, 1] })
    }
  }, [flash, animate, scope, reduce])

  const hasClaimable = claimable > 0n

  return (
    <section ref={scope} aria-label="Financial position" className="panel-sunk p-4 md:p-6">
      <div className="flex flex-col gap-6 min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between">
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="eyebrow">In escrow — across {activeCount} {activeCount === 1 ? 'contract' : 'contracts'}</span>
          {loading ? (
            <Skeleton className="h-9 w-48" />
          ) : (
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="num text-[30px] md:text-[38px] font-semibold tracking-[-0.02em] text-ink leading-none">
                {formatUSDCNumber(total)}
              </span>
              <span className="text-[13px] text-ink-2">USDC locked</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-[22px] flex-wrap">
          <MiniMetric label="Wallet balance" loading={loading}>
            <span className="num text-[16px] font-semibold text-ink">{formatUSDCNumber(walletBalance)}</span>
          </MiniMetric>
          <MiniMetric label="Claimable" loading={loading}>
            {hasClaimable ? (
              <Link
                to="/settings"
                aria-label={`Withdraw ${formatUSDC(claimable)} USDC from your refund balance`}
                className="group num text-[16px] font-semibold text-clay hover:underline underline-offset-2 inline-flex items-center gap-1"
              >
                {formatUSDCNumber(claimable)}
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M3 6h6M7 4l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ) : (
              <span className="num text-[16px] font-semibold text-ink">{formatUSDCNumber(claimable)}</span>
            )}
          </MiniMetric>
          <MiniMetric label="Active" loading={loading}>
            <span className="num text-[16px] font-semibold text-ink">{activeCount}</span>
          </MiniMetric>
        </div>
      </div>
    </section>
  )
}

function MiniMetric({ label, loading, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      {loading ? <Skeleton className="h-4 w-14" /> : children}
    </div>
  )
}

/* ---------- Needs-Action queue ----------
   Pinned panel of dispute/release-due items, pulled out of the flat escrow
   list so the highest-priority decisions are the first thing the page shows. */
function AttentionQueue({ items }) {
  return (
    <section aria-label="Needs your attention" className="rounded-md border border-warn overflow-hidden">
      <div className="bg-warn/10 px-3.5 py-2.5 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-warn">
          <WarningIcon size={12} />
          Needs your attention
        </span>
        <span className="text-[11px] font-mono tabular-nums text-warn">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
      </div>
      <div>
        {items.map((e) => (
          <AttentionRow key={e.id} summary={e} />
        ))}
      </div>
    </section>
  )
}

function AttentionRow({ summary }) {
  const inv = summary.invoiceHash
    ? `INV-${summary.invoiceHash.slice(2, 6).toUpperCase()}`
    : `ESC-${summary.id}`
  const isDispute = summary.disputedMilestoneCount > 0
  const subline = isDispute
    ? 'Dispute raised — awaiting resolution'
    : 'No milestones released yet'

  return (
    <div className="grid grid-cols-[1fr_auto] min-[900px]:grid-cols-[120px_1fr_auto] items-center gap-3 border-t border-rule px-3.5 py-2.5">
      <span className="hidden min-[900px]:block num text-[11px] text-ink-2">#{summary.id}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isDispute ? 'bg-warn' : 'bg-clay'}`} aria-hidden="true" />
          <span className="text-[12px] font-semibold text-ink truncate">{inv}</span>
        </div>
        <span className="block text-[11px] text-ink-3 truncate">{subline}</span>
      </div>
      <Link
        to={`/escrow/${summary.id}`}
        className={isDispute ? 'btn-secondary text-[12.5px] h-9 px-3 shrink-0' : 'btn-primary text-[12.5px] h-9 px-3 shrink-0'}
      >
        {isDispute ? 'Submit Evidence' : 'Review & Release'}
      </Link>
    </div>
  )
}

/* ---------- Escrow table (desktop, >=900px) ----------
   Row = grid, whole row is a Link (same "clickable card" affordance as
   PremiumEscrowCard, just laid out as a table for dense scanning). */
const TABLE_COLUMNS = 'grid-cols-[90px_1fr_110px_130px_90px_40px]'

function EscrowTable({ escrows }) {
  return (
    <div role="table" aria-label="All escrows" className="border border-rule rounded-md overflow-hidden">
      <div role="row" className={`grid ${TABLE_COLUMNS} gap-3.5 bg-sunk px-4 py-2.5`}>
        <span role="columnheader" className="eyebrow">Invoice</span>
        <span role="columnheader" className="eyebrow">Counterparty</span>
        <span role="columnheader" className="eyebrow">Amount</span>
        <span role="columnheader" className="eyebrow">Progress</span>
        <span role="columnheader" className="eyebrow">Status</span>
        <span role="columnheader" aria-hidden="true" />
      </div>
      <div role="rowgroup">
        {escrows.map((e) => (
          <EscrowTableRow key={e.id} summary={e} />
        ))}
      </div>
    </div>
  )
}

function EscrowTableRow({ summary }) {
  const inv = summary.invoiceHash
    ? `INV-${summary.invoiceHash.slice(2, 6).toUpperCase()}`
    : `ESC-${summary.id}`
  const counterparty = summary.isPayer ? summary.recipient : summary.depositor
  const status = deriveStatus(summary)
  const milestoneCount = Number(summary.milestoneCount) || 0
  const releasedCount = Number(summary.releasedMilestoneCount) || 0
  const progressPct = milestoneCount > 0
    ? Math.min(100, Math.max(0, (releasedCount / milestoneCount) * 100))
    : 0
  const disputed = summary.disputedMilestoneCount > 0

  return (
    <Link
      to={`/escrow/${summary.id}`}
      role="row"
      className={`grid ${TABLE_COLUMNS} gap-3.5 items-center px-4 py-2.5 border-t border-rule card-clickable`}
    >
      <span role="cell" className="num text-[11px] text-ink-2 truncate">{inv}</span>
      <span role="cell" className="min-w-0">
        <AddressDisplay address={counterparty} size="sm" />
      </span>
      <span role="cell" className="num text-[13px] font-semibold text-ink">{formatUSDCNumber(summary.totalAmount)}</span>
      <span role="cell">
        <div className="w-full h-[5px] bg-sunk rounded-full overflow-hidden">
          <div
            className={`h-full ${disputed ? 'bg-warn' : 'bg-clay'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </span>
      <span role="cell">
        <span className={`status ${status.pillCls}`}>{status.label}</span>
      </span>
      <span role="cell" className="text-ink-3 justify-self-end">
        <ChevronRightIcon size={14} />
      </span>
    </Link>
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
