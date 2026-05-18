import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'

import ConnectGate from '../components/ConnectGate.jsx'
import Skeleton from '../components/Skeleton.jsx'
import WalletButton from '../components/WalletButton.jsx'
import { useIsArbiter } from '../hooks/useArbiter.js'
import { useDisputedEscrows, useEscrowDetail, useTick } from '../hooks/useEscrows.js'
import { useTx, escrowWrite } from '../hooks/useTx.js'
import { isValidBytes32 } from '../utils/encode.js'
import {
  formatUSDC, formatUSDCNumber, timeAgo, truncateAddr, explorerAddr
} from '../utils/format.js'

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const POLL_MS = 12_000

export default function ArbiterPanel() {
  return (
    <ConnectGate>
      <ArbiterInner />
    </ConnectGate>
  )
}

function ArbiterInner() {
  const { address } = useAccount()
  const { isArbiter, isLoading } = useIsArbiter(address)
  useTick(15_000)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!isArbiter) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader />
        <AccessDenied />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader />
      <DisputeQueue userAddress={address} />
    </div>
  )
}

function PageHeader() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-3xl font-semibold tracking-tight">Arbiter Panel</h1>
      <p className="text-text-secondary text-sm">
        Dispute resolution console. Only visible to wallets holding ARBITER_ROLE.
      </p>
    </div>
  )
}

function AccessDenied() {
  return (
    <div className="card-surface p-10 text-center max-w-md mx-auto">
      <div className="w-12 h-12 rounded-full bg-status-error/10 text-status-error flex items-center justify-center mx-auto mb-4">
        <ShieldIcon size={20} />
      </div>
      <h2 className="text-lg font-semibold text-text-primary mb-2">Access denied</h2>
      <p className="text-sm text-text-secondary mb-6">
        Your connected wallet does not hold the ARBITER_ROLE. Switch to an authorised wallet to view open cases.
      </p>
      <div className="inline-flex justify-center">
        <WalletButton />
      </div>
    </div>
  )
}

/* ---------- Open disputes queue ---------- */
function DisputeQueue({ userAddress }) {
  const { escrows, isLoading, refetch } = useDisputedEscrows()
  const open = useMemo(
    () => escrows.filter((e) => e && Number(e.disputedMilestoneCount) > 0),
    [escrows]
  )
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    if (selectedId == null && open.length > 0) {
      setSelectedId(open[0].id)
    }
    if (selectedId != null && !open.find((e) => e.id === selectedId)) {
      setSelectedId(open[0]?.id ?? null)
    }
  }, [open, selectedId])

  if (isLoading) {
    return <Skeleton className="h-64" />
  }

  if (open.length === 0) {
    return (
      <div className="card-surface p-12 text-center">
        <div className="w-12 h-12 rounded-full bg-background-tertiary border border-border-subtle flex items-center justify-center mx-auto mb-4 text-text-tertiary">
          <ShieldIcon size={20} />
        </div>
        <h2 className="text-lg font-semibold text-text-primary mb-1">No open disputes</h2>
        <p className="text-sm text-text-secondary">When a payer or freelancer halts a contract, it shows up here for review.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <aside className="lg:col-span-1 flex flex-col gap-3">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-base font-semibold text-text-primary tracking-tight">Open cases</h2>
          <span className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-mono">
            {open.length} pending
          </span>
        </div>
        {open.map((e) => (
          <CaseCard
            key={e.id}
            summary={e}
            active={e.id === selectedId}
            onSelect={() => setSelectedId(e.id)}
          />
        ))}
      </aside>

      <section className="lg:col-span-2">
        {selectedId != null && (
          <CaseDetail
            key={selectedId}
            escrowId={selectedId}
            userAddress={userAddress}
            onResolved={refetch}
          />
        )}
      </section>
    </div>
  )
}

function CaseCard({ summary, active, onSelect }) {
  const inv = summary.invoiceHash && summary.invoiceHash !== ZERO_BYTES32
    ? `INV-${summary.invoiceHash.slice(2, 6).toUpperCase()}`
    : `ESC-${summary.id}`
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-2xl border p-4 transition-all flex flex-col gap-3 ${
        active
          ? 'border-status-error/40 bg-status-error/5'
          : 'border-border-subtle bg-background-secondary dark:bg-white/[0.01] hover:border-border-medium'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-text-primary">{inv}</span>
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-status-error font-mono">
          <span className="h-1.5 w-1.5 rounded-full bg-status-error animate-pulse" aria-hidden />
          {summary.disputedMilestoneCount} open
        </span>
      </div>
      <div className="font-mono tabular-nums text-lg font-bold text-text-primary">
        {formatUSDCNumber(summary.totalAmount)}
        <span className="text-xs font-sans font-medium text-text-secondary ml-1.5">USDC locked</span>
      </div>
      <div className="flex flex-col gap-1 text-[11px] text-text-tertiary">
        <span>Payer · <span className="font-mono text-text-secondary">{truncateAddr(summary.depositor)}</span></span>
        <span>Freelancer · <span className="font-mono text-text-secondary">{truncateAddr(summary.recipient)}</span></span>
      </div>
    </button>
  )
}

/* ---------- Selected case detail ---------- */
function CaseDetail({ escrowId, userAddress, onResolved }) {
  const { detail, isLoading, error, refetch } = useEscrowDetail(escrowId, userAddress, { pollMs: POLL_MS })

  if (isLoading) return <Skeleton className="h-96" />
  if (error || !detail) {
    return (
      <div className="card-surface p-8 text-center">
        <h2 className="text-lg font-semibold text-text-primary mb-1">Couldn't load case #{escrowId}</h2>
        <p className="text-sm text-text-secondary">Try again in a moment.</p>
      </div>
    )
  }

  const { escrow, milestones, disputes } = detail
  const disputedMilestones = milestones.filter((m) => m.state === 2)

  if (disputedMilestones.length === 0) {
    return (
      <div className="card-surface p-8 text-center">
        <h2 className="text-lg font-semibold text-text-primary mb-1">No active disputes</h2>
        <p className="text-sm text-text-secondary">This escrow has no milestones in dispute right now.</p>
      </div>
    )
  }

  return (
    <ActiveDisputeDesk
      escrow={escrow}
      disputedMilestones={disputedMilestones}
      disputes={disputes}
      userAddress={userAddress}
      onChange={() => { refetch?.(); onResolved?.() }}
    />
  )
}

/* ---------- Active dispute desk (moved from EscrowDetail) ---------- */
function ActiveDisputeDesk({
  escrow, disputedMilestones, disputes, userAddress, onChange
}) {
  const [selectedIdx, setSelectedIdx] = useState(disputedMilestones[0].index)

  useEffect(() => {
    if (!disputedMilestones.find((m) => m.index === selectedIdx)) {
      setSelectedIdx(disputedMilestones[0]?.index ?? null)
    }
  }, [disputedMilestones, selectedIdx])

  const activeMilestone = disputedMilestones.find((m) => m.index === selectedIdx)
  if (!activeMilestone) return null
  const dispute = disputes[activeMilestone.index]

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-status-error opacity-70 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-status-error" />
          </span>
          <h3 className="text-base font-semibold text-text-primary tracking-tight">
            Active Dispute Resolution
          </h3>
        </div>
        <span className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-mono">
          {disputedMilestones.length} open case{disputedMilestones.length === 1 ? '' : 's'}
        </span>
      </header>

      {disputedMilestones.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          {disputedMilestones.map((m) => {
            const active = m.index === selectedIdx
            return (
              <button
                key={m.index}
                type="button"
                onClick={() => setSelectedIdx(m.index)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? 'border-status-error/40 bg-status-error/10 text-status-error'
                    : 'border-border-subtle bg-background-tertiary text-text-secondary hover:text-text-primary'
                }`}
              >
                M{m.index + 1}
                <span className="font-mono tabular-nums text-[10px] opacity-80">
                  {formatUSDC(m.amount).replace(' USDC', '')}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <DisputeCaseDesk
        escrow={escrow}
        milestone={activeMilestone}
        dispute={dispute}
        userAddress={userAddress}
        onChange={onChange}
      />
    </div>
  )
}

function DisputeCaseDesk({ escrow, milestone, dispute, userAddress, onChange }) {
  const disputedBy = dispute?.disputedBy

  const payerIsDisputer = disputedBy?.toLowerCase() === escrow.depositor?.toLowerCase()
  const payerEvidence = payerIsDisputer
    ? { reason: dispute?.reason, uri: dispute?.evidenceURI, hash: dispute?.evidenceHash, kind: 'opening' }
    : (dispute?.counterEvidenceURI || (dispute?.counterEvidenceHash && dispute.counterEvidenceHash !== ZERO_BYTES32)
        ? { reason: null, uri: dispute.counterEvidenceURI, hash: dispute.counterEvidenceHash, kind: 'counter' }
        : null)
  const freelancerEvidence = !payerIsDisputer
    ? { reason: dispute?.reason, uri: dispute?.evidenceURI, hash: dispute?.evidenceHash, kind: 'opening' }
    : (dispute?.counterEvidenceURI || (dispute?.counterEvidenceHash && dispute.counterEvidenceHash !== ZERO_BYTES32)
        ? { reason: null, uri: dispute.counterEvidenceURI, hash: dispute.counterEvidenceHash, kind: 'counter' }
        : null)

  return (
    <div className="flex flex-col gap-6">
      {/* Per-case header */}
      <div className="rounded-2xl border border-border-subtle bg-background-secondary dark:bg-white/[0.01] p-5 backdrop-blur-sm flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-mono">
              Amount in dispute · M{milestone.index + 1}
            </span>
            <div className="font-mono tabular-nums text-2xl font-bold text-text-primary">
              {formatUSDCNumber(milestone.amount)}
              <span className="text-sm font-sans font-medium text-text-secondary ml-1.5">USDC</span>
            </div>
          </div>
          {dispute?.disputedBy && (
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-mono">
                Raised by
              </span>
              <AddressInline address={dispute.disputedBy} />
            </div>
          )}
        </div>
        {dispute?.raisedAt && Number(dispute.raisedAt) > 0 && (
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-border-subtle">
            <span className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-mono">
              Arbiter timeout
            </span>
            <span className="font-mono tabular-nums text-sm text-text-primary">
              Pending {timeAgo(dispute.raisedAt).replace(' ago', '')}
            </span>
          </div>
        )}
      </div>

      {/* Split evidence */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EvidenceBox
          title="Payer Evidence"
          who={escrow.depositor}
          evidence={payerEvidence}
          waiting={payerEvidence === null}
        />
        <EvidenceBox
          title="Freelancer Evidence"
          who={escrow.recipient}
          evidence={freelancerEvidence}
          waiting={freelancerEvidence === null}
        />
      </div>

      {/* Arbiter-only resolution block with double-confirmation */}
      <ArbiterDecisionBlock
        escrowId={escrow.id}
        milestoneIdx={milestone.index}
        onResolved={onChange}
      />
    </div>
  )
}

function EvidenceBox({ title, who, evidence, waiting }) {
  return (
    <div className="bg-black/[0.02] dark:bg-white/[0.02] border border-border-subtle rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-medium">
          {title}
        </div>
        <AddressInline address={who} />
      </div>

      {waiting || !evidence ? (
        <div className="rounded-xl border border-dashed border-border-subtle bg-background-tertiary/40 px-4 py-8 flex flex-col items-center justify-center text-center gap-2">
          <div className="w-8 h-8 rounded-full border border-dashed border-border-medium flex items-center justify-center text-text-tertiary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <span className="text-xs text-text-tertiary">Waiting for Counter-Evidence</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-[0.15em] text-text-tertiary">
            {evidence.kind === 'opening' ? 'Opening statement' : 'Counter-evidence'}
          </div>
          {evidence.reason && (
            <p className="text-sm font-sans text-text-primary leading-relaxed">{evidence.reason}</p>
          )}
          {evidence.uri && (
            <a
              href={evidence.uri}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono tabular-nums text-sm text-accent-blue hover:opacity-80 break-all"
            >
              {evidence.uri}
              <ExternalLinkIcon size={12} />
            </a>
          )}
          {evidence.hash && evidence.hash !== ZERO_BYTES32 && (
            <div className="border-t border-border-subtle pt-3 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.15em] text-text-tertiary">Evidence hash</span>
              <span className="font-mono tabular-nums text-xs text-text-secondary break-all">
                {evidence.hash}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ArbiterDecisionBlock({ escrowId, milestoneIdx, onResolved }) {
  const [resolutionHash, setResolutionHash] = useState('')
  const [pending, setPending] = useState(null) // null | 'release' | 'refund'

  const tx = useTx({
    onConfirmed: () => { onResolved?.(); setPending(null); setResolutionHash('') }
  })

  const hashValid = isValidBytes32(resolutionHash)
  const execute = (releaseToRecipient) => tx.run(
    escrowWrite('resolveDispute', [BigInt(escrowId), BigInt(milestoneIdx), releaseToRecipient, resolutionHash, 0n]),
    { loadingMessage: 'Recording decision. Check your wallet.' }
  )

  return (
    <div className="flex flex-col gap-4 mt-2 p-6 bg-background-secondary dark:bg-white/[0.01] border border-border-subtle rounded-xl backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-mono">
            Arbiter decision
          </span>
          <span className="text-sm text-text-primary">
            Choose how this milestone resolves. The decision is permanent.
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-[0.18em] text-status-error font-mono">
          Irreversible
        </span>
      </div>

      <input
        className="input-field font-mono tabular-nums text-sm"
        placeholder="0x… resolution hash (bytes32)"
        value={resolutionHash}
        onChange={(e) => setResolutionHash(e.target.value.trim())}
        disabled={!!pending || tx.isBusy}
      />

      {!pending ? (
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={() => setPending('refund')}
            disabled={!hashValid || tx.isBusy}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-status-error text-status-error hover:bg-status-error/10 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            Resolve in favor of Payer
          </button>
          <button
            type="button"
            onClick={() => setPending('release')}
            disabled={!hashValid || tx.isBusy}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-accent-blue text-white shadow-[0_4px_12px_rgba(51,119,255,0.3)] hover:bg-accent-blue/90 transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
          >
            Resolve in favor of Freelancer
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-status-error/40 bg-status-error/5 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs uppercase tracking-[0.18em] font-medium text-status-error animate-pulse">
              {pending === 'release' ? 'Confirm release to freelancer' : 'Confirm refund to payer'}
            </span>
            <span className="font-mono tabular-nums text-[10px] text-text-tertiary">
              ESC-{escrowId} / M{milestoneIdx + 1}
            </span>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">
            Funds will move immediately when this transaction confirms on Arc.
            There is no second chance.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={tx.isBusy}
              className="btn-secondary text-sm py-2 flex-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => execute(pending === 'release')}
              disabled={tx.isBusy}
              className={`text-sm py-2 flex-1 ${
                pending === 'release' ? 'btn-primary' : 'btn-danger'
              }`}
            >
              {tx.isBusy ? 'Executing…' : 'Confirm execution'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- Small primitives ---------- */
function AddressInline({ address }) {
  if (!address) return <span className="text-text-tertiary">—</span>
  return (
    <a
      href={explorerAddr(address)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 font-mono text-sm text-text-primary hover:text-accent transition-colors"
      title={address}
    >
      {truncateAddr(address)}
      <ExternalLinkIcon size={12} />
    </a>
  )
}

function ExternalLinkIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  )
}

function ShieldIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  )
}
