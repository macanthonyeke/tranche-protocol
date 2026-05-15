import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { keccak256, toBytes } from 'viem'

import ConnectGate from '../components/ConnectGate.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import CustomSelect from '../components/CustomSelect.jsx'
import { MilestoneBadge, EscrowBadge, RoleBadge } from '../components/StatusBadge.jsx'
import TxModal from '../components/TxModal.jsx'
import { useEscrowDetail, useTick } from '../hooks/useEscrows.js'
import { useSupportedDomains } from '../hooks/useSupportedDomains.js'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract.js'
import { isValidBytes32, bytes32ToAddress } from '../utils/encode.js'
import { isValidAddress, formatUSDC, formatDeadline, formatTimestamp, formatWindow, countdown, truncateAddr } from '../utils/format.js'
import { getDomainName, ARC_DOMAIN, isEvmDomain } from '../config/chains.js'

const addressToBytes32 = (addr) => '0x' + addr.slice(2).padStart(64, '0')

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

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
  const { detail, isLoading, error, refetch } = useEscrowDetail(id, address)
  useTick(15_000)

  if (isLoading) {
    return <div className="card-surface p-8 animate-pulse h-60" />
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

  // Active milestone: first non-paid / non-refunded
  const activeIdx = milestones.findIndex((m) => m.state !== 3 && m.state !== 4)

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {/* Specs Sidebar */}
      <aside className="lg:w-1/3 lg:sticky lg:top-24 self-start flex flex-col gap-4 w-full">
        <SpecsCard escrow={escrow} role={role} inv={inv} />
        {role && escrow.state === 0 && <CancelCard escrow={escrow} role={role} onChange={refetch} />}
        {isFreelancer && escrow.state === 0 && <UpdateReceivingAddressCard escrow={escrow} onChange={refetch} />}
      </aside>

      {/* Timeline */}
      <section className="lg:w-2/3 flex flex-col gap-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">Milestones</h2>
          <span className="text-sm text-text-secondary">{milestones.length} total</span>
        </div>
        <div className="relative flex flex-col gap-6">
          <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-border-subtle" aria-hidden />
          {milestones.map((m, i) => (
            <MilestoneCard key={i}
              escrow={escrow}
              milestone={m}
              dispute={disputes[i]}
              role={role}
              isArbiter={isArbiter}
              userAddress={address}
              isActive={i === activeIdx}
              disputeWindowExpired={!!disputeWindowExpired[i]}
              deliverySignaled={!!deliverySignaled[i]}
              effectiveDisputeDeadline={Number(effectiveDisputeDeadlines[i] || 0n)}
              onChange={refetch}
            />
          ))}
        </div>
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

/* ---------- Cancel & Update cards ---------- */
function CancelCard({ escrow, role, onChange }) {
  const { writeContractAsync } = useWriteContract()
  const [txStatus, setTxStatus] = useState('idle')
  const [txHash, setTxHash] = useState(null)
  const [txError, setTxError] = useState(null)
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!receipt) return
    setTxStatus('success'); onChange?.()
  }, [receipt]) // eslint-disable-line

  const myFlag = role === 'payer' ? escrow.depositorApproveCancel : escrow.recipientApproveCancel
  const otherFlag = role === 'payer' ? escrow.recipientApproveCancel : escrow.depositorApproveCancel

  const submit = async () => {
    try {
      setTxError(null); setTxStatus('confirming')
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: 'mutualCancel', args: [BigInt(escrow.id)]
      })
      setTxHash(hash); setTxStatus('pending')
    } catch (err) { setTxError(err); setTxStatus('error') }
  }

  return (
    <div className="card-surface p-5 flex flex-col gap-3">
      <h3 className="text-sm font-medium uppercase tracking-wide text-text-secondary">Cancel by agreement</h3>
      <p className="text-xs text-text-tertiary">Both parties must approve. Unreleased funds become payer's refund balance.</p>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Payer</span>
          <span className={escrow.depositorApproveCancel ? 'text-status-success' : 'text-text-tertiary'}>
            {escrow.depositorApproveCancel ? 'Approved' : 'Not yet'}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Freelancer</span>
          <span className={escrow.recipientApproveCancel ? 'text-status-success' : 'text-text-tertiary'}>
            {escrow.recipientApproveCancel ? 'Approved' : 'Not yet'}
          </span>
        </div>
      </div>
      <button className="btn-danger text-sm py-2"
        onClick={submit}
        disabled={myFlag || txStatus === 'confirming' || txStatus === 'pending'}>
        {myFlag ? 'You already approved' : otherFlag ? 'Approve & finalize' : 'Approve cancellation'}
      </button>
      <TxModal status={txStatus} txHash={txHash} error={txError}
        onClose={() => { setTxStatus('idle'); setTxHash(null); setTxError(null) }}
        onRetry={submit} title="Mutual cancel" />
    </div>
  )
}

function UpdateReceivingAddressCard({ escrow, onChange }) {
  const [editing, setEditing] = useState(false)
  const [addr, setAddr] = useState('')
  const [domain, setDomain] = useState(() => Number(escrow.destinationDomain ?? ARC_DOMAIN))
  const [successInfo, setSuccessInfo] = useState(null)
  const { writeContractAsync } = useWriteContract()
  const [txStatus, setTxStatus] = useState('idle')
  const [txHash, setTxHash] = useState(null)
  const [txError, setTxError] = useState(null)
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })
  const { supported } = useSupportedDomains()

  const currentAddress = escrow.mintRecipient ? bytes32ToAddress(escrow.mintRecipient) : null
  const currentDomain = Number(escrow.destinationDomain)

  // ARC is always supported by the contract for receiving updates; ensure it
  // appears in the dropdown even if the on-chain allow-list omitted it.
  const domainOptions = (() => {
    const set = new Set(supported.filter(isEvmDomain))
    set.add(ARC_DOMAIN)
    return [...set].sort((a, b) => a - b).map((d) => ({ value: d, label: getDomainName(d) }))
  })()

  useEffect(() => {
    if (!receipt) return
    setTxStatus('success')
    setSuccessInfo({ address: addr, domain })
    setEditing(false)
    setAddr('')
    onChange?.()
  }, [receipt]) // eslint-disable-line

  const submit = async () => {
    try {
      if (!isValidAddress(addr)) throw new Error('Invalid address')
      setTxError(null); setTxStatus('confirming')
      const bytes32Addr = addressToBytes32(addr)
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: 'updateReceivingAddress',
        args: [BigInt(escrow.id), bytes32Addr, Number(domain)]
      })
      setTxHash(hash); setTxStatus('pending')
    } catch (err) { setTxError(err); setTxStatus('error') }
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
        <div className="rounded-md border border-status-success/40 bg-status-success/10 px-3 py-2 text-xs text-status-success">
          Updated. New address {truncateAddr(successInfo.address)} on {getDomainName(successInfo.domain)}.
        </div>
      )}

      {!editing && (
        <button className="btn-secondary text-sm py-2" onClick={() => { setEditing(true); setSuccessInfo(null); setDomain(currentDomain || ARC_DOMAIN) }}>
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
              disabled={!isValidAddress(addr) || !domainOptions.some((o) => o.value === Number(domain)) || txStatus === 'confirming' || txStatus === 'pending'}>
              Confirm
            </button>
            <button className="btn-secondary text-sm py-2"
              disabled={txStatus === 'confirming' || txStatus === 'pending'}
              onClick={() => { setEditing(false); setAddr('') }}>
              Cancel
            </button>
          </div>
        </>
      )}

      <TxModal status={txStatus} txHash={txHash} error={txError}
        onClose={() => { setTxStatus('idle'); setTxHash(null); setTxError(null) }}
        onRetry={submit} title="Updating receiving address" />
    </div>
  )
}

/* ---------- Milestone Card ---------- */
function MilestoneCard({
  escrow, milestone, dispute, role, isArbiter, userAddress, isActive,
  disputeWindowExpired, deliverySignaled, effectiveDisputeDeadline, onChange
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
    <div className={`relative pl-8`}>
      <span className={`absolute left-[7px] top-6 h-3 w-3 rounded-full border-2 ${
        milestone.state === 3 ? 'bg-status-success border-status-success'
        : milestone.state === 2 ? 'bg-status-warning border-status-warning'
        : isActive ? 'bg-accent border-accent'
        : 'bg-background-primary border-border-medium'
      }`} aria-hidden />

      <div className={`rounded-xl p-5 flex flex-col gap-3 transition-colors ${activeCls}`}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-mono text-xs text-text-tertiary">M{milestone.index + 1}</div>
            <h3 className="text-base font-semibold">{title}</h3>
          </div>
          <MilestoneBadge state={milestone.state} />
        </div>
        <div className="font-mono text-2xl text-text-primary">{formatUSDC(milestone.amount)}</div>

        {deliverySignaled && (
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
  deadlinePassed, disputeWindowExpired, deliverySignaled, noticeDeadline
}) {
  const { writeContractAsync } = useWriteContract()
  const [active, setActive] = useState(null)
  const [txStatus, setTxStatus] = useState('idle')
  const [txHash, setTxHash] = useState(null)
  const [txError, setTxError] = useState(null)
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })
  const [disputeOpen, setDisputeOpen] = useState(false)

  useEffect(() => {
    if (!receipt) return
    setTxStatus('success'); onChange?.()
  }, [receipt]) // eslint-disable-line

  const run = async (fn, args, label) => {
    try {
      setActive(label); setTxError(null); setTxStatus('confirming')
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: fn, args
      })
      setTxHash(hash); setTxStatus('pending')
    } catch (err) { setTxError(err); setTxStatus('error') }
  }

  const id = BigInt(escrow.id)
  const idx = BigInt(milestone.index)
  const now = Math.floor(Date.now() / 1000)
  const isPayer = role === 'payer'
  const isFreelancer = role === 'freelancer'

  const actions = []
  if (milestone.state === 0) {
    if (isFreelancer && !deliverySignaled && !deadlinePassed)
      actions.push({ key: 'signal', label: 'Mark Delivered', run: () => run('signalDelivery', [id, idx], 'signal') })
    if (isPayer && deliverySignaled)
      actions.push({ key: 'approve', label: 'Approve', run: () => run('fulfillCondition', [id, idx], 'approve') })
    if (noticeDeadline > 0 && now > noticeDeadline)
      actions.push({ key: 'silent', label: 'Claim Auto-Release', run: () => run('claimSilentApproval', [id, idx], 'silent') })
    if (isFreelancer && deadlinePassed)
      actions.push({ key: 'escalate', label: 'Escalate', run: () => setDisputeOpen({ kind: 'escalate' }) })
  }
  if (milestone.state === 1) {
    if ((isPayer || isFreelancer) && !disputeWindowExpired)
      actions.push({ key: 'dispute', label: 'Open Dispute', run: () => setDisputeOpen({ kind: 'dispute' }) })
    if (disputeWindowExpired)
      actions.push({ key: 'release', label: 'Release Payment', run: () => run('releaseAfterWindow', [id, idx, 0n], 'release') })
  }

  return (
    <>
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {actions.map((a) => (
            <button key={a.key}
              className="btn-primary text-sm py-2 px-4"
              onClick={a.run}
              disabled={txStatus === 'confirming' || txStatus === 'pending'}>
              {active === a.key && (txStatus === 'confirming' || txStatus === 'pending') ? 'Pending…' : a.label}
            </button>
          ))}
        </div>
      )}

      <TxModal status={txStatus} txHash={txHash} error={txError}
        onClose={() => { setTxStatus('idle'); setTxHash(null); setTxError(null); setActive(null) }}
        title="Submitting transaction" />

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
  const { writeContractAsync } = useWriteContract()
  const [txStatus, setTxStatus] = useState('idle')
  const [txHash, setTxHash] = useState(null)
  const [txError, setTxError] = useState(null)
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!receipt) return
    setTxStatus('success'); onSubmitted?.(); setTimeout(onClose, 600)
  }, [receipt]) // eslint-disable-line

  const submit = async () => {
    try {
      const evidenceHash = keccak256(toBytes(reason + '|' + uri))
      setTxError(null); setTxStatus('confirming')
      const fn = kind === 'escalate' ? 'escalateAfterDeadline' : 'raiseDispute'
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: fn,
        args: [BigInt(escrow.id), BigInt(milestone.index), reason, evidenceHash, uri]
      })
      setTxHash(hash); setTxStatus('pending')
    } catch (err) { setTxError(err); setTxStatus('error') }
  }

  const disabled = !reason.trim() || !uri.trim() || txStatus === 'confirming' || txStatus === 'pending'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="card-surface w-full max-w-md p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">{kind === 'escalate' ? 'Escalate to arbiter' : 'Open a dispute'}</h3>
        <p className="text-sm text-text-secondary">Provide a reason and a URL to your supporting evidence. The hash of (reason + URL) is committed on-chain.</p>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Reason</label>
          <textarea rows={3} className="input-field"
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
            {txStatus === 'confirming' || txStatus === 'pending' ? 'Submitting…' : 'Submit'}
          </button>
        </div>

        <TxModal status={txStatus} txHash={txHash} error={txError}
          onClose={() => { setTxStatus('idle'); setTxHash(null); setTxError(null) }}
          onRetry={submit} title="Submitting dispute" />
      </div>
    </div>
  )
}

function DisputeSection({ escrow, milestone, dispute, role, isArbiter, userAddress, onChange }) {
  const [counterUri, setCounterUri] = useState('')
  const [counterReason, setCounterReason] = useState('')
  const [resolutionHash, setResolutionHash] = useState('')
  const { writeContractAsync } = useWriteContract()
  const [txStatus, setTxStatus] = useState('idle')
  const [txHash, setTxHash] = useState(null)
  const [txError, setTxError] = useState(null)
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!receipt) return
    setTxStatus('success'); onChange?.()
  }, [receipt]) // eslint-disable-line

  if (!dispute) return null
  const disputedBy = dispute.disputedBy
  const isDisputer = disputedBy?.toLowerCase() === userAddress?.toLowerCase()
  const counterMissing = !dispute.counterEvidenceHash || dispute.counterEvidenceHash === ZERO_BYTES32
  const canCounter = !!role && !isDisputer && counterMissing

  const submitCounter = async () => {
    try {
      const hash = keccak256(toBytes(counterReason + '|' + counterUri))
      setTxError(null); setTxStatus('confirming')
      const tx = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: 'submitCounterEvidence',
        args: [BigInt(escrow.id), BigInt(milestone.index), hash, counterUri]
      })
      setTxHash(tx); setTxStatus('pending')
    } catch (err) { setTxError(err); setTxStatus('error') }
  }

  const resolve = async (releaseToRecipient) => {
    try {
      if (!isValidBytes32(resolutionHash)) throw new Error('Invalid resolution hash')
      setTxError(null); setTxStatus('confirming')
      const tx = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: 'resolveDispute',
        args: [BigInt(escrow.id), BigInt(milestone.index), releaseToRecipient, resolutionHash, 0n]
      })
      setTxHash(tx); setTxStatus('pending')
    } catch (err) { setTxError(err); setTxStatus('error') }
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
          <textarea rows={2} className="input-field" placeholder="Your response"
            value={counterReason} onChange={(e) => setCounterReason(e.target.value)} />
          <input className="input-field" placeholder="https://… (evidence URL)"
            value={counterUri} onChange={(e) => setCounterUri(e.target.value.trim())} />
          <button className="btn-primary text-sm py-2 self-start"
            onClick={submitCounter}
            disabled={!counterReason.trim() || !counterUri.trim() || txStatus === 'confirming' || txStatus === 'pending'}>
            Submit My Side
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
              disabled={txStatus === 'confirming' || txStatus === 'pending'}>
              Release to Freelancer
            </button>
            <button className="btn-danger text-sm py-2 flex-1"
              onClick={() => resolve(false)}
              disabled={txStatus === 'confirming' || txStatus === 'pending'}>
              Refund to Payer
            </button>
          </div>
        </div>
      )}

      <TxModal status={txStatus} txHash={txHash} error={txError}
        onClose={() => { setTxStatus('idle'); setTxHash(null); setTxError(null) }}
        title="Submitting" />
    </div>
  )
}
