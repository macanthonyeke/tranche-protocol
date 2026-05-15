import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { keccak256, toBytes } from 'viem'

import ConnectGate from '../components/ConnectGate.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import TxModal from '../components/TxModal.jsx'
import { useDisputedEscrows, useEscrowDetail, useTick } from '../hooks/useEscrows.js'
import { useIsArbiter } from '../hooks/useArbiter.js'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract.js'
import { isValidBytes32 } from '../utils/encode.js'
import { formatUSDC, truncateAddr } from '../utils/format.js'

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

export default function DisputeTribunal() {
  return (
    <ConnectGate title="Connect to view the tribunal" message="Disputes require a connected wallet to view.">
      <TribunalRouter />
    </ConnectGate>
  )
}

function TribunalRouter() {
  const { id, milestone } = useParams()
  if (id !== undefined && milestone !== undefined) {
    return <DisputeRoom escrowId={Number(id)} milestoneIdx={Number(milestone)} />
  }
  return <TribunalList />
}

/* ---------- List view ---------- */
function TribunalList() {
  const { address } = useAccount()
  const { escrows: disputedEscrows, isLoading } = useDisputedEscrows()
  const { isArbiter } = useIsArbiter(address)

  // Filter for non-arbiters: only show disputes the caller is party to.
  // Note: this is a coarse filter at the escrow level. The dispute room handles
  // the per-milestone case.
  const cases = useMemo(() => {
    if (!disputedEscrows) return []
    if (isArbiter) return disputedEscrows
    const lower = address?.toLowerCase()
    return disputedEscrows.filter((e) =>
      e.depositor?.toLowerCase() === lower || e.recipient?.toLowerCase() === lower
    )
  }, [disputedEscrows, address, isArbiter])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dispute Tribunal</h1>
          <p className="text-text-secondary text-sm mt-1">
            {isArbiter ? 'All open disputes across the protocol.' : 'Your active disputes.'}
          </p>
        </div>
        {isArbiter && (
          <span className="rounded-full border border-accent/30 bg-accent-muted text-accent text-xs px-3 py-1">
            Arbiter access
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="card-surface p-8 animate-pulse h-40" />
      ) : cases.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <h2 className="text-xl font-semibold mb-2">No active disputes</h2>
          <p className="text-sm text-text-secondary">Nothing to mediate right now.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cases.map((c) => (
            <Link key={c.id}
              to={`/escrow/${c.id}`}
              className="card-surface p-5 hover:border-border-medium transition-colors flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-text-secondary">ESC-{c.id}</span>
                <span className="rounded-full bg-status-warning/15 text-status-warning text-xs px-2 py-1 font-medium">
                  {c.disputedMilestoneCount} in dispute
                </span>
              </div>
              <div className="font-mono text-xl">{formatUSDC(c.totalAmount)}</div>
              <div className="flex justify-between text-xs">
                <div>
                  <div className="text-text-secondary mb-1">Payer</div>
                  <AddressDisplay address={c.depositor} size="sm" />
                </div>
                <div className="text-right">
                  <div className="text-text-secondary mb-1">Freelancer</div>
                  <AddressDisplay address={c.recipient} size="sm" />
                </div>
              </div>
              <div className="text-sm text-accent self-end">Open case →</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- Dispute Room (2-col chat-style) ---------- */
function DisputeRoom({ escrowId, milestoneIdx }) {
  const navigate = useNavigate()
  const { address } = useAccount()
  const { detail, isLoading, refetch } = useEscrowDetail(escrowId, address)
  useTick(15_000)

  const escrow = detail?.escrow
  const milestone = detail?.milestones?.[milestoneIdx]
  const dispute = detail?.disputes?.[milestoneIdx]
  const isArbiter = !!detail?.isArbiter
  const role = !detail ? null : detail.isPayer ? 'payer' : detail.isFreelancer ? 'freelancer' : null

  if (isLoading || !detail || !escrow || !milestone) {
    return <div className="card-surface p-8 animate-pulse h-40" />
  }
  if (milestone.state !== 2) {
    return (
      <div className="card-surface p-12 text-center">
        <h2 className="text-xl font-semibold mb-2">No active dispute</h2>
        <p className="text-sm text-text-secondary mb-6">This milestone is not currently in dispute.</p>
        <Link to={`/escrow/${escrowId}`} className="btn-primary inline-flex">Back to escrow</Link>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 lg:h-[calc(100vh-8rem)] gap-6">
      {/* Left: Terms */}
      <div className="bg-background-secondary border border-border-subtle rounded-xl p-6 overflow-y-auto flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate('/tribunal')}
            className="text-sm text-text-secondary hover:text-text-primary">
            ← Tribunal
          </button>
          <span className="rounded-full bg-status-warning/15 text-status-warning text-xs px-2 py-1 font-medium">
            In Dispute
          </span>
        </div>

        <div>
          <div className="text-xs text-text-secondary mb-1">Case</div>
          <div className="font-mono text-lg">ESC-{escrowId} / Milestone {milestoneIdx + 1}</div>
        </div>

        <div>
          <div className="text-xs text-text-secondary mb-1">Amount in dispute</div>
          <div className="font-mono text-2xl">{formatUSDC(milestone.amount)}</div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-text-secondary mb-1">Payer</div>
            <AddressDisplay address={escrow.depositor} size="sm" />
          </div>
          <div>
            <div className="text-xs text-text-secondary mb-1">Freelancer</div>
            <AddressDisplay address={escrow.recipient} size="sm" />
          </div>
        </div>

        {dispute?.disputedBy && (
          <div>
            <div className="text-xs text-text-secondary mb-1">Disputed by</div>
            <AddressDisplay address={dispute.disputedBy} size="sm" />
          </div>
        )}

        {escrow.invoiceURI && (
          <a href={escrow.invoiceURI} target="_blank" rel="noreferrer"
            className="btn-secondary text-sm text-center py-2 mt-auto">
            View original invoice ↗
          </a>
        )}

        {isArbiter && <ArbiterResolutionPanel
          escrowId={escrowId} milestoneIdx={milestoneIdx} onResolved={refetch} />}
      </div>

      {/* Right: Evidence chat-style panel */}
      <div className="bg-background-secondary border border-border-subtle rounded-xl flex flex-col overflow-hidden">
        <header className="px-6 py-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold">Evidence</h2>
          <p className="text-xs text-text-secondary">All evidence is committed on-chain by hash.</p>
        </header>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
          {dispute?.disputedBy && (
            <EvidenceBubble
              who={dispute.disputedBy} side="primary"
              reason={dispute.reason}
              uri={dispute.evidenceURI}
              hash={dispute.evidenceHash}
              label="Opening evidence"
            />
          )}
          {dispute?.counterEvidenceURI && (
            <EvidenceBubble
              who={dispute.disputedBy?.toLowerCase() === escrow.depositor?.toLowerCase() ? escrow.recipient : escrow.depositor}
              side="secondary"
              uri={dispute.counterEvidenceURI}
              hash={dispute.counterEvidenceHash}
              label="Counter-evidence"
            />
          )}
          {!dispute?.counterEvidenceURI && (
            <div className="text-sm text-text-tertiary italic text-center mt-4">
              Awaiting counter-evidence from the other party.
            </div>
          )}
        </div>

        <CounterEvidenceInput
          escrowId={escrowId} milestoneIdx={milestoneIdx}
          dispute={dispute} role={role} address={address}
          onSubmitted={refetch}
        />
      </div>
    </div>
  )
}

function EvidenceBubble({ who, side, reason, uri, hash, label }) {
  const align = side === 'primary' ? 'self-start' : 'self-end'
  const tone = side === 'primary'
    ? 'bg-background-tertiary border-border-subtle'
    : 'bg-accent-muted border-accent/30'
  return (
    <div className={`${align} max-w-[85%] rounded-xl border ${tone} p-4 flex flex-col gap-2`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-wider text-text-secondary">{label}</span>
        <AddressDisplay address={who} size="sm" />
      </div>
      {reason && <p className="text-sm text-text-primary">{reason}</p>}
      {uri && (
        <a href={uri} target="_blank" rel="noreferrer" className="text-sm text-accent break-all">
          {uri} ↗
        </a>
      )}
      {hash && hash !== ZERO_BYTES32 && (
        <div className="font-mono text-[10px] text-text-tertiary break-all">{truncateAddr(hash)}</div>
      )}
    </div>
  )
}

function CounterEvidenceInput({ escrowId, milestoneIdx, dispute, role, address, onSubmitted }) {
  const [reason, setReason] = useState('')
  const [uri, setUri] = useState('')
  const { writeContractAsync } = useWriteContract()
  const [txStatus, setTxStatus] = useState('idle')
  const [txHash, setTxHash] = useState(null)
  const [txError, setTxError] = useState(null)
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!receipt) return
    setTxStatus('success'); onSubmitted?.()
    setReason(''); setUri('')
  }, [receipt]) // eslint-disable-line

  if (!role) return null
  const isDisputer = dispute?.disputedBy?.toLowerCase() === address?.toLowerCase()
  const alreadyCountered = dispute?.counterEvidenceHash &&
    dispute.counterEvidenceHash !== ZERO_BYTES32
  if (isDisputer || alreadyCountered) {
    return (
      <footer className="p-4 border-t border-border-subtle bg-background-primary text-xs text-text-tertiary text-center">
        {isDisputer ? 'You opened this dispute. Wait for the other party to respond.' : 'Counter-evidence already submitted.'}
      </footer>
    )
  }

  const submit = async () => {
    try {
      if (!reason.trim() || !uri.trim()) throw new Error('Reason and evidence URL required')
      const hash = keccak256(toBytes(reason + '|' + uri))
      setTxError(null); setTxStatus('confirming')
      const tx = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: 'submitCounterEvidence',
        args: [BigInt(escrowId), BigInt(milestoneIdx), hash, uri]
      })
      setTxHash(tx); setTxStatus('pending')
    } catch (err) { setTxError(err); setTxStatus('error') }
  }

  return (
    <>
      <footer className="p-4 border-t border-border-subtle bg-background-primary flex flex-col gap-2">
        <textarea rows={2} className="input-field text-sm"
          placeholder="Your response…"
          value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex gap-2">
          <input className="input-field text-sm flex-1"
            placeholder="https://… (evidence URL)"
            value={uri} onChange={(e) => setUri(e.target.value.trim())} />
          <button className="btn-primary text-sm px-4"
            onClick={submit}
            disabled={!reason.trim() || !uri.trim() || txStatus === 'confirming' || txStatus === 'pending'}>
            Submit
          </button>
        </div>
      </footer>
      <TxModal status={txStatus} txHash={txHash} error={txError}
        onClose={() => { setTxStatus('idle'); setTxHash(null); setTxError(null) }}
        onRetry={submit} title="Submitting counter-evidence" />
    </>
  )
}

function ArbiterResolutionPanel({ escrowId, milestoneIdx, onResolved }) {
  const [resolutionHash, setResolutionHash] = useState('')
  const { writeContractAsync } = useWriteContract()
  const [txStatus, setTxStatus] = useState('idle')
  const [txHash, setTxHash] = useState(null)
  const [txError, setTxError] = useState(null)
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!receipt) return
    setTxStatus('success'); onResolved?.()
  }, [receipt]) // eslint-disable-line

  const resolve = async (releaseToRecipient) => {
    try {
      if (!isValidBytes32(resolutionHash)) throw new Error('Invalid resolution hash')
      setTxError(null); setTxStatus('confirming')
      const tx = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: 'resolveDispute',
        args: [BigInt(escrowId), BigInt(milestoneIdx), releaseToRecipient, resolutionHash, 0n]
      })
      setTxHash(tx); setTxStatus('pending')
    } catch (err) { setTxError(err); setTxStatus('error') }
  }

  return (
    <div className="mt-auto pt-4 border-t border-border-subtle flex flex-col gap-3">
      <div className="text-xs uppercase tracking-wide text-text-secondary">Arbiter resolution</div>
      <input className="input-field font-mono text-sm"
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
          Refund Payer
        </button>
      </div>
      <TxModal status={txStatus} txHash={txHash} error={txError}
        onClose={() => { setTxStatus('idle'); setTxHash(null); setTxError(null) }}
        title="Resolving dispute" />
    </div>
  )
}
