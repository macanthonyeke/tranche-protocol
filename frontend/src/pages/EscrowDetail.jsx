import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { keccak256, toBytes } from 'viem'
import { motion, AnimatePresence } from 'framer-motion'

import ConnectGate from '../components/ConnectGate.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import CustomSelect from '../components/CustomSelect.jsx'
import Skeleton, { SkeletonMilestoneCard } from '../components/Skeleton.jsx'
import { MilestoneBadge, EscrowBadge, RoleBadge } from '../components/StatusBadge.jsx'
import { useEscrowDetail, useTick } from '../hooks/useEscrows.js'
import { useSupportedDomains } from '../hooks/useSupportedDomains.js'
import { useTx, escrowWrite } from '../hooks/useTx.js'
import { isValidBytes32, bytes32ToAddress } from '../utils/encode.js'
import { isValidAddress, formatUSDC, formatDeadline, formatTimestamp, formatWindow, countdown, truncateAddr } from '../utils/format.js'
import { getDomainName, ARC_DOMAIN, isEvmDomain } from '../config/chains.js'

const addressToBytes32 = (addr) => '0x' + addr.slice(2).padStart(64, '0')

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

const POLL_MS = 12_000

export default function EscrowDetail() {
  return (
    <ConnectGate>
      <DetailInner />
    </ConnectGate>
  )
}

function DetailInner() {
  const { id } = useParams()
  const { address } = useAccount()
  const { detail, isLoading, error, refetch } = useEscrowDetail(id, address, { pollMs: POLL_MS })
  useTick(15_000)

  // Optimistic overlays let writes update the UI instantly while we wait for
  // confirmation. Each entry is { type, milestoneIdx, ... } and is cleared by
  // the next on-chain refetch (which is also why polling matters).
  const [optimistic, setOptimistic] = useState({})
  const setOpt = (key, value) =>
    setOptimistic((o) => ({ ...o, [key]: value }))
  const clearOpt = (key) =>
    setOptimistic((o) => {
      const next = { ...o }; delete next[key]; return next
    })

  // Wipe the optimistic overlay whenever fresh on-chain data arrives.
  useEffect(() => { if (detail) setOptimistic({}) }, [detail])

  if (isLoading) {
    return <EscrowDetailSkeleton />
  }
  if (!detail || error) {
    return (
      <div className="card-surface p-12 text-center">
        <h2 className="text-xl font-semibold mb-2">Escrow not found</h2>
        <p className="text-sm text-text-secondary">There is no escrow with ID #{id}.</p>
      </div>
    )
  }

  const { escrow, milestones, disputes, disputeWindowExpired, deliverySignaled, effectiveDisputeDeadlines, isPayer, isFreelancer, isArbiter } = detail
  const role = isPayer ? 'payer' : isFreelancer ? 'freelancer' : null
  const inv = escrow.invoiceHash ? `INV-${escrow.invoiceHash.slice(2, 6).toUpperCase()}` : `ESC-${escrow.id}`

  const activeIdx = milestones.findIndex((m) => m.state !== 3 && m.state !== 4)
  // Percent of the timeline that should be "filled" with the gradient.
  // Stop at the active milestone's dot — anything past it stays subtle.
  const activeStopPct = milestones.length > 1
    ? (activeIdx === -1 ? 100 : Math.min(100, Math.round((activeIdx / Math.max(1, milestones.length - 1)) * 100)))
    : 0

  return (
    <div className="flex flex-col gap-8">
      <EscrowHeader escrow={escrow} role={role} inv={inv} />

      <div className="flex flex-col lg:flex-row gap-8">
        <aside className="lg:w-1/3 lg:sticky lg:top-24 self-start flex flex-col gap-4 w-full">
          <TimelineCard escrow={escrow} />
          {role && escrow.state === 0 && <CancelCard escrow={escrow} role={role} onChange={refetch} optimistic={optimistic} setOpt={setOpt} clearOpt={clearOpt} />}
          {isFreelancer && escrow.state === 0 && <UpdateReceivingAddressCard escrow={escrow} onChange={refetch} />}
        </aside>

        <section className="lg:w-2/3 flex flex-col gap-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-2xl font-semibold tracking-tight">Milestones</h2>
            <span className="text-sm text-text-secondary">{milestones.length} total</span>
          </div>

          <div className="relative flex flex-col gap-6">
            {/* Track: muted base line spanning the whole column. */}
            <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-border-subtle" aria-hidden />
            {/* Progress: glowing gradient that stops at the active milestone. */}
            <div
              className="absolute left-3 top-2 w-0.5 rounded-full bg-gradient-to-b from-accent-blue via-accent-blue/80 to-accent-blue/0 shadow-[0_0_12px_rgba(51,119,255,0.45)] transition-[height] duration-500"
              style={{ height: `calc(${activeStopPct}% - 1rem)` }}
              aria-hidden
            />
            <AnimatePresence initial={false}>
              {milestones.map((m, i) => {
                const opt = optimistic[`milestone_${i}`]
                return (
                  <motion.div
                    key={i}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                  >
                    <MilestoneCard
                      escrow={escrow}
                      milestone={m}
                      dispute={disputes[i]}
                      role={role}
                      isArbiter={isArbiter}
                      userAddress={address}
                      isActive={i === activeIdx}
                      disputeWindowExpired={!!disputeWindowExpired[i]}
                      deliverySignaled={!!deliverySignaled[i] || opt?.signaledDelivery}
                      effectiveDisputeDeadline={Number(effectiveDisputeDeadlines[i] || 0n)}
                      optimisticBadge={opt?.badge}
                      onChange={refetch}
                      setOpt={setOpt}
                      clearOpt={clearOpt}
                    />
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </section>
      </div>
    </div>
  )
}

function EscrowDetailSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      {/* Header skeleton */}
      <div className="card-surface p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-32 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-2 gap-6 pt-3 border-t border-border-subtle">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="flex flex-col gap-2 items-end">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-40" />
          </div>
        </div>
      </div>
      <div className="flex flex-col lg:flex-row gap-8">
        <aside className="lg:w-1/3 flex flex-col gap-4 w-full">
          <Skeleton className="h-48" />
          <Skeleton className="h-40" />
        </aside>
        <section className="lg:w-2/3 flex flex-col gap-6">
          <Skeleton className="h-8 w-40" />
          <SkeletonMilestoneCard />
          <SkeletonMilestoneCard />
          <SkeletonMilestoneCard />
        </section>
      </div>
    </div>
  )
}

function loadMilestoneTitles(escrowId) {
  try {
    const raw = localStorage.getItem(`escrow-titles-${escrowId}`)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

/* ---------- Escrow Header ----------
   Three-part hierarchy: invoice ID, total amount, status.
   Amount is the largest element on the page — full accent color and tabular.
   Parties sit in a two-column row underneath. */
function EscrowHeader({ escrow, role, inv }) {
  return (
    <header className="card-surface p-6 md:p-8 flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-text-tertiary">
            <span className="font-mono">{inv}</span>
            <span aria-hidden>·</span>
            <span>Escrow #{escrow.id}</span>
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="font-mono tabular text-4xl md:text-5xl font-semibold text-accent tracking-tight">
              {formatUSDC(escrow.totalAmount).replace(' USDC', '')}
            </span>
            <span className="text-base text-text-secondary font-medium">USDC</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {role && <RoleBadge role={role} />}
          <EscrowBadge state={escrow.state} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-5 border-t border-border-subtle">
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-medium">Payer</div>
          <AddressDisplay address={escrow.depositor} />
        </div>
        <div className="flex flex-col gap-1.5 sm:items-end">
          <div className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-medium">Freelancer</div>
          <AddressDisplay address={escrow.recipient} />
        </div>
      </div>

      {escrow.invoiceURI && (
        <a
          href={escrow.invoiceURI}
          target="_blank"
          rel="noreferrer"
          className="self-start text-sm text-accent hover:text-accent-hover transition-colors inline-flex items-center gap-1"
        >
          View invoice ↗
        </a>
      )}
    </header>
  )
}

/* ---------- Timeline card ----------
   Replaces the previous Specs card. Groups Deadline, Dispute window, and
   Delivery notice as a single "Timeline" panel with dividers between rows. */
function TimelineCard({ escrow }) {
  const deadlinePassed = Number(escrow.deadline) * 1000 < Date.now()
  return (
    <div className="card-surface p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-[0.18em] text-text-tertiary font-medium">Timeline</h3>
        <span className="text-[11px] text-text-tertiary font-mono">{getDomainName(escrow.destinationDomain)}</span>
      </div>

      <div className="flex flex-col">
        <TimelineRow label="Deadline">
          <div className="text-right">
            <div className="font-mono tabular text-sm">{formatDeadline(escrow.deadline)}</div>
            <div className={`text-xs font-mono tabular ${deadlinePassed ? 'text-status-error' : 'text-text-tertiary'}`}>
              {countdown(escrow.deadline)}
            </div>
          </div>
        </TimelineRow>
        <TimelineDivider />
        <TimelineRow label="Dispute window">
          <span className="text-sm">{formatWindow(escrow.disputeWindow)}</span>
        </TimelineRow>
        <TimelineDivider />
        <TimelineRow label="Delivery notice">
          <span className="text-sm">{formatWindow(escrow.deliveryNoticeWindow)}</span>
        </TimelineRow>
      </div>
    </div>
  )
}

function TimelineRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <span className="text-sm text-text-secondary">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  )
}

function TimelineDivider() {
  return <div className="h-px bg-border-subtle/60" aria-hidden />
}

/* ---------- Cancel card ---------- */
function CancelCard({ escrow, role, onChange, optimistic, setOpt, clearOpt }) {
  const myFlag = role === 'payer' ? escrow.depositorApproveCancel : escrow.recipientApproveCancel
  const otherFlag = role === 'payer' ? escrow.recipientApproveCancel : escrow.depositorApproveCancel
  const optApproved = optimistic.cancel === 'approved'

  const tx = useTx({
    onSign: () => setOpt('cancel', 'approved'),
    onConfirmed: () => { clearOpt('cancel'); onChange?.() },
    onReverted: () => clearOpt('cancel')
  })

  const submit = () => tx.run(
    escrowWrite('mutualCancel', [BigInt(escrow.id)]),
    { loadingMessage: 'Submitting. Check your wallet.' }
  )

  const payerApproved = (role === 'payer' && optApproved) || escrow.depositorApproveCancel
  const freelancerApproved = (role === 'freelancer' && optApproved) || escrow.recipientApproveCancel

  return (
    <div className="card-surface p-5 flex flex-col gap-3">
      <h3 className="text-[11px] uppercase tracking-[0.18em] text-text-tertiary font-medium">Cancel by mutual agreement</h3>
      <p className="text-xs text-text-secondary leading-relaxed">Both the payer and freelancer need to approve. Any unreleased funds go to the payer's refund balance.</p>
      <div className="flex flex-col gap-2 bg-background-tertiary rounded-xl px-3 py-2.5">
        <ApprovalRow label="Payer" approved={payerApproved} />
        <ApprovalRow label="Freelancer" approved={freelancerApproved} />
      </div>
      <TxButton
        className="btn-danger text-sm py-2"
        onClick={submit}
        disabled={myFlag || optApproved}
        loading={tx.isBusy}
        label={myFlag || optApproved ? 'You approved this' : otherFlag ? 'Finalize cancellation' : 'Approve cancellation'}
      />
    </div>
  )
}

function ApprovalRow({ label, approved }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className={`inline-flex items-center gap-1.5 font-medium ${approved ? 'text-status-success' : 'text-text-tertiary'}`}>
        {approved && (
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M3 7.5l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
        {approved ? 'Approved' : 'Not yet'}
      </span>
    </div>
  )
}

/* ---------- Receiving address (settings-style card with inline edit) ---------- */
function UpdateReceivingAddressCard({ escrow, onChange }) {
  const [editing, setEditing] = useState(false)
  const [addr, setAddr] = useState('')
  const [domain, setDomain] = useState(() => Number(escrow.destinationDomain ?? ARC_DOMAIN))
  const [successInfo, setSuccessInfo] = useState(null)
  const { supported } = useSupportedDomains()

  const currentAddress = escrow.mintRecipient ? bytes32ToAddress(escrow.mintRecipient) : null
  const currentDomain = Number(escrow.destinationDomain)

  // ARC is always supported by the contract for receiving updates.
  const domainOptions = useMemo(() => {
    const set = new Set(supported.filter(isEvmDomain))
    set.add(ARC_DOMAIN)
    return [...set].sort((a, b) => a - b).map((d) => ({ value: d, label: getDomainName(d) }))
  }, [supported])

  const tx = useTx({
    onConfirmed: () => {
      setSuccessInfo({ address: addr, domain })
      setEditing(false); setAddr('')
      onChange?.()
    }
  })

  const submit = () => {
    if (!isValidAddress(addr)) return
    return tx.run(
      escrowWrite('updateReceivingAddress', [BigInt(escrow.id), addressToBytes32(addr), Number(domain)]),
      { loadingMessage: 'Updating. Check your wallet.' }
    )
  }

  return (
    <div className="card-surface p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] uppercase tracking-[0.18em] text-text-tertiary font-medium">Receiving address</h3>
        {!editing && (
          <button
            type="button"
            className="text-xs text-accent hover:text-accent-hover transition-colors"
            onClick={() => { setEditing(true); setSuccessInfo(null); setDomain(currentDomain || ARC_DOMAIN) }}
          >
            Edit
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 bg-background-tertiary rounded-xl px-3 py-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary">Current</div>
        {currentAddress ? <AddressDisplay address={currentAddress} /> : <span className="text-sm text-text-tertiary">—</span>}
        <div className="text-xs text-text-secondary font-mono">{getDomainName(currentDomain)}</div>
      </div>

      <p className="text-xs text-text-secondary leading-relaxed">Where approved milestone payments get sent. You can update this anytime before the escrow is completed or cancelled.</p>

      {successInfo && !editing && (
        <div className="rounded-xl border border-status-success/40 bg-status-success/10 px-3 py-2.5 text-xs text-status-success flex items-start gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="mt-0.5 shrink-0">
            <path d="M3 7.5l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Updated to <span className="font-mono">{truncateAddr(successInfo.address)}</span> on {getDomainName(successInfo.domain)}.</span>
        </div>
      )}

      <AnimatePresence initial={false}>
        {editing && (
          <motion.div
            key="edit"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="flex flex-col gap-3 overflow-hidden"
          >
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-secondary">New address</label>
              <input
                className="input-field font-mono text-sm"
                placeholder="0x…"
                value={addr}
                onChange={(e) => setAddr(e.target.value.trim())}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-secondary">Receiving chain</label>
              <CustomSelect
                value={Number(domain)}
                onChange={(v) => setDomain(Number(v))}
                options={domainOptions}
                placeholder="Select chain"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <TxButton
                className="btn-primary text-sm py-2 flex-1"
                onClick={submit}
                disabled={!isValidAddress(addr) || !domainOptions.some((o) => o.value === Number(domain))}
                loading={tx.isBusy}
                label="Save changes"
              />
              <button
                className="btn-secondary text-sm py-2"
                disabled={tx.isBusy}
                onClick={() => { setEditing(false); setAddr('') }}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---------- Milestone Card ----------
   State-driven styling. PENDING / APPROVED / IN_DISPUTE / RELEASED / CANCELLED
   each get a distinct visual treatment. IN_DISPUTE gets a Safety Orange left
   border and a tinted background to signal urgency. */
const MILESTONE_VARIANT = {
  // state 0 — PENDING
  0: {
    border: 'border border-border-subtle',
    leftAccent: '',
    tint: 'bg-background-secondary',
    dot: 'bg-background-primary border-border-medium'
  },
  // state 1 — APPROVED (waiting on dispute window)
  1: {
    border: 'border border-accent/30',
    leftAccent: 'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:rounded-l-2xl before:bg-accent',
    tint: 'bg-accent-muted/40',
    dot: 'bg-accent border-accent shadow-[0_0_8px_rgba(51,119,255,0.6)]'
  },
  // state 2 — IN_DISPUTE
  2: {
    border: 'border border-status-warning/40',
    leftAccent: 'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:rounded-l-2xl before:bg-status-warning',
    tint: 'bg-status-warning/[0.06]',
    dot: 'bg-status-warning border-status-warning shadow-[0_0_8px_rgba(234,88,12,0.5)]'
  },
  // state 3 — RELEASED
  3: {
    border: 'border border-status-success/30',
    leftAccent: '',
    tint: 'bg-background-secondary',
    dot: 'bg-status-success border-status-success'
  },
  // state 4 — REFUNDED / CANCELLED
  4: {
    border: 'border border-border-subtle',
    leftAccent: '',
    tint: 'bg-background-secondary opacity-70',
    dot: 'bg-text-tertiary border-text-tertiary'
  }
}

function MilestoneCard({
  escrow, milestone, dispute, role, isArbiter, userAddress, isActive,
  disputeWindowExpired, deliverySignaled, effectiveDisputeDeadline,
  optimisticBadge, onChange, setOpt, clearOpt
}) {
  const titles = loadMilestoneTitles(escrow.id)
  const title = titles[milestone.index] || `Milestone ${milestone.index + 1}`

  const noticeDeadline = deliverySignaled
    ? Number(milestone.deliveredAt) + Number(escrow.deliveryNoticeWindow)
    : 0
  const now = Math.floor(Date.now() / 1000)
  const deadlinePassed = Number(escrow.deadline) > 0 && now > Number(escrow.deadline)

  const variant = MILESTONE_VARIANT[milestone.state] ?? MILESTONE_VARIANT[0]
  const completed = milestone.state === 3 || milestone.state === 4
  const ring = isActive && !completed && milestone.state !== 2
    ? 'shadow-[0_0_18px_rgba(51,119,255,0.12)] ring-1 ring-accent/30'
    : ''

  return (
    <div className="relative pl-8">
      <span className={`absolute left-[7px] top-6 h-3 w-3 rounded-full border-2 ${variant.dot}`} aria-hidden />

      <div className={`relative rounded-2xl p-5 pl-7 flex flex-col gap-4 transition-all ${variant.border} ${variant.tint} ${variant.leftAccent} ${ring}`}>
        {/* Title row: index + title on the left, badge on the right (most prominent after title) */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-tertiary">
              M{milestone.index + 1}
            </div>
            <h3 className="text-base md:text-lg font-semibold text-text-primary mt-0.5 truncate">{title}</h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {optimisticBadge && (
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border border-accent/30 bg-accent-muted text-accent">
                {optimisticBadge}
              </span>
            )}
            <MilestoneBadge state={milestone.state} />
          </div>
        </div>

        {/* Amount — monospace, tabular, larger weight to reinforce this is money */}
        <div className="font-mono tabular text-2xl md:text-3xl font-semibold text-text-primary">
          {formatUSDC(milestone.amount).replace(' USDC', '')}
          <span className="text-base text-text-secondary font-sans font-medium ml-1.5">USDC</span>
        </div>

        {/* Timestamps */}
        {(deliverySignaled && Number(milestone.deliveredAt) > 0) || Number(milestone.conditionMetTimestamp) > 0 ? (
          <div className="flex flex-wrap gap-4 text-xs">
            {deliverySignaled && Number(milestone.deliveredAt) > 0 && (
              <div className="flex flex-col gap-0.5">
                <span className="text-text-tertiary text-[10px] uppercase tracking-wider">Delivered</span>
                <span className="font-mono tabular text-text-secondary">{formatTimestamp(milestone.deliveredAt)}</span>
              </div>
            )}
            {Number(milestone.conditionMetTimestamp) > 0 && (
              <div className="flex flex-col gap-0.5">
                <span className="text-text-tertiary text-[10px] uppercase tracking-wider">Approved</span>
                <span className="font-mono tabular text-text-secondary">{formatTimestamp(milestone.conditionMetTimestamp)}</span>
              </div>
            )}
          </div>
        ) : null}

        {/* Live countdowns — distinct treatment, smaller than the amount, accent-muted tone */}
        {milestone.state === 1 && effectiveDisputeDeadline > 0 && !disputeWindowExpired && (
          <Countdown label="Dispute window closes" target={effectiveDisputeDeadline} tone="warning" />
        )}
        {milestone.state === 0 && noticeDeadline > 0 && (
          <Countdown label="Auto-releases in" target={noticeDeadline} tone="warning" />
        )}

        <MilestoneActions
          escrow={escrow} milestone={milestone} role={role}
          isArbiter={isArbiter} onChange={onChange}
          deadlinePassed={deadlinePassed}
          disputeWindowExpired={disputeWindowExpired}
          deliverySignaled={deliverySignaled}
          noticeDeadline={noticeDeadline}
          setOpt={setOpt}
          clearOpt={clearOpt}
        />

        {milestone.state === 2 && (
          <DisputeSection
            escrow={escrow} milestone={milestone} dispute={dispute}
            role={role} isArbiter={isArbiter} userAddress={userAddress}
            onChange={onChange}
          />
        )}
      </div>
    </div>
  )
}

/* Live countdown — pulses the digits subtly to feel active without being noisy.
   Smaller than the amount, monospace, muted accent. */
function Countdown({ label, target, tone = 'warning' }) {
  const toneCls = tone === 'warning' ? 'text-status-warning' : 'text-accent'
  const dotCls = tone === 'warning' ? 'bg-status-warning' : 'bg-accent'
  const value = countdown(target).replace(' remaining', '')
  return (
    <div className="rounded-xl bg-background-tertiary px-3 py-2.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dotCls} animate-pulse`} aria-hidden />
        <span className="text-xs text-text-secondary">{label}</span>
      </div>
      <span className={`font-mono tabular text-base font-semibold ${toneCls}`}>{value}</span>
    </div>
  )
}

/* ----- Action area -----
   Actions are gated by role/state inside the array build. They sit at the bottom
   of the card with clear visual weight: primary positive action gets the accent
   color, destructive (Open Dispute / Escalate) gets the warning color. */
function MilestoneActions({
  escrow, milestone, role, isArbiter, onChange,
  deadlinePassed, disputeWindowExpired, deliverySignaled, noticeDeadline,
  setOpt, clearOpt
}) {
  const [activeKey, setActiveKey] = useState(null)
  const [disputeOpen, setDisputeOpen] = useState(false)

  const tx = useTx({
    onConfirmed: () => { onChange?.(); setActiveKey(null) },
    onReverted: () => { setActiveKey(null); clearOpt(`milestone_${milestone.index}`) }
  })

  const run = async (fn, args, key, optimistic) => {
    setActiveKey(key)
    if (optimistic) setOpt(`milestone_${milestone.index}`, optimistic)
    try {
      await tx.run(escrowWrite(fn, args), { loadingMessage: 'Check your wallet.' })
    } catch {
      clearOpt(`milestone_${milestone.index}`)
    }
  }

  const id = BigInt(escrow.id)
  const idx = BigInt(milestone.index)
  const now = Math.floor(Date.now() / 1000)
  const isPayer = role === 'payer'
  const isFreelancer = role === 'freelancer'

  // tone: 'primary' (accent), 'warning' (orange — destructive within trust flow)
  const actions = []
  if (milestone.state === 0) {
    if (isFreelancer && !deliverySignaled && !deadlinePassed)
      actions.push({ key: 'signal', label: 'Mark as Delivered', tone: 'primary',
        run: () => run('signalDelivery', [id, idx], 'signal', { badge: 'Signaled', signaledDelivery: true }) })
    if (isPayer && deliverySignaled)
      actions.push({ key: 'approve', label: 'Approve', tone: 'primary',
        run: () => run('fulfillCondition', [id, idx], 'approve', { badge: 'Approving…' }) })
    if (noticeDeadline > 0 && now > noticeDeadline)
      actions.push({ key: 'silent', label: 'Claim Auto-Release', tone: 'primary',
        run: () => run('claimSilentApproval', [id, idx], 'silent', { badge: 'Releasing…' }) })
    if (isFreelancer && deadlinePassed)
      actions.push({ key: 'escalate', label: 'Escalate to Arbiter', tone: 'warning',
        run: () => setDisputeOpen({ kind: 'escalate' }) })
  }
  if (milestone.state === 1) {
    if ((isPayer || isFreelancer) && !disputeWindowExpired)
      actions.push({ key: 'dispute', label: 'Open Dispute', tone: 'warning',
        run: () => setDisputeOpen({ kind: 'dispute' }) })
    if (disputeWindowExpired)
      actions.push({ key: 'release', label: 'Release Payment', tone: 'primary',
        run: () => run('releaseAfterWindow', [id, idx, 0n], 'release', { badge: 'Releasing…' }) })
  }

  if (actions.length === 0 && !disputeOpen) return null

  return (
    <>
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1 mt-1 border-t border-border-subtle/60 -mx-1 px-1 pt-3">
          {actions.map((a) => {
            const isLoading = activeKey === a.key && tx.isBusy
            const base = 'inline-flex items-center justify-center gap-2 rounded-xl font-medium px-4 py-2.5 text-sm transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background-primary'
            const tone = a.tone === 'warning'
              ? `${base} bg-status-warning text-white hover:opacity-90 shadow-sm focus-visible:ring-status-warning`
              : `${base} bg-accent text-white hover:bg-accent-hover shadow-sm focus-visible:ring-accent-blue`
            return (
              <button key={a.key} className={tone} onClick={a.run} disabled={tx.isBusy}>
                {isLoading && (
                  <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />
                )}
                {isLoading ? 'Pending…' : a.label}
              </button>
            )
          })}
        </div>
      )}

      {disputeOpen && (
        <DisputeForm
          kind={disputeOpen.kind} escrow={escrow} milestone={milestone}
          onClose={() => setDisputeOpen(false)}
          onSubmitted={onChange}
        />
      )}
    </>
  )
}

function DisputeForm({ kind, escrow, milestone, onClose, onSubmitted }) {
  const [reason, setReason] = useState('')
  const [uri, setUri] = useState('')

  const tx = useTx({
    onConfirmed: () => { onSubmitted?.(); setTimeout(onClose, 400) }
  })

  const submit = () => {
    const evidenceHash = keccak256(toBytes(reason + '|' + uri))
    const fn = kind === 'escalate' ? 'escalateAfterDeadline' : 'raiseDispute'
    return tx.run(
      escrowWrite(fn, [BigInt(escrow.id), BigInt(milestone.index), reason, evidenceHash, uri]),
      { loadingMessage: 'Submitting dispute. Check your wallet.' }
    )
  }

  const disabled = !reason.trim() || !uri.trim() || tx.isBusy

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="card-surface w-full max-w-md p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">{kind === 'escalate' ? 'Escalate to arbiter' : 'Open a dispute'}</h3>
        <p className="text-sm text-text-secondary">Provide a reason and a link to your evidence. The hash of both gets stored on-chain. You cannot change this after submitting.</p>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Reason</label>
          <textarea rows={3} className="input-field-multiline"
            placeholder="Describe the issue clearly."
            value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Evidence URI</label>
          <input className="input-field" placeholder="https://…"
            value={uri} onChange={(e) => setUri(e.target.value.trim())} />
        </div>

        <div className="flex gap-3 pt-2">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <TxButton
            className="btn-primary flex-1"
            onClick={submit}
            disabled={disabled}
            loading={tx.isBusy}
            label="Submit"
          />
        </div>
      </motion.div>
    </div>
  )
}

/* Dispute section — split evidence into clearly-labelled Payer / Freelancer
   blocks with a vertical divider. The counter-evidence form only renders for
   the party who hasn't submitted yet. */
function DisputeSection({ escrow, milestone, dispute, role, isArbiter, userAddress, onChange }) {
  const [counterUri, setCounterUri] = useState('')
  const [counterReason, setCounterReason] = useState('')
  const [resolutionHash, setResolutionHash] = useState('')

  const counterTx = useTx({ onConfirmed: () => onChange?.() })
  const resolveTx = useTx({ onConfirmed: () => onChange?.() })

  if (!dispute) return null
  const disputedBy = dispute.disputedBy
  const isDisputer = disputedBy?.toLowerCase() === userAddress?.toLowerCase()
  const counterMissing = !dispute.counterEvidenceHash || dispute.counterEvidenceHash === ZERO_BYTES32
  const canCounter = !!role && !isDisputer && counterMissing

  const payerIsDisputer = disputedBy?.toLowerCase() === escrow.depositor?.toLowerCase()
  const payerEvidence = payerIsDisputer
    ? { reason: dispute.reason, uri: dispute.evidenceURI, hash: dispute.evidenceHash, kind: 'opening' }
    : (dispute?.counterEvidenceURI || (dispute?.counterEvidenceHash && dispute.counterEvidenceHash !== ZERO_BYTES32)
        ? { reason: null, uri: dispute.counterEvidenceURI, hash: dispute.counterEvidenceHash, kind: 'counter' }
        : null)
  const freelancerEvidence = !payerIsDisputer
    ? { reason: dispute.reason, uri: dispute.evidenceURI, hash: dispute.evidenceHash, kind: 'opening' }
    : (dispute?.counterEvidenceURI || (dispute?.counterEvidenceHash && dispute.counterEvidenceHash !== ZERO_BYTES32)
        ? { reason: null, uri: dispute.counterEvidenceURI, hash: dispute.counterEvidenceHash, kind: 'counter' }
        : null)

  const submitCounter = () => {
    const hash = keccak256(toBytes(counterReason + '|' + counterUri))
    return counterTx.run(
      escrowWrite('submitCounterEvidence', [BigInt(escrow.id), BigInt(milestone.index), hash, counterUri]),
      { loadingMessage: 'Submitting. Check your wallet.' }
    )
  }

  const resolve = (releaseToRecipient) => {
    if (!isValidBytes32(resolutionHash)) return
    return resolveTx.run(
      escrowWrite('resolveDispute', [BigInt(escrow.id), BigInt(milestone.index), releaseToRecipient, resolutionHash, 0n]),
      { loadingMessage: 'Recording decision. Check your wallet.' }
    )
  }

  return (
    <div className="mt-2 pt-4 border-t border-status-warning/30 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="text-status-warning">
          <path d="M7 1L1 12h12L7 1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M7 5.5v3M7 10.2v0.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span className="text-xs uppercase tracking-[0.18em] font-medium text-status-warning">Dispute open</span>
      </div>

      {/* Two-column evidence layout with a vertical divider in between */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-0">
        <EvidenceBlock title="Payer's evidence" who={escrow.depositor} evidence={payerEvidence} />
        <div className="hidden md:block w-px bg-border-subtle mx-4" aria-hidden />
        <EvidenceBlock title="Freelancer's evidence" who={escrow.recipient} evidence={freelancerEvidence} />
      </div>

      {canCounter && (
        <div className="flex flex-col gap-2 rounded-xl bg-background-tertiary p-3">
          <div className="text-xs font-medium text-text-primary">Your response</div>
          <textarea rows={2} className="input-field-multiline" placeholder="Explain your side."
            value={counterReason} onChange={(e) => setCounterReason(e.target.value)} />
          <input className="input-field" placeholder="https://… (evidence URL)"
            value={counterUri} onChange={(e) => setCounterUri(e.target.value.trim())} />
          <TxButton
            className="btn-primary text-sm py-2 self-start"
            onClick={submitCounter}
            disabled={!counterReason.trim() || !counterUri.trim()}
            loading={counterTx.isBusy}
            label="Submit counter-evidence"
          />
        </div>
      )}

      {isArbiter && (
        <div className="flex flex-col gap-2 rounded-xl bg-background-tertiary p-3">
          <div className="text-xs font-medium text-text-primary">Arbiter's decision</div>
          <input className="input-field font-mono text-sm"
            placeholder="Resolution hash (bytes32)"
            value={resolutionHash} onChange={(e) => setResolutionHash(e.target.value.trim())} />
          <div className="flex gap-2">
            <TxButton
              className="btn-primary text-sm py-2 flex-1"
              onClick={() => resolve(true)}
              loading={resolveTx.isBusy}
              label="Release to Freelancer"
            />
            <TxButton
              className="btn-danger text-sm py-2 flex-1"
              onClick={() => resolve(false)}
              loading={resolveTx.isBusy}
              label="Refund to Payer"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function EvidenceBlock({ title, who, evidence }) {
  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-medium">{title}</div>
        <AddressDisplay address={who} size="sm" />
      </div>
      {!evidence ? (
        <div className="text-xs text-text-tertiary italic py-3">No evidence submitted yet.</div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-[0.15em] text-text-tertiary">
            {evidence.kind === 'opening' ? 'Opening statement' : 'Counter-evidence'}
          </div>
          {evidence.reason && (
            <p className="text-sm text-text-primary leading-relaxed">{evidence.reason}</p>
          )}
          {evidence.uri && (
            <a href={evidence.uri} target="_blank" rel="noreferrer"
              className="text-xs text-accent hover:text-accent-hover underline break-all">
              View evidence ↗
            </a>
          )}
          {evidence.hash && evidence.hash !== ZERO_BYTES32 && (
            <div className="font-mono text-[10px] text-text-tertiary break-all">
              hash {truncateAddr(evidence.hash)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* Button wrapper that adds a small spinner when loading. Visual amplification
   of the existing busy state — no new logic. */
function TxButton({ className, onClick, disabled, loading, label }) {
  return (
    <button className={className} onClick={onClick} disabled={disabled || loading}>
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />
          Pending…
        </span>
      ) : label}
    </button>
  )
}
