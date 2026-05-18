// "God Mode" tribunal: black-bg admin/arbiter command center with strict RBAC.
// Sections render only when the connected wallet holds the corresponding role.
// Wallets with no privileged roles are bounced to the dashboard.

import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { isAddress, keccak256, toBytes } from 'viem'

import ConnectGate from '../components/ConnectGate.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import Skeleton from '../components/Skeleton.jsx'
import TxModal from '../components/TxModal.jsx'
import { useDisputedEscrows, useEscrowDetail, useTick } from '../hooks/useEscrows.js'
import { useAllCallerRoles } from '../hooks/useArbiter.js'
import { useSupportedDomains } from '../hooks/useSupportedDomains.js'
import { txToast } from '../hooks/useToast.jsx'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract.js'
import { isValidBytes32 } from '../utils/encode.js'
import { formatUSDC, truncateAddr } from '../utils/format.js'
import { getDomainName, ALL_DOMAIN_NUMBERS } from '../config/chains.js'
import { useReadContract } from 'wagmi'

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const ARBITER_INACTION_TIMEOUT_SEC = 30 * 24 * 60 * 60
const TIMEOUT_WARN_THRESHOLD_SEC = 7 * 24 * 60 * 60

// "God Mode" button shapes. Stark, high-contrast, severe.
const GOD_BTN = 'inline-flex items-center justify-center font-mono uppercase tracking-wider text-xs px-4 py-3 rounded-none border transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const GOD_BTN_WHITE = `${GOD_BTN} bg-white text-black border-white hover:bg-gray-200`
const GOD_BTN_RED = `${GOD_BTN} bg-status-error text-white border-status-error hover:opacity-90`
const GOD_BTN_GHOST = `${GOD_BTN} bg-transparent text-text-primary border-border-medium hover:border-border-focused`

export default function DisputeTribunal() {
  return (
    <ConnectGate title="Wallet not connected" message="Connect the wallet that holds an arbiter or admin role to access this panel.">
      <TribunalRouter />
    </ConnectGate>
  )
}

function TribunalRouter() {
  const { address } = useAccount()
  const { roles, hasAny, isLoading } = useAllCallerRoles(address)
  const { id, milestone } = useParams()

  if (isLoading) {
    return (
      <FullBleedDark>
        <div className="p-8"><Skeleton className="h-40" /></div>
      </FullBleedDark>
    )
  }

  if (!hasAny) {
    return <AccessDenied />
  }

  // Per-case 3-column view requires arbiter privileges.
  if (id !== undefined && milestone !== undefined) {
    if (!roles.isArbiter) {
      return <Navigate to="/dashboard" replace />
    }
    return (
      <FullBleedDark>
        <DisputeCommandCenter escrowId={Number(id)} milestoneIdx={Number(milestone)} />
      </FullBleedDark>
    )
  }

  return (
    <FullBleedDark>
      <CommandCenter roles={roles} address={address} />
    </FullBleedDark>
  )
}

/* ============================================================
   Layout — full-bleed black background and monospace defaults.
   Negates AppShell's main padding via negative margins.
   ============================================================ */
function FullBleedDark({ children }) {
  return (
    <div className="-mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 -mb-24 lg:-mb-8 bg-[#050505] text-text-primary font-mono min-h-[calc(100vh-4rem)] w-auto max-w-full overflow-x-hidden">
      <div className="px-4 md:px-6 lg:px-8 py-8 max-w-content mx-auto w-full">
        {children}
      </div>
    </div>
  )
}

function AccessDenied() {
  return (
    <FullBleedDark>
      <div className="flex flex-col items-center justify-center py-32 gap-6 text-center">
        <div className="text-5xl font-mono uppercase tracking-[0.3em] text-status-error">
          Access denied
        </div>
        <p className="text-text-secondary font-sans max-w-md">
          This wallet doesn't hold any admin or arbiter role on the contract.
          You need to be an arbiter, fee manager, domain manager,
          recovery manager, or pauser to access this.
        </p>
        <Link to="/dashboard" className={GOD_BTN_WHITE}>← Return to dashboard</Link>
      </div>
    </FullBleedDark>
  )
}

/* ============================================================
   Top-level Command Center: header + disputes (arbiter) + admin modules.
   ============================================================ */
function CommandCenter({ roles, address }) {
  const activeRoles = useMemo(() => {
    const labels = []
    if (roles.isDefaultAdmin) labels.push('ADMIN')
    if (roles.isArbiter) labels.push('ARBITER')
    if (roles.isFeeManager) labels.push('FEE MANAGER')
    if (roles.isDomainManager) labels.push('DOMAIN MANAGER')
    if (roles.isRecoveryManager) labels.push('RECOVERY MANAGER')
    if (roles.isPauser) labels.push('PAUSER')
    return labels
  }, [roles])

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3 border-b border-border-subtle pb-6">
        <div className="text-xs uppercase tracking-[0.3em] text-text-tertiary">
          Arbiter Panel
        </div>
        <h1 className="text-4xl font-mono uppercase tracking-tight text-text-primary">
          Admin Controls
        </h1>
        <div className="flex items-center justify-between gap-4 flex-wrap pt-2">
          <div className="flex flex-wrap gap-2">
            {activeRoles.map((r) => (
              <span key={r} className="text-[10px] uppercase tracking-[0.2em] border border-border-medium px-2 py-1 text-text-primary">
                {r}
              </span>
            ))}
          </div>
          <div className="text-xs text-text-tertiary">
            Caller&nbsp;
            <span className="text-text-primary">{address ? truncateAddr(address) : '—'}</span>
          </div>
        </div>
      </header>

      {roles.isArbiter && <DisputesSection />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {roles.isFeeManager && <FeeManagerModule />}
        {roles.isDomainManager && <DomainManagerModule />}
        {roles.isRecoveryManager && <RecoveryManagerModule />}
        {roles.isPauser && <PauserModule />}
      </div>
    </div>
  )
}

/* ============================================================
   ARBITER — disputed escrows list with timeout indicator.
   ============================================================ */
function DisputesSection() {
  const { escrows, isLoading } = useDisputedEscrows()
  useTick(15_000) // refresh countdowns

  return (
    <section className="flex flex-col gap-4">
      <ModuleHeader title="Open Disputes" subtitle={`${escrows.length} case(s) waiting for a decision`} />
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : escrows.length === 0 ? (
        <div className="border border-border-subtle px-6 py-16 sm:py-20 flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 border border-border-medium flex items-center justify-center text-text-secondary">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 2v3M5 7h14M6 7l-2 11h16L18 7M11 12v4M13 12v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-sm uppercase tracking-[0.2em] text-text-primary">No open disputes right now</div>
            <div className="text-xs text-text-tertiary font-sans">When a case lands, it will appear here for review.</div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {escrows.map((c) => (
            <DisputedEscrowCard key={c.id} summary={c} />
          ))}
        </div>
      )}
    </section>
  )
}

function DisputedEscrowCard({ summary }) {
  // We only have summary-level data here (no per-milestone dispute raisedAt).
  // The per-case command center loads the full detail and shows precise timing.
  return (
    <Link
      to={`/tribunal/${summary.id}/0`}
      className="border border-border-subtle bg-[#0a0a0a] p-5 flex flex-col gap-3 hover:border-border-focused transition-colors"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-text-tertiary">
          ESC-{summary.id}
        </span>
        <span className="text-[10px] uppercase tracking-[0.2em] text-status-warning border border-status-warning/40 px-2 py-0.5">
          {summary.disputedMilestoneCount} In Dispute
        </span>
      </div>
      <div className="font-mono tabular text-3xl text-white">{formatUSDC(summary.totalAmount)}</div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-text-tertiary mb-1 uppercase tracking-wider">Payer</div>
          <AddressDisplay address={summary.depositor} size="sm" />
        </div>
        <div className="text-right">
          <div className="text-text-tertiary mb-1 uppercase tracking-wider">Freelancer</div>
          <AddressDisplay address={summary.recipient} size="sm" />
        </div>
      </div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-text-primary self-end pt-1">
        Review case →
      </div>
    </Link>
  )
}

/* ============================================================
   ARBITER — 3-column command center for a single dispute.
   ============================================================ */
function DisputeCommandCenter({ escrowId, milestoneIdx }) {
  const navigate = useNavigate()
  const { address } = useAccount()
  const { detail, isLoading, refetch } = useEscrowDetail(escrowId, address, { pollMs: 12_000 })
  useTick(15_000)

  const escrow = detail?.escrow
  const milestone = detail?.milestones?.[milestoneIdx]
  const dispute = detail?.disputes?.[milestoneIdx]

  if (isLoading || !detail || !escrow || !milestone) {
    return <Skeleton className="h-40" />
  }
  if (milestone.state !== 2) {
    return (
      <div className="border border-border-subtle p-12 text-center flex flex-col items-center gap-4">
        <h2 className="text-xl font-mono uppercase tracking-wider">No active dispute</h2>
        <p className="text-sm text-text-secondary">This milestone does not have an open dispute.</p>
        <button className={GOD_BTN_GHOST} onClick={() => navigate('/tribunal')}>← Back to tribunal</button>
      </div>
    )
  }

  const raisedAt = Number(dispute?.raisedAt ?? 0n)
  const nowSec = Math.floor(Date.now() / 1000)
  const elapsed = raisedAt > 0 ? nowSec - raisedAt : 0
  const remaining = Math.max(0, ARBITER_INACTION_TIMEOUT_SEC - elapsed)
  const danger = raisedAt > 0 && remaining < TIMEOUT_WARN_THRESHOLD_SEC

  const disputedBy = dispute?.disputedBy
  const payerIsDisputer = disputedBy?.toLowerCase() === escrow.depositor?.toLowerCase()

  // Split evidence into payer/freelancer threads.
  const payerEvidence = payerIsDisputer
    ? { reason: dispute.reason, uri: dispute.evidenceURI, hash: dispute.evidenceHash, kind: 'opening' }
    : (dispute?.counterEvidenceURI || dispute?.counterEvidenceHash !== ZERO_BYTES32
        ? { reason: null, uri: dispute.counterEvidenceURI, hash: dispute.counterEvidenceHash, kind: 'counter' }
        : null)
  const freelancerEvidence = !payerIsDisputer
    ? { reason: dispute.reason, uri: dispute.evidenceURI, hash: dispute.evidenceHash, kind: 'opening' }
    : (dispute?.counterEvidenceURI || dispute?.counterEvidenceHash !== ZERO_BYTES32
        ? { reason: null, uri: dispute.counterEvidenceURI, hash: dispute.counterEvidenceHash, kind: 'counter' }
        : null)

  return (
    <div className="flex flex-col gap-6 pb-64 lg:pb-32">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
        <button onClick={() => navigate('/tribunal')} className="text-xs uppercase tracking-[0.2em] text-text-tertiary hover:text-text-primary">
          ← Tribunal
        </button>
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.2em] border border-status-warning/40 text-status-warning px-2 py-1">
            In Dispute
          </span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-text-tertiary">
            ESC-{escrowId} / M{milestoneIdx + 1}
          </span>
        </div>
      </div>

      {/* 3-column command center */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TermsColumn
          escrow={escrow}
          milestone={milestone}
          dispute={dispute}
          escrowId={escrowId}
          milestoneIdx={milestoneIdx}
          raisedAt={raisedAt}
          remaining={remaining}
          danger={danger}
        />
        <EvidenceColumn
          title="Payer's evidence"
          who={escrow.depositor}
          evidence={payerEvidence}
        />
        <EvidenceColumn
          title="Freelancer's evidence"
          who={escrow.recipient}
          evidence={freelancerEvidence}
        />
      </div>

      {/* Sticky decision bar */}
      <ArbiterDecisionBar
        escrowId={escrowId}
        milestoneIdx={milestoneIdx}
        onResolved={refetch}
      />
    </div>
  )
}

function TermsColumn({ escrow, milestone, dispute, escrowId, milestoneIdx, raisedAt, remaining, danger }) {
  return (
    <div className="border border-border-subtle bg-[#0a0a0a] p-5 flex flex-col gap-4 overflow-hidden">
      <div className="text-[10px] uppercase tracking-[0.3em] text-text-tertiary">Escrow Details</div>

      <div>
        <Label>Amount in dispute</Label>
        <div className="font-mono tabular text-3xl text-white">{formatUSDC(milestone.amount)}</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Payer</Label>
          <AddressDisplay address={escrow.depositor} size="sm" />
        </div>
        <div>
          <Label>Freelancer</Label>
          <AddressDisplay address={escrow.recipient} size="sm" />
        </div>
      </div>

      <div>
        <Label>Case</Label>
        <div className="text-sm">ESC-{escrowId} / Milestone {milestoneIdx + 1}</div>
      </div>

      {dispute?.disputedBy && (
        <div>
          <Label>Raised by</Label>
          <AddressDisplay address={dispute.disputedBy} size="sm" />
        </div>
      )}

      <div>
        <Label>Invoice hash</Label>
        <div className="font-mono text-xs break-all text-text-primary">
          {escrow.invoiceHash}
        </div>
      </div>

      {raisedAt > 0 && (
        <div>
          <Label>Arbiter timeout</Label>
          <div className={`font-mono text-sm ${danger ? 'text-status-error animate-pulse' : 'text-text-primary'}`}>
            {formatRemaining(remaining)}
          </div>
          <div className="text-[10px] text-text-tertiary mt-1">
            If the arbiter takes no action for 30 days, anyone can force a refund to the payer.
          </div>
        </div>
      )}

      {escrow.invoiceURI && (
        <a href={escrow.invoiceURI} target="_blank" rel="noreferrer" className={`${GOD_BTN_GHOST} mt-auto`}>
          View invoice ↗
        </a>
      )}
    </div>
  )
}

function EvidenceColumn({ title, who, evidence }) {
  return (
    <div className="border border-border-subtle bg-[#0a0a0a] p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle pb-3">
        <div className="text-[10px] uppercase tracking-[0.3em] text-text-tertiary">{title}</div>
        <AddressDisplay address={who} size="sm" />
      </div>
      {!evidence ? (
        <div className="text-xs text-text-tertiary italic text-center py-12 font-sans">
          No evidence submitted yet.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-text-tertiary">
            {evidence.kind === 'opening' ? 'Opening statement' : 'Counter-evidence'}
          </div>
          {evidence.reason && (
            <p className="text-sm text-text-primary font-sans">{evidence.reason}</p>
          )}
          {evidence.uri && (
            <a href={evidence.uri} target="_blank" rel="noreferrer"
              className="text-xs underline break-all text-text-primary">
              {evidence.uri} ↗
            </a>
          )}
          {evidence.hash && evidence.hash !== ZERO_BYTES32 && (
            <div className="text-[10px] text-text-tertiary break-all border-t border-border-subtle pt-2">
              hash {evidence.hash}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ============================================================
   ARBITER DECISION EXECUTION — sticky bottom bar, double-confirm.
   ============================================================ */
function ArbiterDecisionBar({ escrowId, milestoneIdx, onResolved }) {
  const [resolutionHash, setResolutionHash] = useState('')
  const [pending, setPending] = useState(null) // null | 'release' | 'refund'
  const { writeContractAsync } = useWriteContract()
  const [txStatus, setTxStatus] = useState('idle')
  const [txHash, setTxHash] = useState(null)
  const [txError, setTxError] = useState(null)
  const [txToastApi, setTxToastApi] = useState(null)
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!receipt) return
    setTxStatus('success'); setPending(null); onResolved?.()
    txToastApi?.success('Decision recorded on-chain.', { hash: txHash })
  }, [receipt]) // eslint-disable-line

  const isBusy = txStatus === 'confirming' || txStatus === 'pending'
  const hashValid = isValidBytes32(resolutionHash)

  const arm = (kind) => {
    if (!hashValid) return
    setPending(kind)
  }
  const cancel = () => setPending(null)

  const execute = async (releaseToRecipient) => {
    const t = txToast({ loading: 'Executing decision. Check your wallet.' })
    setTxToastApi(t)
    try {
      setTxError(null); setTxStatus('confirming')
      const tx = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: 'resolveDispute',
        args: [BigInt(escrowId), BigInt(milestoneIdx), releaseToRecipient, resolutionHash, 0n]
      })
      setTxHash(tx); setTxStatus('pending')
      t.update('Submitted. Waiting for confirmation.')
    } catch (err) {
      setTxError(err); setTxStatus('error'); setPending(null)
      t.error('Transaction failed. Try again.')
    }
  }

  return (
    <>
      <div className="fixed bottom-16 lg:bottom-0 left-0 right-0 z-40 bg-[#050505] border-t border-border-medium w-full max-w-full">
        <div className="max-w-content mx-auto px-4 md:px-6 lg:px-8 py-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
            <div className="text-[10px] uppercase tracking-[0.3em] text-text-tertiary">
              Record your decision
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-status-error">
              This is irreversible. The decision gets written on-chain.
            </div>
          </div>
          <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
            <input
              className="flex-1 w-full bg-[#0a0a0a] border border-border-subtle text-text-primary placeholder:text-text-tertiary font-mono text-sm px-3 py-3 focus:outline-none focus:border-border-focused"
              placeholder="resolution hash (bytes32)"
              value={resolutionHash}
              onChange={(e) => setResolutionHash(e.target.value.trim())}
              disabled={!!pending || isBusy}
            />
            {!pending && (
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  className={GOD_BTN_RED}
                  onClick={() => arm('refund')}
                  disabled={!hashValid || isBusy}
                >
                  Refund to Payer
                </button>
                <button
                  className={GOD_BTN_WHITE}
                  onClick={() => arm('release')}
                  disabled={!hashValid || isBusy}
                >
                  Release to Freelancer
                </button>
              </div>
            )}
            {pending && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="text-xs uppercase tracking-[0.2em] text-status-error animate-pulse pr-2">
                  {pending === 'release' ? 'Confirm release to freelancer' : 'Confirm refund to payer'}
                </div>
                <div className="flex gap-2">
                  <button className={GOD_BTN_GHOST} onClick={cancel} disabled={isBusy}>Cancel</button>
                  <button
                    className={pending === 'release' ? GOD_BTN_WHITE : GOD_BTN_RED}
                    onClick={() => execute(pending === 'release')}
                    disabled={isBusy}
                  >
                    {isBusy ? 'Executing…' : 'Confirm Execution'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <TxModal
        status={txStatus} txHash={txHash} error={txError}
        onClose={() => { setTxStatus('idle'); setTxHash(null); setTxError(null) }}
        title="Recording decision"
      />
    </>
  )
}

/* ============================================================
   FEE MANAGER MODULE
   ============================================================ */
function FeeManagerModule() {
  const fee = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'protocolFeeBps' })
  const treasury = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'protocolTreasury' })
  const cctp = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'cctpForwardFee' })

  return (
    <Module title="Fee Manager" subtitle="Fee rate, treasury address, and CCTP forwarding fee">
      <Row label="Current fee">
        <span className="font-mono text-base text-text-primary">
          {fee.data !== undefined ? `${(Number(fee.data) / 100).toFixed(2)}%` : '—'}
        </span>
      </Row>
      <WriteForm
        placeholder="New fee in basis points (199 = 1.99%)"
        validate={(v) => /^\d+$/.test(v) && Number(v) <= 1000}
        label="Update fee"
        fn="setProtocolFee"
        toCallArgs={(v) => [BigInt(v)]}
        onSuccess={() => { fee.refetch?.() }}
      />

      <Divider />

      <Row label="Treasury">
        <span className="font-mono text-xs text-text-primary">{treasury.data ? truncateAddr(treasury.data) : '—'}</span>
      </Row>
      <WriteForm
        placeholder="New treasury address (0x...)"
        validate={(v) => isAddress(v)}
        label="Update treasury"
        fn="setProtocolTreasury"
        toCallArgs={(v) => [v]}
        onSuccess={() => { treasury.refetch?.() }}
      />

      <Divider />

      <Row label="CCTP forwarding fee">
        <span className="font-mono text-base text-text-primary">
          {cctp.data !== undefined ? `${(Number(cctp.data) / 1_000_000).toFixed(6)} USDC` : '—'}
        </span>
      </Row>
      <WriteForm
        placeholder="New fee in USDC base units (6 decimals, e.g. 1000000 = 1 USDC)"
        validate={(v) => /^\d+$/.test(v)}
        label="Update forwarding fee"
        fn="setCctpForwardFee"
        toCallArgs={(v) => [BigInt(v)]}
        onSuccess={() => { cctp.refetch?.() }}
      />
    </Module>
  )
}

/* ============================================================
   DOMAIN MANAGER MODULE
   ============================================================ */
function DomainManagerModule() {
  const { supported, refetch } = useSupportedDomains()
  return (
    <Module title="Domain Manager" subtitle="Supported destination chains">
      <div className="flex flex-col gap-2">
        {supported.length === 0 ? (
          <div className="text-xs text-text-tertiary italic">No destination chains added yet.</div>
        ) : (
          supported.map((d) => (
            <SupportedDomainRow key={d} domain={d} onRemoved={refetch} />
          ))
        )}
      </div>

      <Divider />

      <WriteForm
        placeholder="CCTP domain ID (e.g. 6 for Base Sepolia)"
        validate={(v) => /^\d+$/.test(v) && ALL_DOMAIN_NUMBERS.includes(Number(v))}
        label="Add chain"
        fn="addSupportedDomain"
        toCallArgs={(v) => [Number(v)]}
        onSuccess={() => { refetch?.() }}
      />
    </Module>
  )
}

function SupportedDomainRow({ domain, onRemoved }) {
  const { writeContractAsync } = useWriteContract()
  const [txHash, setTxHash] = useState(null)
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (receipt) { onRemoved?.(); setTxHash(null) }
  }, [receipt]) // eslint-disable-line

  const remove = async () => {
    const t = txToast({ loading: `Removing domain ${domain}…` })
    try {
      const tx = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: 'removeSupportedDomain', args: [Number(domain)]
      })
      setTxHash(tx)
      t.update('Submitted.')
      // Resolve toast on receipt via separate effect (Sonner reuses the id).
      t.success('Removed.', { hash: tx })
    } catch (err) {
      t.error('Removal failed.')
    }
  }

  return (
    <div className="flex items-center justify-between border border-border-subtle px-3 py-2 text-xs">
      <span className="font-mono text-text-primary">{getDomainName(domain)} <span className="text-text-tertiary">#{domain}</span></span>
      <button className={`${GOD_BTN_GHOST} !px-3 !py-1.5`} onClick={remove}>Remove</button>
    </div>
  )
}

/* ============================================================
   RECOVERY MANAGER MODULE
   ============================================================ */
function RecoveryManagerModule() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const { writeContractAsync } = useWriteContract()
  const [txStatus, setTxStatus] = useState('idle')
  const [txHash, setTxHash] = useState(null)
  const [txError, setTxError] = useState(null)
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toastApi, setToastApi] = useState(null)

  useEffect(() => {
    if (!receipt) return
    setTxStatus('success')
    toastApi?.success('Refund credit transferred.', { hash: txHash })
    setFrom(''); setTo(''); setConfirmOpen(false)
  }, [receipt]) // eslint-disable-line

  const valid = isAddress(from) && isAddress(to) && from.toLowerCase() !== to.toLowerCase()

  const execute = async () => {
    const t = txToast({ loading: 'Executing emergency recovery…' })
    setToastApi(t)
    try {
      setTxError(null); setTxStatus('confirming')
      const tx = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: 'adminTransferRefundCredit', args: [from, to]
      })
      setTxHash(tx); setTxStatus('pending')
      t.update('Submitted. Waiting for confirmation.')
    } catch (err) {
      setTxError(err); setTxStatus('error'); setConfirmOpen(false)
      t.error('Recovery failed.')
    }
  }

  return (
    <Module title="Recovery Manager" subtitle="Transfer refund credit to a new wallet" danger>
      <div className="border border-status-error/40 bg-status-error/5 text-status-error text-[10px] uppercase tracking-[0.2em] px-3 py-2">
        This cannot be undone.
      </div>

      <Label>Restricted wallet (current credit holder)</Label>
      <input
        className="w-full bg-[#0a0a0a] border border-border-subtle text-text-primary placeholder:text-text-tertiary font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-status-error"
        placeholder="0x… (current credit holder)"
        value={from}
        onChange={(e) => setFrom(e.target.value.trim())}
      />

      <Label>Replacement wallet</Label>
      <input
        className="w-full bg-[#0a0a0a] border border-border-subtle text-text-primary placeholder:text-text-tertiary font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-status-error"
        placeholder="0x… (replacement wallet)"
        value={to}
        onChange={(e) => setTo(e.target.value.trim())}
      />

      {!confirmOpen ? (
        <button
          className={GOD_BTN_RED}
          onClick={() => setConfirmOpen(true)}
          disabled={!valid || txStatus === 'confirming' || txStatus === 'pending'}
        >
          Transfer credit
        </button>
      ) : (
        <div className="flex flex-col gap-2 border border-status-error/40 p-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-status-error animate-pulse">
            Confirm transfer
          </div>
          <div className="flex gap-2">
            <button className={GOD_BTN_GHOST} onClick={() => setConfirmOpen(false)} disabled={txStatus === 'pending' || txStatus === 'confirming'}>
              Cancel
            </button>
            <button className={GOD_BTN_RED} onClick={execute} disabled={txStatus === 'pending' || txStatus === 'confirming'}>
              {txStatus === 'pending' || txStatus === 'confirming' ? 'Executing…' : 'Confirm Execution'}
            </button>
          </div>
        </div>
      )}

      <TxModal
        status={txStatus} txHash={txHash} error={txError}
        onClose={() => { setTxStatus('idle'); setTxHash(null); setTxError(null) }}
        title="Recovery"
      />
    </Module>
  )
}

/* ============================================================
   PAUSER MODULE
   ============================================================ */
function PauserModule() {
  const paused = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'paused' })
  const { writeContractAsync } = useWriteContract()
  const [txStatus, setTxStatus] = useState('idle')
  const [txHash, setTxHash] = useState(null)
  const [txError, setTxError] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toastApi, setToastApi] = useState(null)
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!receipt) return
    setTxStatus('success'); paused.refetch?.()
    toastApi?.success(paused.data ? 'Protocol is now active.' : 'Protocol is now paused.', { hash: txHash })
    setConfirmOpen(false)
  }, [receipt]) // eslint-disable-line

  const isPaused = !!paused.data
  const isBusy = txStatus === 'confirming' || txStatus === 'pending'

  const execute = async () => {
    const t = txToast({ loading: isPaused ? 'Unpausing…' : 'Pausing…' })
    setToastApi(t)
    try {
      setTxError(null); setTxStatus('confirming')
      const tx = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: isPaused ? 'unpause' : 'pause', args: []
      })
      setTxHash(tx); setTxStatus('pending')
      t.update('Submitted. Waiting for confirmation.')
    } catch (err) {
      setTxError(err); setTxStatus('error'); setConfirmOpen(false)
      t.error('Action failed.')
    }
  }

  return (
    <Module title="Pauser" subtitle="Pause or unpause the entire protocol" danger={isPaused}>
      <div className={`text-2xl font-mono uppercase tracking-[0.2em] py-3 ${isPaused ? 'text-status-error' : 'text-status-success'}`}>
        {isPaused ? 'Paused' : 'Active'}
      </div>

      {!confirmOpen ? (
        <button
          className={isPaused ? GOD_BTN_WHITE : GOD_BTN_RED}
          onClick={() => setConfirmOpen(true)}
          disabled={isBusy}
        >
          {isPaused ? 'Unpause' : 'Pause'}
        </button>
      ) : (
        <div className="flex flex-col gap-2 border border-status-error/40 p-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-status-error animate-pulse">
            {isPaused ? 'Confirm: unpause the protocol' : 'Confirm: pause the protocol'}
          </div>
          <div className="flex gap-2">
            <button className={GOD_BTN_GHOST} onClick={() => setConfirmOpen(false)} disabled={isBusy}>
              Cancel
            </button>
            <button className={isPaused ? GOD_BTN_WHITE : GOD_BTN_RED} onClick={execute} disabled={isBusy}>
              {isBusy ? 'Executing…' : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      {isPaused && (
        <div className="border border-status-error/40 bg-status-error/5 text-status-error text-[10px] uppercase tracking-[0.2em] px-3 py-2">
          Protocol is paused. No new escrows can be created until it is unpaused.
        </div>
      )}

      <TxModal
        status={txStatus} txHash={txHash} error={txError}
        onClose={() => { setTxStatus('idle'); setTxHash(null); setTxError(null) }}
        title={isPaused ? 'Unpausing protocol' : 'Pausing protocol'}
      />
    </Module>
  )
}

/* ============================================================
   Shared primitives
   ============================================================ */
function Module({ title, subtitle, children, danger = false }) {
  return (
    <section className={`border ${danger ? 'border-status-error/40' : 'border-border-subtle'} bg-[#0a0a0a] p-5 flex flex-col gap-3`}>
      <ModuleHeader title={title} subtitle={subtitle} danger={danger} />
      {children}
    </section>
  )
}

function ModuleHeader({ title, subtitle, danger = false }) {
  return (
    <header className="flex flex-col gap-1 border-b border-border-subtle pb-3">
      <div className={`text-[10px] uppercase tracking-[0.3em] ${danger ? 'text-status-error' : 'text-text-tertiary'}`}>
        {title}
      </div>
      {subtitle && (
        <div className="text-xs text-text-secondary font-sans">{subtitle}</div>
      )}
    </header>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <Label inline>{label}</Label>
      {children}
    </div>
  )
}

function Label({ children, inline = false }) {
  return (
    <div className={`text-[10px] uppercase tracking-[0.2em] text-text-tertiary ${inline ? '' : 'mb-1'}`}>
      {children}
    </div>
  )
}

function Divider() {
  return <hr className="border-t border-border-subtle my-1" />
}

function WriteForm({ label, fn, placeholder, validate, toCallArgs, onSuccess }) {
  const [value, setValue] = useState('')
  const { writeContractAsync } = useWriteContract()
  const [txStatus, setTxStatus] = useState('idle')
  const [txHash, setTxHash] = useState(null)
  const [txError, setTxError] = useState(null)
  const [toastApi, setToastApi] = useState(null)
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!receipt) return
    setTxStatus('success'); onSuccess?.()
    toastApi?.success('Update confirmed.', { hash: txHash })
    setValue('')
  }, [receipt]) // eslint-disable-line

  const valid = validate(value)
  const isBusy = txStatus === 'confirming' || txStatus === 'pending'

  const submit = async () => {
    const t = txToast({ loading: `${label} — confirm in wallet…` })
    setToastApi(t)
    try {
      setTxError(null); setTxStatus('confirming')
      const tx = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: fn, args: toCallArgs(value)
      })
      setTxHash(tx); setTxStatus('pending')
      t.update('Submitted. Waiting for confirmation.')
    } catch (err) {
      setTxError(err); setTxStatus('error')
      t.error(`${label} failed.`)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        className="w-full bg-[#0a0a0a] border border-border-subtle text-text-primary placeholder:text-text-tertiary font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-border-focused"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value.trim())}
        disabled={isBusy}
      />
      <button
        className={GOD_BTN_WHITE}
        onClick={submit}
        disabled={!valid || isBusy}
      >
        {isBusy ? 'Submitting…' : label}
      </button>
      <TxModal
        status={txStatus} txHash={txHash} error={txError}
        onClose={() => { setTxStatus('idle'); setTxHash(null); setTxError(null) }}
        title={label}
      />
    </div>
  )
}

/* ---------- helpers ---------- */
function formatRemaining(seconds) {
  if (seconds <= 0) return 'Arbiter timeout reached. Anyone can now trigger a refund.'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  return `${d}d ${h}h left before timeout`
}

// Hint to esbuild that these imports aren't dead.
void keccak256
void toBytes
