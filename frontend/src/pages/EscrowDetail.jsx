import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

import ConnectGate from '../components/ConnectGate.jsx'
import CustomSelect from '../components/CustomSelect.jsx'
import IconButton from '../components/IconButton.jsx'
import Modal from '../components/Modal.jsx'
import Field from '../components/Field.jsx'
import Skeleton, { SkeletonMilestoneCard } from '../components/Skeleton.jsx'
import { useEscrowDetail, useDisputeConfig, useSettlementProposals, useTick } from '../hooks/useEscrows.js'
import { useSupportedDomains } from '../hooks/useSupportedDomains.js'
import { useProtocolConfig } from '../hooks/useArbiter.js'
import { useTx, escrowWrite } from '../hooks/useTx.js'
import { useToast } from '../hooks/useToast.jsx'
import { resolveMaxFee } from '../utils/cctpFee.js'
import { bytes32ToAddress, hashDescription } from '../utils/encode.js'
import {
  isValidAddress, isValidUrl, formatUSDCNumber, formatDeadline, formatTimestamp,
  formatWindow, countdown, truncateAddr, explorerAddr, ESCROW_LABELS, MILESTONE_LABELS
} from '../utils/format.js'
import { getDomainName, ARC_DOMAIN, isEvmDomain } from '../config/chains.js'

const addressToBytes32 = (addr) => '0x' + addr.slice(2).padStart(64, '0')
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const POLL_MS = 12_000

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
  const { detail, isLoading, error, refetch } = useEscrowDetail(id, address, { pollMs: POLL_MS })
  useTick(15_000)

  // Optimistic overlays keep the UI responsive while a tx is in flight; cleared
  // on the next fresh on-chain read.
  const [optimistic, setOptimistic] = useState({})
  const setOpt = (key, value) => setOptimistic((o) => ({ ...o, [key]: value }))
  const clearOpt = (key) =>
    setOptimistic((o) => { const next = { ...o }; delete next[key]; return next })
  useEffect(() => { if (detail) setOptimistic({}) }, [detail])

  if (isLoading) return <EscrowDetailSkeleton />
  if (!detail || error) {
    return (
      <div className="card-surface p-12 text-center">
        <h2 className="text-xl font-semibold mb-2">Escrow not found</h2>
        <p className="text-sm text-ink-2">There is no escrow with ID #{id}.</p>
      </div>
    )
  }

  const {
    escrow, milestones, disputes, splits, reviewWindowExpired, claimed,
    reviewDeadlines, isPayer, isFreelancer
  } = detail
  const role = isPayer ? 'payer' : isFreelancer ? 'freelancer' : null
  const inv = escrow.invoiceHash
    ? `INV-${escrow.invoiceHash.slice(2, 6).toUpperCase()}`
    : `ESC-${escrow.id}`

  return (
    <div className="flex flex-col">
      <InspectionHeader escrow={escrow} inv={inv} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-6">
        <LedgerColumn
          escrow={escrow}
          role={role}
          splits={splits}
          onChange={refetch}
          optimistic={optimistic}
          setOpt={setOpt}
          clearOpt={clearOpt}
        />

        <div className="lg:col-span-2 flex flex-col">
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
            onChange={refetch}
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
        className="flex items-center gap-2 text-sm text-ink-2 hover:text-ink transition-colors mb-6"
      >
        <ArrowLeft size={16} /> Back to Escrows
      </button>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-3xl font-mono font-bold text-ink tracking-tight truncate">
            {inv}
          </h1>
          <IconButton
            onClick={onCopy}
            label={`Copy ${inv}`}
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

/* ---------- Column 1 — Metadata & financial ledger ----------
   Locked amount up top, then a stack of border-separated parameter rows. The
   secondary cards (mutual cancel, receiving address) sit beneath so the whole
   column scrolls together rather than stacking visually with the milestones. */
function LedgerColumn({ escrow, role, splits, onChange, optimistic, setOpt, clearOpt }) {
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
          <ParamRow label="Arbiter Status">
            <span className="text-sm text-ink">Decentralized Panel</span>
          </ParamRow>
          <ParamRow label="Gas Asset">
            <span className="text-sm text-ink">{gasAssetLabel(escrow.destinationDomain)}</span>
          </ParamRow>
          <ParamRow label="Destination">
            <span className="text-sm text-ink">{getDomainName(escrow.destinationDomain)}</span>
          </ParamRow>
          <ParamRow label="Deadline">
            <DeadlineCell deadline={escrow.deadline} />
          </ParamRow>
          <ParamRow label="Review Window">
            <span className="text-sm text-ink">{formatWindow(escrow.reviewWindow)}</span>
          </ParamRow>
          <ParamRow label="Contract Suffix" last>
            <span className="font-mono text-xs text-ink-2 tracking-tight">
              {contractSuffix(escrow.invoiceHash)}
            </span>
          </ParamRow>
        </div>

        {escrow.invoiceURI && (
          <a
            href={escrow.invoiceURI}
            target="_blank"
            rel="noreferrer"
            className="self-start text-sm text-clay hover:text-clay-hover transition-colors inline-flex items-center gap-1"
          >
            View invoice ↗
          </a>
        )}
      </div>

      {splits?.length > 0 && <SplitRecipients splits={splits} />}

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

function MilestoneStack({
  escrow, milestones, disputes, role, userAddress,
  reviewWindowExpired, claimed, reviewDeadlines,
  optimistic, onChange, setOpt, clearOpt
}) {
  const hasDispute = milestones.some((m) => m.state === 2)
  const releasedCount = useIntCountUp(milestones.filter((m) => m.state === 3).length)
  return (
    <div className="bg-paper border border-rule rounded-2xl p-6">
      <div className="flex items-baseline justify-between mb-5">
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

      <div className="flex flex-col gap-4">
        <AnimatePresence>
          {milestones.map((m, i) => {
            const opt = optimistic[`milestone_${i}`]
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
                  onChange={onChange}
                  setOpt={setOpt}
                  clearOpt={clearOpt}
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
  escrow, milestone, dispute, role, userAddress,
  reviewWindowExpired, claimed, reviewDeadline,
  optimisticBadge, onChange, setOpt, clearOpt
}) {
  const titles = loadMilestoneTitles(escrow.id)
  const title = titles[milestone.index] || `Milestone ${milestone.index + 1}`

  const now = Math.floor(Date.now() / 1000)
  const deadlinePassed = Number(escrow.deadline) > 0 && now > Number(escrow.deadline)

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
    claimed, reviewWindowExpired, deadlinePassed
  })

  const inDispute = milestone.state === 2
  const rowCls = inDispute
    ? 'border border-warn/40 bg-warn/[0.04] rounded-xl p-5 relative'
    : 'border border-rule bg-paper rounded-xl p-5 relative'
  return (
    <div className={rowCls}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-mono text-[10px] uppercase tracking-[0.18em] ${inDispute ? 'text-warn' : 'text-ink-3'}`}>
              M{milestone.index + 1}
            </span>
            <h3 className="text-base font-semibold text-ink truncate">{title}</h3>
            {optimisticBadge && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border border-clay/30 bg-clay-soft text-clay">
                {optimisticBadge}
              </span>
            )}
          </div>

          {description && (
            <p className="text-sm text-ink-2 leading-relaxed">{description}</p>
          )}

          <div className="font-mono tabular-nums text-xl font-bold text-ink mt-1">
            {formatUSDCNumber(milestone.amount)}
            <span className="text-sm font-sans font-medium text-ink-2 ml-1.5">USDC</span>
          </div>

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
          <MilestoneStateGlyph state={milestone.state} />
          <MilestoneAction
            escrow={escrow}
            milestone={milestone}
            role={role}
            deadlinePassed={deadlinePassed}
            reviewWindowExpired={reviewWindowExpired}
            setOpt={setOpt}
            clearOpt={clearOpt}
            onChange={onChange}
          />
          <DisputeActions
            escrow={escrow}
            milestone={milestone}
            dispute={dispute}
            role={role}
            userAddress={userAddress}
            deadlinePassed={deadlinePassed}
            reviewWindowExpired={reviewWindowExpired}
            onChange={onChange}
          />
        </div>
      </div>

      {milestone.state === 2 && (
        <div className="mt-4 pt-4 border-t border-warn/30 flex flex-col gap-4">
          <div className="text-xs uppercase tracking-[0.18em] font-medium text-warn">
            In review by the arbiter panel
          </div>
          <ArbiterTimeoutNote dispute={dispute} />
          {(role === 'payer' || role === 'freelancer') && (
            <SettlementPanel
              escrow={escrow}
              milestone={milestone}
              role={role}
              onChange={onChange}
            />
          )}
        </div>
      )}

      {(milestone.state === 3 || milestone.state === 4) &&
        dispute && dispute.resolutionHash && dispute.resolutionHash !== ZERO_BYTES32 && (
          <ResolutionNote dispute={dispute} />
        )}
      <ConfettiBurst active={burst} />
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
  const copy = 'If the arbiter does not act within the window, funds are split 50/50 between both parties.'

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

/* Mutual settlement (mutualSettle). Either party proposes a recipient share in
   whole percent; when both parties' proposals match, the contract executes the
   split automatically. We surface both standing proposals and a one-click
   "agree to their number" path. */
function SettlementPanel({ escrow, milestone, role, onChange }) {
  const { depositorProposal, recipientProposal, refetch } = useSettlementProposals(
    escrow.id, milestone.index, escrow.depositor, escrow.recipient
  )
  const { config } = useProtocolConfig()
  const toast = useToast()

  const mine = role === 'payer' ? depositorProposal : recipientProposal
  const theirs = role === 'payer' ? recipientProposal : depositorProposal

  const [pct, setPct] = useState('')
  const tx = useTx({ onConfirmed: () => { setPct(''); refetch(); onChange?.() } })

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
      toast.error(err.message || 'Could not fetch the cross-chain forwarding fee.')
      return
    }
    return tx.run(
      escrowWrite('mutualSettle', [BigInt(escrow.id), BigInt(milestone.index), BigInt(bps), maxFee]),
      { loadingMessage: 'Check your wallet.' }
    )
  }

  const submit = () => { if (canSubmit) propose(Math.round(pctNum * 100)) }

  const bpsToPct = (bps) => Number(bps) / 100
  // Their proposal differs from mine (or I have none): offer to accept it,
  // which makes both proposals match and settles on-chain.
  const canAgree = theirs.exists && (!mine.exists || mine.bps !== theirs.bps)

  return (
    <div className="rounded-xl border border-rule bg-paper p-4 flex flex-col gap-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-ink-3 font-medium">Propose settlement</p>

      <Field label="I propose recipient gets" helper="Whole percent (0–100). Both sides must agree to settle.">
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

      <button className="btn-secondary text-sm py-2" onClick={submit} disabled={!canSubmit}>
        {tx.isBusy ? 'Working…' : 'Submit Proposal'}
      </button>

      {(mine.exists || theirs.exists) && (
        <p className="text-[13px] text-ink-2">
          {mine.exists ? `You proposed ${bpsToPct(mine.bps)}%` : 'You have not proposed yet'}
          {' — '}
          {theirs.exists ? `Counterparty proposed ${bpsToPct(theirs.bps)}%` : 'counterparty has not proposed yet'}
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

/* Shown on a resolved (released/refunded) milestone that went through a
   dispute. Links out to the arbiter's written reasoning and the on-chain
   resolution hash. */
function ResolutionNote({ dispute }) {
  const pct = Number(dispute.resolvedRecipientBps ?? 0n) / 100
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
        <span className="num text-[11px] text-ink-3 break-all">{dispute.resolutionHash}</span>
      </div>
    </div>
  )
}

function describeMilestone(m, { reviewWindowExpired, deadlinePassed }) {
  if (m.state === 0 && deadlinePassed) return 'Deadline passed without delivery. Refundable to the payer.'
  if (m.state === 0) return 'Awaiting freelancer delivery.'
  if (m.state === 1 && !reviewWindowExpired) return 'Delivered. Payer review window open — approve, dispute, or let it auto-release.'
  if (m.state === 1 && reviewWindowExpired) return 'Review window lapsed. Ready to auto-release.'
  if (m.state === 2) return 'In review by the arbiter panel. See evidence below.'
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
function MilestoneAction({
  escrow, milestone, role, deadlinePassed, reviewWindowExpired,
  setOpt, clearOpt, onChange
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

  const id = BigInt(escrow.id)
  const idx = BigInt(milestone.index)
  const isPayer = role === 'payer'
  const isFreelancer = role === 'freelancer'

  // Pick the single highest-priority action available to this caller right now.
  // Lifecycle: PENDING(0) → IN_REVIEW(1) → RELEASED(3); a missed deadline on a
  // PENDING milestone is permissionlessly refundable to the payer.
  let action = null
  if (milestone.state === 0) {
    if (isFreelancer && !deadlinePassed) {
      action = { key: 'claim', label: 'Mark as Delivered', fn: 'claimDelivery', args: [id, idx], optimistic: { badge: 'Claiming…', claimedDelivery: true } }
    } else if (deadlinePassed) {
      action = { key: 'refund', label: 'Refund (deadline passed)', fn: 'refundAfterDeadline', args: [id, idx], optimistic: { badge: 'Refunding…' } }
    }
  } else if (milestone.state === 1) {
    if (isPayer) {
      action = { key: 'approve', label: 'Approve & Release', fn: 'approveRelease', args: [id, idx], needsForwardFee: true, optimistic: { badge: 'Approving…' } }
    } else if (reviewWindowExpired) {
      action = { key: 'release', label: 'Release Payment', fn: 'release', args: [id, idx], needsForwardFee: true, optimistic: { badge: 'Releasing…' } }
    }
  }

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
        toast.error(err.message || 'Could not fetch the cross-chain forwarding fee.')
        return
      }
    }

    try {
      await tx.run(escrowWrite(action.fn, args), { loadingMessage: 'Check your wallet.' })
    } catch {
      clearOpt(`milestone_${milestone.index}`)
    }
  }

  const isLoading = activeKey === action.key && tx.isBusy
  return (
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
        className="relative inline-flex items-center justify-center gap-2 px-4 py-2
                   bg-clay text-paper rounded-xl font-medium text-sm
                   hover:bg-clay-hover
                   transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]
                   disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        {isLoading && (
          <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-paper/40 border-t-paper animate-spin" aria-hidden />
        )}
        {isLoading ? 'Pending…' : action.label}
      </button>
    </div>
  )
}

/* ----- Dispute portal -----
   Secondary, warning-toned actions that a participant can take on a milestone:
   raise a dispute (IN_REVIEW, review window still open — depositor only), or
   submit counter-evidence (DISPUTED, you didn't raise it and none submitted
   yet). At most one of these is reachable for any given milestone state. A
   missed-deadline PENDING milestone is no longer escalated — it is refunded via
   the primary {refundAfterDeadline} action. */
function DisputeActions({
  escrow, milestone, dispute, role, userAddress,
  reviewWindowExpired, onChange
}) {
  const [modal, setModal] = useState(null) // 'raise' | 'counter' | null

  const isParticipant = role === 'payer' || role === 'freelancer'
  if (!isParticipant) return null

  const state = milestone.state
  const counterExists =
    dispute && dispute.counterEvidenceHash && dispute.counterEvidenceHash !== ZERO_BYTES32
  const raisedByMe =
    dispute?.raisedBy && userAddress &&
    dispute.raisedBy.toLowerCase() === userAddress.toLowerCase()

  // raiseDispute is depositor-only and only from IN_REVIEW within the window.
  const canRaise = state === 1 && role === 'payer' && !reviewWindowExpired
  const canCounter = state === 2 && !!dispute?.raisedBy && !raisedByMe && !counterExists

  if (!canRaise && !canCounter) return null

  const btnCls =
    'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-medium text-sm ' +
    'border border-warn/40 text-warn hover:bg-warn/10 transition-colors ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-warn focus-visible:ring-offset-2 focus-visible:ring-offset-paper'

  return (
    <>
      {canRaise && (
        <button type="button" className={btnCls} onClick={() => setModal('raise')}>
          Raise Dispute
        </button>
      )}
      {canCounter && (
        <button type="button" className={btnCls} onClick={() => setModal('counter')}>
          Submit Counter Evidence
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
    </>
  )
}

const EVIDENCE_MODES = {
  raise: {
    title: 'Raise a dispute',
    fn: 'raiseDispute',
    needsReason: true,
    submitLabel: 'Submit dispute',
    evidenceLabel: 'Evidence link',
    blurb: 'Freezes this delivered milestone for the arbiter panel to review. Provide a reason and a link to your evidence.'
  },
  counter: {
    title: 'Submit counter-evidence',
    fn: 'submitCounterEvidence',
    needsReason: false,
    submitLabel: 'Submit counter-evidence',
    evidenceLabel: 'Counter-evidence link',
    blurb: 'Respond to the open dispute with your own evidence. You can only submit this once.'
  }
}

/* Shared evidence form for raise / counter. The evidence link is
   hashed client-side with keccak256 to produce the bytes32 the contract stores
   as tamper-proof proof; the link itself is stored as the URI. */
function EvidenceModal({ open, mode, escrowId, milestoneIndex, onClose, onConfirmed }) {
  const meta = mode ? EVIDENCE_MODES[mode] : null
  const [reason, setReason] = useState('')
  const [uri, setUri] = useState('')
  const tx = useTx({ onConfirmed: () => { setReason(''); setUri(''); onConfirmed?.() } })

  useEffect(() => { if (!open) { setReason(''); setUri('') } }, [open])

  if (!open || !meta) return null

  const uriValid = isValidUrl(uri)
  const reasonValid = !meta.needsReason || reason.trim().length > 0
  const canSubmit = uriValid && reasonValid && !tx.isBusy
  const evidenceHash = uriValid ? hashDescription(uri) : null

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
          helper="Link to your evidence (URL or IPFS gateway). Hashed locally; the hash is stored on-chain."
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

/* ---------- Receiving address (inline-edit card) ---------- */
function UpdateReceivingAddressCard({ escrow, onChange }) {
  const [editing, setEditing] = useState(false)
  const [addr, setAddr] = useState('')
  const [domain, setDomain] = useState(() => Number(escrow.destinationDomain ?? ARC_DOMAIN))
  const [successInfo, setSuccessInfo] = useState(null)
  const { supported } = useSupportedDomains()
  const addrId = useId()
  const chainId = useId()

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
    <div className="bg-paper border border-rule rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] uppercase tracking-[0.18em] text-ink-3 font-medium">Receiving address</h3>
        {!editing && (
          <button
            type="button"
            className="text-xs text-clay hover:text-clay-hover transition-colors"
            onClick={() => { setEditing(true); setSuccessInfo(null); setDomain(currentDomain || ARC_DOMAIN) }}
          >
            Edit
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 bg-sunk rounded-xl px-3 py-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3">Current</div>
        {currentAddress ? <AddressInline address={currentAddress} /> : <span className="text-sm text-ink-3">—</span>}
        <div className="text-xs text-ink-2 font-mono">{getDomainName(currentDomain)}</div>
      </div>

      <p className="text-xs text-ink-2 leading-relaxed">Where approved milestone payments get sent. You can update this anytime before the escrow is completed or cancelled.</p>

      {successInfo && !editing && (
        <div className="rounded-xl border border-ok/40 bg-ok/10 px-3 py-2.5 text-xs text-ok flex items-start gap-2">
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
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-3 overflow-hidden"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor={addrId} className="text-xs font-medium text-ink-2">New address</label>
              <input
                id={addrId}
                className="input-field font-mono text-sm"
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={addr && !isValidAddress(addr) ? true : undefined}
                value={addr}
                onChange={(e) => setAddr(e.target.value.trim())}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={chainId} className="text-xs font-medium text-ink-2">Receiving chain</label>
              <CustomSelect
                id={chainId}
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
