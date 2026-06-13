import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'

import PageHeader from '../components/PageHeader.jsx'
import ConnectGate from '../components/ConnectGate.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import Modal from '../components/Modal.jsx'
import Field from '../components/Field.jsx'
import Skeleton from '../components/Skeleton.jsx'
import WalletButton from '../components/WalletButton.jsx'
import { useRoles } from '../hooks/useRoles.jsx'
import { useDisputedEscrows, useEscrowDetail, useDisputeConfig, useTick, useEscrowInvoice } from '../hooks/useEscrows.js'
import InvoiceCard from '../components/InvoiceCard.jsx'
import { useProtocolConfig } from '../hooks/useArbiter.js'
import { useTx, escrowWrite } from '../hooks/useTx.js'
import { useToast } from '../hooks/useToast.jsx'
import { resolveMaxFee } from '../utils/cctpFee.js'
import { isValidBytes32, bytes32ToAddress, hashDescription } from '../utils/encode.js'
import { cctpTrackKey, encodeReceiveMessage } from '../utils/irisDelivery.js'
import { getDomainName, ARC_DOMAIN, getChainExplorerTx, MESSAGE_TRANSMITTER_V2, EVM_CHAIN_PARAMS } from '../config/chains.js'
import { formatUSDC, formatUSDCNumber, formatTimestamp, formatDeadline, formatWindow, countdown } from '../utils/format.js'
import { useCctpDelivery } from '../hooks/useCctpDelivery.js'

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
  const { address } = useAccount()
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

  // Single ARBITER_WINDOW read from the contract rather than hardcoding 14d.
  const windowSecs = arbiterWindow
  const timeoutAt = Number(d.raisedAt) + Number(windowSecs)
  const now = Math.floor(Date.now() / 1000)
  const canTimeout = windowSecs > 0n && now >= timeoutAt

  // A DISPUTED milestone always carries both a delivery-claim and an objection,
  // so the contract's timeout fallback settles it as a fixed 50/50 split.
  const timeoutOutcome = 'Funds split 50/50 — the freelancer\'s share arrives as a claimable balance and is charged the protocol fee.'

  const handleResolve = useCallback((txHash) => {
    if (txHash && Number(e.destinationDomain) !== ARC_DOMAIN) {
      setResolveTxHash(txHash)
      // Also persist to localStorage so EscrowDetail picks it up on other devices.
      localStorage.setItem(
        cctpTrackKey(detail.id, index),
        JSON.stringify({ txHash, domain: e.destinationDomain, ts: Date.now() })
      )
    }
    refetch()
  }, [e.destinationDomain, detail.id, index, refetch])

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
        bpsDenominator={bpsDenominator}
        onResolved={handleResolve}
        canTimeout={canTimeout}
        timeoutAt={timeoutAt}
        timeoutOutcome={timeoutOutcome}
      />

      {resolveTxHash && Number(e.destinationDomain) !== ARC_DOMAIN && (
        <ArbiterDeliveryStatus
          txHash={resolveTxHash}
          destinationDomain={e.destinationDomain}
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

/* Shown in the arbiter's DisputeBlock after resolveDispute confirms cross-chain.
   Polls Iris so the arbiter can confirm the payment was forwarded. */
function ArbiterDeliveryStatus({ txHash, destinationDomain }) {
  const { phase, deliveries } = useCctpDelivery(txHash, destinationDomain)
  const chainName = getDomainName(destinationDomain)

  if (phase === 'idle') return null

  return (
    <div className="flex flex-col gap-1.5 pt-2 border-t border-rule mt-1">
      {phase === 'polling' && (
        <div className="flex items-center gap-2 text-[12px] text-ink-2">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-ink-3/40 border-t-clay animate-spin shrink-0" aria-hidden />
          Delivering to {chainName}…
        </div>
      )}
      {phase === 'delivered' && deliveries.map((d, i) => {
        const url = getChainExplorerTx(d.destinationDomain ?? destinationDomain, d.destinationTxHash)
        return (
          <div key={i} className="flex items-center gap-2 text-[12px] text-ok">
            <span>✓ Delivered to {chainName}</span>
            {url && <a href={url} target="_blank" rel="noreferrer" className="text-clay hover:opacity-80">View tx ↗</a>}
          </div>
        )
      })}
      {phase === 'failed' && (
        <p className="text-[12px] text-warn">
          Delivery failed — forwarding fee was too low. The recipient should self-relay via the escrow detail page.
        </p>
      )}
      {phase === 'unavailable' && (
        <p className="text-[12px] text-ink-3">Delivery status unavailable.</p>
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

function ResolveForm({ id, index, escrow, milestone, bpsDenominator, onResolved, canTimeout, timeoutAt, timeoutOutcome }) {
  // User works in whole percent (0–100); the contract receives BPS (0–10,000).
  const [pct, setPct] = useState('50')
  const [resolutionUri, setResolutionUri] = useState('')
  const [resolutionHash, setResolutionHash] = useState('')
  const [err, setErr] = useState('')
  const tx = useTx({
    onConfirmed: () => { setPct('50'); setResolutionUri(''); setResolutionHash('') }
  })
  const timeoutTx = useTx({ onConfirmed: () => onResolved?.(null) })

  // A resolution that pays the recipient settles via CCTP; for cross-chain
  // destinations maxFee must cover Circle's live forwarding fee or the mint
  // won't auto-deliver (INSUFFICIENT_FEE). Quoted at submit time. Arc same-chain
  // burns take maxFee = 0.
  const { config } = useProtocolConfig()
  const toast = useToast()

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

    let maxFee
    try {
      const feeBps = config?.protocolFeeBps ?? 0n
      const protocolFee = (recipientAmount * BigInt(feeBps)) / 10_000n
      maxFee = await resolveMaxFee({
        destinationDomain: escrow.destinationDomain,
        escrowCctpForwardFee: escrow.escrowCctpForwardFee,
        burnAmount: recipientAmount - protocolFee
      })
    } catch (e) {
      toast.error(e.message || "Couldn't check delivery fees. Please try again.")
      return
    }

    const txHash = await tx.run(
      escrowWrite('resolveDispute', [
        BigInt(id), BigInt(index), BigInt(bps), effectiveHash, resolutionUri.trim(), maxFee
      ]),
      { loadingMessage: 'Sign to resolve.' }
    )
    onResolved?.(txHash ?? null)
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
                { loadingMessage: 'Settling by timeout.' }
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
