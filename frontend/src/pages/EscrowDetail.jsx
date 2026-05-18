import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { keccak256, toBytes } from 'viem'
import { motion, AnimatePresence } from 'framer-motion'

import ConnectGate from '../components/ConnectGate.jsx'
import CustomSelect from '../components/CustomSelect.jsx'
import Skeleton, { SkeletonMilestoneCard } from '../components/Skeleton.jsx'
import { useEscrowDetail, useTick } from '../hooks/useEscrows.js'
import { useSupportedDomains } from '../hooks/useSupportedDomains.js'
import { useTx, escrowWrite } from '../hooks/useTx.js'
import { isValidBytes32, bytes32ToAddress } from '../utils/encode.js'
import {
  isValidAddress, formatUSDC, formatUSDCNumber, formatDeadline, formatTimestamp,
  formatWindow, countdown, truncateAddr, explorerAddr, ESCROW_LABELS, MILESTONE_LABELS
} from '../utils/format.js'
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

  // Optimistic overlays keep the UI responsive while a tx is in flight; cleared
  // on the next fresh on-chain read.
  const [optimistic, setOptimistic] = useState({})
  const setOpt = (key, value) => setOptimistic((o) => ({ ...o, [key]: value }))
  const clearOpt = (key) =>
    setOptimistic((o) => { const next = { ...o }; delete next[key]; return next })
  useEffect(() => { if (detail) setOptimistic({}) }, [detail])

  const [activeTab, setActiveTab] = useState('milestones')

  if (isLoading) return <EscrowDetailSkeleton />
  if (!detail || error) {
    return (
      <div className="card-surface p-12 text-center">
        <h2 className="text-xl font-semibold mb-2">Escrow not found</h2>
        <p className="text-sm text-text-secondary">There is no escrow with ID #{id}.</p>
      </div>
    )
  }

  const {
    escrow, milestones, disputes, disputeWindowExpired, deliverySignaled,
    effectiveDisputeDeadlines, isPayer, isFreelancer, isArbiter
  } = detail
  const role = isPayer ? 'payer' : isFreelancer ? 'freelancer' : null
  const inv = escrow.invoiceHash
    ? `INV-${escrow.invoiceHash.slice(2, 6).toUpperCase()}`
    : `ESC-${escrow.id}`

  const openDisputeCount = milestones.filter((m) => m.state === 2).length

  return (
    <div className="flex flex-col">
      <InspectionHeader escrow={escrow} inv={inv} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-6">
        <LedgerColumn
          escrow={escrow}
          role={role}
          onChange={refetch}
          optimistic={optimistic}
          setOpt={setOpt}
          clearOpt={clearOpt}
        />

        <RightColumn
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          openDisputeCount={openDisputeCount}
          escrow={escrow}
          milestones={milestones}
          disputes={disputes}
          role={role}
          isArbiter={isArbiter}
          userAddress={address}
          disputeWindowExpired={disputeWindowExpired}
          deliverySignaled={deliverySignaled}
          effectiveDisputeDeadlines={effectiveDisputeDeadlines}
          optimistic={optimistic}
          onChange={refetch}
          setOpt={setOpt}
          clearOpt={clearOpt}
        />
      </div>
    </div>
  )
}

/* ---------- Right column — tab switcher + content ----------
   Milestones tab: the existing milestone stack.
   Tribunal Room tab: a stark dispute desk. When no milestone is in dispute it
   shows a portal to initiate one; when one or more milestones are disputed it
   surfaces evidence side-by-side and (for arbiters) double-confirm controls. */
function RightColumn({
  activeTab, setActiveTab, openDisputeCount,
  escrow, milestones, disputes, role, isArbiter, userAddress,
  disputeWindowExpired, deliverySignaled, effectiveDisputeDeadlines,
  optimistic, onChange, setOpt, clearOpt
}) {
  return (
    <div className="lg:col-span-2 flex flex-col">
      <div className="flex items-center gap-6 border-b border-border-subtle mb-6">
        <TabButton
          active={activeTab === 'milestones'}
          onClick={() => setActiveTab('milestones')}
        >
          Milestones
        </TabButton>
        <TabButton
          active={activeTab === 'tribunal'}
          onClick={() => setActiveTab('tribunal')}
          icon={<ShieldIcon size={14} />}
          badge={openDisputeCount > 0 ? openDisputeCount : null}
          badgeTone="error"
        >
          Tribunal Room
        </TabButton>
      </div>

      {activeTab === 'milestones' ? (
        <MilestoneStack
          escrow={escrow}
          milestones={milestones}
          role={role}
          userAddress={userAddress}
          disputeWindowExpired={disputeWindowExpired}
          deliverySignaled={deliverySignaled}
          effectiveDisputeDeadlines={effectiveDisputeDeadlines}
          optimistic={optimistic}
          onChange={onChange}
          setOpt={setOpt}
          clearOpt={clearOpt}
          openTribunal={() => setActiveTab('tribunal')}
        />
      ) : (
        <TribunalRoom
          escrow={escrow}
          milestones={milestones}
          disputes={disputes}
          role={role}
          isArbiter={isArbiter}
          userAddress={userAddress}
          onChange={onChange}
        />
      )}
    </div>
  )
}

function TabButton({ active, onClick, children, icon, badge, badgeTone }) {
  const base = 'flex items-center gap-2 pb-3 -mb-px text-sm font-medium transition-colors border-b-2'
  const tone = active
    ? 'border-accent-blue text-text-primary'
    : 'border-transparent text-text-secondary hover:text-text-primary'
  return (
    <button type="button" onClick={onClick} className={`${base} ${tone}`} aria-pressed={active}>
      {icon}
      <span>{children}</span>
      {badge != null && (
        <span
          className={`inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-mono tabular-nums px-1.5 ${
            badgeTone === 'error'
              ? 'bg-status-error/10 text-status-error border border-status-error/30'
              : 'bg-background-tertiary text-text-secondary border border-border-subtle'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  )
}

/* ---------- Header backrow ----------
   Back-to-grid affordance, invoice title with copy, state-glow pill on the
   right. The pill shows the protocol host chain (Arc) since the escrow contract
   itself lives there — the destinationDomain (where the freelancer receives)
   is surfaced separately in the ledger column. */
function InspectionHeader({ escrow, inv }) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(inv)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  return (
    <>
      <button
        type="button"
        onClick={() => navigate('/dashboard')}
        className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors mb-6"
      >
        <ArrowLeft size={16} /> Back to Escrows
      </button>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-3xl font-mono font-bold text-text-primary tracking-tight truncate">
            {inv}
          </h1>
          <button
            type="button"
            onClick={onCopy}
            aria-label={`Copy ${inv}`}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-background-tertiary transition-colors"
            title={copied ? 'Copied' : 'Copy ID'}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </button>
        </div>

        <StateGlowPill state={escrow.state} />
      </div>
    </>
  )
}

function StateGlowPill({ state }) {
  const verb = ESCROW_LABELS[state] ?? 'Active'
  const tone = state === 1
    ? { dot: 'bg-status-success', text: 'text-status-success', ring: 'border-status-success/30 bg-status-success/10', glow: 'shadow-[0_0_10px_rgba(5,150,105,0.55)]' }
    : state === 2
    ? { dot: 'bg-text-tertiary', text: 'text-text-tertiary', ring: 'border-border-subtle bg-background-tertiary', glow: '' }
    : { dot: 'bg-accent-blue', text: 'text-accent-blue', ring: 'border-accent/30 bg-accent-muted/40', glow: 'shadow-[0_0_10px_rgba(51,119,255,0.55)]' }
  const pulse = state === 0 ? 'animate-pulse' : ''
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${tone.ring} ${tone.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot} ${tone.glow} ${pulse}`} aria-hidden />
      {verb} on Arc Network
    </span>
  )
}

/* ---------- Column 1 — Metadata & financial ledger ----------
   Locked amount up top, then a stack of border-separated parameter rows. The
   secondary cards (mutual cancel, receiving address) sit beneath so the whole
   column scrolls together rather than stacking visually with the milestones. */
function LedgerColumn({ escrow, role, onChange, optimistic, setOpt, clearOpt }) {
  return (
    <aside className="lg:col-span-1 flex flex-col gap-6">
      <div className="bg-background-secondary dark:bg-white/[0.01] border border-border-subtle rounded-2xl p-6 backdrop-blur-sm h-fit flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-medium">Total Locked</span>
          <div className="font-mono tabular-nums font-bold text-3xl text-text-primary leading-tight">
            {formatUSDCNumber(escrow.totalAmount)}
            <span className="text-base font-sans font-medium text-text-secondary ml-2">USDC</span>
          </div>
        </div>

        <div className="flex flex-col">
          <ParamRow label="Payer Address">
            <AddressInline address={escrow.depositor} />
          </ParamRow>
          <ParamRow label="Freelancer Address">
            <AddressInline address={escrow.recipient} />
          </ParamRow>
          <ParamRow label="Arbiter Status">
            <span className="text-sm text-text-primary">Decentralized Panel</span>
          </ParamRow>
          <ParamRow label="Gas Asset">
            <span className="text-sm text-text-primary">{gasAssetLabel(escrow.destinationDomain)}</span>
          </ParamRow>
          <ParamRow label="Destination">
            <span className="text-sm text-text-primary">{getDomainName(escrow.destinationDomain)}</span>
          </ParamRow>
          <ParamRow label="Deadline">
            <DeadlineCell deadline={escrow.deadline} />
          </ParamRow>
          <ParamRow label="Dispute Window">
            <span className="text-sm text-text-primary">{formatWindow(escrow.disputeWindow)}</span>
          </ParamRow>
          <ParamRow label="Contract Suffix" last>
            <span className="font-mono text-xs text-text-secondary tracking-tight">
              {contractSuffix(escrow.invoiceHash)}
            </span>
          </ParamRow>
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
      </div>

      {role && escrow.state === 0 && (
        <CancelCard
          escrow={escrow} role={role} onChange={onChange}
          optimistic={optimistic} setOpt={setOpt} clearOpt={clearOpt}
        />
      )}
      {role === 'freelancer' && escrow.state === 0 && (
        <UpdateReceivingAddressCard escrow={escrow} onChange={onChange} />
      )}
    </aside>
  )
}

function ParamRow({ label, last = false, children }) {
  return (
    <div className={`flex justify-between items-center py-3 text-sm ${last ? '' : 'border-b border-border-subtle/50'}`}>
      <span className="text-text-secondary">{label}</span>
      <div className="text-right min-w-0">{children}</div>
    </div>
  )
}

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

function DeadlineCell({ deadline }) {
  const passed = Number(deadline) * 1000 < Date.now()
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-mono tabular-nums text-sm text-text-primary">{formatDeadline(deadline)}</span>
      <span className={`text-xs font-mono tabular-nums ${passed ? 'text-status-error' : 'text-text-tertiary'}`}>
        {countdown(deadline)}
      </span>
    </div>
  )
}

// "USDC (Native Arc Gas)" maps to the native-USDC-as-gas property of Arc
// specifically — every other chain uses its own native asset for gas with USDC
// as the value asset.
function gasAssetLabel(destinationDomain) {
  const d = Number(destinationDomain)
  if (d === ARC_DOMAIN) return 'USDC (Native Arc Gas)'
  return `USDC · ${getDomainName(d)} gas`
}

// Reasonable binding for "Contract Suffix": last 4 bytes of the invoice hash,
// which is the part most likely to differ between escrows in a UI listing.
function contractSuffix(invoiceHash) {
  if (!invoiceHash || invoiceHash === ZERO_BYTES32) return '—'
  return invoiceHash.slice(-10)
}

/* ---------- Column 2 — Milestone stack ----------
   Each milestone is a vertical card. Left side carries title, copy, and the
   release value. Right side carries the single most relevant action button —
   premium glowing accent when actionable, solid success checkmark when
   released, muted dash when refunded/cancelled. Open disputes drop the inline
   dispute resolution UI directly below the action area so evidence and
   counter-evidence stay attached to their milestone. */
function MilestoneStack({
  escrow, milestones, role,
  disputeWindowExpired, deliverySignaled, effectiveDisputeDeadlines,
  optimistic, onChange, setOpt, clearOpt, openTribunal
}) {
  return (
    <div className="bg-background-secondary dark:bg-white/[0.01] border border-border-subtle rounded-2xl p-6">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="text-base font-semibold text-text-primary tracking-tight">Milestones</h2>
        <span className="text-xs font-mono tabular-nums text-text-tertiary uppercase tracking-widest">
          {milestones.filter((m) => m.state === 3).length} / {milestones.length} released
        </span>
      </div>

      <div className="flex flex-col gap-4">
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
                <MilestoneRow
                  escrow={escrow}
                  milestone={m}
                  role={role}
                  disputeWindowExpired={!!disputeWindowExpired[i]}
                  deliverySignaled={!!deliverySignaled[i] || opt?.signaledDelivery}
                  effectiveDisputeDeadline={Number(effectiveDisputeDeadlines[i] || 0n)}
                  optimisticBadge={opt?.badge}
                  onChange={onChange}
                  setOpt={setOpt}
                  clearOpt={clearOpt}
                  openTribunal={openTribunal}
                />
              </motion.div>
            )
          })}
        </AnimatePresence>
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

function MilestoneRow({
  escrow, milestone, role,
  disputeWindowExpired, deliverySignaled, effectiveDisputeDeadline,
  optimisticBadge, onChange, setOpt, clearOpt, openTribunal
}) {
  const titles = loadMilestoneTitles(escrow.id)
  const title = titles[milestone.index] || `Milestone ${milestone.index + 1}`

  const noticeDeadline = deliverySignaled
    ? Number(milestone.deliveredAt) + Number(escrow.deliveryNoticeWindow)
    : 0
  const now = Math.floor(Date.now() / 1000)
  const deadlinePassed = Number(escrow.deadline) > 0 && now > Number(escrow.deadline)

  const description = describeMilestone(milestone, {
    deliverySignaled, noticeDeadline, disputeWindowExpired, effectiveDisputeDeadline
  })

  return (
    <div className="border border-border-subtle bg-black/[0.01] dark:bg-white/[0.005] rounded-xl p-5 relative">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
              M{milestone.index + 1}
            </span>
            <h3 className="text-base font-semibold text-text-primary truncate">{title}</h3>
            {optimisticBadge && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border border-accent/30 bg-accent-muted text-accent">
                {optimisticBadge}
              </span>
            )}
          </div>

          {description && (
            <p className="text-sm text-text-secondary leading-relaxed">{description}</p>
          )}

          <div className="font-mono tabular-nums text-xl font-bold text-text-primary mt-1">
            {formatUSDCNumber(milestone.amount)}
            <span className="text-sm font-sans font-medium text-text-secondary ml-1.5">USDC</span>
          </div>

          {(deliverySignaled && Number(milestone.deliveredAt) > 0) || Number(milestone.conditionMetTimestamp) > 0 ? (
            <div className="flex flex-wrap gap-4 text-xs mt-1">
              {deliverySignaled && Number(milestone.deliveredAt) > 0 && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-text-tertiary text-[10px] uppercase tracking-wider">Delivered</span>
                  <span className="font-mono tabular-nums text-text-secondary">{formatTimestamp(milestone.deliveredAt)}</span>
                </div>
              )}
              {Number(milestone.conditionMetTimestamp) > 0 && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-text-tertiary text-[10px] uppercase tracking-wider">Approved</span>
                  <span className="font-mono tabular-nums text-text-secondary">{formatTimestamp(milestone.conditionMetTimestamp)}</span>
                </div>
              )}
            </div>
          ) : null}

          {milestone.state === 1 && effectiveDisputeDeadline > 0 && !disputeWindowExpired && (
            <Countdown label="Dispute window closes" target={effectiveDisputeDeadline} tone="warning" />
          )}
          {milestone.state === 0 && noticeDeadline > 0 && (
            <Countdown label="Auto-releases in" target={noticeDeadline} tone="warning" />
          )}
        </div>

        <div className="shrink-0 flex flex-col items-end gap-2">
          <MilestoneStateGlyph state={milestone.state} />
          <MilestoneAction
            escrow={escrow}
            milestone={milestone}
            role={role}
            deadlinePassed={deadlinePassed}
            disputeWindowExpired={disputeWindowExpired}
            deliverySignaled={deliverySignaled}
            noticeDeadline={noticeDeadline}
            setOpt={setOpt}
            clearOpt={clearOpt}
            onChange={onChange}
          />
        </div>
      </div>

      {milestone.state === 2 && (
        <button
          type="button"
          onClick={openTribunal}
          className="mt-4 pt-4 border-t border-status-warning/30 w-full flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] font-medium text-status-warning hover:opacity-80 transition-opacity"
        >
          <span className="inline-flex items-center gap-2">
            <ShieldIcon size={12} /> Resolve in Tribunal Room
          </span>
          <span aria-hidden>→</span>
        </button>
      )}
    </div>
  )
}

function describeMilestone(m, { deliverySignaled, disputeWindowExpired }) {
  if (m.state === 0 && !deliverySignaled) return 'Awaiting freelancer delivery.'
  if (m.state === 0 && deliverySignaled) return 'Delivery signaled. Payer review pending.'
  if (m.state === 1 && !disputeWindowExpired) return 'Approved and queued for release. Dispute window still open.'
  if (m.state === 1 && disputeWindowExpired) return 'Dispute window closed. Ready to release.'
  if (m.state === 2) return 'In review by the arbiter panel. See evidence below.'
  if (m.state === 3) return 'Released to the freelancer.'
  if (m.state === 4) return 'Refunded to the payer.'
  return null
}

function MilestoneStateGlyph({ state }) {
  if (state === 3) {
    return (
      <span className="inline-flex items-center gap-1.5 text-status-success text-xs font-medium">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-status-success/15 border border-status-success/30">
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M3 7.5l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        Released
      </span>
    )
  }
  if (state === 4) {
    return (
      <span className="inline-flex items-center gap-1.5 text-text-tertiary text-xs font-medium">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-background-tertiary border border-border-subtle">
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M3 7h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </span>
        Refunded
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border border-border-subtle bg-background-tertiary text-text-secondary tracking-wide">
      {MILESTONE_LABELS[state]}
    </span>
  )
}

/* ----- Premium milestone action -----
   Single most relevant action per role/state. Glowing accent for primary
   positive actions; warning tone reserved for the dispute portal at the
   bottom of the page so the inline action stays positive-leaning. */
function MilestoneAction({
  escrow, milestone, role, deadlinePassed, disputeWindowExpired,
  deliverySignaled, noticeDeadline, setOpt, clearOpt, onChange
}) {
  const [activeKey, setActiveKey] = useState(null)
  const tx = useTx({
    onConfirmed: () => { onChange?.(); setActiveKey(null) },
    onReverted: () => { setActiveKey(null); clearOpt(`milestone_${milestone.index}`) }
  })

  const id = BigInt(escrow.id)
  const idx = BigInt(milestone.index)
  const now = Math.floor(Date.now() / 1000)
  const isPayer = role === 'payer'
  const isFreelancer = role === 'freelancer'

  // Pick the single highest-priority action available to this caller right now.
  let action = null
  if (milestone.state === 0) {
    if (isFreelancer && !deliverySignaled && !deadlinePassed) {
      action = { key: 'signal', label: 'Mark as Delivered', fn: 'signalDelivery', args: [id, idx], optimistic: { badge: 'Signaled', signaledDelivery: true } }
    } else if (isPayer && deliverySignaled) {
      action = { key: 'approve', label: 'Approve & Release', fn: 'fulfillCondition', args: [id, idx], optimistic: { badge: 'Approving…' } }
    } else if (noticeDeadline > 0 && now > noticeDeadline) {
      action = { key: 'silent', label: 'Claim Auto-Release', fn: 'claimSilentApproval', args: [id, idx], optimistic: { badge: 'Releasing…' } }
    }
  } else if (milestone.state === 1) {
    if (disputeWindowExpired) {
      action = { key: 'release', label: 'Release Payment', fn: 'releaseAfterWindow', args: [id, idx, 0n], optimistic: { badge: 'Releasing…' } }
    }
  }

  if (!action) return null

  const run = async () => {
    setActiveKey(action.key)
    setOpt(`milestone_${milestone.index}`, action.optimistic)
    try {
      await tx.run(escrowWrite(action.fn, action.args), { loadingMessage: 'Check your wallet.' })
    } catch {
      clearOpt(`milestone_${milestone.index}`)
    }
  }

  const isLoading = activeKey === action.key && tx.isBusy
  return (
    <button
      type="button"
      onClick={run}
      disabled={tx.isBusy}
      className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-accent-blue text-white rounded-xl font-medium text-sm shadow-[0_4px_12px_rgba(51,119,255,0.3)] hover:bg-accent-blue/90 transition-all disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
    >
      {isLoading && (
        <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />
      )}
      {isLoading ? 'Pending…' : action.label}
    </button>
  )
}

/* Live countdown — pulses the digits subtly to feel active without being noisy.
   Smaller than the amount, monospace, muted accent. */
function Countdown({ label, target, tone = 'warning' }) {
  const toneCls = tone === 'warning' ? 'text-status-warning' : 'text-accent'
  const dotCls = tone === 'warning' ? 'bg-status-warning' : 'bg-accent'
  const value = countdown(target).replace(' remaining', '')
  return (
    <div className="rounded-xl bg-background-tertiary px-3 py-2.5 flex items-center justify-between gap-3 mt-2">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dotCls} animate-pulse`} aria-hidden />
        <span className="text-xs text-text-secondary">{label}</span>
      </div>
      <span className={`font-mono tabular-nums text-sm font-semibold ${toneCls}`}>{value}</span>
    </div>
  )
}

/* ---------- Tribunal Room (right-column tab) ----------
   Two modes:
   - NO_DISPUTE  → stark "Halt Contract" portal that opens an initiation form
   - ACTIVE      → split evidence desk; if multiple milestones are disputed, a
                   small chip switcher picks which case to view; arbiter-only
                   block at the bottom resolves with double-confirmation.
   The page-level "is disputed" predicate is "any milestone in state 2", which
   matches the on-chain model where disputes are per-milestone. */
function TribunalRoom({ escrow, milestones, disputes, role, isArbiter, userAddress, onChange }) {
  const disputedMilestones = useMemo(
    () => milestones.filter((m) => m.state === 2),
    [milestones]
  )

  if (disputedMilestones.length === 0) {
    return (
      <NoDisputeState
        escrow={escrow}
        milestones={milestones}
        role={role}
        onChange={onChange}
      />
    )
  }

  return (
    <ActiveDisputeDesk
      escrow={escrow}
      disputedMilestones={disputedMilestones}
      disputes={disputes}
      role={role}
      isArbiter={isArbiter}
      userAddress={userAddress}
      onChange={onChange}
    />
  )
}

/* ---------- Tribunal Room — NO DISPUTE state ----------
   Stark error-tinted portal. Click "Halt Contract" to expose an inline form for
   picking a milestone, pinning an IPFS evidence path, and signing the on-chain
   commitment. Hidden entirely if the caller is not a party to the escrow or no
   milestone is in a disputable state. */
function NoDisputeState({ escrow, milestones, role, onChange }) {
  const [initiating, setInitiating] = useState(false)
  const [milestoneIdx, setMilestoneIdx] = useState(null)
  const [reason, setReason] = useState('')
  const [uri, setUri] = useState('')

  const now = Math.floor(Date.now() / 1000)
  const disputable = useMemo(() => milestones.filter((m) => {
    if (m.state === 1) return true
    if (m.state === 0 && Number(escrow.deadline) > 0 && now > Number(escrow.deadline)) return true
    return false
  }), [milestones, escrow.deadline, now])

  const options = useMemo(() =>
    disputable.map((m) => ({
      value: m.index,
      label: `M${m.index + 1} — ${formatUSDC(m.amount)} (${MILESTONE_LABELS[m.state]})`
    })),
    [disputable]
  )

  useEffect(() => {
    if (initiating && milestoneIdx === null && disputable.length > 0) {
      setMilestoneIdx(disputable[0].index)
    }
  }, [initiating, milestoneIdx, disputable])

  const selected = milestones.find((m) => m.index === milestoneIdx)
  const isEscalation = selected?.state === 0
  const fnName = isEscalation ? 'escalateAfterDeadline' : 'raiseDispute'

  const tx = useTx({
    onConfirmed: () => {
      onChange?.()
      setReason(''); setUri(''); setInitiating(false); setMilestoneIdx(null)
    }
  })

  const submit = () => {
    if (!selected) return
    const evidenceHash = keccak256(toBytes(reason + '|' + uri))
    return tx.run(
      escrowWrite(fnName, [BigInt(escrow.id), BigInt(selected.index), reason, evidenceHash, uri]),
      { loadingMessage: 'Committing dispute on-chain. Check your wallet.' }
    )
  }

  const submitDisabled = !selected || !reason.trim() || !uri.trim() || tx.isBusy
  const canInitiate = !!role && escrow.state === 0 && disputable.length > 0

  return (
    <div className="bg-status-error/5 border border-status-error/10 rounded-2xl p-8 backdrop-blur-sm flex flex-col items-center justify-center text-center">
      <div className="w-16 h-16 rounded-full bg-status-error/10 text-status-error flex items-center justify-center mb-4 shadow-[0_0_24px_rgba(220,38,38,0.18)]">
        <ShieldIcon size={28} />
      </div>

      <h3 className="text-lg font-semibold text-text-primary tracking-tight">
        Halt Contract &amp; Initiate Dispute.
      </h3>
      <p className="text-sm text-text-secondary leading-relaxed mt-2 max-w-md">
        This action freezes all funds and summons the decentralized arbiter panel.
        You must provide an IPFS hash of your cryptographic evidence.
      </p>

      {!initiating && (
        <button
          type="button"
          onClick={() => setInitiating(true)}
          disabled={!canInitiate}
          className="mt-6 inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl border border-status-error text-status-error hover:bg-status-error/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <ShieldIcon size={14} /> Halt Contract &amp; Initiate Dispute
        </button>
      )}

      {!canInitiate && !initiating && (
        <p className="mt-4 text-[11px] text-text-tertiary">
          {!role
            ? 'Only the payer or freelancer can open a dispute.'
            : escrow.state !== 0
              ? 'Escrow is closed — no disputes can be opened.'
              : 'No milestones are currently in a disputable state.'}
        </p>
      )}

      <AnimatePresence initial={false}>
        {initiating && (
          <motion.div
            key="initiate-form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden w-full mt-6 text-left"
          >
            <div className="border border-status-error/15 bg-background-secondary dark:bg-white/[0.01] rounded-2xl p-5 flex flex-col gap-4">
              <p className="text-xs text-text-secondary leading-relaxed">
                Disputes are permanent. Once submitted, the evidence hash is written to the Arc blockchain
                and the milestone moves into arbiter review. You can't withdraw or edit what you commit here.
              </p>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-secondary">Milestone</label>
                <CustomSelect
                  value={milestoneIdx ?? ''}
                  onChange={(v) => setMilestoneIdx(Number(v))}
                  options={options}
                  placeholder="Select a milestone"
                />
                {selected && isEscalation && (
                  <span className="text-[11px] text-status-warning mt-1">
                    Deadline has passed — this will escalate the milestone to the arbiter.
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-secondary">IPFS Evidence Path</label>
                <input
                  className="input-field font-mono tabular-nums text-sm"
                  placeholder="ipfs://… or https://…"
                  value={uri}
                  onChange={(e) => setUri(e.target.value.trim())}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-secondary">Legal Description</label>
                <textarea
                  rows={4}
                  className="input-field-multiline"
                  placeholder="State the facts of the dispute. This text is hashed onto the chain as part of your evidence commitment."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => { setInitiating(false); setReason(''); setUri('') }}
                  disabled={tx.isBusy}
                  className="text-sm text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitDisabled}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-status-error text-status-error hover:bg-status-error/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  {tx.isBusy && (
                    <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current/40 border-t-current animate-spin" aria-hidden />
                  )}
                  {tx.isBusy ? 'Committing…' : isEscalation ? 'Commit Escalation' : 'Commit Dispute'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---------- Tribunal Room — ACTIVE DISPUTE state ----------
   Header with pulsing red dot, optional case switcher when multiple milestones
   are in dispute, then the per-case evidence desk. */
function ActiveDisputeDesk({
  escrow, disputedMilestones, disputes, role, isArbiter, userAddress, onChange
}) {
  const [selectedIdx, setSelectedIdx] = useState(disputedMilestones[0].index)

  // If the on-chain set of disputed milestones changes (e.g. one resolves), and
  // the previously selected milestone is no longer disputed, snap to the first.
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
        role={role}
        isArbiter={isArbiter}
        userAddress={userAddress}
        onChange={onChange}
      />
    </div>
  )
}

function DisputeCaseDesk({ escrow, milestone, dispute, role, isArbiter, userAddress, onChange }) {
  const [counterUri, setCounterUri] = useState('')
  const [counterReason, setCounterReason] = useState('')

  const counterTx = useTx({ onConfirmed: () => onChange?.() })

  const disputedBy = dispute?.disputedBy
  const isDisputer = disputedBy?.toLowerCase() === userAddress?.toLowerCase()
  const counterMissing = !dispute?.counterEvidenceHash || dispute.counterEvidenceHash === ZERO_BYTES32
  const canCounter = !!role && !isDisputer && counterMissing

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

  const submitCounter = () => {
    const hash = keccak256(toBytes(counterReason + '|' + counterUri))
    return counterTx.run(
      escrowWrite('submitCounterEvidence', [BigInt(escrow.id), BigInt(milestone.index), hash, counterUri]),
      { loadingMessage: 'Submitting. Check your wallet.' }
    )
  }

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

      {/* Counter-evidence prompt for the non-disputing party */}
      {canCounter && (
        <div className="rounded-2xl border border-border-subtle bg-background-secondary dark:bg-white/[0.01] p-5 backdrop-blur-sm flex flex-col gap-3">
          <h4 className="text-xs uppercase tracking-[0.18em] text-text-tertiary font-medium">
            Submit your counter-evidence
          </h4>
          <textarea
            rows={3}
            className="input-field-multiline"
            placeholder="Explain your side of the case."
            value={counterReason}
            onChange={(e) => setCounterReason(e.target.value)}
          />
          <input
            className="input-field font-mono tabular-nums text-sm"
            placeholder="ipfs://… (evidence URL)"
            value={counterUri}
            onChange={(e) => setCounterUri(e.target.value.trim())}
          />
          <TxButton
            className="btn-primary text-sm py-2 self-start"
            onClick={submitCounter}
            disabled={!counterReason.trim() || !counterUri.trim()}
            loading={counterTx.isBusy}
            label="Submit counter-evidence"
          />
        </div>
      )}

      {/* Arbiter-only resolution block with double-confirmation */}
      {isArbiter && (
        <ArbiterDecisionBlock
          escrowId={escrow.id}
          milestoneIdx={milestone.index}
          onResolved={onChange}
        />
      )}
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

/* Arbiter-only decision block. Lives below the evidence desk and demands a
   bytes32 resolution hash plus a double-confirm step before executing. */
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

/* ---------- Cancel by mutual agreement ---------- */
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
    <div className="bg-background-secondary dark:bg-white/[0.01] border border-border-subtle rounded-2xl p-5 backdrop-blur-sm flex flex-col gap-3">
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

/* ---------- Receiving address (inline-edit card) ---------- */
function UpdateReceivingAddressCard({ escrow, onChange }) {
  const [editing, setEditing] = useState(false)
  const [addr, setAddr] = useState('')
  const [domain, setDomain] = useState(() => Number(escrow.destinationDomain ?? ARC_DOMAIN))
  const [successInfo, setSuccessInfo] = useState(null)
  const { supported } = useSupportedDomains()

  const currentAddress = escrow.mintRecipient ? bytes32ToAddress(escrow.mintRecipient) : null
  const currentDomain = Number(escrow.destinationDomain)

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
    <div className="bg-background-secondary dark:bg-white/[0.01] border border-border-subtle rounded-2xl p-5 backdrop-blur-sm flex flex-col gap-4">
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
        {currentAddress ? <AddressInline address={currentAddress} /> : <span className="text-sm text-text-tertiary">—</span>}
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

/* ---------- Loading skeleton ---------- */
function EscrowDetailSkeleton() {
  return (
    <div className="flex flex-col">
      <Skeleton className="h-4 w-32 mb-6" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-7 w-44 rounded-full" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-6">
        <aside className="lg:col-span-1 flex flex-col gap-6">
          <Skeleton className="h-96" />
        </aside>
        <section className="lg:col-span-2 flex flex-col gap-4">
          <SkeletonMilestoneCard />
          <SkeletonMilestoneCard />
          <SkeletonMilestoneCard />
        </section>
      </div>
    </div>
  )
}

/* ---------- Icons + small primitives ---------- */
function ArrowLeft({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="19" y1="12" x2="5" y2="12"/>
      <polyline points="12 19 5 12 12 5"/>
    </svg>
  )
}

function CopyIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  )
}

function CheckIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12"/>
    </svg>
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

function ChevronIcon({ size = 14, open = false }) {
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
      aria-hidden
      className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
    >
      <polyline points="6 9 12 15 18 9"/>
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
