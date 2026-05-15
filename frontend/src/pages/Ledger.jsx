import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'

import ConnectGate from '../components/ConnectGate.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import { EscrowBadge } from '../components/StatusBadge.jsx'
import { useEscrowsForPayer, useEscrowsForFreelancer } from '../hooks/useEscrows.js'
import { formatUSDC, formatDeadline } from '../utils/format.js'

const STATE_LABEL = { all: 'All', 0: 'Active', 1: 'Completed', 2: 'Cancelled' }
const ROLE_FILTERS = ['all', 'paying', 'receiving']
const ROLE_LABEL = { all: 'All roles', paying: 'Paying', receiving: 'Receiving' }

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
  const [roleFilter, setRoleFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState('all')

  const isLoading = loadingPayer || loadingFreelancer

  // Combine the two lists with role attached, dedupe by id (a wallet could
  // theoretically be both depositor and recipient on the same escrow).
  const mine = useMemo(() => {
    const map = new Map()
    payerEscrows?.forEach((e) => e && map.set(e.id, { ...e, isPayer: true }))
    freelancerEscrows?.forEach((e) => {
      if (!e) return
      if (!map.has(e.id)) map.set(e.id, { ...e, isPayer: false })
    })
    return Array.from(map.values()).sort((a, b) => b.id - a.id)
  }, [payerEscrows, freelancerEscrows])

  const filtered = mine.filter((e) => {
    if (roleFilter === 'paying' && !e.isPayer) return false
    if (roleFilter === 'receiving' && e.isPayer) return false
    if (stateFilter !== 'all' && e.state !== Number(stateFilter)) return false
    return true
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Ledger</h1>
        <p className="text-text-secondary text-sm mt-1">A complete record of every escrow you've been part of.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Pillgroup
          value={roleFilter} onChange={setRoleFilter}
          options={ROLE_FILTERS.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
        />
        <Pillgroup
          value={String(stateFilter)} onChange={(v) => setStateFilter(v === 'all' ? 'all' : Number(v))}
          options={['all', 0, 1, 2].map((s) => ({ value: String(s), label: STATE_LABEL[s] }))}
        />
      </div>

      {isLoading ? (
        <div className="card-surface p-8 animate-pulse h-40" />
      ) : filtered.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <h2 className="text-xl font-semibold mb-2">No escrows match your filters</h2>
          <p className="text-sm text-text-secondary">Try widening the filters above.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto card-surface">
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
                {filtered.map((e) => {
                  const counterparty = e.isPayer ? e.recipient : e.depositor
                  return (
                    <tr key={e.id} className="hover:bg-background-tertiary/50 transition-colors">
                      <Td><span className="font-mono text-sm">#{e.id}</span></Td>
                      <Td><span className="text-sm">{e.isPayer ? 'Paying' : 'Receiving'}</span></Td>
                      <Td><AddressDisplay address={counterparty} size="sm" /></Td>
                      <Td className="text-right">
                        <span className="font-mono">{formatUSDC(e.totalAmount)}</span>
                      </Td>
                      <Td><span className="font-mono text-sm text-text-secondary">{formatDeadline(e.deadline)}</span></Td>
                      <Td><EscrowBadge state={e.state} /></Td>
                      <Td className="text-right">
                        <Link to={`/escrow/${e.id}`} className="text-sm text-accent">Open →</Link>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden flex flex-col gap-4">
            {filtered.map((e) => {
              const counterparty = e.isPayer ? e.recipient : e.depositor
              return (
                <Link key={e.id} to={`/escrow/${e.id}`}
                  className="card-surface p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-xs text-text-tertiary">#{e.id}</div>
                      <div className="text-sm">{e.isPayer ? 'Paying' : 'Receiving'}</div>
                    </div>
                    <EscrowBadge state={e.state} />
                  </div>
                  <AddressDisplay address={counterparty} size="sm" />
                  <div className="flex items-end justify-between">
                    <div className="text-xs text-text-secondary">
                      Deadline · <span className="font-mono">{formatDeadline(e.deadline)}</span>
                    </div>
                    <span className="font-mono text-lg">{formatUSDC(e.totalAmount)}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function Pillgroup({ value, onChange, options }) {
  return (
    <div className="inline-flex items-center rounded-lg bg-background-tertiary p-1 gap-1">
      {options.map((o) => {
        const active = String(value) === String(o.value)
        return (
          <button key={o.value}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              active ? 'bg-background-secondary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
            }`}>
            {o.label}
          </button>
        )
      })}
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
