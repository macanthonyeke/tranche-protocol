import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { motion, AnimatePresence } from 'framer-motion'

import ConnectGate from '../components/ConnectGate.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Skeleton from '../components/Skeleton.jsx'
import { EscrowBadge } from '../components/StatusBadge.jsx'
import { useEscrowsForPayer, useEscrowsForFreelancer } from '../hooks/useEscrows.js'
import { useInfiniteList } from '../hooks/useInfiniteList.js'
import { formatUSDC, formatDeadline } from '../utils/format.js'

// FILTER (status) — All / Active / Disputed / Completed
const FILTERS = [
  { value: 'all',       label: 'All' },
  { value: 'active',    label: 'Active' },
  { value: 'disputed',  label: 'Disputed' },
  { value: 'completed', label: 'Completed' }
]

export default function Ledger() {
  return (
    <ConnectGate>
      <LedgerInner />
    </ConnectGate>
  )
}

function LedgerInner() {
  const { address } = useAccount()
  const { escrows: payerEscrows, isLoading: loadingPayer } = useEscrowsForPayer(address)
  const { escrows: freelancerEscrows, isLoading: loadingFreelancer } = useEscrowsForFreelancer(address)
  const [filter, setFilter] = useState('all')
  const [searchRaw, setSearchRaw] = useState('')
  const [search, setSearch] = useState('')

  // 500ms debounce on search input -> filter args.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchRaw.trim().toLowerCase()), 500)
    return () => clearTimeout(t)
  }, [searchRaw])

  const isLoading = loadingPayer || loadingFreelancer

  const mine = useMemo(() => {
    const map = new Map()
    payerEscrows?.forEach((e) => e && map.set(e.id, { ...e, isPayer: true }))
    freelancerEscrows?.forEach((e) => {
      if (!e) return
      if (!map.has(e.id)) map.set(e.id, { ...e, isPayer: false })
    })
    return Array.from(map.values()).sort((a, b) => b.id - a.id)
  }, [payerEscrows, freelancerEscrows])

  const filtered = useMemo(() => {
    return mine.filter((e) => {
      if (filter === 'active'    && e.state !== 0) return false
      if (filter === 'completed' && e.state !== 1) return false
      if (filter === 'disputed'  && !(e.disputedMilestoneCount > 0)) return false

      if (search) {
        const idStr = `#${e.id}`.toLowerCase()
        const dep = (e.depositor || '').toLowerCase()
        const rec = (e.recipient || '').toLowerCase()
        if (!idStr.includes(search) && !dep.includes(search) && !rec.includes(search)) return false
      }
      return true
    })
  }, [mine, filter, search])

  const { visible, hasMore, sentinelRef } = useInfiniteList(filtered, { pageSize: 20, deps: [filter, search] })

  const hasAnyHistory = mine.length > 0

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">History</h1>
        <p className="text-text-secondary text-sm mt-1">Every escrow tied to your wallet, from the beginning.</p>
      </div>

      <CommandBar
        search={searchRaw} onSearch={setSearchRaw}
        filter={filter} onFilter={setFilter}
      />

      {isLoading ? (
        <LedgerSkeleton />
      ) : !hasAnyHistory ? (
        <EmptyState
          title="Nothing here yet."
          message="Create your first escrow and it will show up here."
          ctaLabel="Create Escrow"
          ctaTo="/create"
        />
      ) : filtered.length === 0 ? (
        <div className="card-surface px-6 py-16 sm:py-20 text-center flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-background-tertiary text-text-secondary flex items-center justify-center ring-1 ring-border-subtle">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.6"/>
              <path d="M15 15l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </div>
          <h2 className="text-base font-semibold text-text-primary">No results for those filters</h2>
          <p className="text-sm text-text-secondary max-w-xs">Try clearing the filters or searching by a different address.</p>
        </div>
      ) : (
        <>
          {/* Desktop table — wrapped in overflow-x-auto for narrow desktop windows */}
          <div className="hidden md:block w-full max-w-full overflow-x-auto card-surface">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr>
                  <Th>ID</Th>
                  <Th>Role</Th>
                  <Th>Counterparty</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Deadline</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {visible.map((e) => {
                    const counterparty = e.isPayer ? e.recipient : e.depositor
                    return (
                      <motion.tr
                        key={e.id}
                        layout
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="hover:bg-background-tertiary/50 transition-colors"
                      >
                        <Td><span className="font-mono tabular text-sm">#{e.id}</span></Td>
                        <Td><span className="text-sm">{e.isPayer ? "You're the payer" : "You're the freelancer"}</span></Td>
                        <Td><AddressDisplay address={counterparty} size="sm" /></Td>
                        <Td className="text-right">
                          <span className="font-mono tabular">{formatUSDC(e.totalAmount)}</span>
                        </Td>
                        <Td><span className="font-mono tabular text-sm text-text-secondary">{formatDeadline(e.deadline)}</span></Td>
                        <Td><EscrowBadge state={e.state} /></Td>
                        <Td className="text-right">
                          <Link to={`/escrow/${e.id}`} className="text-sm text-accent">Open →</Link>
                        </Td>
                      </motion.tr>
                    )
                  })}
                </AnimatePresence>
              </tbody>
            </table>
            {hasMore && (
              <div ref={sentinelRef} className="p-4">
                <Skeleton className="h-10" />
              </div>
            )}
          </div>

          {/* Mobile cards */}
          <div className="md:hidden flex flex-col gap-4">
            <AnimatePresence initial={false}>
              {visible.map((e) => {
                const counterparty = e.isPayer ? e.recipient : e.depositor
                return (
                  <motion.div
                    key={e.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Link to={`/escrow/${e.id}`} className="card-clickable block p-4">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-mono tabular text-xs text-text-tertiary">#{e.id}</div>
                            <div className="text-sm">{e.isPayer ? "You're the payer" : "You're the freelancer"}</div>
                          </div>
                          <EscrowBadge state={e.state} />
                        </div>
                        <AddressDisplay address={counterparty} size="sm" />
                        <div className="flex items-end justify-between">
                          <div className="text-xs text-text-secondary">
                            Deadline · <span className="font-mono tabular">{formatDeadline(e.deadline)}</span>
                          </div>
                          <span className="font-mono tabular text-lg">{formatUSDC(e.totalAmount)}</span>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                )
              })}
            </AnimatePresence>
            {hasMore && <div ref={sentinelRef}><Skeleton className="h-32" /></div>}
          </div>
        </>
      )}
    </div>
  )
}

function LedgerSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
    </div>
  )
}

function CommandBar({ search, onSearch, filter, onFilter }) {
  return (
    <div className="card-surface p-3 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
      <div role="search" className="relative flex-1">
        <span aria-hidden className="absolute inset-y-0 left-3 inline-flex items-center text-text-tertiary pointer-events-none">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <input
          type="search"
          aria-label="Search escrows by wallet address or ID"
          placeholder="Search by wallet address or escrow ID (e.g. #42)"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          className="bg-background-tertiary border border-border-subtle rounded-xl pl-9 pr-4 h-12 w-full appearance-none
                     text-sm text-text-primary placeholder:text-text-tertiary
                     transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]
                     focus:outline-none focus:ring-2 focus:ring-accent-blue focus:ring-offset-2 focus:ring-offset-background-primary
                     focus:border-border-focused"
        />
      </div>

      <div
        role="tablist"
        aria-label="Filter by status"
        className="inline-flex items-center rounded-xl bg-background-tertiary p-1 gap-1 self-start md:self-auto"
      >
        {FILTERS.map((f) => {
          const active = filter === f.value
          return (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onFilter(f.value)}
              className={`px-3 py-2 rounded-lg text-xs font-medium
                transition-[background-color,color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98]
                ${active
                  ? 'bg-background-secondary text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'}
                focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background-tertiary`}
            >
              [{f.label}]
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Th({ children, className = '' }) {
  return (
    <th className={`border-b border-border-subtle p-4 text-text-secondary font-medium text-xs uppercase tracking-wide ${className}`}>
      {children}
    </th>
  )
}

function Td({ children, className = '' }) {
  return (
    <td className={`border-b border-border-subtle p-4 ${className}`}>
      {children}
    </td>
  )
}
