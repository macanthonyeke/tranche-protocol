import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.jsx'

import PageHeader from '../components/PageHeader.jsx'
import ConnectGate from '../components/ConnectGate.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import Modal from '../components/Modal.jsx'
import Field from '../components/Field.jsx'
import Skeleton from '../components/Skeleton.jsx'
import WalletButton from '../components/WalletButton.jsx'
import { useRoles } from '../hooks/useRoles.jsx'
import { useDisputedEscrows, useEscrowDetail, useDisputeConfig, useTick, useEscrowInvoice } from '../hooks/useEscrows.js'
import { useProtocolConfig } from '../hooks/useArbiter.js'
import InvoiceCard from '../components/InvoiceCard.jsx'
import { useTx, escrowWrite } from '../hooks/useTx.js'
import { resolveDominantMaxFee } from '../utils/cctpFee.js'
import { isValidBytes32, bytes32ToAddress, hashDescription } from '../utils/encode.js'
import { cctpTrackKey, encodeReceiveMessage, receiptEmittedCctpMessageForMilestone } from '../utils/irisDelivery.js'
import { safeSetItem } from '../utils/safeStorage.js'
import { getDomainName, ARC_DOMAIN, getChainExplorerTx, MESSAGE_TRANSMITTER_V2, EVM_CHAIN_PARAMS } from '../config/chains.js'
import { formatUSDC, formatUSDCNumber, formatTimestamp, formatDeadline, formatWindow, countdown } from '../utils/format.js'
import { useCctpDelivery } from '../hooks/useCctpDelivery.js'
import { CONTRACT_ADDRESS } from '../config/contract.js'

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

export default function ArbiterPanel() {
  return (
    <div>
      <PageHeader
        eyebrow="Arbiter queue"
        title="Open disputes."
        kicker="Each escrow below has at least one milestone in dispute. Open a row to read the evidence and resolve."
      />
      <ConnectGate><Gate /></ConnectGate>
    </div>
  )
}

function Gate() {
  const { isArbiter, isLoading } = useRoles()
  if (isLoading) return <Skeleton className="h-48" />
  if (!isArbiter) {
    return (
      <div className="max-w-prose flex flex-col gap-4">
        <p className="text-ink-2 text-[15px] leading-relaxed">
          This wallet doesn't hold the arbiter role. If you should have it, contact a default admin to grant{' '}
          <span className="num text-[12.5px]">ARBITER_ROLE</span>.
        </p>
        <div><WalletButton /></div>
      </div>
    )
  }
  return <Body />
}

function Body() {
  useTick(20_000)
  const { escrows, isLoading, error, refetch } = useDisputedEscrows()
  const [openId, setOpenId] = useState(null)
  const open = (escrows || []).filter((e) => e && Number(e.disputedMilestoneCount) > 0)

  return (
    <div className="pb-20 flex flex-col gap-10">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">Queue · {error ? '?' : open.length}</p>
        <button className="btn-quiet" onClick={() => refetch()}>Refresh</button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : error ? (
        <div className="flex flex-col items-start gap-3 py-12">
          <p className="text-warn text-[14.5px]">Failed to load the dispute queue — the indexer may be temporarily unavailable.</p>
          <p className="text-ink-3 text-[13px]">{error.message || String(error)}</p>
          <button className="btn-quiet text-[13px]" onClick={() => refetch()}>Try again</button>
        </div>
      ) : open.length === 0 ? (
        <p className="text-ink-3 text-[14.5px] py-12">No open disputes. The queue is clear.</p>
      ) : (
        <ul className="flex flex-col">
          <div className="rule" />
          {open.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => setOpenId(s.id)}
                className="w-full grid grid-cols-12 items-center gap-3 py-4 px-2 -mx-2 rounded-md hover:bg-sunk transition-colors text-left"
              >
                <span className="col-span-1 seq text-[12px] text-ink-3">#{s.id}</span>
                <span className="col-span-3 flex items-center gap-2 min-w-0 truncate">
                  <span className="text-[10.5px] text-ink-3 uppercase tracking-[0.12em] shrink-0">Payer</span>
                  <AddressDisplay address={s.depositor} />
                </span>
                <span className="col-span-3 flex items-center gap-2 min-w-0 truncate">
                  <span className="text-[10.5px] text-ink-3 uppercase tracking-[0.12em] shrink-0">Freelancer</span>
                  <AddressDisplay address={s.recipient} />
                </span>
                <span className="col-span-2 num text-[14px] text-ink min-w-0 truncate">{formatUSDCNumber(s.totalAmount)} USDC</span>
                <span className="col-span-2 justify-self-end status-bad shrink-0">{s.disputedMilestoneCount} disputed</span>
                <span className="col-span-1 justify-self-end text-ink-3 shrink-0">→</span>
              </button>
              <div className="rule" />
            </li>
          ))}
        </ul>
      )}

      <ResolutionDrawer id={openId} onClose={() => setOpenId(null)} onResolved={() => { refetch() }} />
    </div>
  )
}

function ResolutionDrawer({ id, onClose, onResolved }) {
  const { address } = useAuth()
  const { detail, refetch } = useEscrowDetail(id, address, { pollMs: 0 })
  const hasInvoice = !!(detail?.escrow?.invoiceHash && detail.escrow.invoiceHash !== ZERO_BYTES32)
  const { invoiceData, invoiceAcknowledgedAt } = useEscrowInvoice(hasInvoice ? id : null)

  if (!id) return null
  if (!detail) {
    return (
      <Modal open={true} onClose={onClose} title={`Escrow #${id}`} size="lg">
        <Skeleton className="h-32" />
      </Modal>
    )
  }

  const disputedIndexes = detail.milestones
    .map((m, i) => (m.state === 2 ? i : null))
    .filter((x) => x !== null)

  return (
    <Modal
      open={true} onClose={onClose}
      title={`Escrow #${id} · Resolve disputes`} size="lg"
      footer={<button className="btn-quiet" onClick={onClose}>Close</button>}
    >
      <div className="flex flex-col gap-7 max-h-[68vh] overflow-y-auto pr-2 -mr-2">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="eyebrow mb-1">Total locked</p>
            <p className="num text-[20px] text-ink">
              {formatUSDCNumber(detail.escrow.totalAmount)}
              <span className="text-ink-3 text-[13px] font-sans"> USDC</span>
            </p>
          </div>
          <Link to={`/escrow/${id}`} className="btn-secondary" target="_blank">Open full view ↗</Link>
        </div>

        {hasInvoice && (
          <InvoiceCard
            escrowId={id}
            invoiceHash={detail.escrow.invoiceHash}
            invoiceData={invoiceData}
            invoiceURI={detail.escrow.invoiceURI}
            invoiceAcknowledgedAt={invoiceAcknowledgedAt}
            role="arbiter"
          />
        )}

        {detail.splits?.length > 0 && <SplitsPanel splits={detail.splits} />}

        <ul className="flex flex-col gap-7">
          {disputedIndexes.map((i) => (
            <DisputeBlock key={i} detail={detail} index={i} refetch={() => { refetch(); onResolved() }} />
          ))}
        </ul>
      </div>
    </Modal>
  )
}

/* Where released funds will actually land. Shown so the arbiter understands
   that a "release to freelancer" decision fans out to these split recipients,
   each on its own destination chain, by bps share. */
function SplitsPanel({ splits }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="eyebrow">Split recipients · {splits.length}</p>
      <ul className="flex flex-col">
        {splits.map((s, i) => {
          const addr = s.mintRecipient ? bytes32ToAddress(s.mintRecipient) : null
          const pct = (Number(s.bps) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })
          return (
            <li
              key={i}
              className={`flex items-center justify-between gap-3 py-2.5 ${i === splits.length - 1 ? '' : 'border-b border-rule'}`}
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                {addr ? <AddressDisplay address={addr} /> : <span className="text-[13px] text-ink-3">—</span>}
                <span className="text-[11.5px] text-ink-3 font-mono">{getDomainName(s.destinationDomain)}</span>
              </div>
              <span className="num text-[14px] text-ink shrink-0">{pct}%</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function DisputeBlock({ detail, index, refetch }) {
  const m = detail.milestones[index]
  const d = detail.disputes[index]
  const e = detail.escrow
  const { arbiterWindow, bpsDenominator } = useDisputeConfig()
  const [resolveTxHash, setResolveTxHash] = useState(null)
  const [resolveOrdinals, setResolveOrdinals] = useState(null)
  const [resolveTotalMessages, setResolveTotalMessages] = useState(null)
  const [resolveFingerprints, setResolveFingerprints] = useState(null)

  // Round 19 Phase C: split-aware, same as resolveIsCrossChain/
  // resolveDisputeMaxFeePlan above — not the raw e.destinationDomain this
  // used to read independently.
  const trackingDomain = resolveTrackingDomain(e, detail.splits)

  // Single ARBITER_WINDOW read from the contract rather than hardcoding 14d.
  const windowSecs = arbiterWindow
  const timeoutAt = Number(d.raisedAt) + Number(windowSecs)
  const now = Math.floor(Date.now() / 1000)
  const canTimeout = windowSecs > 0n && now >= timeoutAt

  // A DISPUTED milestone always carries both a delivery-claim and an objection,
  // so the contract's timeout fallback settles it as a fixed 50/50 split.
  const timeoutOutcome = 'Funds split 50/50 — the freelancer\'s share arrives as a claimable balance and is charged the protocol fee.'

  // Round 22 Phase A: gated on receiptEmittedCctpMessageForMilestone
  // (Round 26: was the bare receiptEmittedCctpMessage), not on "was this
  // escrow/split CONFIGURED for cross-chain" — a resolveDispute ruling can
  // execute while rounding every share to zero or diverting every
  // cross-chain leg to an Arc credit, with no CCTP message ever created.
  // Receives the full confirmed receipt now (see ResolveForm's own tx
  // below), not a broadcast-time txHash string — the same
  // broadcast-vs-mined gap Round 21 Phase D already closed for mutualSettle.
  // resolveDisputeByTimeout's own onConfirmed still calls this with `null`
  // (it never goes cross-chain at all, TrancheProtocol.sol:596/:614 —
  // both halves always become Arc refund credits), which correctly no-ops
  // here without needing a receipt to prove that.
  //
  // Round 26 finding 3: milestone-scoped and authenticity-verified, not
  // just "a real MessageSent exists somewhere in this receipt" — Circle
  // wallets are ERC-4337 smart accounts, and a bundler's handleOps can pack
  // a foreign UserOperation's logs into the same receipt. detail.id/index
  // are already in scope — no discovery needed, unlike the fallback path.
  const handleResolve = useCallback((receipt) => {
    if (receipt) {
      const { emitted, ordinals, totalMessages, fingerprints } = receiptEmittedCctpMessageForMilestone(receipt, detail.id, index)
      if (emitted) {
        setResolveTxHash(receipt.transactionHash)
        setResolveOrdinals(ordinals)
        setResolveTotalMessages(totalMessages)
        setResolveFingerprints(fingerprints)
        // Also persist to localStorage so EscrowDetail picks it up on other
        // devices. Round 20 Phase D: no `domain` field — no reader ever
        // consumed it (both this component and EscrowDetail's MilestoneRow
        // recompute the domain live from escrow/splits), and a single stored
        // domain couldn't represent a mixed split's several real per-message
        // domains anyway. useCctpDelivery gets its per-message domains from
        // Iris directly once it has the txHash.
        //
        // Round 27: expectedOrdinals/expectedTotalMessages, not the raw hex
        // `messages` array Round 26 persisted here — see useCctpDelivery's
        // own doc comment for why content matching against Iris never
        // actually worked.
        safeSetItem(
          cctpTrackKey(detail.id, index),
          JSON.stringify({ txHash: receipt.transactionHash, ts: Date.now(), expectedOrdinals: ordinals, expectedTotalMessages: totalMessages, expectedFingerprints: fingerprints })
        )
      }
    }
    refetch()
  }, [detail.id, index, refetch])

  return (
    <li className="flex flex-col gap-4 pb-7 border-b border-rule last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="seq text-[12px] text-ink-3">M{index + 1}</span>
          <p className="display text-[22px] text-ink leading-tight">
            {`Milestone ${index + 1}: ${formatUSDC(m.amount).replace(' USDC', '')} USDC`}
          </p>
        </div>
        <span className="status-bad">Disputed</span>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-ink-3">
        {Number(m.claimedAt) > 0 && (
          <span>Claimed: <span className="text-ink-2">{formatTimestamp(m.claimedAt)}</span></span>
        )}
        {Number(e.deadline) > 0 && (
          <span>Deadline: <span className="text-ink-2">{formatDeadline(e.deadline)}</span></span>
        )}
        {Number(e.reviewWindow) > 0 && (
          <span>Review window: <span className="text-ink-2">{formatWindow(e.reviewWindow)}</span></span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <Side
          label="Payer"
          who={d.raisedBy}
          when={d.raisedAt}
          reason={d.reason}
          uri={d.evidenceURI}
        />
        {d.counterEvidenceHash && d.counterEvidenceHash !== ZERO_BYTES32 ? (
          <Side
            label="Freelancer"
            who={d.raisedBy?.toLowerCase() === e.depositor.toLowerCase() ? e.recipient : e.depositor}
            uri={d.counterEvidenceURI}
          />
        ) : (
          <div>
            <p className="eyebrow mb-1">Freelancer</p>
            <p className="text-[13px] text-ink-3">No counter-evidence submitted.</p>
          </div>
        )}
      </div>

      <EvidenceHashVerifier
        payerHash={d.evidenceHash}
        freelancerHash={d.counterEvidenceHash}
      />

      <ResolveForm
        id={detail.id} index={index}
        escrow={e}
        milestone={m}
        splits={detail.splits}
        bpsDenominator={bpsDenominator}
        onResolved={handleResolve}
        canTimeout={canTimeout}
        timeoutAt={timeoutAt}
        timeoutOutcome={timeoutOutcome}
      />

      {resolveTxHash && trackingDomain != null && (
        <ArbiterDeliveryStatus
          txHash={resolveTxHash}
          isCrossChain={trackingDomain != null}
          expectedOrdinals={resolveOrdinals}
          expectedTotalMessages={resolveTotalMessages}
          expectedFingerprints={resolveFingerprints}
        />
      )}
    </li>
  )
}

function Side({ label, who, when, reason, uri }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">{label}</p>
        {when && Number(when) > 0 && <p className="text-[11.5px] text-ink-3">{formatTimestamp(when)}</p>}
      </div>
      {who ? <AddressDisplay address={who} /> : <span className="text-[13px] text-ink-3">—</span>}
      {reason && <p className="text-[13.5px] text-ink-2 leading-relaxed mt-1">{reason}</p>}
      {uri && (
        <a href={uri} target="_blank" rel="noreferrer" className="text-clay hover:opacity-80 underline-offset-2 hover:underline text-[12.5px] break-all">
          {uri}
        </a>
      )}
    </div>
  )
}

const domainLabel = (domain) => (domain != null ? getDomainName(domain) : 'an unknown chain')

/* Shown in the arbiter's DisputeBlock after resolveDispute confirms cross-chain.
   Polls Iris so the arbiter can confirm the payment was forwarded.

   Round 20 Phase D: renders each CCTP message in `deliveries` independently
   by its OWN forwardState/destinationDomain, instead of gating the whole
   block on one aggregate `phase` string — see EscrowDetail.jsx's
   CrossChainDelivery for the full citation trail on why a single collapsed
   phase/domain silently hid an already-delivered leg whenever a DIFFERENT
   leg in the same mixed split failed. */
function ArbiterDeliveryStatus({ txHash, isCrossChain, expectedOrdinals, expectedTotalMessages, expectedFingerprints }) {
  const { phase, deliveries } = useCctpDelivery(txHash, isCrossChain, expectedOrdinals, expectedTotalMessages, expectedFingerprints)

  if (phase === 'idle') return null

  return (
    <div className="flex flex-col gap-1.5 pt-2 border-t border-rule mt-1">
      {phase === 'polling' && deliveries.length === 0 && (
        <div className="flex items-center gap-2 text-[12px] text-ink-2">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-ink-3/40 border-t-clay animate-spin shrink-0" aria-hidden />
          Delivering…
        </div>
      )}
      {deliveries.map((d, i) => {
        const chainName = domainLabel(d.destinationDomain)
        if (d.forwardState === 'COMPLETE') {
          const url = d.destinationDomain != null ? getChainExplorerTx(d.destinationDomain, d.destinationTxHash) : null
          return (
            <div key={i} className="flex items-center gap-2 text-[12px] text-ok">
              <span>✓ Delivered to {chainName}</span>
              {url && <a href={url} target="_blank" rel="noreferrer" className="text-clay hover:opacity-80">View tx ↗</a>}
            </div>
          )
        }
        if (d.forwardState === 'FAILED') {
          return (
            <p key={i} className="text-[12px] text-warn">
              Delivery to {chainName} failed — forwarding fee was too low. The recipient should self-relay via the escrow detail page.
            </p>
          )
        }
        return (
          <div key={i} className="flex items-center gap-2 text-[12px] text-ink-2">
            <span className="inline-block h-3 w-3 rounded-full border-2 border-ink-3/40 border-t-clay animate-spin shrink-0" aria-hidden />
            Delivering to {chainName}…
          </div>
        )
      })}
      {phase === 'unavailable' && (
        <p className="text-[12px] text-ink-3">Delivery status unavailable.</p>
      )}
      {/* Round 29 (Low finding) — same distinct treatment as
          EscrowDetail.jsx's CrossChainDelivery: 2+ minutes of the identical
          inconsistent state, not ordinary polling latency. */}
      {phase === 'stale' && (
        <p className="text-[12px] text-warn">Delivery status hasn't changed in over 2 minutes — still checking.</p>
      )}
    </div>
  )
}

/* Arbiter tool: paste any evidence link to compute its hash and check it against
   the hashes committed on-chain by each party. Catches URI-substitution claims. */
function EvidenceHashVerifier({ payerHash, freelancerHash }) {
  const [open, setOpen] = useState(false)
  const [uri, setUri] = useState('')

  const computed = uri.trim() ? hashDescription(uri.trim()) : null
  const matchesPayer     = computed && payerHash     && payerHash     !== ZERO_BYTES32 && computed.toLowerCase() === payerHash.toLowerCase()
  const matchesFreelancer = computed && freelancerHash && freelancerHash !== ZERO_BYTES32 && computed.toLowerCase() === freelancerHash.toLowerCase()
  const noMatch = computed && !matchesPayer && !matchesFreelancer

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="self-start text-[11.5px] text-ink-3 hover:text-ink-2 transition-colors"
      >
        {open ? '▾ Hide hash verifier' : '▸ Verify evidence hashes'}
      </button>
      {open && (
        <div className="rounded-xl bg-sunk px-3 py-3 flex flex-col gap-3">
          <p className="text-[11.5px] text-ink-3 leading-relaxed">
            Paste an evidence link to verify it matches a hash committed on-chain. Mismatches indicate the link was not the one originally submitted.
          </p>
          <input
            type="text"
            className="input text-[12.5px]"
            placeholder="Paste evidence link to verify…"
            autoComplete="off"
            spellCheck={false}
            value={uri}
            onChange={(e) => setUri(e.target.value)}
          />
          {computed && (
            <div className="flex flex-col gap-1.5">
              <div className="font-mono text-[10.5px] text-ink-3 break-all">{computed}</div>
              {matchesPayer && (
                <p className="text-[12px] text-ok font-medium">✓ Matches payer evidence hash</p>
              )}
              {matchesFreelancer && (
                <p className="text-[12px] text-ok font-medium">✓ Matches freelancer evidence hash</p>
              )}
              {noMatch && (
                <p className="text-[12px] text-warn">No match — this link was not committed on-chain.</p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1 border-t border-rule pt-2">
            <EvidenceHashRow label="Payer hash" hash={payerHash} />
            <EvidenceHashRow label="Freelancer hash" hash={freelancerHash} />
          </div>
        </div>
      )}
    </div>
  )
}

function EvidenceHashRow({ label, hash }) {
  const valid = hash && hash !== ZERO_BYTES32
  return (
    <div className="flex items-start gap-2">
      <span className="text-[11px] text-ink-3 shrink-0 w-28">{label}:</span>
      <span className="font-mono text-[10.5px] text-ink-3 break-all">{valid ? hash : '—'}</span>
    </div>
  )
}

/* Where each half of a timeout settlement lands.
 *
 * Deliberately NOT EscrowDetail's payoutLines(): that one describes a CCTP
 * payout ("Paid on: Base"), and a timeout settlement never routes through
 * CCTP. Both halves become Arc refund credits regardless of the escrow's
 * destinationDomain (TrancheProtocol.sol:596, :614), so borrowing that helper
 * would name a chain the money never reaches.
 *
 * Split escrows fan the freelancer's half across the split legs, credited to
 * each leg's decoded Arc address. The proportional/last-absorbs-dust mechanics
 * and the SE-4 non-EVM caveat are real but belong in the docs, not on a
 * signing screen — same level of abstraction as Round 1's split handling. */
export function timeoutCreditLines(escrow, splits) {
  return [
    ...(splits?.length > 0
      // Round 16 #1: found via the same grep #4 asked for, not itself named
      // in scope, but the identical shape — "divided across N split
      // recipients" is an outcome claim the very next line's exception
      // already contradicts. Not every configured recipient necessarily
      // gets something: the credit loop is guarded by `share > 0` (:608),
      // so a leg whose proportional share rounds down to zero is skipped
      // entirely. Reframed around the CONFIGURATION, same as payoutLines
      // and resolveDisputeConfirm's split branches.
      ? [
        `${splits.length} configured split entries, by their configured percentages`,
        'A recipient whose share rounds down to zero is credited nothing.'
      ]
      : [`Freelancer's share goes to ${escrow.recipient}`]),
    `Payer's share goes to ${escrow.refundTo}`
  ]
}

/* The 50/50 shares, mirroring TrancheProtocol.sol:576-578 exactly — including
   the remainder. recipientShare rounds down and depositorShare is the
   subtraction, so on an odd amount the payer absorbs the odd base unit and the
   two shares always sum to the milestone amount.
 *
 * Split out and exported because that invariant cannot be checked through the
 * rendered copy: the remainder is at most one base unit (0.000001 USDC) and
 * formatUSDC rounds to two decimals, so both a correct implementation and a
 * naive amount/2 print the same string. */
export function timeoutShares(amount, bpsDenominator) {
  const denom = bpsDenominator > 0n ? bpsDenominator : 10_000n
  const recipientShare = (amount * 5000n) / denom
  return { recipientShare, depositorShare: amount - recipientShare }
}

/* VALUE-MOVING. resolveDisputeByTimeout is the contract's automatic fallback
   for a dispute no arbiter ruled on within ARBITER_WINDOW (14 days). It is
   permissionless and takes no caller input: defaultBps is hardcoded to 5000
   (TrancheProtocol.sol:576).

   Two things the copy has to keep apart, because the same panel offers both
   and they are easy to conflate — the arbiter's discretionary resolve (a
   percentage the arbiter chooses, settled via CCTP) and this, a fixed 50/50
   that nobody chooses and that never leaves Arc. Whoever signs this may not
   be the arbiter at all.

   Gross figures only. The two halves are exact — computed the way the
   contract computes them, with the remainder going to the payer — but the
   protocol fee is escrowFeeBps, snapshotted at deposit and unreadable from
   the frontend, so the freelancer's net is not stated. The asymmetry is,
   because it holds regardless of the rate: the fee comes off the
   freelancer's half only (:583).

   Round 14 #10: gross-only is fine as a design choice, but the credited-line
   used to say "Both halves are credited" right below the two gross figures —
   read together, that states the freelancer's GROSS half lands as their
   credit. It does not: :593 computes recipientNet = recipientShare - fee and
   THAT is what's credited (:596/:609); the fee is a separate safeTransfer to
   the treasury (:621). The payer's half, with no fee, is credited in full
   (:614) — so the two halves are not even credited the same way, which
   "Both halves are credited" also flattens. */
export function timeoutSettlementConfirm({ escrow, milestone, index, splits, timeoutAt, bpsDenominator }) {
  const { recipientShare, depositorShare } = timeoutShares(milestone.amount, bpsDenominator)

  return {
    title: 'Settle this dispute by timeout',
    subtitle: 'The arbitration window closed with no arbiter ruling, so the contract settles it automatically. Anyone can trigger this, and the outcome is fixed.',
    amount: milestone.amount,
    amountLabel: 'Amount settled',
    contractName: 'Tranche Protocol Escrow',
    contractAddress: CONTRACT_ADDRESS,
    functionName: 'resolveDisputeByTimeout',
    parameters: [
      `Milestone ${index + 1} of ${Number(escrow.milestoneCount)}: ${formatUSDC(milestone.amount)}`,
      'Fixed 50/50 split written into the contract — this is not an arbiter ruling and the share cannot be adjusted.',
      `Freelancer's half: ${formatUSDC(recipientShare)} before the protocol fee`,
      `Payer's half: ${formatUSDC(depositorShare)}`,
      ...timeoutCreditLines(escrow, splits),
      "The protocol fee is taken from the freelancer's half only — the payer's half is fee-free.",
      "The payer's half is credited to Arc in full. The freelancer's half is credited net of that fee — the fee itself goes to the protocol treasury, not into either balance. Neither half is sent to a wallet.",
      `Arbitration window closed ${formatTimestamp(timeoutAt)}. Anyone can submit this.`
    ]
  }
}

/* Where a no-split payout actually lands. The CCTP burn targets
   e.mintRecipient (TrancheProtocol.sol:1298); e.recipient is only the
   authorisation identity, and updateReceivingAddress moves mintRecipient
   without ever touching it (:986-990). Naming `recipient` on a signing screen
   therefore shows the pre-redirect address as though it were the destination.

   The one place recipient IS the destination is the Finding 3 divert: a
   cross-chain share at-or-below the floor is credited to
   refundBalances[e.recipient] on Arc instead (:1291-1293). Handled separately
   below, and deliberately not conflated with this. */
function payoutAddress(escrow) {
  return escrow.mintRecipient ? bytes32ToAddress(escrow.mintRecipient) : escrow.recipient
}

/* Mirrors _assertCrossChainFee (TrancheProtocol.sol): with splits configured,
   e.destinationDomain is not what the burn uses, so ANY non-Arc leg makes the
   settlement cross-chain. */
function resolveIsCrossChain(escrow, splits) {
  if (splits?.length > 0) return splits.some((s) => Number(s.destinationDomain) !== ARC_DOMAIN)
  return Number(escrow.destinationDomain) !== ARC_DOMAIN
}

/* Round 19 Phase C. The domain to hand useCctpDelivery for post-submission
   tracking — null when resolveIsCrossChain says there's nothing to track.
   Reading the root escrow.destinationDomain here (the bug this replaces)
   silently disagreed with resolveIsCrossChain whenever an Arc-root escrow's
   cross-chain-ness came from a split leg instead: tracking would never start
   even though the burn genuinely leaves Arc. Picking the first non-Arc split
   leg when one exists keeps the domain passed down consistent with why
   resolveIsCrossChain said this is cross-chain in the first place. */
export function resolveTrackingDomain(escrow, splits) {
  if (!resolveIsCrossChain(escrow, splits)) return null
  if (splits?.length > 0) {
    return splits.find((s) => Number(s.destinationDomain) !== ARC_DOMAIN)?.destinationDomain ?? escrow.destinationDomain
  }
  return escrow.destinationDomain
}

/* Round 18 Phase B. Decides what maxFee resolveDispute should submit, reusing
   resolveIsCrossChain — the SAME split-aware determination the confirm
   descriptor above already uses — instead of the raw escrow.destinationDomain
   the submission code used to read independently. That gap meant an Arc-root
   escrow with a cross-chain split leg would be quoted 0 by the raw check
   while _assertCrossChainFee (TrancheProtocol.sol:1382) correctly saw the
   split leg and required a floor-clearing value, so submission and descriptor
   could disagree in a way that guarantees a revert.

   Round 19 Phase B: Round 18's version tried to estimate the real remainder
   (via worstCaseRemainder's ceiling bound) to decide whether a live Circle
   quote could safely be submitted, and REJECTED the transaction outright when
   the estimate looked unsafe — but "conservative estimate <= floor" and
   "real remainder <= floor" are different conditions, so it could reject a
   transaction the contract would have accepted. Verified directly against
   the contract instead: submitting exactly the escrow's own floor is
   unconditionally safe for every cross-chain, bps > 0 case — split or not,
   divert-reachable or not.
     - The divert-vs-burn decision (TrancheProtocol.sol:1291) is made by the
       contract from its OWN computed real remainder — the submitted maxFee
       plays no role in that decision at all.
     - Exactly one assertion applies beforehand, regardless of which branch
       later fires: maxFee >= e.escrowCctpForwardFee (TrancheProtocol.sol:
       1398-1399).
     - The divert branch never reads maxFee again after that assertion.
     - The burn branch's only further constraint is maxFee < remainder
       (TrancheProtocol.sol:1354, inside _approveAndBurn) — and that branch is
       ONLY entered when remainder > floor (the divert condition's negation),
       so maxFee = floor always satisfies it without needing to know the real
       remainder.

   Round 20 Phase C: the floor is always SAFE, but for a no-split cross-chain
   burn where floor < Circle's live fee < the real remainder, floor-only
   submission dispatches a burn that clears the contract's own check yet
   still fails Circle's forwarding delivery with INSUFFICIENT_FEE, forcing a
   self-relay that a correctly-fee'd burn would never have needed. Split legs
   and the rounds-to-zero case still skip the live quote entirely — split
   legs always burn at the snapshot regardless of what's submitted (settled
   decision #7), and a zero recipient share triggers no burn at all
   (TrancheProtocol.sol:1248's `if (recipientAmount > 0)` guard) — so a quote
   for either would fetch a number the contract never uses. Only the genuine
   no-split, nonzero-share burn signals `needsLiveQuote`; the caller resolves
   it via {resolveDominantMaxFee} in utils/cctpFee.js, which uses the quote
   ONLY when it is provably below worstCaseRemainder's bound on the real
   remainder — never as a rejection trigger, and never blocking the
   transaction on a failed fetch.

   Synchronous and pure on purpose: this test harness cannot execute real
   Solidity, but it CAN verify this decision independently of the component. */
export function resolveDisputeMaxFeePlan({ escrow, splits, bps, recipientAmount, maxProtocolFeeBps }) {
  const crossChain = resolveIsCrossChain(escrow, splits)
  const floor = escrow.escrowCctpForwardFee ?? 0n

  // _assertCrossChainFee only runs at all when bps > 0 (TrancheProtocol.sol:
  // 510) — at bps 0 there is no recipient share and nothing to clear a floor
  // for.
  if (!crossChain || !(bps > 0)) return { maxFee: 0n }

  // Split legs burn at the snapshot regardless of what's submitted; a
  // rounds-to-zero share triggers no burn at all but still runs the fee
  // assertion (gated on bps alone, not the post-rounding amount) — a live
  // quote is pointless for either, so both submit the floor directly.
  if (splits?.length > 0 || recipientAmount === 0n) return { maxFee: floor }

  return {
    needsLiveQuote: true,
    quoteParams: { destinationDomain: escrow.destinationDomain, floor, recipientAmount, maxProtocolFeeBps }
  }
}

/* VALUE-MOVING, and the last signing site in the project. This is the twin
   timeoutSettlementConfirm above warns about — same panel, same milestone,
   opposite mechanics — so the two screens have to be impossible to mix up:

   - The timeout is permissionless, fixed at 50/50, and NEVER LEAVES ARC: both
     halves land as refund credits (:593-614). This one is ARBITER_ROLE-gated
     (:495), the percentage is chosen, and the freelancer's share is really
     burned through CCTP to their destination chain (:516 → :1248-1299). That
     difference is the single most important thing on the screen.

   Three more things the contract decides that the form does not show:

   1. maxFee is LIVE here, unlike mutualSettle where the same parameter is
      dead. _assertCrossChainFee floors the CALLER's maxFee (:510), and the
      no-split burn uses it (:1298). Split legs do not — each burns at the
      e.escrowCctpForwardFee snapshot instead (:1329). That is settled
      decision #7's asymmetry, and it is stateable rather than arcane: the fee
      figure that governs differs between the two shapes, so the screen names
      whichever one actually applies.

   2. The protocol fee is still escrowFeeBps, snapshotted, no getter. Same
      rule as everywhere else: exact gross halves, the asymmetry stated, never
      a rate and never a net.

   3. Once ARBITER_WINDOW has elapsed the timeout becomes available to anyone,
      so a late ruling races a permissionless 50/50. `canTimeout` is already
      computed for the button below, so the screen can say so.

   The resolution hash and URI are stored in DisputeData (:512-513) — public
   and permanent, like the evidence in Round 8. */
export function resolveDisputeConfirm({
  escrow, milestone, index, splits, bps, resolutionUri, maxFee, canTimeout, bpsDenominator
}) {
  const denom = bpsDenominator > 0n ? bpsDenominator : 10_000n
  const recipientShare = (milestone.amount * BigInt(bps)) / denom
  const payerShare = milestone.amount - recipientShare
  const pct = bps / 100
  const crossChain = resolveIsCrossChain(escrow, splits)
  const floor = escrow.escrowCctpForwardFee ?? 0n
  const partial = bps > 0 && bps < 10_000
  // Round 16 #3: bps > 0 does not guarantee recipientShare > 0 — integer
  // division can floor a small enough milestone amount times a small enough
  // bps to zero even though the arbiter's ruling assigned a genuinely
  // nonzero percentage. Distinct from a per-leg rounding-to-zero (still
  // disclosed below when it applies): here nothing reaches the freelancer
  // at all, so it gets its own branch rather than walking through
  // delivery/chain/fee copy for a transfer that never happens.
  const recipientGetsPaid = bps > 0 && recipientShare > 0n
  // Round 17 Phase A: whenever both of these hold, Finding 3's sub-floor
  // divert-to-Arc is reachable for THIS call — the frontend cannot compute
  // the exact post-fee amount (escrowFeeBps has no getter), so it cannot
  // know in advance which branch fires. Every destination/delivery/fee fact
  // below has to hedge both outcomes together rather than assert one and
  // append a correcting caveat afterward. When this is false, the existing
  // unconditional wording is provably correct (a full ruling can never
  // reach the divert branch) and stays exactly as it was.
  const divertReachable = partial && crossChain

  const params = [
    `Milestone ${index + 1} of ${Number(escrow.milestoneCount)}: ${formatUSDC(milestone.amount)} in dispute`,
    `Your ruling: ${pct}% to the freelancer, ${100 - pct}% to the payer.`
  ]

  if (bps > 0) {
    params.push(`Freelancer's share: ${formatUSDC(recipientShare)} before the protocol fee`)
  }
  if (bps < 10_000) {
    params.push(`Payer's share: ${formatUSDC(payerShare)} — no protocol fee is taken on this half`)
  }

  if (recipientGetsPaid) {
    if (splits?.length > 0) {
      // Round 15 #11 / Round 16 #1: "most delivered" was a quantified
      // claim nothing in the contract backs, and "divided across N split
      // recipients" (what Round 15 replaced it with) is itself still an
      // outcome claim — it implies N recipients receive something, which
      // rounding and the sub-floor divert below can both make false.
      // Describes the escrow's CONFIGURATION instead — N split entries,
      // each with its own percentage and chain — and leaves what actually
      // happens to the caveats pushed below rather than a headcount here.
      // Already fine as a leading line for Round 17 Phase A too: it never
      // claimed delivery in the first place, so there's nothing to hedge.
      params.push(`${splits.length} configured split entries, by their configured share and destination chain`)
      params.push('A recipient whose share rounds down to zero is paid nothing.')
    } else if (divertReachable) {
      // Round 17 Phase A: this used to state the destination as fact, then
      // a caveat further down corrected it if the divert actually fired —
      // the frontend genuinely cannot know in advance which branch fires,
      // so both are stated together here instead.
      params.push(`If this amount clears this escrow's forwarding-fee floor, it is paid to ${payoutAddress(escrow)} on ${getDomainName(Number(escrow.destinationDomain))}.`)
      // The divert credits refundBalances[e.recipient] (:1292) — the one
      // branch where `recipient`, not `mintRecipient`, is the destination.
      params.push(`If it does not clear the floor, it is credited on Arc to ${escrow.recipient} instead — no cross-chain delivery.`)
    } else {
      // The burn goes to e.mintRecipient (:1298), NOT e.recipient.
      // updateReceivingAddress rewrites mintRecipient and leaves recipient
      // untouched (:986-990), so the two diverge the moment a freelancer
      // redirects — and recipient is the stale one.
      params.push(`Freelancer's share is sent to ${payoutAddress(escrow)} on ${getDomainName(Number(escrow.destinationDomain))}`)
    }
    // "Pays both sides immediately" was true of neither half. A cross-chain
    // share is a burn Circle mints minutes later; an Arc share is a
    // safeTransfer inside this transaction (:1343-1346); and the payer's half
    // is a credit that is never sent anywhere (:606 below).
    //
    // Round 18 Phase A #3/#4: a split escrow is not one outcome here either —
    // Solidity evaluates each leg independently (TrancheProtocol.sol:1303-
    // 1312), so an Arc leg, a cross-chain leg that clears the floor, and a
    // cross-chain leg that doesn't can all settle simultaneously within this
    // one transaction. The clears/doesn't-clear pair below is correct for a
    // single destination but was wrong to also apply, unchanged, to a fan-out
    // — this states timing per leg-type instead of one outcome for the whole
    // ruling whenever splits are configured.
    if (splits?.length > 0) {
      // Round 19 Phase A #1/#3: two more gaps in the same fan-out reasoning.
      // (a) Solidity's `if (share > 0)` guard (TrancheProtocol.sol:1310) skips
      // a zero-share leg's whole if/else — it is never transferred, never
      // burned, and never credited, so "each"/"every" here contradicted the
      // rounds-to-zero disclosure already on screen (the split leading line
      // above). Scoped every clause to nonzero shares. (b) The Arc-leg clause
      // was unconditional even for a split with NO Arc leg configured at all
      // (e.g. a single-entry cross-chain split) — gated on hasArcLeg so it
      // doesn't reference legs that don't exist in this escrow's
      // configuration.
      if (!crossChain) {
        params.push('Each split leg with a nonzero share is transferred on Arc as this transaction executes.')
      } else {
        // Round 19 Phase A follow-up: deliberately scoped to a CONFIGURED Arc
        // leg, not one with a computed nonzero share. Computing the latter
        // would mean replicating the contract's order-dependent per-leg split
        // loop (TrancheProtocol.sol:1301-1312) against a remainder that
        // depends on the per-escrow protocol-fee snapshot, which has no
        // getter — any such check could only use a live-rate estimate, and
        // could therefore FALSELY OMIT this clause for a leg that will
        // actually receive a nonzero share. That failure mode (silently
        // dropping true information) is worse than this honest-but-loosely-
        // scoped statement, which stays true (if vacuously, for a leg that
        // happens to round to zero) regardless of the real fee rate. Gating
        // on the leg's configured bps > 0 instead was considered too, but
        // rejected — it doesn't cover a leg with nonzero bps whose computed
        // share still rounds to zero (the exact case the tests below exercise).
        const hasArcLeg = splits.some((s) => Number(s.destinationDomain) === ARC_DOMAIN)
        const legClauses = []
        if (hasArcLeg) legClauses.push('Any Arc split leg with a nonzero share transfers immediately as part of this transaction.')
        if (divertReachable) {
          legClauses.push(
            "Any cross-chain split leg with a nonzero share that clears this escrow's forwarding-fee floor leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.",
            'Any cross-chain split leg with a nonzero share that does not clear the floor is credited on Arc instead, as part of this transaction (see above).'
          )
        } else {
          legClauses.push("Any cross-chain split leg with a nonzero share leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.")
        }
        params.push(legClauses.join(' '))
      }
    } else if (divertReachable) {
      params.push(
        "If it clears the floor, it leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant. If it does not clear the floor, nothing leaves Arc — it is credited there instead, as part of this transaction."
      )
    } else {
      params.push(
        crossChain
          ? "The freelancer's share leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant."
          : "The freelancer's share is transferred on Arc as this transaction executes."
      )
    }
    params.push("The protocol fee is taken from the freelancer's share only.")
  } else if (bps > 0) {
    params.push("This percentage rounds down to zero USDC at this milestone's amount, so nothing is actually paid to the freelancer despite the nonzero ruling.")
  } else {
    params.push('Nothing is paid to the freelancer. The milestone is refunded in full.')
  }

  if (bps < 10_000) {
    params.push(`Payer's share is credited to ${escrow.refundTo} as a withdrawable balance on Arc, not sent to a wallet.`)
  }

  if (crossChain && recipientGetsPaid) {
    // Settled #7: the caller's maxFee governs a no-split burn; split legs burn
    // at the snapshot floor regardless of what maxFee was submitted for them.
    // Name the one that actually applies rather than both.
    if (divertReachable) {
      // Round 17 Phase A: this used to be an unconditional fee line
      // immediately followed by a separate caveat correcting the
      // destination if the divert fired — two facts about the same
      // uncertain outcome, stated as if only one applied.
      params.push(
        splits?.length > 0
          // Split legs have no earlier destination statement to duplicate
          // (the split leading line above is a configuration fact, not a
          // destination claim — see Round 16 #1), so fee and destination
          // are consolidated into one hedge here, since they were already
          // adjacent and both depend on the same clears-the-floor question.
          // Round 18 Phase A #2: "a given split leg" implied every leg in the
          // configuration faces this floor check. An Arc leg never does
          // (TrancheProtocol.sol:1343, direct transfer) — scoped to the legs
          // that actually can be diverted.
          //
          // Round 19 Phase A: "does not clear the floor, that leg is
          // credited" was still true only for a NONZERO share — a share that
          // rounds down to zero is skipped by Solidity's `if (share > 0)`
          // guard (TrancheProtocol.sol:1310) entirely, so it is never
          // credited at all. Scoped to nonzero, matching the leading
          // "rounds down to zero is paid nothing" disclosure above.
          ? `If a given cross-chain split leg's nonzero share clears this escrow's forwarding-fee floor, it is delivered to its configured chain and pays a forwarding fee of up to ${formatUSDC(floor)}, deducted from that leg's share on delivery. If that nonzero share does not clear the floor, that leg is credited on Arc instead — no delivery, no fee.`
          // Unlike the split case, the no-split destination was ALREADY
          // hedged above (the "If this amount clears... it is paid to...
          // / If it does not... credited on Arc to escrow.recipient..."
          // pair). Restating the destination here would repeat that fact
          // rather than add the new one (the fee) — this states only what
          // this line is actually for.
          : `If this amount clears this escrow's forwarding-fee floor, delivery costs up to ${formatUSDC(maxFee ?? 0n)} in Circle forwarding fees, deducted from the freelancer's share on arrival. If it does not clear the floor, no delivery fee is charged.`
      )
    } else {
      params.push(
        splits?.length > 0
          // A cap, not a charge: the snapshot is passed to CCTP as maxFee and
          // Circle deducts its actual fee — possibly less — from the burned
          // amount on the destination (TrancheProtocol.sol:874-877).
          ? `Each cross-chain split leg pays this escrow's fixed forwarding fee of up to ${formatUSDC(floor)}, deducted from that leg's share on delivery.`
          : `Delivery costs up to ${formatUSDC(maxFee ?? 0n)} in Circle forwarding fees, deducted from the freelancer's share on arrival.`
      )
    }
  }

  params.push(`Your written reasoning at ${resolutionUri} is stored on-chain permanently and readable by anyone.`)

  if (canTimeout) {
    params.push('The arbitration window has already closed, so anyone can now settle this at a fixed 50/50 instead. Submitting first is what makes your ruling the outcome.')
  }

  params.push('This is final. The contract has no appeal path.')

  return {
    title: 'Resolve this dispute',
    subtitle: 'Your ruling settles the milestone now. It cannot be appealed, reversed, or re-ruled — but the two shares do not reach the parties the same way, or at the same speed.',
    amount: milestone.amount,
    amountLabel: 'Amount settled',
    contractName: 'Tranche Protocol Escrow',
    contractAddress: CONTRACT_ADDRESS,
    functionName: 'resolveDispute',
    parameters: params
  }
}

function ResolveForm({ id, index, escrow, milestone, splits, bpsDenominator, onResolved, canTimeout, timeoutAt, timeoutOutcome }) {
  // User works in whole percent (0–100); the contract receives BPS (0–10,000).
  const [pct, setPct] = useState('50')
  const [resolutionUri, setResolutionUri] = useState('')
  const [resolutionHash, setResolutionHash] = useState('')
  const [err, setErr] = useState('')
  // Round 22 Phase A: onResolved now receives the CONFIRMED receipt, not a
  // broadcast-time txHash string — DisputeBlock.handleResolve needs the
  // receipt to check receiptEmittedCctpMessage. Moving this into
  // onConfirmed closes the same broadcast-vs-mined gap Round 21 Phase D
  // already closed for mutualSettle.
  const tx = useTx({
    onConfirmed: (receipt) => {
      setPct('50'); setResolutionUri(''); setResolutionHash('')
      onResolved?.(receipt)
    }
  })
  const timeoutTx = useTx({ onConfirmed: () => onResolved?.(null) })
  const { config } = useProtocolConfig()

  // A resolution that pays the recipient settles via CCTP; for cross-chain
  // destinations a live-quote-when-safe, floor-fallback-otherwise value gets
  // submitted (see resolveDisputeMaxFeePlan / resolveDominantMaxFee) — Arc
  // same-chain burns take maxFee = 0.

  // Percentage → BPS, plus the live split preview.
  const pctNum = pct === '' ? NaN : Number(pct)
  const pctValid = Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 100
  const bps = pctValid ? Math.round(pctNum * 100) : 0
  const denom = bpsDenominator > 0n ? bpsDenominator : 10_000n
  const recipientAmount = pctValid ? (milestone.amount * BigInt(bps)) / denom : 0n
  const depositorAmount = pctValid ? milestone.amount - recipientAmount : 0n

  const uriValid = resolutionUri.trim().length > 0
  // Optional explicit hash; otherwise derive keccak256 of the resolution URI.
  const explicitHashValid = isValidBytes32(resolutionHash)
  const effectiveHash = explicitHashValid
    ? resolutionHash
    : uriValid ? hashDescription(resolutionUri.trim()) : null
  const canSubmit = pctValid && uriValid && !tx.isBusy

  const submit = async () => {
    if (!pctValid) { setErr('Enter a recipient share between 0 and 100%.'); return }
    if (!uriValid) { setErr('A resolution URI is required.'); return }
    if (resolutionHash && !explicitHashValid) {
      setErr('Resolution hash must be 0x followed by 64 hex characters (or leave it blank to auto-compute).')
      return
    }
    setErr('')

    // Round 18/19/20 Phase B/C: see resolveDisputeMaxFeePlan for why this
    // reuses resolveIsCrossChain instead of reading escrow.destinationDomain
    // directly, why split legs and the rounds-to-zero case skip the network
    // entirely, and why the one case that needs it resolves through
    // resolveDominantMaxFee rather than rejecting on a bad quote.
    const plan = resolveDisputeMaxFeePlan({
      escrow, splits, bps, recipientAmount, maxProtocolFeeBps: config?.maxProtocolFeeBps
    })
    const maxFee = plan.needsLiveQuote ? await resolveDominantMaxFee(plan.quoteParams) : (plan.maxFee ?? 0n)

    await tx.run(
      escrowWrite('resolveDispute', [
        BigInt(id), BigInt(index), BigInt(bps), effectiveHash, resolutionUri.trim(), maxFee
      ]),
      {
        loadingMessage: 'Sign to resolve.',
        confirm: resolveDisputeConfirm({
          escrow, milestone, index, splits, bps,
          resolutionUri: resolutionUri.trim(), maxFee, canTimeout, bpsDenominator
        })
      }
    )
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      {/* Recipient share slider (0–100%), stored internally as BPS. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <p className="eyebrow">Recipient share</p>
          <span className="num text-[14px] text-ink">{pctValid ? pctNum : '—'}%</span>
        </div>
        <input
          type="range" min={0} max={100} step={1}
          value={pctValid ? pctNum : 50}
          onChange={(e) => setPct(e.target.value)}
          className="w-full accent-clay"
          aria-label="Recipient share percent"
        />
        <div className="flex items-center gap-2">
          <input
            type="number" min={0} max={100} step={1}
            className="input num w-24"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            aria-label="Recipient share percent (numeric)"
          />
          <span className="text-[13px] text-ink-3">% to the freelancer</span>
        </div>
        <div className="rounded-xl bg-sunk px-3 py-2.5 text-[13px] text-ink-2 leading-relaxed">
          Recipient gets <span className="num text-ink">{formatUSDCNumber(recipientAmount)} USDC</span>,
          {' '}Depositor gets <span className="num text-ink">{formatUSDCNumber(depositorAmount)} USDC</span>.
        </div>
      </div>

      <Field
        label="Resolution URI"
        helper="Required. Link to the written reasoning behind this decision."
      >
        {(p) => (
          <input {...p}
            className="input"
            placeholder="IPFS link or URL to written reasoning"
            autoComplete="off"
            spellCheck={false}
            value={resolutionUri}
            onChange={(e) => setResolutionUri(e.target.value)}
          />
        )}
      </Field>

      <Field
        label="Resolution hash (optional)"
        error={err}
        helper="Leave blank to auto-compute keccak256 of the resolution URI."
      >
        {(p) => (
          <input {...p}
            className="input num"
            placeholder={effectiveHash || '0x… (64 hex chars)'}
            autoComplete="off"
            spellCheck={false}
            maxLength={66}
            value={resolutionHash}
            onChange={(e) => setResolutionHash(e.target.value.trim())}
          />
        )}
      </Field>

      <div className="flex items-center gap-2">
        <button
          className="btn-primary"
          onClick={submit}
          disabled={!canSubmit}
        >
          {tx.isBusy ? 'Working…' : 'Resolve Dispute'}
        </button>
      </div>

      {/* Permissionless timeout fallback. Outcome is decided by the contract
          based on who raised the dispute — no longer always a refund. */}
      <div className="flex flex-col gap-1.5 pt-1 border-t border-rule mt-1">
        <p className="text-[12px] text-ink-3 leading-relaxed">
          {canTimeout
            ? `Arbitration window has elapsed. ${timeoutOutcome}`
            : `If unresolved, the arbitration window closes in ${countdown(timeoutAt).replace(' remaining', '')}. ${timeoutOutcome}`}
        </p>
        {canTimeout && (
          <div>
            <button
              className="btn-quiet"
              onClick={() => timeoutTx.run(
                escrowWrite('resolveDisputeByTimeout', [BigInt(id), BigInt(index)]),
                {
                  loadingMessage: 'Settling by timeout.',
                  confirm: timeoutSettlementConfirm({
                    escrow, milestone, index, splits, timeoutAt, bpsDenominator
                  })
                }
              )}
              disabled={timeoutTx.isBusy}
            >
              {timeoutTx.isBusy ? 'Working…' : 'Settle by timeout'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
