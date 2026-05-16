import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { keccak256, toBytes } from 'viem'
import { motion, AnimatePresence } from 'framer-motion'

import ConnectGate from '../components/ConnectGate.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import CustomSelect from '../components/CustomSelect.jsx'
import Skeleton from '../components/Skeleton.jsx'
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
        <p className="text-sm text-text-secondary">No escrow with ID #{id}.</p>
      </div>
    )
  }

  const { escrow, milestones, disputes, disputeWindowExpired, deliverySignaled, effectiveDisputeDeadlines, isPayer, isFreelancer, isArbiter } = detail
  const role = isPayer ? 'payer' : isFreelancer ? 'freelancer' : null
  const inv = escrow.invoiceHash ? `INV-${escrow.invoiceHash.slice(2, 6).toUpperCase()}` : `ESC-${escrow.id}`

  const activeIdx = milestones.findIndex((m) => m.state !== 3 && m.state !== 4)

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      <aside className="lg:w-1/3 lg:sticky lg:top-24 self-start flex flex-col gap-4 w-full">
        <SpecsCard escrow={escrow} role={role} inv={inv} />
        {role && escrow.state === 0 && <CancelCard escrow={escrow} role={role} onChange={refetch} optimistic={optimistic} setOpt={setOpt} clearOpt={clearOpt} />}
        {isFreelancer && escrow.state === 0 && <UpdateReceivingAddressCard escrow={escrow} onChange={refetch} />}
      </aside>

      <section className="lg:w-2/3 flex flex-col gap-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">Milestones</h2>
          <span className="text-sm text-text-secondary">{milestones.length} total</span>
        </div>

        <div className="relative flex flex-col gap-6">
          <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-border-subtle" aria-hidden />
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
  )
}

function EscrowDetailSkeleton() {
  return (
    <div className="flex flex-col lg:flex-row gap-8">
      <aside className="lg:w-1/3 flex flex-col gap-4 w-full">
        <Skeleton className="h-72" />
        <Skeleton className="h-40" />
      </aside>
      <section className="lg:w-2/3 flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </section>
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

/* ---------- Specs Card ---------- */
function SpecsCard({ escrow, role, inv }) {
  const deadlinePassed = Number(escrow.deadline) * 1000 < Date.now()
  return (
    <div className="card-surface p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        {role && <RoleBadge role={role} />}
        <EscrowBadge state={escrow.state} />
      </div>
      <div className="font-mono text-sm text-text-secondary">{inv}</div>
      <div className="font-mono text-3xl text-text-primary">{formatUSDC(escrow.totalAmount)}</div>

      <hr className="border-border-subtle" />

      <div className="flex flex-col gap-3 text-sm">
        <Row label="Payer"><AddressDisplay address={escrow.depositor} size="sm" /></Row>
        <Row label="Freelancer"><AddressDisplay address={escrow.recipient} size="sm" /></Row>
        <Row label="Destination">{getDomainName(escrow.destinationDomain)}</Row>
        <Row label="Deadline">
          <div className="text-right">
            <div className="font-mono">{formatDeadline(escrow.deadline)}</div>
            <div className={`text-xs ${deadlinePassed ? 'text-status-error' : 'text-text-tertiary'}`}>
              {countdown(escrow.deadline)}
            </div>
          </div>
        </Row>
        <Row label="Dispute window">{formatWindow(escrow.disputeWindow)}</Row>
        <Row label="Delivery notice">{formatWindow(escrow.deliveryNoticeWindow)}</Row>
      </div>

      {escrow.invoiceURI && (
        <a href={escrow.invoiceURI} target="_blank" rel="noreferrer"
          className="btn-secondary text-sm text-center py-2 mt-2">
          View invoice ↗
        </a>
      )}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-text-secondary">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
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
    { loadingMessage: 'Submitting cancellation…' }
  )

  return (
    <div className="card-surface p-5 flex flex-col gap-3">
      <h3 className="text-sm font-medium uppercase tracking-wide text-text-secondary">Cancel by agreement</h3>
      <p className="text-xs text-text-tertiary">Both parties must approve. Unreleased funds become payer's refund balance.</p>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Payer</span>
          <span className={(role === 'payer' && optApproved) || escrow.depositorApproveCancel ? 'text-status-success' : 'text-text-tertiary'}>
            {(role === 'payer' && optApproved) || escrow.depositorApproveCancel ? 'Approved' : 'Not yet'}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Freelancer</span>
          <span className={(role === 'freelancer' && optApproved) || escrow.recipientApproveCancel ? 'text-status-success' : 'text-text-tertiary'}>
            {(role === 'freelancer' && optApproved) || escrow.recipientApproveCancel ? 'Approved' : 'Not yet'}
          </span>
        </div>
      </div>
      <button className="btn-danger text-sm py-2"
        onClick={submit}
        disabled={myFlag || optApproved || tx.isBusy}>
        {myFlag || optApproved ? 'You already approved' : otherFlag ? 'Approve & finalize' : 'Approve cancellation'}
      </button>
    </div>
  )
}

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
      { loadingMessage: 'Updating receiving address…' }
    )
  }

  return (
    <div className="card-surface p-5 flex flex-col gap-3">
      <h3 className="text-sm font-medium uppercase tracking-wide text-text-secondary">Receiving address</h3>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-text-tertiary">Where future milestone payouts are sent.</span>
        {currentAddress && <AddressDisplay address={currentAddress} />}
        <span className="text-xs text-text-tertiary mt-1">Chain: {getDomainName(currentDomain)}</span>
      </div>

      {successInfo && !editing && (
        <div className="rounded-xl border border-status-success/40 bg-status-success/10 px-3 py-2 text-xs text-status-success">
          Updated. New address {truncateAddr(successInfo.address)} on {getDomainName(successInfo.domain)}.
        </div>
      )}

      {!editing && (
        <button className="btn-secondary text-sm py-2"
          onClick={() => { setEditing(true); setSuccessInfo(null); setDomain(currentDomain || ARC_DOMAIN) }}>
          Update receiving address
        </button>
      )}

      {editing && (
        <>
          <label className="text-xs text-text-secondary">Receiving address</label>
          <input className="input-field font-mono text-sm" placeholder="0x…"
            value={addr} onChange={(e) => setAddr(e.target.value.trim())} />
          <label className="text-xs text-text-secondary">Receiving chain</label>
          <CustomSelect
            value={Number(domain)}
            onChange={(v) => setDomain(Number(v))}
            options={domainOptions}
            placeholder="Select chain"
          />
          <div className="flex gap-2">
            <button className="btn-primary text-sm py-2 flex-1" onClick={submit}
              disabled={!isValidAddress(addr) || !domainOptions.some((o) => o.value === Number(domain)) || tx.isBusy}>
              Confirm
            </button>
            <button className="btn-secondary text-sm py-2"
              disabled={tx.isBusy}
              onClick={() => { setEditing(false); setAddr('') }}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/* ---------- Milestone Card ---------- */
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

  const activeCls = isActive
    ? 'bg-accent-muted border-l-4 border-accent-blue pl-7'
    : 'bg-background-secondary border border-border-subtle pl-7'

  return (
    <div className="relative pl-8">
      <span className={`absolute left-[7px] top-6 h-3 w-3 rounded-full border-2 ${
        milestone.state === 3 ? 'bg-status-success border-status-success'
        : milestone.state === 2 ? 'bg-status-warning border-status-warning'
        : isActive ? 'bg-accent border-accent'
        : 'bg-background-primary border-border-medium'
      }`} aria-hidden />

      <div className={`rounded-2xl p-5 flex flex-col gap-3 transition-colors ${activeCls}`}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-mono text-xs text-text-tertiary">M{milestone.index + 1}</div>
            <h3 className="text-base font-semibold">{title}</h3>
          </div>
          <div className="flex items-center gap-2">
            {optimisticBadge && (
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border border-accent/30 bg-accent-muted text-accent">
                {optimisticBadge}
              </span>
            )}
            <MilestoneBadge state={milestone.state} />
          </div>
        </div>
        <div className="font-mono text-2xl text-text-primary">{formatUSDC(milestone.amount)}</div>

        {deliverySignaled && Number(milestone.deliveredAt) > 0 && (
          <div className="font-mono text-xs text-text-tertiary">
            Delivered · {formatTimestamp(milestone.deliveredAt)}
          </div>
        )}
        {Number(milestone.conditionMetTimestamp) > 0 && (
          <div className="font-mono text-xs text-text-tertiary">
            Approved · {formatTimestamp(milestone.conditionMetTimestamp)}
          </div>
        )}

        {milestone.state === 1 && effectiveDisputeDeadline > 0 && !disputeWindowExpired && (
          <div>
            <div className="text-xs text-text-secondary mb-1">Dispute window closes</div>
            <div className="text-status-warning font-mono text-2xl">
              {countdown(effectiveDisputeDeadline).replace(' remaining', '')}
            </div>
          </div>
        )}
        {milestone.state === 0 && noticeDeadline > 0 && (
          <div>
            <div className="text-xs text-text-secondary mb-1">Auto-release in</div>
            <div className="text-status-warning font-mono text-2xl">
              {countdown(noticeDeadline).replace(' remaining', '')}
            </div>
          </div>
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
      await tx.run(escrowWrite(fn, args), { loadingMessage: 'Awaiting wallet signature…' })
    } catch {
      clearOpt(`milestone_${milestone.index}`)
    }
  }

  const id = BigInt(escrow.id)
  const idx = BigInt(milestone.index)
  const now = Math.floor(Date.now() / 1000)
  const isPayer = role === 'payer'
  const isFreelancer = role === 'freelancer'

  const actions = []
  if (milestone.state === 0) {
    if (isFreelancer && !deliverySignaled && !deadlinePassed)
      actions.push({ key: 'signal', label: 'Mark Delivered',
        run: () => run('signalDelivery', [id, idx], 'signal', { badge: 'Signaled', signaledDelivery: true }) })
    if (isPayer && deliverySignaled)
      actions.push({ key: 'approve', label: 'Approve',
        run: () => run('fulfillCondition', [id, idx], 'approve', { badge: 'Approving…' }) })
    if (noticeDeadline > 0 && now > noticeDeadline)
      actions.push({ key: 'silent', label: 'Claim Auto-Release',
        run: () => run('claimSilentApproval', [id, idx], 'silent', { badge: 'Releasing…' }) })
    if (isFreelancer && deadlinePassed)
      actions.push({ key: 'escalate', label: 'Escalate',
        run: () => setDisputeOpen({ kind: 'escalate' }) })
  }
  if (milestone.state === 1) {
    if ((isPayer || isFreelancer) && !disputeWindowExpired)
      actions.push({ key: 'dispute', label: 'Open Dispute',
        run: () => setDisputeOpen({ kind: 'dispute' }) })
    if (disputeWindowExpired)
      actions.push({ key: 'release', label: 'Release Payment',
        run: () => run('releaseAfterWindow', [id, idx, 0n], 'release', { badge: 'Releasing…' }) })
  }

  return (
    <>
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {actions.map((a) => (
            <button key={a.key}
              className="btn-primary text-sm py-2 px-4"
              onClick={a.run}
              disabled={tx.isBusy}>
              {activeKey === a.key && tx.isBusy ? 'Pending…' : a.label}
            </button>
          ))}
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
      { loadingMessage: 'Submitting dispute…' }
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
        <p className="text-sm text-text-secondary">Provide a reason and a URL to your supporting evidence. The hash of (reason + URL) is committed on-chain.</p>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Reason</label>
          <textarea rows={3} className="input-field-multiline"
            placeholder="Why are you disputing this milestone?"
            value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Evidence URI</label>
          <input className="input-field" placeholder="https://…"
            value={uri} onChange={(e) => setUri(e.target.value.trim())} />
        </div>

        <div className="flex gap-3 pt-2">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={disabled}>
            {tx.isBusy ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

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

  const submitCounter = () => {
    const hash = keccak256(toBytes(counterReason + '|' + counterUri))
    return counterTx.run(
      escrowWrite('submitCounterEvidence', [BigInt(escrow.id), BigInt(milestone.index), hash, counterUri]),
      { loadingMessage: 'Submitting counter-evidence…' }
    )
  }

  const resolve = (releaseToRecipient) => {
    if (!isValidBytes32(resolutionHash)) return
    return resolveTx.run(
      escrowWrite('resolveDispute', [BigInt(escrow.id), BigInt(milestone.index), releaseToRecipient, resolutionHash, 0n]),
      { loadingMessage: 'Resolving dispute…' }
    )
  }

  return (
    <div className="mt-3 pt-3 border-t border-border-subtle flex flex-col gap-3">
      <div>
        <div className="text-xs text-text-secondary mb-1">Disputed by</div>
        <AddressDisplay address={disputedBy} size="sm" />
      </div>

      {dispute.reason && (
        <div>
          <div className="text-xs text-text-secondary mb-1">Reason</div>
          <p className="text-sm">{dispute.reason}</p>
        </div>
      )}

      {dispute.evidenceURI && (
        <div>
          <div className="text-xs text-text-secondary mb-1">Evidence</div>
          <a href={dispute.evidenceURI} target="_blank" rel="noreferrer" className="text-sm text-accent">View evidence ↗</a>
          <div className="font-mono text-xs text-text-tertiary mt-1">{truncateAddr(dispute.evidenceHash)}</div>
        </div>
      )}

      {dispute.counterEvidenceURI && (
        <div>
          <div className="text-xs text-text-secondary mb-1">Counter-evidence</div>
          <a href={dispute.counterEvidenceURI} target="_blank" rel="noreferrer" className="text-sm text-accent">View counter ↗</a>
        </div>
      )}

      {canCounter && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-text-secondary">Submit your side</div>
          <textarea rows={2} className="input-field-multiline" placeholder="Your response"
            value={counterReason} onChange={(e) => setCounterReason(e.target.value)} />
          <input className="input-field" placeholder="https://… (evidence URL)"
            value={counterUri} onChange={(e) => setCounterUri(e.target.value.trim())} />
          <button className="btn-primary text-sm py-2 self-start"
            onClick={submitCounter}
            disabled={!counterReason.trim() || !counterUri.trim() || counterTx.isBusy}>
            {counterTx.isBusy ? 'Submitting…' : 'Submit My Side'}
          </button>
        </div>
      )}

      {isArbiter && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-text-secondary">Arbiter resolution</div>
          <input className="input-field font-mono"
            placeholder="Resolution hash (bytes32)"
            value={resolutionHash} onChange={(e) => setResolutionHash(e.target.value.trim())} />
          <div className="flex gap-2">
            <button className="btn-primary text-sm py-2 flex-1"
              onClick={() => resolve(true)}
              disabled={resolveTx.isBusy}>
              Release to Freelancer
            </button>
            <button className="btn-danger text-sm py-2 flex-1"
              onClick={() => resolve(false)}
              disabled={resolveTx.isBusy}>
              Refund to Payer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
