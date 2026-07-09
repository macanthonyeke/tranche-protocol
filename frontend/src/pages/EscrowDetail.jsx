import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAccount, useReadContract } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

import ConnectGate from '../components/ConnectGate.jsx'
import IconButton from '../components/IconButton.jsx'
import Modal from '../components/Modal.jsx'
import Field from '../components/Field.jsx'
import Skeleton, { SkeletonMilestoneCard } from '../components/Skeleton.jsx'
import EditableRow from '../components/EditableRow.jsx'
import { useEscrowDetail, useDisputeConfig, useSettlementProposals, useTick } from '../hooks/useEscrows.js'
import { useSupportedDomains } from '../hooks/useSupportedDomains.js'
import { useProtocolConfig } from '../hooks/useArbiter.js'
import { useTx, escrowWrite } from '../hooks/useTx.js'
import { useToast } from '../hooks/useToast.jsx'
import { resolveMaxFee } from '../utils/cctpFee.js'
import { bytes32ToAddress, hashDescription, hashBytes } from '../utils/encode.js'
import { cctpTrackKey, encodeReceiveMessage } from '../utils/irisDelivery.js'
import {
  isValidAddress, isValidUrl, formatUSDCNumber, formatDeadline, formatTimestamp,
  formatWindow, countdown, truncateAddr, explorerAddr, ESCROW_LABELS, MILESTONE_LABELS,
  NO_ATTACHMENT_URI
} from '../utils/format.js'
import {
  getDomainName, ARC_DOMAIN, isEvmDomain,
  getChainExplorerTx, MESSAGE_TRANSMITTER_V2, EVM_CHAIN_PARAMS
} from '../config/chains.js'
import { useCctpDelivery } from '../hooks/useCctpDelivery.js'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract.js'
import { GOLDSKY_ENABLED, fetchEscrowTitles, fetchMilestoneReleaseTxs } from '../lib/goldsky.js'
import { useEscrowInvoice } from '../hooks/useEscrows.js'
import InvoiceCard from '../components/InvoiceCard.jsx'

const addressToBytes32 = (addr) => '0x' + addr.slice(2).padStart(64, '0')
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const POLL_MS = 12_000
// Must match DELIVERY_GRACE_PERIOD in TrancheProtocol.sol — update both if either changes.
const DELIVERY_GRACE_PERIOD = 72 * 60 * 60

function useIntCountUp(target, duration = 800) {
  const [value, setValue] = useState(target)
  const reduce = useReducedMotion()
  const prevRef = useRef(target)
  useEffect(() => {
    if (reduce || target === prevRef.current) { setValue(target); prevRef.current = target; return }
    const from = prevRef.current
    const start = performance.now()
    let raf
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(from + (target - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
      else { setValue(target); prevRef.current = target }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, reduce])
  return value
}

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

  // After a tx confirms, poll at 3s until state updates or 30s elapses.
  const [fastPollUntil, setFastPollUntil] = useState(null)
  const fastPollActive = fastPollUntil != null && Date.now() < fastPollUntil
  useEffect(() => {
    if (!fastPollUntil) return
    const remaining = fastPollUntil - Date.now()
    if (remaining <= 0) { setFastPollUntil(null); return }
    const t = setTimeout(() => setFastPollUntil(null), remaining)
    return () => clearTimeout(t)
  }, [fastPollUntil])

  const { detail, isLoading, error, refetch } = useEscrowDetail(id, address, { pollMs: fastPollActive ? 3_000 : POLL_MS })
  useTick(15_000)

  // Optimistic overlays keep the UI responsive while a tx is in flight; cleared
  // on the next fresh on-chain read.
  const [optimistic, setOptimistic] = useState({})
  const setOpt = (key, value) => setOptimistic((o) => ({ ...o, [key]: value }))
  const clearOpt = (key) =>
    setOptimistic((o) => { const next = { ...o }; delete next[key]; return next })
  useEffect(() => { if (detail) setOptimistic({}) }, [detail])

  const handleChange = useCallback(() => {
    setFastPollUntil(Date.now() + 30_000)
    refetch()
  }, [refetch])

  // Focus-bar "jump to milestone": expand it (via MilestoneStack's imperative
  // openRef), flash a clay ring for ~1.5s, and scroll to the row itself
  // (a scoped element scroll, not scrollIntoView against the whole page).
  const openRef = useRef(null)
  const [flashIndex, setFlashIndex] = useState(null)
  const reduceMotion = useReducedMotion()
  // Below `lg`, the two desktop columns become a Milestones / Details & terms
  // tab (see the mobile tab bar below) instead of stacking into one long
  // scroll; jumping to a milestone switches back to Milestones first.
  const [mobileTab, setMobileTab] = useState('milestones')
  const jump = useCallback((index) => {
    openRef.current?.(index)
    setFlashIndex(index)
    setMobileTab('milestones')
    setTimeout(() => {
      document.getElementById(`milestone-${index}`)?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth', block: 'center'
      })
    }, 60)
    setTimeout(() => setFlashIndex(null), 1500)
  }, [reduceMotion])

  const detailHasInvoice = detail
    ? !!(detail.escrow.invoiceHash && detail.escrow.invoiceHash !== ZERO_BYTES32)
    : false
  const { invoiceAcknowledgedAt: ackAt, refetch: refetchInvoice } = useEscrowInvoice(detailHasInvoice ? detail.escrow.id : null)

  // The acknowledgment timestamp comes from the subgraph, which lags the
  // confirmed tx. Hide the accept/decline banner the instant the recipient's
  // acknowledge tx confirms, rather than waiting for the indexer to catch up.
  const [localAck, setLocalAck] = useState(false)

  if (isLoading) return <EscrowDetailSkeleton />
  if (!detail) {
    const isNotFound = !error || error?.cause?.data?.errorName === 'EscrowDoesNotExist'
    return (
      <div className="card-surface p-12 text-center">
        {isNotFound ? (
          <>
            <h2 className="text-xl font-semibold mb-2">Escrow not found</h2>
            <p className="text-sm text-ink-2">There is no escrow with ID #{id}.</p>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold mb-2">Couldn't load this escrow</h2>
            <p className="text-sm text-ink-2 mb-4">Something went wrong. Check your connection and try again.</p>
            <button type="button" className="btn-secondary text-sm" onClick={refetch}>Retry</button>
          </>
        )}
      </div>
    )
  }

  const {
    escrow, milestones, disputes, splits, reviewWindowExpired, claimed,
    reviewDeadlines, isPayer, isFreelancer
  } = detail
  const role = isPayer ? 'payer' : isFreelancer ? 'freelancer' : null

  return (
    <div className="flex flex-col">
      <InspectionHeader escrow={escrow} />

      {role && (
        <div className="mt-6">
          <FocusBar
            escrow={escrow}
            milestones={milestones}
            role={role}
            reviewWindowExpired={reviewWindowExpired}
            onJump={jump}
          />
        </div>
      )}

      <div role="tablist" aria-label="Escrow sections" className="lg:hidden mt-6 flex items-center gap-1 p-1 bg-sunk rounded-xl">
        {[['milestones', 'Milestones'], ['details', 'Details & terms']].map(([key, label]) => {
          const active = mobileTab === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setMobileTab(key)}
              className={`relative flex-1 inline-flex items-center justify-center min-h-9 px-3.5 py-2 text-sm font-medium rounded-lg
                transition-colors duration-200
                focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-sunk
                ${active ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}
            >
              {active && (
                <motion.span
                  layoutId="mobile-tab-pill"
                  className="absolute inset-0 rounded-lg bg-paper shadow-sm"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <span className="relative">{label}</span>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.75fr)_minmax(320px,1fr)] gap-8 mt-6">
        <div className={`flex-col gap-4 lg:order-1 lg:flex ${mobileTab === 'milestones' ? 'flex' : 'hidden'}`}>
          {isFreelancer && escrow.state === 0 && detailHasInvoice && !ackAt && !localAck && (
            <AckBanner
              escrow={escrow}
              onChange={handleChange}
              onAcknowledged={() => { setLocalAck(true); refetchInvoice?.() }}
            />
          )}
          <MilestoneStack
            escrow={escrow}
            milestones={milestones}
            disputes={disputes}
            role={role}
            userAddress={address}
            reviewWindowExpired={reviewWindowExpired}
            claimed={claimed}
            reviewDeadlines={reviewDeadlines}
            optimistic={optimistic}
            onChange={handleChange}
            setOpt={setOpt}
            clearOpt={clearOpt}
            flashIndex={flashIndex}
            openRef={openRef}
          />
        </div>

        <div className={`lg:order-2 lg:block ${mobileTab === 'details' ? 'block' : 'hidden'}`}>
          <LedgerColumn
            escrow={escrow}
            role={role}
            splits={splits}
            onChange={handleChange}
            optimistic={optimistic}
            setOpt={setOpt}
            clearOpt={clearOpt}
          />
        </div>
      </div>
    </div>
  )
}

/* ---------- Header backrow ----------
   Back-to-grid affordance, invoice title with copy, state-glow pill on the
   right. The pill shows the protocol host chain (Arc) since the escrow contract
   itself lives there — the destinationDomain (where the freelancer receives)
   is surfaced separately in the ledger column. */
function InspectionHeader({ escrow }) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  const displayId = `#${escrow.id}`
  const invTag = escrow.invoiceHash && escrow.invoiceHash !== ZERO_BYTES32
    ? `INV-${escrow.invoiceHash.slice(2, 6).toUpperCase()}`
    : null

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  return (
    <>
      <button
        type="button"
        onClick={() => navigate('/dashboard')}
        className="flex items-center gap-2 text-sm text-ink-2 hover:text-ink transition-colors mb-6"
      >
        <ArrowLeft size={16} /> Back to Escrows
      </button>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-3xl font-mono font-bold text-ink tracking-tight">
            {displayId}
          </h1>
          {invTag && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-sunk border border-rule font-mono text-xs text-ink-2 tracking-tight shrink-0">
              {invTag}
            </span>
          )}
          <IconButton
            onClick={onCopy}
            label="Copy escrow ID"
            title={copied ? 'Copied' : 'Copy ID'}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </IconButton>
        </div>

        <StateGlowPill state={escrow.state} />
      </div>
    </>
  )
}

function StateGlowPill({ state }) {
  const verb = ESCROW_LABELS[state] ?? 'Active'
  const tone = state === 1
    ? { dot: 'bg-ok', text: 'text-ok', ring: 'border-ok/30 bg-ok/10' }
    : state === 2
    ? { dot: 'bg-ink-3', text: 'text-ink-3', ring: 'border-rule bg-sunk' }
    : { dot: 'bg-clay', text: 'text-clay', ring: 'border-clay/30 bg-clay-soft/40' }
  const pulse = state === 0 ? 'animate-pulse' : ''
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${tone.ring} ${tone.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot} ${pulse}`} aria-hidden />
      {verb} on Arc Network
    </span>
  )
}

/* ---------- Invoice acknowledgment banner ----------
   Shown to the freelancer when the escrow is active, has an invoice, and the
   recipient hasn't yet emitted InvoiceAcknowledged on-chain. */
function AckBanner({ escrow, onChange, onAcknowledged }) {
  const acceptTx = useTx({ onConfirmed: () => { onAcknowledged?.(); onChange?.() } })
  const declineTx = useTx({ onConfirmed: () => onChange?.() })
  const busy = acceptTx.isBusy || declineTx.isBusy
  return (
    <div className="bg-paper border border-clay/30 rounded-2xl p-6 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-ink">Review and accept the invoice terms</h2>
        <p className="text-sm text-ink-2 leading-relaxed">
          The payer has committed to these terms on-chain. Accepting creates a record that you agreed to this scope.
        </p>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          className="btn-primary text-sm py-2"
          disabled={busy}
          onClick={() => acceptTx.run(
            escrowWrite('acknowledgeInvoice', [BigInt(escrow.id)]),
            { loadingMessage: 'Check your wallet.' }
          )}
        >
          {acceptTx.isBusy ? 'Working…' : 'Accept terms'}
        </button>
        <button
          type="button"
          className="btn-danger text-sm py-2"
          disabled={busy}
          onClick={() => declineTx.run(
            escrowWrite('declineEscrow', [BigInt(escrow.id)]),
            { loadingMessage: 'Check your wallet.' }
          )}
          title="Reject the whole escrow. Refunds the full amount to the payer — no protocol fee. Only available while every milestone is still pending."
        >
          {declineTx.isBusy ? 'Working…' : 'Decline escrow'}
        </button>
      </div>
    </div>
  )
}

/* ---------- Focus bar — "what to act on now" ----------
   Computes the single most relevant thing for the current viewer across all
   milestones, using the same computeMilestoneAction priority a milestone's
   own action button uses (defined near MilestoneAction, below). Priority:
   an action that's yours > an open dispute > a permissionless action anyone
   can trigger > nothing pending > escrow complete. */
function FocusBar({ escrow, milestones, role, reviewWindowExpired, onJump }) {
  const titles = useMilestoneTitles(escrow.id)

  if (escrow.state === 1) {
    return (
      <FocusBarShell
        tone="ok"
        eyebrow="Complete"
        title="This escrow is complete."
        body={`All ${formatUSDCNumber(escrow.totalAmount)} USDC has been released across ${milestones.length} milestone${milestones.length === 1 ? '' : 's'}. Nothing further is required.`}
      />
    )
  }
  if (escrow.state === 2) return null

  const now = Math.floor(Date.now() / 1000)
  const gracePassed = Number(escrow.deadline) > 0 && now > Number(escrow.deadline) + DELIVERY_GRACE_PERIOD

  let mine = null, disputed = null, permissionless = null
  milestones.forEach((m, i) => {
    const a = computeMilestoneAction(escrow, m, role, { reviewWindowExpired: !!reviewWindowExpired[i], gracePassed })
    if (a && !a.permissionless && !mine) mine = { m, a }
    if (m.state === 2 && !disputed) disputed = { m }
    if (a?.permissionless && !permissionless) permissionless = { m, a }
  })

  if (mine) {
    const { m, a } = mine
    const title = titles[m.index] || `Milestone ${m.index + 1}`
    const body = role === 'payer'
      ? `The freelancer marked "${title}" delivered. Approve to release ${formatUSDCNumber(m.amount)} USDC, or raise a dispute if it is not right.`
      : `Milestone ${m.index + 1} is ready. Mark it delivered to start the payer's ${formatWindow(escrow.reviewWindow)} review window.`
    return (
      <FocusBarShell tone="clay" eyebrow="Your move" title={`${a.label}, Milestone ${m.index + 1}`} body={body} cta={a.label} onClick={() => onJump(m.index)} />
    )
  }
  if (disputed) {
    return (
      <FocusBarShell
        tone="warn"
        eyebrow="Needs your attention"
        title={`Milestone ${disputed.m.index + 1} is in tribunal`}
        body="Review the evidence and propose a settlement. If neither side acts, the milestone settles automatically once the arbitration window closes."
        cta="Review dispute"
        onClick={() => onJump(disputed.m.index)}
      />
    )
  }
  if (permissionless) {
    const { m, a } = permissionless
    return (
      <FocusBarShell
        tone="neutral"
        eyebrow="Available now"
        title={`Milestone ${m.index + 1} can be ${a.key === 'refund' ? 'refunded' : 'released'}`}
        body={`${a.label} is permissionless now, anyone can trigger it.`}
        cta={a.label}
        onClick={() => onJump(m.index)}
      />
    )
  }

  const other = role === 'payer' ? 'the freelancer' : 'the payer'
  return (
    <FocusBarShell
      tone="neutral"
      eyebrow="Nothing needs you"
      title="You are all caught up."
      body={`Waiting on ${other}. The next action will show up here.`}
    />
  )
}

const FOCUS_TONE = {
  clay:    { bg: 'var(--clay-soft)', bd: 'color-mix(in oklch, var(--clay) 35%, transparent)', ac: 'var(--clay)' },
  warn:    { bg: 'color-mix(in oklch, var(--warn) 12%, transparent)', bd: 'color-mix(in oklch, var(--warn) 35%, transparent)', ac: 'var(--warn)' },
  ok:      { bg: 'color-mix(in oklch, var(--ok) 10%, transparent)', bd: 'color-mix(in oklch, var(--ok) 30%, transparent)', ac: 'var(--ok)' },
  neutral: { bg: 'var(--sunk)', bd: 'var(--rule)', ac: 'var(--ink-3)' }
}

function FocusBarShell({ tone, eyebrow, title, body, cta, onClick }) {
  const t = FOCUS_TONE[tone] ?? FOCUS_TONE.neutral
  return (
    <div
      className="rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-5"
      style={{ background: t.bg, borderColor: t.bd }}
    >
      <div className="flex items-start gap-3.5 min-w-0 sm:flex-1">
        <span
          className="rounded-md inline-flex items-center justify-center shrink-0 h-9 w-9 mt-0.5"
          style={{ background: 'color-mix(in oklch, var(--paper) 55%, transparent)', color: t.ac }}
        >
          <FocusIcon tone={tone} />
        </span>
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-0.5" style={{ color: t.ac }}>
            {eyebrow}
          </div>
          <div className="text-[15px] font-semibold text-ink mb-1">{title}</div>
          <p className="text-[13px] leading-relaxed text-ink-2 max-w-[60ch]">{body}</p>
        </div>
      </div>
      {cta && (
        <button
          type="button"
          onClick={onClick}
          className="inline-flex items-center justify-center gap-2 rounded-md px-4 h-10 w-full sm:w-auto shrink-0 font-medium text-[13.5px] transition-all active:scale-[0.98]"
          style={tone === 'warn'
            ? { background: 'transparent', color: 'var(--warn)', border: '1px solid color-mix(in oklch, var(--warn) 45%, transparent)' }
            : { background: 'var(--clay)', color: 'var(--paper)' }}
        >
          {cta}
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 10h11M11 6l4 4-4 4" />
          </svg>
        </button>
      )}
    </div>
  )
}

function FocusIcon({ tone }) {
  if (tone === 'ok') return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 10.5 8 14.5l8-9" />
    </svg>
  )
  if (tone === 'warn') return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 3v14M5 6h10M5 6 3 11h4zM15 6l-2 5h4zM6.5 17h7" />
    </svg>
  )
  if (tone === 'clay') return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  )
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 1.5" />
    </svg>
  )
}

/* ---------- Column 1 — Metadata & financial ledger ----------
   Locked amount up top, then a stack of border-separated parameter rows. The
   secondary cards (mutual cancel, receiving address) sit beneath so the whole
   column scrolls together rather than stacking visually with the milestones. */
function LedgerColumn({ escrow, role, splits, onChange, optimistic, setOpt, clearOpt }) {
  const hasInvoice = !!(escrow.invoiceHash && escrow.invoiceHash !== ZERO_BYTES32)
  const { invoiceData, invoiceAcknowledgedAt } = useEscrowInvoice(hasInvoice ? escrow.id : null)

  return (
    <aside className="lg:col-span-1 flex flex-col gap-6">
      <div className="bg-paper border border-rule rounded-2xl p-6 h-fit flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink-3 font-medium">Total Locked</span>
          <div className="font-mono tabular-nums font-bold text-3xl text-ink leading-tight">
            {formatUSDCNumber(escrow.totalAmount)}
            <span className="text-base font-sans font-medium text-ink-2 ml-2">USDC</span>
          </div>
        </div>

        <div className="flex flex-col">
          <ParamRow label="Payer Address">
            <AddressInline address={escrow.depositor} />
          </ParamRow>
          <ParamRow label="Freelancer Address">
            <AddressInline address={escrow.recipient} />
          </ParamRow>
          <ParamRow label="Arbiter">
            <span className="text-sm text-ink">Assigned protocol arbiter</span>
          </ParamRow>
          <ParamRow label="Payout chain">
            <span className="text-sm text-ink">{getDomainName(escrow.destinationDomain)}</span>
          </ParamRow>
          <ParamRow label="Deadline">
            <DeadlineCell deadline={escrow.deadline} />
          </ParamRow>
          <ParamRow label="Review window" last>
            <span className="text-sm text-ink">{formatWindow(escrow.reviewWindow)}</span>
          </ParamRow>
        </div>

        {hasInvoice && (
          <InvoiceCard
            escrowId={escrow.id}
            invoiceHash={escrow.invoiceHash}
            invoiceData={invoiceData}
            invoiceURI={escrow.invoiceURI}
            invoiceAcknowledgedAt={invoiceAcknowledgedAt}
            role={role === 'freelancer' ? 'recipient' : role ?? 'payer'}
          />
        )}
      </div>

      {splits?.length > 0 && <SplitRecipients splits={splits} escrow={escrow} />}

      {role && escrow.state === 0 && (
        <EditableParamsPanel escrow={escrow} role={role} splits={splits} hasInvoice={hasInvoice} onChange={onChange} />
      )}

      {role && escrow.state === 0 && (
        <CancelCard
          escrow={escrow} role={role} onChange={onChange}
          optimistic={optimistic} setOpt={setOpt} clearOpt={clearOpt}
        />
      )}
    </aside>
  )
}

/* ---------- Editable parameters ----------
   One place for every parameter the caller can change on a live escrow,
   built on the shared EditableRow primitive so the deadline / invoice link /
   receiving address / split address flows share one interaction pattern
   instead of four hand-rolled inline-edit cards. */
function EditableParamsPanel({ escrow, role, splits, hasInvoice, onChange }) {
  const { address } = useAccount()
  const mySplitIndex = role === 'freelancer' && splits
    ? splits.findIndex((s) => {
        const addr = s.mintRecipient ? bytes32ToAddress(s.mintRecipient) : null
        return addr && address && addr.toLowerCase() === address.toLowerCase()
      })
    : -1

  const rows = []
  if (role === 'payer') rows.push('deadline')
  if (role === 'payer' && hasInvoice) rows.push('invoice')
  if (role === 'freelancer') rows.push('receiving')
  if (role === 'freelancer' && mySplitIndex >= 0) rows.push('split')
  if (rows.length === 0) return null

  return (
    <div className="bg-paper border border-rule rounded-2xl p-5 flex flex-col gap-1">
      <h3 className="text-[11px] uppercase tracking-[0.18em] text-ink-3 font-medium">Editable parameters</h3>
      <p className="text-xs text-ink-3 leading-relaxed mb-1">Everything you can change on this live escrow, in one place.</p>
      <div className="flex flex-col">
        {rows.map((key, i) => {
          const last = i === rows.length - 1
          if (key === 'deadline') return <DeadlineEditRow key={key} escrow={escrow} onChange={onChange} last={last} />
          if (key === 'invoice') return <InvoiceLinkEditRow key={key} escrow={escrow} onChange={onChange} last={last} />
          if (key === 'receiving') return <ReceivingAddressEditRow key={key} escrow={escrow} onChange={onChange} last={last} />
          if (key === 'split') {
            const s = splits[mySplitIndex]
            return (
              <SplitAddressEditRow
                key={key}
                escrow={escrow}
                splitIndex={mySplitIndex}
                currentDomain={Number(s.destinationDomain)}
                currentAddress={s.mintRecipient ? bytes32ToAddress(s.mintRecipient) : null}
                pct={Number(s.bps) / 100}
                onChange={onChange}
                last={last}
              />
            )
          }
          return null
        })}
      </div>
    </div>
  )
}

function DeadlineEditRow({ escrow, onChange, last }) {
  const [saveNonce, setSaveNonce] = useState(0)
  const [successTs, setSuccessTs] = useState(null)
  const currentTs = Number(escrow.deadline)
  const minStr = useMemo(() => {
    const d = new Date((currentTs + 60) * 1000)
    const off = d.getTimezoneOffset() * 60_000
    return new Date(d.getTime() - off).toISOString().slice(0, 16)
  }, [currentTs])

  const tx = useTx({
    onConfirmed: () => { setSaveNonce((n) => n + 1); onChange?.() }
  })

  const toTs = (d) => (d.deadline ? Math.floor(new Date(d.deadline).getTime() / 1000) : 0)

  return (
    <EditableRow
      key={saveNonce}
      label="Deadline"
      ownerTag="Payer"
      currentDisplay={formatDeadline(escrow.deadline)}
      help="You can only move the deadline later, never earlier. Past the deadline, any undelivered milestone becomes refundable to you."
      fields={[{ key: 'deadline', label: 'New deadline', type: 'datetime', min: minStr }]}
      validate={(d) => toTs(d) > currentTs}
      busy={tx.isBusy}
      successMessage={successTs ? `Extended to ${formatDeadline(BigInt(successTs))}.` : null}
      onSubmit={(d) => {
        const newTs = toTs(d)
        setSuccessTs(newTs)
        tx.run(escrowWrite('extendDeadline', [BigInt(escrow.id), BigInt(newTs)]), { loadingMessage: 'Extending. Check your wallet.' })
      }}
      last={last}
    />
  )
}

function InvoiceLinkEditRow({ escrow, onChange, last }) {
  const [saveNonce, setSaveNonce] = useState(0)
  const [saved, setSaved] = useState(false)
  const current = (escrow.invoiceURI && escrow.invoiceURI !== NO_ATTACHMENT_URI) ? escrow.invoiceURI : ''

  const tx = useTx({
    onConfirmed: () => { setSaveNonce((n) => n + 1); onChange?.() }
  })

  return (
    <EditableRow
      key={saveNonce}
      label="Invoice link"
      ownerTag="Payer"
      currentDisplay={current}
      help="An optional link to the full invoice. The structured invoice terms committed on-chain don't change, only this convenience link."
      fields={[{ key: 'url', label: 'New invoice link', type: 'text', mono: true, placeholder: 'https://…' }]}
      validate={(d) => {
        const trimmed = (d.url || '').trim()
        return trimmed !== '' && trimmed !== current && isValidUrl(trimmed)
      }}
      busy={tx.isBusy}
      successMessage={saved ? 'Invoice link updated.' : null}
      onSubmit={(d) => {
        const trimmed = d.url.trim()
        setSaved(true)
        tx.run(escrowWrite('updateInvoiceURI', [BigInt(escrow.id), trimmed]), { loadingMessage: 'Updating. Check your wallet.' })
      }}
      last={last}
    />
  )
}

function ReceivingAddressEditRow({ escrow, onChange, last }) {
  const [saveNonce, setSaveNonce] = useState(0)
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
    onConfirmed: () => { setSaveNonce((n) => n + 1); onChange?.() }
  })

  return (
    <EditableRow
      key={saveNonce}
      label="Receiving address"
      ownerTag="Freelancer"
      currentDisplay={currentAddress ? `${truncateAddr(currentAddress)} · ${getDomainName(currentDomain)}` : null}
      help="Where approved milestone payments get sent. You can update this anytime before the escrow is completed or cancelled."
      fields={[
        { key: 'addr', label: 'New address', type: 'text', mono: true, placeholder: '0x…' },
        { key: 'domain', label: 'Receiving chain', type: 'select', options: domainOptions, value: currentDomain || ARC_DOMAIN }
      ]}
      validate={(d) => isValidAddress(d.addr) && domainOptions.some((o) => o.value === Number(d.domain))}
      busy={tx.isBusy}
      successMessage={successInfo ? `Updated to ${truncateAddr(successInfo.address)} on ${getDomainName(successInfo.domain)}.` : null}
      onSubmit={(d) => {
        setSuccessInfo({ address: d.addr, domain: Number(d.domain) })
        tx.run(
          escrowWrite('updateReceivingAddress', [BigInt(escrow.id), addressToBytes32(d.addr), Number(d.domain)]),
          { loadingMessage: 'Updating. Check your wallet.' }
        )
      }}
      last={last}
    />
  )
}

function SplitAddressEditRow({ escrow, splitIndex, currentDomain, currentAddress, pct, onChange, last }) {
  const [saveNonce, setSaveNonce] = useState(0)
  const [successInfo, setSuccessInfo] = useState(null)
  const { supported } = useSupportedDomains()

  const domainOptions = useMemo(() => {
    const set = new Set(supported.filter(isEvmDomain))
    set.add(ARC_DOMAIN)
    return [...set].sort((a, b) => a - b).map((d) => ({ value: d, label: getDomainName(d) }))
  }, [supported])

  const tx = useTx({
    onConfirmed: () => { setSaveNonce((n) => n + 1); onChange?.() }
  })

  const pctLabel = pct.toLocaleString('en-US', { maximumFractionDigits: 2 })

  return (
    <EditableRow
      key={saveNonce}
      label="My split address"
      ownerTag="Your split"
      currentDisplay={currentAddress ? `${truncateAddr(currentAddress)} · ${pctLabel}%` : null}
      help="Update the wallet and destination chain for your share of split payouts."
      fields={[
        { key: 'addr', label: 'New address', type: 'text', mono: true, placeholder: '0x…' },
        { key: 'domain', label: 'Receiving chain', type: 'select', options: domainOptions, value: currentDomain }
      ]}
      validate={(d) => isValidAddress(d.addr) && domainOptions.some((o) => o.value === Number(d.domain))}
      busy={tx.isBusy}
      successMessage={successInfo ? `Updated to ${truncateAddr(successInfo.address)} on ${getDomainName(successInfo.domain)}.` : null}
      onSubmit={(d) => {
        setSuccessInfo({ address: d.addr, domain: Number(d.domain) })
        tx.run(
          escrowWrite('updateSplitReceivingAddress', [BigInt(escrow.id), BigInt(splitIndex), addressToBytes32(d.addr), Number(d.domain)]),
          { loadingMessage: 'Updating. Check your wallet.' }
        )
      }}
      last={last}
    />
  )
}

/* ---------- Split recipients ----------
   Only present when the escrow was created with a multi-party split. Each
   released milestone's remainder (after the protocol fee) is divided across
   these recipients by their bps share, each on its own CCTP destination. */
function SplitRecipients({ splits }) {
  return (
    <div className="bg-paper border border-rule rounded-2xl p-5 flex flex-col gap-3">
      <h3 className="text-[11px] uppercase tracking-[0.18em] text-ink-3 font-medium">Split recipients</h3>
      <p className="text-xs text-ink-2 leading-relaxed">
        Released funds are divided across these wallets by share, each on its own destination chain.
      </p>
      <div className="flex flex-col">
        {splits.map((s, i) => {
          const addr = s.mintRecipient ? bytes32ToAddress(s.mintRecipient) : null
          const pct = (Number(s.bps) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })
          return (
            <div
              key={i}
              className={`flex items-center justify-between gap-3 py-3 text-sm ${i === splits.length - 1 ? '' : 'border-b border-rule/50'}`}
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                {addr ? <AddressInline address={addr} /> : <span className="text-ink-3">—</span>}
                <span className="text-xs text-ink-2 font-mono">{getDomainName(s.destinationDomain)}</span>
              </div>
              <span className="font-mono tabular-nums text-sm text-ink shrink-0">{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ParamRow({ label, last = false, children }) {
  return (
    <div className={`flex justify-between items-center py-3 text-sm ${last ? '' : 'border-b border-rule/50'}`}>
      <span className="text-ink-2">{label}</span>
      <div className="text-right min-w-0">{children}</div>
    </div>
  )
}

function AddressInline({ address }) {
  if (!address) return <span className="text-ink-3">—</span>
  return (
    <a
      href={explorerAddr(address)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 font-mono text-sm text-ink hover:text-clay transition-colors"
      title={address}
    >
      {truncateAddr(address)}
      <ExternalLinkIcon size={12} />
    </a>
  )
}

function DeadlineCell({ deadline }) {
  const deadlineMs = Number(deadline) * 1000
  const passed = deadlineMs < Date.now()
  const urgent = !passed && (deadlineMs - Date.now()) < 86_400_000
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-mono tabular-nums text-sm text-ink">{formatDeadline(deadline)}</span>
      <span className={`text-xs font-mono tabular-nums ${passed ? 'text-bad' : urgent ? 'text-bad animate-pulse' : 'text-ink-3'}`}>
        {urgent && !passed ? '⚠ ' : ''}{countdown(deadline)}
      </span>
    </div>
  )
}

/* ---------- Column 2 — Milestone stack ----------
   Each milestone is a vertical card. Left side carries title, copy, and the
   release value. Right side carries the single most relevant action button —
   premium glowing clay when actionable, solid success checkmark when
   released, muted dash when refunded/cancelled. Open disputes drop the inline
   dispute resolution UI directly below the action area so evidence and
   counter-evidence stay attached to their milestone. */
const BURST_PARTICLES = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * 2 * Math.PI
  const r = i % 2 === 0 ? 44 : 28
  return {
    id: i,
    x: Math.round(Math.cos(angle) * r),
    y: Math.round(Math.sin(angle) * r),
    color: ['var(--ok)', 'var(--clay)', 'var(--warn)'][i % 3],
    size: i % 3 === 0 ? 6 : 4,
  }
})

function ConfettiBurst({ active }) {
  return (
    <AnimatePresence>
      {active && BURST_PARTICLES.map((p) => (
        <motion.span
          key={p.id}
          style={{
            position: 'absolute', top: '18%', left: '72%',
            width: p.size, height: p.size,
            borderRadius: '50%', background: p.color,
            pointerEvents: 'none', zIndex: 20,
          }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
    </AnimatePresence>
  )
}

// The first non-terminal milestone (state !== RELEASED, !== REFUNDED)
// defaults expanded; settled milestones default collapsed. Falls back to
// the last milestone once everything is terminal.
function defaultOpenIndex(milestones) {
  const active = milestones.find((m) => m.state !== 3 && m.state !== 4)
  return active ? active.index : milestones[milestones.length - 1]?.index ?? 0
}

function MilestoneStack({
  escrow, milestones, disputes, role, userAddress,
  reviewWindowExpired, claimed, reviewDeadlines,
  optimistic, onChange, setOpt, clearOpt, flashIndex, openRef
}) {
  const hasDispute = milestones.some((m) => m.state === 2)
  const releasedCount = useIntCountUp(milestones.filter((m) => m.state === 3).length)
  const [openSet, setOpenSet] = useState(() => new Set([defaultOpenIndex(milestones)]))

  // Reset the default expand target when the viewer switches escrows (route
  // param change on the same page instance, not a remount).
  useEffect(() => {
    setOpenSet(new Set([defaultOpenIndex(milestones)]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escrow.id])

  const toggle = (i) => setOpenSet((s) => {
    const next = new Set(s)
    next.has(i) ? next.delete(i) : next.add(i)
    return next
  })

  // Exposes an imperative "open + track" entry point for the focus bar's
  // jump-to-milestone action (Step 3), without those callers needing to
  // know this component owns a Set internally.
  if (openRef) openRef.current = (i) => setOpenSet((s) => new Set(s).add(i))

  return (
    <div className="bg-paper border border-rule rounded-2xl p-6">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-base font-semibold text-ink tracking-tight">
          Milestones
          {hasDispute && (
            <span className="ml-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono uppercase tracking-[0.18em] text-warn bg-warn/10 align-middle">
              <span className="h-1.5 w-1.5 rounded-full bg-warn animate-pulse" />
              In Tribunal
            </span>
          )}
        </h2>
        <span className="text-xs font-mono tabular-nums text-ink-3 uppercase tracking-widest">
          {releasedCount} / {milestones.length} released
        </span>
      </div>
      <p className="text-[11px] text-ink-3 mb-5 leading-relaxed">
        Milestone titles are only visible on the device that created this escrow.
      </p>

      <div className="flex flex-col gap-4">
        <AnimatePresence>
          {milestones.map((m, i) => {
            const opt = optimistic[`milestone_${i}`]
            // proposeMilestoneCancel is sequential: the previous milestone must
            // already be terminal (RELEASED=3 / REFUNDED=4).
            const prevTerminal = i === 0 || milestones[i - 1].state === 3 || milestones[i - 1].state === 4
            return (
              <motion.div
                key={i}
                layout
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: i * 0.07 }}
              >
                <MilestoneRow
                  escrow={escrow}
                  milestone={m}
                  dispute={disputes?.[i]}
                  role={role}
                  userAddress={userAddress}
                  reviewWindowExpired={!!reviewWindowExpired[i]}
                  claimed={!!claimed[i] || opt?.claimedDelivery}
                  reviewDeadline={Number(reviewDeadlines[i] || 0n)}
                  optimisticBadge={opt?.badge}
                  prevTerminal={prevTerminal}
                  onChange={onChange}
                  setOpt={setOpt}
                  clearOpt={clearOpt}
                  open={openSet.has(m.index)}
                  onToggle={() => toggle(m.index)}
                  flash={flashIndex === m.index}
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

// Titles are emitted on-chain at deposit (MilestoneTitles event) and indexed
// on the subgraph's Escrow entity, so any device — not just the creating
// one — can read them. localStorage stays as the fallback for escrows created
// before titles were passed on-chain, and as the instant value while the
// subgraph fetch is in flight. The shared queryKey dedupes the fetch across
// all MilestoneRow instances; staleTime is Infinity because titles never
// change after deposit.
function useMilestoneTitles(escrowId) {
  const { data } = useQuery({
    queryKey: ['gs-titles', escrowId],
    queryFn: () => fetchEscrowTitles(escrowId),
    enabled: GOLDSKY_ENABLED && escrowId !== undefined && escrowId !== null,
    staleTime: Infinity
  })
  return data && data.length > 0 ? data : loadMilestoneTitles(escrowId)
}

// Chain-readable fallback for the cross-chain tracker's txHash — indexed on
// the Milestone entity's releaseTx field (see indexer/schema.graphql), so
// the counterparty's device can find the same burn tx even though it didn't
// submit it. localStorage (see readCctpTrack below) stays the instant local
// echo for the submitting device, since indexing lags the tx by a few
// seconds; this hook is the fallback once that lag clears.
function useMilestoneReleaseTxs(escrowId) {
  const { data } = useQuery({
    queryKey: ['gs-release-tx', escrowId],
    queryFn: () => fetchMilestoneReleaseTxs(escrowId),
    enabled: GOLDSKY_ENABLED && escrowId !== undefined && escrowId !== null,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false
  })
  return data || {}
}

const CCTP_TRACK_MAX_AGE_MS = 24 * 60 * 60 * 1000

function readCctpTrack(escrowId, milestoneIndex) {
  try {
    const raw = localStorage.getItem(cctpTrackKey(escrowId, milestoneIndex))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Date.now() - parsed.ts > CCTP_TRACK_MAX_AGE_MS) {
      localStorage.removeItem(cctpTrackKey(escrowId, milestoneIndex))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function MilestoneRow({
  escrow, milestone, dispute, role, userAddress,
  reviewWindowExpired, claimed, reviewDeadline,
  optimisticBadge, prevTerminal, onChange, setOpt, clearOpt,
  open, onToggle, flash
}) {
  const titles = useMilestoneTitles(escrow.id)
  const title = titles[milestone.index] || `Milestone ${milestone.index + 1}`

  // Cross-chain delivery tracker's txHash: localStorage is the instant local
  // echo (set by MilestoneAction/SettlementPanel right after this device
  // submits the release), the subgraph's releaseTx is the chain-readable
  // fallback so the counterparty sees the same tracker without having
  // submitted anything themselves.
  const [cctpTrack, setCctpTrack] = useState(() =>
    readCctpTrack(escrow.id, milestone.index)
  )
  const releaseTxs = useMilestoneReleaseTxs(escrow.id)
  const cctpTxHash = cctpTrack?.txHash || releaseTxs[milestone.index] || null

  // When MilestoneAction or SettlementPanel confirms a cross-chain release on this
  // device, they write to localStorage and call onCrossChainRelease so we re-read.
  const handleCrossChainRelease = useCallback(() => {
    setCctpTrack(readCctpTrack(escrow.id, milestone.index))
  }, [escrow.id, milestone.index])

  const now = Math.floor(Date.now() / 1000)
  const deadlinePassed = Number(escrow.deadline) > 0 && now > Number(escrow.deadline)
  const gracePassed = Number(escrow.deadline) > 0 && now > Number(escrow.deadline) + DELIVERY_GRACE_PERIOD
  const graceHoursRemaining = deadlinePassed && !gracePassed
    ? Math.ceil((Number(escrow.deadline) + DELIVERY_GRACE_PERIOD - now) / 3600)
    : 0

  const reduce = useReducedMotion()
  const prevStateRef = useRef(milestone.state)
  const [burst, setBurst] = useState(false)
  useEffect(() => {
    if (!reduce && prevStateRef.current !== 3 && milestone.state === 3) {
      setBurst(true)
      const id = setTimeout(() => setBurst(false), 900)
      return () => clearTimeout(id)
    }
    prevStateRef.current = milestone.state
  }, [milestone.state, reduce])

  const description = describeMilestone(milestone, {
    claimed, reviewWindowExpired, deadlinePassed, gracePassed, graceHoursRemaining, dispute
  })

  const inDispute = milestone.state === 2
  const rowCls = inDispute
    ? 'border border-warn/40 bg-warn/[0.04] rounded-xl relative transition-shadow'
    : 'border border-rule bg-paper rounded-xl relative transition-shadow'
  return (
    <div
      id={`milestone-${milestone.index}`}
      className={rowCls}
      style={flash ? { boxShadow: '0 0 0 3px var(--clay-soft)', borderColor: 'var(--clay)' } : undefined}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 text-left p-5"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`font-mono text-[10px] uppercase tracking-[0.18em] shrink-0 ${inDispute ? 'text-warn' : 'text-ink-3'}`}>
            M{milestone.index + 1}
          </span>
          <span className="text-[15px] font-semibold text-ink truncate">{title}</span>
          <MilestoneStateGlyph state={milestone.state} />
          {optimisticBadge && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border border-clay/30 bg-clay-soft text-clay shrink-0">
              {optimisticBadge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono font-semibold tabular-nums text-[15px] text-ink">
            {formatUSDCNumber(milestone.amount)}
          </span>
          <ChevronIcon open={open} />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 border-t border-rule/60 pt-4 flex flex-col gap-3.5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-2 min-w-0 flex-1">
                  {description && (
                    <p className="text-sm text-ink-2 leading-relaxed">{description}</p>
                  )}

                  {claimed && Number(milestone.claimedAt) > 0 ? (
                    <div className="flex flex-wrap gap-4 text-xs mt-1">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-ink-3 text-[10px] uppercase tracking-wider">Delivered</span>
                        <span className="font-mono tabular-nums text-ink-2">{formatTimestamp(milestone.claimedAt)}</span>
                      </div>
                    </div>
                  ) : null}

                  {milestone.state === 1 && reviewDeadline > 0 && !reviewWindowExpired && (
                    <Countdown label="Auto-releases in" target={reviewDeadline} tone="warning" />
                  )}
                </div>

                <div className="shrink-0 flex flex-col items-end gap-2">
                  <MilestoneAction
                    escrow={escrow}
                    milestone={milestone}
                    role={role}
                    gracePassed={gracePassed}
                    reviewWindowExpired={reviewWindowExpired}
                    setOpt={setOpt}
                    clearOpt={clearOpt}
                    onChange={onChange}
                    onCrossChainRelease={handleCrossChainRelease}
                  />
                  <RaiseDisputeButton
                    escrow={escrow}
                    milestone={milestone}
                    role={role}
                    reviewWindowExpired={reviewWindowExpired}
                    onChange={onChange}
                  />
                </div>
              </div>

              {milestone.state === 2 && (role === 'payer' || role === 'freelancer') && (
                <DisputePanel
                  escrow={escrow}
                  milestone={milestone}
                  dispute={dispute}
                  role={role}
                  userAddress={userAddress}
                  onChange={onChange}
                  onCrossChainRelease={handleCrossChainRelease}
                />
              )}

              {(milestone.state === 3 || milestone.state === 4) &&
                dispute?.resolutionHash && dispute.resolutionHash !== ZERO_BYTES32 && (
                  <ResolutionNote dispute={dispute} />
                )}
              {milestone.state === 4 && Number(dispute?.raisedAt ?? 0) > 0 &&
                (!dispute?.resolutionHash || dispute.resolutionHash === ZERO_BYTES32) && (
                  <TimeoutOutcomeCard milestone={milestone} role={role} />
                )}
              {milestone.state === 3 && cctpTxHash && Number(escrow.destinationDomain) !== ARC_DOMAIN && (
                <CrossChainDelivery
                  txHash={cctpTxHash}
                  destinationDomain={escrow.destinationDomain}
                  escrowId={escrow.id}
                  milestoneIndex={milestone.index}
                />
              )}

              {(role === 'payer' || role === 'freelancer') && prevTerminal &&
                (milestone.state === 0 || milestone.state === 1) && (
                  <MilestoneCancelControl
                    escrow={escrow}
                    milestoneIndex={milestone.index}
                    role={role}
                    onChange={onChange}
                  />
                )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfettiBurst active={burst} />
    </div>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg
      width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={{ color: 'var(--ink-3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }}
    >
      <path d="m5.5 8 4.5 4.5L14.5 8" />
    </svg>
  )
}

/* ---------- Per-milestone mutual cancel ----------
   Cancels a single milestone (refunds its amount to the payer) once both
   parties have proposed — the milestone-level analogue of {mutualCancel}. The
   public `milestoneCancelProposals` mapping is read directly for both parties
   so each side sees the live approval state. */
function MilestoneCancelControl({ escrow, milestoneIndex, role, onChange }) {
  const [open, setOpen] = useState(false)

  const baseArgs = { address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'milestoneCancelProposals' }
  const { data: payerProposedRaw, refetch: refetchPayer } = useReadContract({
    ...baseArgs,
    args: [BigInt(escrow.id), BigInt(milestoneIndex), escrow.depositor],
    query: { refetchInterval: POLL_MS }
  })
  const { data: freelancerProposedRaw, refetch: refetchFreelancer } = useReadContract({
    ...baseArgs,
    args: [BigInt(escrow.id), BigInt(milestoneIndex), escrow.recipient],
    query: { refetchInterval: POLL_MS }
  })

  const tx = useTx({
    onConfirmed: () => { refetchPayer(); refetchFreelancer(); onChange?.() }
  })

  const payerProposed = !!payerProposedRaw
  const freelancerProposed = !!freelancerProposedRaw
  const iProposed = role === 'payer' ? payerProposed : freelancerProposed

  const submit = () => tx.run(
    escrowWrite('proposeMilestoneCancel', [BigInt(escrow.id), BigInt(milestoneIndex)]),
    { loadingMessage: 'Submitting. Check your wallet.' }
  )

  if (!open) {
    return (
      <div className="mt-4 pt-3 border-t border-rule/50 flex items-center justify-between gap-3">
        <span className="text-xs text-ink-3">Need to drop just this milestone?</span>
        <button
          type="button"
          className="text-xs text-ink-2 hover:text-ink transition-colors"
          onClick={() => setOpen(true)}
        >
          Cancel milestone
        </button>
      </div>
    )
  }

  return (
    <div className="mt-4 pt-4 border-t border-rule/50 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] uppercase tracking-[0.18em] text-ink-3 font-medium">Cancel this milestone</h4>
        <button type="button" className="text-xs text-ink-3 hover:text-ink-2 transition-colors" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <p className="text-xs text-ink-2 leading-relaxed">
        Both the payer and freelancer must propose. Once both agree, this milestone's amount is refunded to the payer and the rest of the escrow continues.
      </p>
      <div className="flex flex-col gap-2 bg-sunk rounded-xl px-3 py-2.5">
        <ApprovalRow label="Payer" approved={payerProposed} />
        <ApprovalRow label="Freelancer" approved={freelancerProposed} />
      </div>
      <TxButton
        className="btn-danger text-sm py-2"
        onClick={submit}
        disabled={iProposed || tx.isBusy}
        loading={tx.isBusy}
        label={iProposed
          ? 'You proposed this'
          : (role === 'payer' ? freelancerProposed : payerProposed)
          ? 'Finalize cancellation'
          : 'Propose cancellation'}
      />
    </div>
  )
}

/* ---------- Tabbed dispute panel ----------
   Collapses the density spike a disputed milestone used to be (stepper +
   details + timeout note + settlement panel, all stacked) into three tabs.
   Pure recomposition of already-fetched data — dispute, settlement
   proposals, arbiter window — no new reads. Tab pill mirrors the segmented
   control already used on Dashboard/Ledger (bg-sunk pill, animated
   layoutId), so this doesn't invent a new control style. */
const DISPUTE_TABS = [
  ['overview', 'Overview'],
  ['evidence', 'Evidence'],
  ['settle', 'Settle']
]

function DisputePanel({ escrow, milestone, dispute, role, userAddress, onChange, onCrossChainRelease }) {
  const [tab, setTab] = useState('overview')

  return (
    <div className="pt-2 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs uppercase tracking-[0.18em] font-medium text-warn">
          In review by the arbiter panel
        </div>
      </div>

      <div role="tablist" aria-label="Dispute" className="inline-flex items-center gap-1 p-1 bg-sunk rounded-xl self-start">
        {DISPUTE_TABS.map(([key, label]) => {
          const active = tab === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={`relative inline-flex items-center justify-center min-h-8 px-3.5 py-1.5 text-xs font-medium rounded-lg
                whitespace-nowrap transition-colors duration-200
                focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-sunk
                ${active ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}
            >
              {active && (
                <motion.span
                  layoutId={`dispute-tab-pill-${escrow.id}-${milestone.index}`}
                  className="absolute inset-0 rounded-lg bg-paper shadow-sm"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <span className="relative">{label}</span>
            </button>
          )
        })}
      </div>

      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          <DisputeStepper dispute={dispute} role={role} />
          <ArbiterTimeoutNote dispute={dispute} />
        </div>
      )}

      {tab === 'evidence' && (
        <div className="flex flex-col gap-4">
          {Number(dispute?.raisedAt ?? 0) > 0 && <DisputeDetails dispute={dispute} />}
          <EvidenceTabActions escrow={escrow} milestone={milestone} dispute={dispute} role={role} userAddress={userAddress} onChange={onChange} />
        </div>
      )}

      {tab === 'settle' && (
        <SettlementPanel
          escrow={escrow}
          milestone={milestone}
          role={role}
          onChange={onChange}
          onCrossChainRelease={onCrossChainRelease}
        />
      )}
    </div>
  )
}

/* Role-aware process stepper shown inside the DISPUTED milestone block.
   Gives both parties a clear picture of where the dispute stands and what's next.
   The arbiter window countdown comes from the live contract value via useDisputeConfig. */
function DisputeStepper({ dispute, role }) {
  const { arbiterWindow } = useDisputeConfig()

  const counterDone =
    !!dispute?.counterEvidenceHash && dispute.counterEvidenceHash !== ZERO_BYTES32
  const windowSecs = arbiterWindow ?? 0n
  const arbiterTarget = Number(dispute?.raisedAt ?? 0) + Number(windowSecs)
  const timeLeft = windowSecs > 0n ? countdown(arbiterTarget).replace(' remaining', '') : null
  const elapsed = windowSecs > 0n && Math.floor(Date.now() / 1000) >= arbiterTarget

  const steps = [
    {
      state: 'done',
      label: 'Dispute raised',
      sub: role === 'payer'
        ? 'You contested the delivery claim.'
        : 'Payer contested your delivery claim.',
    },
    {
      state: counterDone ? 'done' : 'current',
      label: counterDone
        ? 'Counter-evidence submitted'
        : role === 'freelancer'
        ? 'Submit counter-evidence'
        : 'Awaiting counter-evidence',
      sub: counterDone
        ? null
        : role === 'freelancer'
        ? 'Respond with evidence to defend your delivery before the window closes.'
        : 'The freelancer may respond with their side of the story.',
    },
    {
      state: counterDone ? 'current' : 'future',
      label: 'Arbiter ruling',
      sub: elapsed
        ? 'Arbitration window has elapsed — the 50/50 timeout outcome can now be triggered.'
        : timeLeft
        ? `Arbitration closes in ${timeLeft}. If the arbiter doesn't act, funds split 50/50 — the freelancer's share arrives as a claimable balance, net of the protocol fee.`
        : 'The arbiter will review both sides and issue a ruling.',
    },
    {
      state: 'future',
      label: 'Funds distributed',
      sub: 'Resolved amounts arrive as a claimable balance. The protocol fee applies.',
    },
  ]

  return (
    <div className="flex flex-col">
      {steps.map((step, i) => (
        <StepRow
          key={i}
          stepState={step.state}
          label={step.label}
          sub={step.sub}
          isLast={i === steps.length - 1}
        />
      ))}
    </div>
  )
}

function StepRow({ stepState, label, sub, isLast }) {
  const isDone    = stepState === 'done'
  const isCurrent = stepState === 'current'
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          isDone
            ? 'bg-ok/20 text-ok border border-ok/30'
            : isCurrent
            ? 'bg-warn/10 border border-warn/50'
            : 'bg-sunk border border-rule'
        }`}>
          {isDone ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : isCurrent ? (
            <span className="w-1.5 h-1.5 rounded-full bg-warn animate-pulse" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-ink-3/40" />
          )}
        </div>
        {!isLast && <div className="w-px flex-1 min-h-[12px] bg-rule/60 my-1" />}
      </div>
      <div className={`${isLast ? 'pb-0' : 'pb-3'} min-w-0 flex-1`}>
        <p className={`text-[12.5px] font-medium leading-snug ${
          isDone ? 'text-ok' : isCurrent ? 'text-warn' : 'text-ink-3'
        }`}>{label}</p>
        {sub && <p className="text-[11.5px] text-ink-3 mt-0.5 leading-relaxed">{sub}</p>}
      </div>
    </div>
  )
}

/* Explains what the permissionless timeout fallback will do if the arbiter
   never acts. A DISPUTED milestone always carries both a recipient
   delivery-claim and a depositor objection, so the contract
   (`resolveDisputeByTimeout`) settles it as a fixed 50/50 split. The countdown
   uses ARBITER_WINDOW read from the contract — never a hardcoded 14d. */
function ArbiterTimeoutNote({ dispute }) {
  const { arbiterWindow } = useDisputeConfig()
  if (!dispute?.raisedBy) return null

  const windowSecs = arbiterWindow
  const copy = 'If the arbiter does not act within the window, funds are split 50/50. The freelancer\'s share arrives as a claimable balance on Arc and is charged the protocol fee.'

  const target = Number(dispute.raisedAt) + Number(windowSecs)
  const now = Math.floor(Date.now() / 1000)
  const elapsed = windowSecs > 0n && now >= target

  return (
    <div className="rounded-xl bg-sunk px-3 py-2.5 flex flex-col gap-1.5">
      <p className="text-xs text-ink-2 leading-relaxed">{copy}</p>
      {windowSecs > 0n && (
        <p className="font-mono tabular-nums text-[11px] text-ink-3">
          {elapsed
            ? 'Arbitration window has elapsed — the timeout outcome can now be triggered.'
            : `Arbitration window closes in ${countdown(target).replace(' remaining', '')}.`}
        </p>
      )}
    </div>
  )
}

/* Shows the open dispute's evidence to both parties — payer and freelancer see the
   same dispute card so neither is blind to what the other submitted. Data comes
   from the getEscrowDetail payload; no extra fetches needed. */
function DisputeDetails({ dispute }) {
  const counterSubmitted =
    dispute.counterEvidenceHash && dispute.counterEvidenceHash !== ZERO_BYTES32
  return (
    <div className="rounded-xl bg-sunk px-3 py-3 flex flex-col gap-3">
      {dispute.reason && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-ink-3 font-medium mb-1">Dispute reason</p>
          <p className="text-[13px] text-ink-2 leading-relaxed">{dispute.reason}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 items-center text-[13px]">
        {Number(dispute.raisedAt) > 0 && (
          <span className="text-ink-3">Raised {formatTimestamp(dispute.raisedAt)}</span>
        )}
        {dispute.evidenceURI && (
          <a
            href={dispute.evidenceURI}
            target="_blank"
            rel="noreferrer"
            className="text-clay hover:opacity-80 inline-flex items-center gap-1"
          >
            View evidence ↗
          </a>
        )}
      </div>
      <div className="flex items-center gap-2 text-[12px]">
        {counterSubmitted ? (
          <>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok shrink-0" aria-hidden />
            <span className="text-ink-2">Counter-evidence submitted</span>
            {dispute.counterEvidenceURI && (
              <a
                href={dispute.counterEvidenceURI}
                target="_blank"
                rel="noreferrer"
                className="text-clay hover:opacity-80"
              >
                View ↗
              </a>
            )}
          </>
        ) : (
          <>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink-3 shrink-0" aria-hidden />
            <span className="text-ink-3">No counter-evidence yet</span>
          </>
        )}
      </div>
    </div>
  )
}

/* Mutual settlement (mutualSettle). Either party proposes a recipient share in
   whole percent; when both parties' proposals match, the contract executes the
   split automatically. We surface both standing proposals and a one-click
   "agree to their number" path. */
function SettlementPanel({ escrow, milestone, role, onChange, onCrossChainRelease }) {
  const { depositorProposal, recipientProposal, refetch } = useSettlementProposals(
    escrow.id, milestone.index, escrow.depositor, escrow.recipient
  )
  const { config } = useProtocolConfig()
  const toast = useToast()

  const mine = role === 'payer' ? depositorProposal : recipientProposal
  const theirs = role === 'payer' ? recipientProposal : depositorProposal

  const [pct, setPct] = useState('50')
  const tx = useTx({ onConfirmed: () => { setPct('50'); refetch(); onChange?.() } })

  useEffect(() => {
    if (mine.exists) setPct(String(bpsToPct(mine.bps)))
  }, [mine.exists]) // eslint-disable-line

  const pctNum = pct === '' ? NaN : Number(pct)
  const pctValid = Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 100
  const canSubmit = pctValid && !tx.isBusy

  // Same-chain (Arc) settlements take maxFee = 0; cross-chain must cover
  // Circle's live forwarding fee on the recipient's share, quoted at submit time.
  const propose = async (bps) => {
    let maxFee
    try {
      const recipientAmount = (milestone.amount * BigInt(bps)) / 10_000n
      const feeBps = config?.protocolFeeBps ?? 0n
      const protocolFee = (recipientAmount * BigInt(feeBps)) / 10_000n
      maxFee = await resolveMaxFee({
        destinationDomain: escrow.destinationDomain,
        escrowCctpForwardFee: escrow.escrowCctpForwardFee,
        burnAmount: recipientAmount - protocolFee
      })
    } catch (err) {
      toast.error(err.message || "Couldn't check delivery fees. Please try again.")
      return
    }
    const txHash = await tx.run(
      escrowWrite('mutualSettle', [BigInt(escrow.id), BigInt(milestone.index), BigInt(bps), maxFee]),
      { loadingMessage: 'Check your wallet.' }
    )
    if (txHash && Number(escrow.destinationDomain) !== ARC_DOMAIN) {
      localStorage.setItem(
        cctpTrackKey(escrow.id, milestone.index),
        JSON.stringify({ txHash, domain: escrow.destinationDomain, ts: Date.now() })
      )
      onCrossChainRelease?.()
    }
  }

  const submit = () => { if (canSubmit) propose(Math.round(pctNum * 100)) }

  const bpsToPct = (bps) => Number(bps) / 100
  // Their proposal differs from mine (or I have none): offer to accept it,
  // which makes both proposals match and settles on-chain.
  const canAgree = theirs.exists && (!mine.exists || mine.bps !== theirs.bps)

  // Perspective-relative copy: `role === 'payer'` is the depositor (client),
  // otherwise the recipient (freelancer). Both sides always enter the
  // recipient's percentage; the label disambiguates whose share that is.
  const isPayer = role === 'payer'
  const shareLabel = isPayer
    ? "Freelancer's share of the disputed amount"
    : 'Your share of the disputed amount'

  // Live USDC split off the disputed milestone amount, recomputed as they type.
  const recipientShare = pctValid ? (milestone.amount * BigInt(Math.round(pctNum * 100))) / 10_000n : 0n
  const depositorShare = pctValid ? milestone.amount - recipientShare : 0n

  return (
    <div className="rounded-xl border border-rule bg-paper p-4 flex flex-col gap-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-ink-3 font-medium">Settle this without an arbiter</p>

      {theirs.exists && (
        <div className="rounded-xl bg-sunk px-3 py-2.5">
          <p className="text-[13px] text-ink-2 leading-relaxed">
            They proposed {bpsToPct(theirs.bps)}% — enter the same number to settle instantly
          </p>
        </div>
      )}

      <Field
        label={shareLabel}
        helper="Agree on a number with the other party first, then both submit it here. When both sides submit the same percentage, funds split instantly."
      >
        {(p) => (
          <div className="flex items-center gap-2">
            <input
              {...p}
              type="number" min={0} max={100} step={1}
              className="input num w-24"
              placeholder="50"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
            />
            <span className="text-[13px] text-ink-3">%</span>
          </div>
        )}
      </Field>

      {pctValid && (
        <div className="rounded-xl bg-sunk px-3.5 py-3 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="eyebrow">{isPayer ? 'Freelancer gets' : 'You receive'}</span>
              <span className="flex items-baseline gap-1">
                <span className="num text-[20px] leading-none font-medium text-clay">{formatUSDCNumber(recipientShare)}</span>
                <span className="text-[10.5px] text-ink-3">USDC</span>
              </span>
              <span className="num text-[11px] text-ink-3">{Math.round(pctNum)}%</span>
            </div>
            <div className="flex flex-col items-end gap-1.5 text-right">
              <span className="eyebrow">{isPayer ? 'You keep' : 'Client gets back'}</span>
              <span className="flex items-baseline gap-1">
                <span className="num text-[20px] leading-none font-medium text-ink">{formatUSDCNumber(depositorShare)}</span>
                <span className="text-[10.5px] text-ink-3">USDC</span>
              </span>
              <span className="num text-[11px] text-ink-3">{100 - Math.round(pctNum)}%</span>
            </div>
          </div>
          {/* Live split meter: clay = recipient's share. scaleX (transform, not
              width) so the fill animates without touching layout properties. */}
          <div className="relative h-2 rounded-full bg-rule overflow-hidden" aria-hidden="true">
            <div
              className="absolute inset-0 origin-left bg-clay transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ transform: `scaleX(${Math.max(0, Math.min(1, pctNum / 100))})` }}
            />
          </div>
        </div>
      )}

      <button className="btn-secondary text-sm py-2" onClick={submit} disabled={!canSubmit}>
        {tx.isBusy ? 'Working…' : mine.exists ? 'Update Settlement Proposal' : 'Submit Settlement Proposal'}
      </button>
      {mine.exists && (
        <p className="text-[12px] text-ink-3 -mt-1">
          Your offer stays open until you change it.
        </p>
      )}

      {canAgree && (
        <div className="rounded-xl bg-sunk px-3 py-2.5 flex flex-col gap-2">
          <p className="text-[13px] text-ink-2 leading-relaxed">
            Both parties agree on {bpsToPct(theirs.bps)}%? Confirm to settle: the recipient
            receives {bpsToPct(theirs.bps)}% and the depositor the remainder.
          </p>
          <button
            className="btn-primary text-sm py-2 self-start"
            onClick={() => propose(Number(theirs.bps))}
            disabled={tx.isBusy}
          >
            {tx.isBusy ? 'Working…' : `Confirm settlement at ${bpsToPct(theirs.bps)}%`}
          </button>
        </div>
      )}
    </div>
  )
}

/* Cross-chain delivery tracker. Shown on a RELEASED cross-chain milestone when
   we have a tracked burn tx hash from this device. Polls Iris every 15s. */
function CrossChainDelivery({ txHash, destinationDomain, escrowId, milestoneIndex }) {
  const { phase, deliveries } = useCctpDelivery(txHash, destinationDomain)
  const chainName = getDomainName(destinationDomain)
  const [copied, setCopied] = useState(false)

  if (phase === 'idle') return null

  return (
    <div className="mt-3 pt-3 border-t border-rule flex flex-col gap-2">
      {phase === 'polling' && (
        <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-ink-3/40 border-t-clay animate-spin shrink-0" aria-hidden />
          Delivering to {chainName}…
          <span className="text-[11px] text-ink-3">(checking every 15s)</span>
        </div>
      )}

      {phase === 'delivered' && deliveries.map((d, i) => {
        const explorerUrl = getChainExplorerTx(d.destinationDomain ?? destinationDomain, d.destinationTxHash)
        return (
          <div key={i} className="flex items-center gap-2 text-[12.5px] text-ok">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3 7.5l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Delivered to {chainName}
            {explorerUrl && (
              <a href={explorerUrl} target="_blank" rel="noreferrer" className="text-clay hover:opacity-80 inline-flex items-center gap-0.5">
                View tx <ExternalLinkIcon size={11} />
              </a>
            )}
          </div>
        )
      })}

      {phase === 'failed' && (
        <SelfRelayCard
          deliveries={deliveries}
          destinationDomain={destinationDomain}
          escrowId={escrowId}
          milestoneIndex={milestoneIndex}
          copied={copied}
          onCopied={() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }}
        />
      )}

      {phase === 'unavailable' && (
        <p className="text-[12px] text-ink-3">Delivery status unavailable — check back later.</p>
      )}
    </div>
  )
}

/* Recovery card shown when Iris reports forwardState: FAILED.
   Explains what happened in plain English and walks the user through relaying
   the CCTP message on the destination chain to complete the transfer. */
function SelfRelayCard({ deliveries, destinationDomain, escrowId, milestoneIndex, copied, onCopied }) {
  const { address } = useAccount()
  const [relayPhase, setRelayPhase] = useState('idle') // idle|switching|relaying|done|error
  const [relayTxHash, setRelayTxHash] = useState(null)
  const [relayError, setRelayError] = useState(null)
  const [calldataOpen, setCalldataOpen] = useState(false)
  const chainName = getDomainName(destinationDomain)

  // Use the first failed delivery (or all of them for multi-split)
  const primary = deliveries.find((d) => d.forwardState === 'FAILED') ?? deliveries[0]
  if (!primary) return null

  const transmitter = MESSAGE_TRANSMITTER_V2[Number(destinationDomain)] ?? null
  const chainParams = EVM_CHAIN_PARAMS[Number(destinationDomain)] ?? null
  const canRelayInApp = !!(transmitter && chainParams && typeof window !== 'undefined' && window.ethereum)

  const calldata = primary.message && primary.attestation
    ? encodeReceiveMessage(primary.message, primary.attestation)
    : null

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); onCopied?.() } catch {}
  }

  const relayInApp = async () => {
    if (!canRelayInApp) return
    try {
      setRelayPhase('switching')
      setRelayError(null)
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainParams.chainId }]
        })
      } catch (err) {
        if (err.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [chainParams]
          })
        } else {
          throw err
        }
      }
      setRelayPhase('relaying')
      const params = [{ to: transmitter, data: calldata, from: address }]
      const txHash = await window.ethereum.request({ method: 'eth_sendTransaction', params })
      setRelayTxHash(txHash)
      setRelayPhase('done')
      // Clean up localStorage so the tracker doesn't restart next visit
      localStorage.removeItem(cctpTrackKey(escrowId, milestoneIndex))
    } catch (err) {
      setRelayPhase('error')
      setRelayError(err.message || 'Relay failed. Try again.')
    }
  }

  const errorIsInsufficientFee = primary.errorCode === 'INSUFFICIENT_FEE'

  return (
    <div className="rounded-xl border border-warn/30 bg-warn/[0.04] px-4 py-4 flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <p className="text-[12px] font-medium text-warn uppercase tracking-[0.14em]">Delivery failed</p>
        <p className="text-[13px] text-ink-2 leading-relaxed">
          {errorIsInsufficientFee
            ? `The payment reached Circle but wasn't auto-delivered to ${chainName} because the forwarding fee was too low.`
            : `The payment reached Circle but wasn't auto-delivered to ${chainName}.`}
          {' '}You can recover it by self-relaying the message on {chainName}.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <p className="text-[11.5px] text-ink-3 uppercase tracking-[0.14em] font-medium">Recovery steps</p>

        <div className="flex items-start gap-3">
          <span className="h-5 w-5 rounded-full bg-sunk border border-rule flex items-center justify-center text-[10px] font-mono text-ink-3 shrink-0">1</span>
          <p className="text-[12.5px] text-ink-2 pt-0.5">
            Switch your wallet to <span className="font-medium text-ink">{chainName}</span>.
          </p>
        </div>

        <div className="flex items-start gap-3">
          <span className="h-5 w-5 rounded-full bg-sunk border border-rule flex items-center justify-center text-[10px] font-mono text-ink-3 shrink-0">2</span>
          <p className="text-[12.5px] text-ink-2 pt-0.5">
            Call <span className="font-mono text-[11.5px] text-ink">receiveMessage(message, attestation)</span> on {chainName}'s <span className="font-medium text-ink">MessageTransmitterV2</span>.
            {!transmitter && (
              <span className="text-ink-3"> Find the address at Circle's{' '}
                <a href="https://developers.circle.com/stablecoins/docs/evm-smart-contracts" target="_blank" rel="noreferrer" className="text-clay hover:opacity-80 underline-offset-2 hover:underline">developer portal</a>.
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Primary action: one-click relay if we have the transmitter address */}
      {canRelayInApp && relayPhase !== 'done' && (
        <button
          type="button"
          className="btn-primary text-sm py-2.5 self-start"
          onClick={relayInApp}
          disabled={relayPhase === 'switching' || relayPhase === 'relaying'}
        >
          {relayPhase === 'switching' && (
            <span className="inline-flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded-full border-2 border-paper/40 border-t-paper animate-spin" />
              Switching to {chainName}…
            </span>
          )}
          {relayPhase === 'relaying' && (
            <span className="inline-flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded-full border-2 border-paper/40 border-t-paper animate-spin" />
              Relaying…
            </span>
          )}
          {(relayPhase === 'idle' || relayPhase === 'error') && `Relay on ${chainName} →`}
        </button>
      )}

      {relayPhase === 'done' && relayTxHash && (
        <div className="flex items-center gap-2 text-[12.5px] text-ok">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M3 7.5l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Relay submitted — {relayTxHash.slice(0, 10)}…
        </div>
      )}

      {relayPhase === 'error' && relayError && (
        <p className="text-[12px] text-warn">{relayError}</p>
      )}

      {/* Calldata fallback: always available for manual relay */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setCalldataOpen((v) => !v)}
          className="self-start text-[11.5px] text-ink-3 hover:text-ink-2 transition-colors"
        >
          {calldataOpen ? '▾ Hide relay calldata' : '▸ Show relay calldata'}
        </button>
        {calldataOpen && (
          <div className="rounded-xl bg-sunk px-3 py-3 flex flex-col gap-2">
            <CallDataRow label="Message"     value={primary.message}     onCopy={copyText} copied={copied} />
            <CallDataRow label="Attestation" value={primary.attestation} onCopy={copyText} copied={copied} />
            {calldata && <CallDataRow label="Calldata"    value={calldata}           onCopy={copyText} copied={copied} />}
            <p className="text-[11px] text-ink-3 leading-relaxed pt-1">
              Call <span className="font-mono">receiveMessage(message, attestation)</span> on {chainName}'s MessageTransmitterV2 to complete the transfer.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function CallDataRow({ label, value, onCopy, copied }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2">
      <span className="text-[11px] text-ink-3 shrink-0 w-20">{label}:</span>
      <div className="flex items-start gap-1.5 min-w-0 flex-1">
        <span className="font-mono text-[10px] text-ink-3 break-all leading-relaxed flex-1">
          {value.slice(0, 40)}…
        </span>
        <button
          type="button"
          onClick={() => onCopy(value)}
          title="Copy"
          className="shrink-0 text-ink-3 hover:text-ink transition-colors mt-0.5"
        >
          {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
        </button>
      </div>
    </div>
  )
}

/* Shown on a resolved (released/refunded) milestone that went through a
   dispute. Links out to the arbiter's written reasoning and the on-chain
   resolution hash. */
function ResolutionNote({ dispute }) {
  const [hashCopied, setHashCopied] = useState(false)
  const pct = Number(dispute.resolvedRecipientBps ?? 0n) / 100

  const copyHash = async () => {
    try { await navigator.clipboard.writeText(dispute.resolutionHash); setHashCopied(true); setTimeout(() => setHashCopied(false), 1200) } catch {}
  }

  return (
    <div className="mt-4 pt-4 border-t border-rule flex flex-col gap-2">
      <p className="text-[11px] uppercase tracking-[0.18em] text-ink-3 font-medium">Arbiter resolution</p>
      <p className="text-[13px] text-ink-2">Resolved with {pct}% to the recipient.</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {dispute.resolutionURI && (
          <a
            href={dispute.resolutionURI}
            target="_blank"
            rel="noreferrer"
            className="text-clay hover:opacity-80 underline-offset-2 hover:underline text-[13px]"
          >
            View Resolution ↗
          </a>
        )}
        <div className="flex items-center gap-1.5">
          <span className="num text-[11px] text-ink-3">
            {dispute.resolutionHash.slice(0, 8)}…{dispute.resolutionHash.slice(-6)}
          </span>
          <button
            type="button"
            onClick={copyHash}
            title={hashCopied ? 'Copied!' : 'Copy resolution hash'}
            className="text-ink-3 hover:text-ink transition-colors"
          >
            {hashCopied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
          </button>
        </div>
      </div>
    </div>
  )
}

/* Shown when a dispute settled by arbiter timeout (resolveDisputeByTimeout).
   State = REFUNDED but no resolutionHash — the 50/50 split was automatic.
   Freelancer's share lands in their refund balance, not auto-delivered. */
function TimeoutOutcomeCard({ milestone, role }) {
  const half = milestone.amount / 2n
  const depositorShare = milestone.amount - half
  return (
    <div className="mt-4 pt-4 border-t border-rule flex flex-col gap-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-ink-3 font-medium">Arbiter timeout — 50/50 split</p>
      <p className="text-[13px] text-ink-2 leading-relaxed">
        The arbiter did not act within the window. Funds were split equally between both parties.
      </p>
      <div className="rounded-xl bg-sunk px-3.5 py-3 flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Freelancer received</span>
          <span className="num text-[18px] leading-none font-medium text-clay">{formatUSDCNumber(half)}</span>
          <span className="text-[10px] text-ink-3 num">USDC · 50%</span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="eyebrow">Payer received</span>
          <span className="num text-[18px] leading-none font-medium text-ink">{formatUSDCNumber(depositorShare)}</span>
          <span className="text-[10px] text-ink-3 num">USDC · 50%</span>
        </div>
      </div>
      {role === 'freelancer' && (
        <p className="text-[13px] text-ink-2">
          Your 50% is in your{' '}
          <Link to="/settings" className="text-clay hover:opacity-80 underline-offset-2 hover:underline">
            claimable balance
          </Link>
          .
        </p>
      )}
    </div>
  )
}

function describeMilestone(m, { reviewWindowExpired, deadlinePassed, gracePassed, graceHoursRemaining, dispute }) {
  // Timeout 50/50: state REFUNDED but no arbiter resolutionHash — timeout path settled it.
  if (m.state === 4 && Number(dispute?.raisedAt ?? 0) > 0 &&
      (!dispute?.resolutionHash || dispute.resolutionHash === ZERO_BYTES32)) {
    return 'Settled by arbiter timeout — funds split 50/50. The freelancer\'s share is in their claimable balance, net of the protocol fee.'
  }
  if (m.state === 0 && gracePassed) return 'Deadline passed without delivery. Refundable to the payer.'
  if (m.state === 0 && deadlinePassed) return `Deadline passed. Freelancer has ${graceHoursRemaining}h left in the grace period to mark delivery.`
  if (m.state === 0) return 'Awaiting freelancer delivery.'
  if (m.state === 1 && !reviewWindowExpired) return 'Delivered. Payer review window open — approve, dispute, or let it auto-release.'
  if (m.state === 1 && reviewWindowExpired) return 'Review window lapsed. Ready to auto-release.'
  if (m.state === 2) return 'In review by the arbiter panel.'
  if (m.state === 3) return 'Released to the freelancer.'
  if (m.state === 4) return 'Refunded to the payer.'
  return null
}

function MilestoneStateGlyph({ state }) {
  if (state === 3) {
    return (
      <span className="inline-flex items-center gap-1.5 text-ok text-xs font-medium">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ok/15 border border-ok/30">
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
      <span className="inline-flex items-center gap-1.5 text-ink-3 text-xs font-medium">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sunk border border-rule">
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M3 7h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </span>
        Refunded
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border border-rule bg-sunk text-ink-2 tracking-wide">
      {MILESTONE_LABELS[state]}
    </span>
  )
}

/* ----- Premium milestone action -----
   Single most relevant action per role/state. Glowing clay for primary
   positive actions; warning tone reserved for the dispute portal at the
   bottom of the page so the inline action stays positive-leaning. */
// Picks the single highest-priority action available to a given caller role
// on a milestone right now. Shared between MilestoneAction (which submits
// the tx) and FocusBar (which only needs to know what's next). Lifecycle:
// PENDING(0) → IN_REVIEW(1) → RELEASED(3); a missed deadline on a PENDING
// milestone is permissionlessly refundable to the payer.
function computeMilestoneAction(escrow, milestone, role, { reviewWindowExpired, gracePassed }) {
  const id = BigInt(escrow.id)
  const idx = BigInt(milestone.index)
  const isPayer = role === 'payer'
  const isFreelancer = role === 'freelancer'

  if (milestone.state === 0) {
    if (isFreelancer && !gracePassed) {
      return { key: 'claim', label: 'Mark as Delivered', fn: 'claimDelivery', args: [id, idx], optimistic: { badge: 'Claiming…', claimedDelivery: true } }
    }
    if (gracePassed) {
      return { key: 'refund', label: 'Refund (deadline passed)', fn: 'refundAfterDeadline', args: [id, idx], optimistic: { badge: 'Refunding…' }, permissionless: true }
    }
    return null
  }
  if (milestone.state === 1) {
    if (isPayer) {
      return { key: 'approve', label: 'Approve & Release', fn: 'approveRelease', args: [id, idx], needsForwardFee: true, optimistic: { badge: 'Approving…' } }
    }
    if (reviewWindowExpired) {
      return { key: 'release', label: 'Release Payment', fn: 'release', args: [id, idx], needsForwardFee: true, optimistic: { badge: 'Releasing…' }, permissionless: true }
    }
  }
  return null
}

function MilestoneAction({
  escrow, milestone, role, gracePassed, reviewWindowExpired,
  setOpt, clearOpt, onChange, onCrossChainRelease
}) {
  const [activeKey, setActiveKey] = useState(null)
  const tx = useTx({
    onConfirmed: () => { onChange?.(); setActiveKey(null) },
    onReverted: () => { setActiveKey(null); clearOpt(`milestone_${milestone.index}`) }
  })

  // Cross-chain burns must carry a maxFee that covers Circle's live Forwarding
  // Service fee, or the burn is attested but the mint is rejected
  // (INSUFFICIENT_FEE). We quote that fee at submit time (see {resolveMaxFee})
  // rather than reusing the contract's static floor. approveRelease honours the
  // caller-supplied maxFee; release ignores it and uses the escrow's snapshotted
  // fee, but the arg is kept for ABI compatibility. Same-chain (Arc) burns force
  // maxFee = 0 inside the contract regardless.
  const { config } = useProtocolConfig()
  const toast = useToast()

  const action = computeMilestoneAction(escrow, milestone, role, { reviewWindowExpired, gracePassed })
  if (!action) return null

  const run = async () => {
    setActiveKey(action.key)
    setOpt(`milestone_${milestone.index}`, action.optimistic)

    let args = action.args
    if (action.needsForwardFee) {
      // Whole milestone is released; burn amount is the milestone minus the
      // protocol fee. Quote Circle's live forwarding fee for the band check.
      // This runs before the wallet prompt, so useTx won't toast its failures.
      try {
        const feeBps = config?.protocolFeeBps ?? 0n
        const protocolFee = (milestone.amount * BigInt(feeBps)) / 10_000n
        const maxFee = await resolveMaxFee({
          destinationDomain: escrow.destinationDomain,
          escrowCctpForwardFee: escrow.escrowCctpForwardFee,
          burnAmount: milestone.amount - protocolFee
        })
        args = [...action.args, maxFee]
      } catch (err) {
        clearOpt(`milestone_${milestone.index}`)
        setActiveKey(null)
        toast.error(err.message || "Couldn't check delivery fees. Please try again.")
        return
      }
    }

    try {
      const txHash = await tx.run(escrowWrite(action.fn, args), { loadingMessage: 'Check your wallet.' })
      if (txHash && Number(escrow.destinationDomain) !== ARC_DOMAIN) {
        localStorage.setItem(
          cctpTrackKey(escrow.id, milestone.index),
          JSON.stringify({ txHash, domain: escrow.destinationDomain, ts: Date.now() })
        )
        onCrossChainRelease?.()
      }
    } catch {
      clearOpt(`milestone_${milestone.index}`)
    }
  }

  const isLoading = activeKey === action.key && tx.isBusy
  const permissionless = !!action.permissionless
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="relative">
        <AnimatePresence>
          {isLoading && (
            <motion.span
              key="ring"
              className="absolute inset-0 rounded-xl border-2 border-clay pointer-events-none"
              initial={{ opacity: 0.7, scale: 1 }}
              animate={{ opacity: 0, scale: 1.4 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: 'easeOut', repeat: Infinity, repeatType: 'loop' }}
            />
          )}
        </AnimatePresence>
        <button
          type="button"
          onClick={run}
          disabled={tx.isBusy}
          className={`relative inline-flex items-center justify-center gap-2 px-4 py-2
                     rounded-xl font-medium text-sm
                     transition-[background-color,border-color,color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]
                     disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-paper
                     ${permissionless
                       ? 'bg-transparent text-clay border border-dashed border-clay/55 hover:bg-clay-soft/40'
                       : 'bg-clay text-paper hover:bg-clay-hover'}`}
        >
          {isLoading && (
            <span className={`inline-block h-3.5 w-3.5 rounded-full border-2 animate-spin ${permissionless ? 'border-clay/30 border-t-clay' : 'border-paper/40 border-t-paper'}`} aria-hidden />
          )}
          {!isLoading && permissionless && <KeyIcon />}
          {isLoading ? 'Pending…' : action.label}
        </button>
      </div>
      {permissionless && !isLoading && <PermissionlessHint />}
    </div>
  )
}

function KeyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="7" cy="7" r="3.2" />
      <path d="m9.3 9.3 6 6" />
      <path d="m12.5 12.5 1.5-1.5" />
      <path d="m14.5 14.5 1.5-1.5" />
    </svg>
  )
}

function PermissionlessHint() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3 text-right max-w-[180px]">
      Anyone can run this now, it is permissionless once the condition is met.
    </span>
  )
}

/* ----- Dispute portal -----
   Secondary, warning-toned actions that a participant can take on a milestone:
   raise a dispute (IN_REVIEW, review window still open — depositor only), or
   submit counter-evidence (DISPUTED, you didn't raise it and none submitted
   yet). At most one of these is reachable for any given milestone state. A
   missed-deadline PENDING milestone is no longer escalated — it is refunded via
   the primary {refundAfterDeadline} action. */
// Action-zone-only: raiseDispute is depositor-only, from IN_REVIEW(1) within
// the window, i.e. before any dispute exists — so this lives in the top
// action row alongside MilestoneAction, not inside the (state===2-only)
// dispute tabs below.
function RaiseDisputeButton({ escrow, milestone, role, reviewWindowExpired, onChange }) {
  const [modal, setModal] = useState(false)
  const canRaise = milestone.state === 1 && role === 'payer' && !reviewWindowExpired
  if (!canRaise) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setModal(true)}
        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-medium text-sm
                   border border-warn/40 text-warn hover:bg-warn/10 transition-colors
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-warn focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        Raise Dispute
      </button>
      <EvidenceModal
        open={modal}
        mode="raise"
        escrowId={escrow.id}
        milestoneIndex={milestone.index}
        onClose={() => setModal(false)}
        onConfirmed={() => { setModal(false); onChange?.() }}
      />
    </>
  )
}

// Evidence-tab-only: counter/append, both state===2 (dispute already open).
function EvidenceTabActions({ escrow, milestone, dispute, role, userAddress, onChange }) {
  const [modal, setModal] = useState(null) // 'counter' | 'append' | null

  const isParticipant = role === 'payer' || role === 'freelancer'
  if (!isParticipant) return null

  const counterExists =
    dispute && dispute.counterEvidenceHash && dispute.counterEvidenceHash !== ZERO_BYTES32
  const raisedByMe =
    dispute?.raisedBy && userAddress &&
    dispute.raisedBy.toLowerCase() === userAddress.toLowerCase()

  const canCounter = !!dispute?.raisedBy && !raisedByMe && !counterExists
  // Either participant may append additional evidence while the dispute is open.
  const canAppend = true

  const btnCls =
    'inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl font-medium text-sm ' +
    'border border-warn/40 text-warn hover:bg-warn/10 transition-colors ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-warn focus-visible:ring-offset-2 focus-visible:ring-offset-paper'

  return (
    <div className="flex flex-wrap gap-2">
      {canCounter && (
        <button type="button" className={btnCls} onClick={() => setModal('counter')}>
          Submit Counter Evidence
        </button>
      )}
      {canAppend && (
        <button type="button" className={btnCls} onClick={() => setModal('append')}>
          Add Evidence
        </button>
      )}
      <EvidenceModal
        open={!!modal}
        mode={modal}
        escrowId={escrow.id}
        milestoneIndex={milestone.index}
        onClose={() => setModal(null)}
        onConfirmed={() => { setModal(null); onChange?.() }}
      />
    </div>
  )
}

const EVIDENCE_MODES = {
  raise: {
    title: 'Raise a dispute',
    fn: 'raiseDispute',
    needsReason: true,
    submitLabel: 'Submit dispute',
    evidenceLabel: 'Evidence link',
    blurb: 'Pauses this milestone for arbiter review. Upload your evidence to a permanent host (IPFS or Arweave recommended) and paste the link below. Dropping the file below fingerprints its contents directly — stronger than a URL hash.'
  },
  counter: {
    title: 'Submit counter-evidence',
    fn: 'submitCounterEvidence',
    needsReason: false,
    submitLabel: 'Submit counter-evidence',
    evidenceLabel: 'Counter-evidence link',
    blurb: 'Your one opportunity to respond. Upload your evidence to a permanent host (IPFS or Arweave recommended). Dropping the file fingerprints its contents on-chain — the hash cannot be changed after submission.'
  },
  append: {
    title: 'Add evidence',
    fn: 'appendEvidence',
    needsReason: false,
    submitLabel: 'Add evidence',
    evidenceLabel: 'Evidence link',
    blurb: 'Attach a supplementary evidence link to this dispute. Either party may add evidence while the dispute is open. Dropping the file fingerprints its contents directly rather than hashing the URL.'
  }
}

/* Shared evidence form for raise / counter / append.
   The on-chain hash is the file fingerprint when a file is dropped, falling
   back to keccak256(uri) when only a link is provided. The URI is always
   stored separately so the arbiter can fetch the content. */
function EvidenceModal({ open, mode, escrowId, milestoneIndex, onClose, onConfirmed }) {
  const meta = mode ? EVIDENCE_MODES[mode] : null
  const [reason, setReason] = useState('')
  const [uri, setUri] = useState('')
  const [fileHash, setFileHash] = useState(null)
  const [fileName, setFileName] = useState(null)
  const [fileDragging, setFileDragging] = useState(false)
  const fileInputRef = useRef(null)

  const reset = () => { setReason(''); setUri(''); setFileHash(null); setFileName(null) }
  const tx = useTx({ onConfirmed: () => { reset(); onConfirmed?.() } })

  useEffect(() => { if (!open) reset() }, [open]) // eslint-disable-line

  if (!open || !meta) return null

  const uriValid = isValidUrl(uri)
  const reasonValid = !meta.needsReason || reason.trim().length > 0
  const canSubmit = uriValid && reasonValid && !tx.isBusy

  // File fingerprint takes precedence; URI hash is the fallback.
  const evidenceHash = fileHash ?? (uriValid ? hashDescription(uri) : null)

  const fingerprintFile = async (file) => {
    try {
      const buf = await file.arrayBuffer()
      setFileHash(hashBytes(new Uint8Array(buf)))
      setFileName(file.name)
    } catch {}
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setFileDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) fingerprintFile(file)
  }

  const submit = () => {
    if (!canSubmit) return
    const id = BigInt(escrowId)
    const idx = BigInt(milestoneIndex)
    const args = meta.needsReason
      ? [id, idx, reason.trim(), evidenceHash, uri]
      : [id, idx, evidenceHash, uri]
    tx.run(escrowWrite(meta.fn, args), { loadingMessage: 'Check your wallet.' })
  }

  return (
    <Modal
      open={open}
      onClose={tx.isBusy ? () => {} : onClose}
      title={meta.title}
      footer={
        <>
          <button className="btn-quiet" onClick={onClose} disabled={tx.isBusy}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={!canSubmit}>
            {tx.isBusy ? 'Working…' : meta.submitLabel}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2 leading-relaxed">{meta.blurb}</p>

        {meta.needsReason && (
          <Field label="Reason" helper="A short explanation, stored on-chain.">
            {(p) => (
              <textarea
                {...p}
                rows={3}
                className="input-multiline"
                placeholder="Briefly explain the issue"
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        )}

        <Field
          label={meta.evidenceLabel}
          error={uri && !uriValid ? "That doesn't look like a valid URL." : undefined}
          helper="Link where your evidence is hosted (URL or IPFS gateway). Always stored on-chain alongside the hash."
        >
          {(p) => (
            <input
              {...p}
              type="url"
              className="input"
              placeholder="https://…"
              autoComplete="off"
              spellCheck={false}
              value={uri}
              onChange={(e) => setUri(e.target.value.trim())}
            />
          )}
        </Field>

        {/* File fingerprint drop zone */}
        <div className="flex flex-col gap-2">
          <p className="eyebrow">File fingerprint</p>
          {fileHash ? (
            <div className="flex items-center gap-2 rounded-xl bg-ok/10 border border-ok/30 px-3 py-2.5">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M2.5 7.5l3 3 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-ok" style={{ color: 'var(--ok)' }} />
              </svg>
              <span className="text-[12.5px] text-ink-2 min-w-0 flex-1 truncate">{fileName}</span>
              <span className="font-mono text-[11px] text-ok shrink-0">{fileHash.slice(0, 10)}…</span>
              <button
                type="button"
                onClick={() => { setFileHash(null); setFileName(null) }}
                className="shrink-0 text-ink-3 hover:text-ink transition-colors text-sm leading-none"
                title="Remove file"
              >
                ×
              </button>
            </div>
          ) : (
            <div
              className={`rounded-xl border border-dashed px-3 py-3 text-[11.5px] text-center cursor-pointer transition-colors ${
                fileDragging
                  ? 'border-clay bg-clay/5 text-clay'
                  : 'border-rule/60 text-ink-3 hover:border-clay/50 hover:text-ink-2'
              }`}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setFileDragging(true) }}
              onDragLeave={() => setFileDragging(false)}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
            >
              Drop your evidence file to fingerprint it (recommended)
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { fingerprintFile(f); e.target.value = '' } }}
                tabIndex={-1}
              />
            </div>
          )}
          {!fileHash && uriValid && (
            <p className="text-[11.5px] text-ink-3">
              Link only — file contents are not fingerprinted
            </p>
          )}
        </div>

        <div>
          <p className="eyebrow mb-1.5">Evidence hash</p>
          <p className="num text-[12px] text-ink-2 break-all">{evidenceHash || '—'}</p>
        </div>
      </div>
    </Modal>
  )
}

/* Live countdown — pulses the digits subtly to feel active without being noisy.
   Smaller than the amount, monospace, muted clay. */
function Countdown({ label, target, tone = 'warning' }) {
  const toneCls = tone === 'warning' ? 'text-warn' : 'text-clay'
  const dotCls = tone === 'warning' ? 'bg-warn' : 'bg-clay'
  const value = countdown(target).replace(' remaining', '')
  return (
    <div className="rounded-xl bg-sunk px-3 py-2.5 flex items-center justify-between gap-3 mt-2">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dotCls} animate-pulse`} aria-hidden />
        <span className="text-xs text-ink-2">{label}</span>
      </div>
      <span className={`font-mono tabular-nums text-sm font-semibold ${toneCls}`}>{value}</span>
    </div>
  )
}

/* ---------- Cancel by mutual agreement ---------- */
function CancelCard({ escrow, role, onChange, optimistic, setOpt, clearOpt }) {
  const myFlag = role === 'payer' ? escrow.depositorApproveCancel : escrow.recipientApproveCancel
  const otherFlag = role === 'payer' ? escrow.recipientApproveCancel : escrow.depositorApproveCancel
  const optApproved = optimistic.cancel === 'approved'

  const optRetracted = optimistic.cancel === 'retracted'

  const tx = useTx({
    onSign: () => setOpt('cancel', 'approved'),
    onConfirmed: () => { clearOpt('cancel'); onChange?.() },
    onReverted: () => clearOpt('cancel')
  })

  const retractTx = useTx({
    onSign: () => setOpt('cancel', 'retracted'),
    onConfirmed: () => { clearOpt('cancel'); onChange?.() },
    onReverted: () => clearOpt('cancel')
  })

  const submit = () => tx.run(
    escrowWrite('mutualCancel', [BigInt(escrow.id)]),
    { loadingMessage: 'Submitting. Check your wallet.' }
  )

  const retract = () => retractTx.run(
    escrowWrite('retractCancelApproval', [BigInt(escrow.id)]),
    { loadingMessage: 'Retracting. Check your wallet.' }
  )

  // Has the caller approved on-chain, and not yet optimistically retracted?
  const iApproved = (myFlag || optApproved) && !optRetracted
  const payerApproved = role === 'payer' ? iApproved : escrow.depositorApproveCancel
  const freelancerApproved = role === 'freelancer' ? iApproved : escrow.recipientApproveCancel

  return (
    <div className="bg-paper border border-rule rounded-2xl p-5 flex flex-col gap-3">
      <h3 className="text-[11px] uppercase tracking-[0.18em] text-ink-3 font-medium">Cancel by mutual agreement</h3>
      <p className="text-xs text-ink-2 leading-relaxed">Both the payer and freelancer need to approve. Any unreleased funds go to the payer's refund balance.</p>
      <div className="flex flex-col gap-2 bg-sunk rounded-xl px-3 py-2.5">
        <ApprovalRow label="Payer" approved={payerApproved} />
        <ApprovalRow label="Freelancer" approved={freelancerApproved} />
      </div>
      <TxButton
        className="btn-danger text-sm py-2"
        onClick={submit}
        disabled={iApproved || tx.isBusy || retractTx.isBusy}
        loading={tx.isBusy}
        label={iApproved ? 'You approved this' : otherFlag ? 'Finalize cancellation' : 'Approve cancellation'}
      />
      {iApproved && (
        <button
          type="button"
          className="self-center text-xs text-ink-2 hover:text-ink transition-colors disabled:opacity-60"
          onClick={retract}
          disabled={retractTx.isBusy}
        >
          {retractTx.isBusy ? 'Retracting…' : 'Retract my approval'}
        </button>
      )}
    </div>
  )
}

function ApprovalRow({ label, approved }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-2">{label}</span>
      <span className={`inline-flex items-center gap-1.5 font-medium ${approved ? 'text-ok' : 'text-ink-3'}`}>
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
