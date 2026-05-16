import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, useWaitForTransactionReceipt, useWriteContract, useReadContract } from 'wagmi'
import { decodeEventLog } from 'viem'
import { motion, AnimatePresence } from 'framer-motion'

import ConnectGate from '../components/ConnectGate.jsx'
import CustomSelect from '../components/CustomSelect.jsx'
import DatePicker from '../components/DatePicker.jsx'
import Tooltip from '../components/Tooltip.jsx'
import TxModal from '../components/TxModal.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import { txToast } from '../hooks/useToast.jsx'
import { useSupportedDomains } from '../hooks/useSupportedDomains.js'
import { ARC_DOMAIN, getDomainName, isEvmDomain } from '../config/chains.js'
import { CONTRACT_ADDRESS, USDC_ADDRESS, ESCROW_ABI, USDC_ABI } from '../config/contract.js'
import { addressToBytes32, hashDescription, daysToSeconds, hoursToSeconds, usdcToBaseUnits, isValidBytes32 } from '../utils/encode.js'
import { isValidAddress, isValidUrl, formatUSDC, formatDeadline, formatWindow } from '../utils/format.js'

const DRAFT_KEY = 'escrow-draft'

const STEP_DEFS = [
  { num: 1, label: 'Parties & amount' },
  { num: 2, label: 'Invoice' },
  { num: 3, label: 'Timing' },
  { num: 4, label: 'Milestones' },
  { num: 5, label: 'Review & lock' }
]

const TITLE_PRESETS = [
  'Upfront Payment', 'Project Kickoff', 'First Draft',
  'Revision Round 1', 'Revision Round 2', 'Final Delivery',
  'Post-Launch Support', 'Testing & QA', 'Documentation', 'Custom'
]

const NOTICE_WINDOW_OPTIONS = [
  { value: 1, label: '1 day' }, { value: 2, label: '2 days' },
  { value: 3, label: '3 days' }, { value: 7, label: '7 days' },
  { value: 14, label: '14 days' }
]

const DISPUTE_WINDOW_OPTIONS = [
  { value: 24,  label: '24 hours' }, { value: 48,  label: '48 hours' },
  { value: 72,  label: '3 days' }, { value: 168, label: '7 days' },
  { value: 336, label: '14 days' }
]

const emptyState = () => ({
  freelancer: '',
  destinationDomain: ARC_DOMAIN,
  totalAmount: '',
  description: '',
  invoiceURI: '',
  useCustomHash: false,
  customInvoiceHash: '',
  deadline: null,
  noticeWindowDays: 7,
  disputeWindowHours: 72,
  milestones: [{ title: 'Upfront Payment', customTitle: '', amount: '' }]
})

export default function CreateEscrow() {
  return (
    <ConnectGate title="Connect to create an escrow" message="You need a connected wallet to lock funds.">
      <Wizard />
    </ConnectGate>
  )
}

function Wizard() {
  const navigate = useNavigate()
  const { address } = useAccount()
  const { supported, isLoading: loadingDomains } = useSupportedDomains()

  const [step, setStep] = useState(1)
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const obj = JSON.parse(raw)
        return { ...emptyState(), ...obj, deadline: obj.deadline ? new Date(obj.deadline) : null }
      }
    } catch {}
    return emptyState()
  })
  const [errors, setErrors] = useState({})

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        ...state,
        deadline: state.deadline ? state.deadline.toISOString() : null,
        step
      }))
    } catch {}
  }, [state, step])

  const [phase, setPhase] = useState('idle')
  const [txStatus, setTxStatus] = useState('idle')
  const [txHash, setTxHash] = useState(null)
  const [txError, setTxError] = useState(null)
  const [txToastApi, setTxToastApi] = useState(null)
  const { writeContractAsync } = useWriteContract()
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  const totalBaseUnits = useMemo(() => {
    try { return usdcToBaseUnits(state.totalAmount) } catch { return 0n }
  }, [state.totalAmount])

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: 'allowance',
    args: address && CONTRACT_ADDRESS ? [address, CONTRACT_ADDRESS] : undefined,
    query: { enabled: !!address }
  })
  const approved = allowance !== undefined && totalBaseUnits > 0n && BigInt(allowance) >= totalBaseUnits

  const milestonesSum = useMemo(
    () => state.milestones.reduce((acc, m) => acc + (parseFloat(m.amount) || 0), 0),
    [state.milestones]
  )
  const totalAmountNum = parseFloat(state.totalAmount) || 0
  const remaining = +(totalAmountNum - milestonesSum).toFixed(6)
  const exactMatch = totalAmountNum > 0 && Math.abs(remaining) < 1e-9
  const supportedSet = useMemo(() => new Set(supported), [supported])

  const validateStep = (s) => {
    const e = {}
    if (s === 1) {
      if (!isValidAddress(state.freelancer)) e.freelancer = 'Enter a valid Ethereum address.'
      if (state.freelancer && address && state.freelancer.toLowerCase() === address.toLowerCase())
        e.freelancer = 'Freelancer cannot be the same as the payer.'
      if (!supportedSet.has(Number(state.destinationDomain))) e.destinationDomain = 'Select a supported destination chain.'
      else if (!isEvmDomain(state.destinationDomain)) e.destinationDomain = 'Non-EVM destinations aren\'t supported yet.'
      if (!totalAmountNum || totalAmountNum <= 0) e.totalAmount = 'Enter a total amount greater than 0.'
    }
    if (s === 2) {
      if (!state.useCustomHash && !state.description.trim()) e.description = 'Describe what this invoice covers.'
      if (state.useCustomHash && !isValidBytes32(state.customInvoiceHash)) e.customInvoiceHash = 'Custom hash must be 0x + 64 hex chars.'
      if (!isValidUrl(state.invoiceURI)) e.invoiceURI = 'Enter a valid URL.'
    }
    if (s === 3) {
      if (!state.deadline) e.deadline = 'Pick a project deadline.'
      else {
        const ts = Math.floor(state.deadline.getTime() / 1000)
        if (ts <= Math.floor(Date.now() / 1000) + 3600) e.deadline = 'Deadline must be at least 1 hour in the future.'
      }
    }
    if (s === 4) {
      if (state.milestones.length === 0) e.milestones = 'Add at least one milestone.'
      state.milestones.forEach((m, i) => {
        const eff = m.title === 'Custom' ? m.customTitle.trim() : m.title
        if (!eff) e[`milestone_${i}_title`] = 'Title required.'
        const a = parseFloat(m.amount)
        if (!a || a <= 0) e[`milestone_${i}_amount`] = 'Amount must be > 0.'
      })
      if (!exactMatch) e.milestonesTotal = 'Milestone amounts must equal the total.'
    }
    return e
  }

  const goNext = () => {
    const e = validateStep(step)
    setErrors(e)
    if (Object.keys(e).length === 0) setStep((s) => Math.min(s + 1, 5))
  }
  const goBack = () => setStep((s) => Math.max(s - 1, 1))

  const milestoneAmountsBigInt = useMemo(
    () => state.milestones.map((m) => { try { return usdcToBaseUnits(m.amount) } catch { return 0n } }),
    [state.milestones]
  )
  const protocolFee = totalBaseUnits * 199n / 10_000n
  const milestoneSum = milestoneAmountsBigInt.reduce((a, b) => a + b, 0n)

  const onApprove = async () => {
    const t = txToast({ loading: 'Approving USDC — confirm in wallet…' })
    setTxToastApi(t)
    try {
      setTxError(null); setTxStatus('confirming'); setPhase('approve')
      const hash = await writeContractAsync({
        address: USDC_ADDRESS, abi: USDC_ABI, functionName: 'approve',
        args: [CONTRACT_ADDRESS, totalBaseUnits]
      })
      setTxHash(hash); setTxStatus('pending')
      t.update('Approval submitted. Waiting for confirmation…')
    } catch (err) {
      setTxError(err); setTxStatus('error')
      t.error('Approval failed.')
    }
  }

  const onDeposit = async () => {
    const t = txToast({ loading: 'Creating escrow — confirm in wallet…' })
    setTxToastApi(t)
    try {
      if (milestoneSum !== totalBaseUnits) throw new Error('Amount mismatch')
      const invoiceHash = state.useCustomHash ? state.customInvoiceHash : hashDescription(state.description)
      // Single freelancer address acts as both the on-chain recipient identity
      // (used for permission checks) and — left-padded to bytes32 — the CCTP
      // mintRecipient that USDC is bridged to.
      const mintRecipient = addressToBytes32(state.freelancer)
      const deadline = BigInt(Math.floor(state.deadline.getTime() / 1000))
      const disputeWindow = BigInt(hoursToSeconds(state.disputeWindowHours))
      const noticeWindow = BigInt(daysToSeconds(state.noticeWindowDays))

      setTxError(null); setTxStatus('confirming'); setPhase('deposit')
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'deposit',
        args: [
          state.freelancer,
          '0x0000000000000000000000000000000000000000',
          totalBaseUnits,
          Number(state.destinationDomain),
          mintRecipient,
          disputeWindow,
          noticeWindow,
          invoiceHash,
          state.invoiceURI,
          milestoneAmountsBigInt,
          deadline,
          []
        ]
      })
      setTxHash(hash); setTxStatus('pending')
      t.update('Deposit submitted. Waiting for confirmation…')
    } catch (err) {
      setTxError(err); setTxStatus('error')
      t.error('Deposit failed.')
    }
  }

  useEffect(() => {
    if (!receipt) return
    if (phase === 'approve') {
      setTxStatus('success'); refetchAllowance()
      txToastApi?.success('USDC approved.', { hash: txHash })
    } else if (phase === 'deposit') {
      let escrowId = null
      try {
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue
          try {
            const decoded = decodeEventLog({ abi: ESCROW_ABI, data: log.data, topics: log.topics })
            if (decoded.eventName === 'EscrowCreated') { escrowId = Number(decoded.args.escrowId); break }
          } catch {}
        }
      } catch {}
      if (escrowId !== null) {
        try {
          const titles = state.milestones.map((m) => m.title === 'Custom' ? m.customTitle : m.title)
          localStorage.setItem(`escrow-titles-${escrowId}`, JSON.stringify(titles))
        } catch {}
      }
      setTxStatus('success')
      try { localStorage.removeItem(DRAFT_KEY) } catch {}
      txToastApi?.success('Escrow created successfully.', { hash: txHash })
      setTimeout(() => navigate(escrowId !== null ? `/escrow/${escrowId}` : '/dashboard'), 800)
    }
  }, [receipt]) // eslint-disable-line

  const closeTxModal = () => {
    setTxStatus('idle'); setTxHash(null); setTxError(null)
    if (phase === 'approve') refetchAllowance()
  }

  const chainOptions = useMemo(() => (
    supported.filter(isEvmDomain).map((d) => ({ value: d, label: getDomainName(d) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  ), [supported])

  return (
    <div className="flex flex-col md:flex-row gap-8 md:gap-12 max-w-4xl mx-auto w-full">
      {/* Progress tracker */}
      <ProgressTracker step={step} onJump={(i) => i < step && setStep(i)} />

      {/* Form card */}
      <div className="md:w-3/4 card-surface p-6 md:p-8">
        <div className="flex flex-col gap-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="flex flex-col gap-6"
            >
              {step === 1 && <Step1 state={state} setState={setState} errors={errors} chainOptions={chainOptions} loadingDomains={loadingDomains} />}
              {step === 2 && <Step2 state={state} setState={setState} errors={errors} />}
              {step === 3 && <Step3 state={state} setState={setState} errors={errors} />}
              {step === 4 && <Step4 state={state} setState={setState} errors={errors}
                  milestonesSum={milestonesSum} totalAmountNum={totalAmountNum}
                  remaining={remaining} exactMatch={exactMatch} />}
              {step === 5 && <Step5 state={state}
                  totalBaseUnits={totalBaseUnits} protocolFee={protocolFee}
                  milestoneAmountsBigInt={milestoneAmountsBigInt}
                  approved={approved} onApprove={onApprove} onDeposit={onDeposit}
                  txStatus={txStatus} phase={phase} />}
            </motion.div>
          </AnimatePresence>

          <div className="flex items-center justify-between pt-4 border-t border-border-subtle">
            <button className="btn-secondary"
              onClick={goBack}
              disabled={step === 1 || txStatus === 'confirming' || txStatus === 'pending'}
            >Back</button>
            {step < 5 && <button className="btn-primary" onClick={goNext}>Continue</button>}
          </div>
        </div>
      </div>

      <TxModal
        status={txStatus} txHash={txHash} error={txError}
        title={phase === 'approve' ? 'Approving USDC…' : 'Creating escrow…'}
        onClose={closeTxModal}
        onRetry={phase === 'approve' ? onApprove : onDeposit}
      />
    </div>
  )
}

/* ---------- Progress tracker ---------- */
function ProgressTracker({ step, onJump }) {
  return (
    <>
      {/* Mobile: horizontal scroll */}
      <div className="md:hidden flex flex-row justify-between w-full overflow-x-auto pb-4 mb-2 gap-3">
        {STEP_DEFS.map((s) => {
          const isCurrent = s.num === step
          const isDone = s.num < step
          return (
            <button key={s.num} onClick={() => onJump(s.num)}
              className={`flex items-center gap-2 shrink-0 px-3 py-2 rounded-full text-xs font-medium border ${
                isCurrent ? 'bg-accent-muted border-accent-blue text-accent'
                : isDone ? 'border-border-subtle text-text-secondary'
                : 'border-border-subtle text-text-tertiary'
              }`}>
              <span className={`inline-flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-mono ${
                isCurrent ? 'bg-accent text-white' : isDone ? 'bg-background-tertiary text-text-secondary' : 'bg-background-tertiary text-text-tertiary'
              }`}>{s.num}</span>
              {s.label}
            </button>
          )
        })}
      </div>

      {/* Desktop: vertical, left of form */}
      <aside className="hidden md:flex md:w-1/4 flex-col gap-8 border-l-2 border-border-subtle pl-6">
        {STEP_DEFS.map((s) => {
          const isCurrent = s.num === step
          const isDone = s.num < step
          return (
            <button key={s.num} onClick={() => onJump(s.num)}
              className={`relative flex items-start gap-3 text-left ${isDone || isCurrent ? '' : 'opacity-60'}`}>
              <span className={`absolute -left-[34px] inline-flex items-center justify-center h-6 w-6 rounded-full text-[11px] font-mono border-2 ${
                isCurrent ? 'bg-accent border-accent text-white'
                : isDone ? 'bg-background-secondary border-accent text-accent'
                : 'bg-background-primary border-border-subtle text-text-tertiary'
              }`}>{s.num}</span>
              <div>
                <div className="text-xs text-text-secondary">Step {s.num}</div>
                <div className={`text-sm font-medium ${isCurrent ? 'text-text-primary' : 'text-text-secondary'}`}>{s.label}</div>
              </div>
            </button>
          )
        })}
      </aside>
    </>
  )
}

/* ---------- Step 1 ---------- */
function Step1({ state, setState, errors, chainOptions, loadingDomains }) {
  const setField = (k) => (v) => setState((s) => ({ ...s, [k]: v }))
  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Who are you paying?</h2>
        <p className="text-sm text-text-secondary mt-1">Where funds go on milestone approval.</p>
      </div>

      <Field label="Freelancer's wallet address" error={errors.freelancer}
        hint={<Tooltip content="Acts as both the on-chain escrow recipient and the CCTP payout destination." />}>
        <input className="input-field font-mono" placeholder="0x…"
          value={state.freelancer}
          onChange={(e) => setField('freelancer')(e.target.value.trim())}
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Destination chain" error={errors.destinationDomain}
          hint={<Tooltip content="Where the freelancer receives their USDC. Same-chain is free; cross-chain pays CCTP fee." />}>
          <CustomSelect
            value={Number(state.destinationDomain)} onChange={setField('destinationDomain')}
            options={chainOptions} searchable
            placeholder={loadingDomains ? 'Loading chains…' : 'Select a chain'}
          />
        </Field>
        <Field label="Total escrow amount (USDC)" error={errors.totalAmount}>
          <input type="number" step="0.01" min="0"
            className="input-field font-mono" placeholder="0.00"
            value={state.totalAmount}
            onChange={(e) => setField('totalAmount')(e.target.value)}
          />
        </Field>
      </div>
    </>
  )
}

/* ---------- Step 2 ---------- */
function Step2({ state, setState, errors }) {
  const setField = (k) => (v) => setState((s) => ({ ...s, [k]: v }))
  const hashPreview = useMemo(() => {
    if (state.useCustomHash) return state.customInvoiceHash
    if (!state.description.trim()) return ''
    try { return hashDescription(state.description) } catch { return '' }
  }, [state.description, state.useCustomHash, state.customInvoiceHash])

  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">What's the invoice?</h2>
        <p className="text-sm text-text-secondary mt-1">A description and a link to the off-chain invoice.</p>
      </div>

      {!state.useCustomHash ? (
        <Field label="Invoice description" error={errors.description}
          hint={<Tooltip content="Hashed locally with keccak256 — only the hash goes on-chain." />}>
          <textarea rows={3} className="input-field-multiline"
            placeholder="e.g. Marketing site redesign, August deliverables…"
            value={state.description}
            onChange={(e) => setField('description')(e.target.value)}
          />
        </Field>
      ) : (
        <Field label="Custom invoice hash (bytes32)" error={errors.customInvoiceHash}>
          <input className="input-field font-mono" placeholder="0x…"
            value={state.customInvoiceHash}
            onChange={(e) => setField('customInvoiceHash')(e.target.value.trim())}
          />
        </Field>
      )}

      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input type="checkbox" className="rounded border-border-medium accent-[var(--accent-blue)]"
          checked={state.useCustomHash}
          onChange={(e) => setField('useCustomHash')(e.target.checked)}
        />
        Use a custom hash instead
      </label>

      <Field label="Invoice URI" error={errors.invoiceURI}
        hint={<Tooltip content="A URL where the off-chain invoice document can be retrieved." />}>
        <input className="input-field" placeholder="https://…"
          value={state.invoiceURI}
          onChange={(e) => setField('invoiceURI')(e.target.value.trim())}
        />
      </Field>

      <Field label="Invoice hash preview">
        <input className="input-field font-mono text-xs" readOnly value={hashPreview || '—'} />
      </Field>
    </>
  )
}

/* ---------- Step 3 ---------- */
function Step3({ state, setState, errors }) {
  const setField = (k) => (v) => setState((s) => ({ ...s, [k]: v }))
  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Set the timeline</h2>
        <p className="text-sm text-text-secondary mt-1">Deadlines and review windows.</p>
      </div>

      <Field label="Project deadline" error={errors.deadline}
        hint={<Tooltip content="After this date, undelivered milestones can be escalated to arbitration." />}>
        <DatePicker value={state.deadline} onChange={setField('deadline')} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Delivery notice window"
          hint={<Tooltip content="If the payer goes silent after delivery, the milestone auto-releases after this window." />}>
          <CustomSelect value={state.noticeWindowDays}
            onChange={setField('noticeWindowDays')} options={NOTICE_WINDOW_OPTIONS} />
        </Field>
        <Field label="Dispute window"
          hint={<Tooltip content="After approval, either party can still open a dispute within this window." />}>
          <CustomSelect value={state.disputeWindowHours}
            onChange={setField('disputeWindowHours')} options={DISPUTE_WINDOW_OPTIONS} />
        </Field>
      </div>
    </>
  )
}

/* ---------- Step 4 ---------- */
function Step4({ state, setState, errors, milestonesSum, totalAmountNum, remaining, exactMatch }) {
  const titleOptions = TITLE_PRESETS.map((t) => ({ value: t, label: t }))

  const addMilestone = () => {
    if (state.milestones.length >= 10) return
    setState((s) => ({ ...s, milestones: [...s.milestones, { title: TITLE_PRESETS[0], customTitle: '', amount: '' }] }))
  }
  const removeMilestone = (i) => {
    if (state.milestones.length <= 1) return
    setState((s) => ({ ...s, milestones: s.milestones.filter((_, idx) => idx !== i) }))
  }
  const update = (i, field, value) => {
    setState((s) => {
      const next = [...s.milestones]
      next[i] = { ...next[i], [field]: value }
      return { ...s, milestones: next }
    })
  }

  const over = milestonesSum > totalAmountNum + 1e-9
  const percentage = totalAmountNum > 0 ? Math.min(100, (milestonesSum / totalAmountNum) * 100) : 0

  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Milestones</h2>
        <p className="text-sm text-text-secondary mt-1">Each milestone is paid independently when approved.</p>
      </div>

      <div className="flex flex-col gap-4">
        <AnimatePresence initial={false}>
          {state.milestones.map((m, i) => (
            <motion.div
              key={i}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="flex flex-col sm:flex-row items-stretch sm:items-end gap-4 bg-background-primary p-4 rounded-xl border border-border-subtle"
            >
              <div className="flex-1 flex flex-col gap-2">
                <div className="text-xs text-text-secondary">Milestone {i + 1}</div>
                <CustomSelect value={m.title} onChange={(v) => update(i, 'title', v)} options={titleOptions} />
                {m.title === 'Custom' && (
                  <input className="input-field mt-2" placeholder="Custom title"
                    value={m.customTitle} onChange={(e) => update(i, 'customTitle', e.target.value)} />
                )}
                {errors[`milestone_${i}_title`] && <div className="text-xs text-status-error">{errors[`milestone_${i}_title`]}</div>}
              </div>
              <div className="sm:w-44 flex flex-col gap-2">
                <div className="text-xs text-text-secondary">Amount (USDC)</div>
                <input type="number" step="0.01" min="0"
                  className="input-field font-mono" placeholder="0.00"
                  value={m.amount} onChange={(e) => update(i, 'amount', e.target.value)} />
                {errors[`milestone_${i}_amount`] && <div className="text-xs text-status-error">{errors[`milestone_${i}_amount`]}</div>}
              </div>
              <button type="button"
                className="self-start sm:self-end btn-secondary h-12 px-3 text-sm"
                disabled={state.milestones.length <= 1}
                onClick={() => removeMilestone(i)}
                aria-label="Remove milestone">
                Remove
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {state.milestones.length < 10 && (
        <button type="button" className="btn-secondary self-start text-sm py-2" onClick={addMilestone}>
          + Add Milestone
        </button>
      )}

      {/* Allocation tracker */}
      <div className="card-surface p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Allocated</span>
          <span className="font-mono">{milestonesSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {totalAmountNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</span>
        </div>
        <div className="bg-background-tertiary w-full h-2 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${exactMatch ? 'bg-status-success' : over ? 'bg-status-error' : 'bg-accent'}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className={`text-xs ${exactMatch ? 'text-status-success' : over ? 'text-status-error' : 'text-status-warning'}`}>
          {totalAmountNum === 0
            ? 'Set a total amount in Step 1 first.'
            : over
            ? `You've exceeded the total by ${Math.abs(remaining).toFixed(2)} USDC.`
            : exactMatch
            ? 'All funds allocated. Ready to continue.'
            : `${Math.abs(remaining).toFixed(2)} USDC unallocated.`}
        </div>
      </div>
    </>
  )
}

/* ---------- Step 5 ---------- */
function Step5({ state, totalBaseUnits, protocolFee, milestoneAmountsBigInt, approved, onApprove, onDeposit, txStatus, phase }) {
  const totalSum = milestoneAmountsBigInt.reduce((a, b) => a + b, 0n)
  const mismatch = totalSum !== totalBaseUnits

  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Review & lock funds</h2>
        <p className="text-sm text-text-secondary mt-1">Approve USDC, then submit the deposit.</p>
      </div>

      <div className="card-surface p-5 flex flex-col gap-3">
        <ReviewRow label="Freelancer"><AddressDisplay address={state.freelancer} /></ReviewRow>
        <ReviewRow label="Destination chain"><span className="text-sm">{getDomainName(state.destinationDomain)}</span></ReviewRow>
        <ReviewRow label="Deadline">
          <span className="font-mono text-sm">{state.deadline ? formatDeadline(Math.floor(state.deadline.getTime() / 1000)) : '—'}</span>
        </ReviewRow>
        <ReviewRow label="Delivery notice window">
          <span className="text-sm">{formatWindow(daysToSeconds(state.noticeWindowDays))}</span>
        </ReviewRow>
        <ReviewRow label="Dispute window">
          <span className="text-sm">{formatWindow(hoursToSeconds(state.disputeWindowHours))}</span>
        </ReviewRow>
      </div>

      <div className="card-surface p-5 flex flex-col gap-3">
        <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide">Amount breakdown</h3>
        {state.milestones.map((m, i) => {
          const title = m.title === 'Custom' ? m.customTitle : m.title
          return (
            <ReviewRow key={i} label={`${i + 1}. ${title}`}>
              <span className="font-mono text-sm">{formatUSDC(milestoneAmountsBigInt[i])}</span>
            </ReviewRow>
          )
        })}
        <hr className="border-border-subtle" />
        <ReviewRow label="Subtotal"><span className="font-mono text-sm">{formatUSDC(totalSum)}</span></ReviewRow>
        <ReviewRow label="Protocol fee (1.99%)"><span className="font-mono text-sm">{formatUSDC(protocolFee)}</span></ReviewRow>
        <hr className="border-border-subtle" />
        <ReviewRow label={<span className="font-medium text-text-primary">Total to lock</span>}>
          <span className="font-mono text-lg text-accent">{formatUSDC(totalBaseUnits)}</span>
        </ReviewRow>
        {mismatch && (
          <div className="text-xs text-status-error">Milestone amounts don't match total. Go back to Step 4.</div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ActionStep label="Approve USDC" letter="A" done={approved}
          loading={phase === 'approve' && (txStatus === 'confirming' || txStatus === 'pending')}>
          {approved ? <span className="text-sm text-status-success">Approved ✓</span> : (
            <button className="btn-primary text-sm py-2 px-4"
              onClick={onApprove}
              disabled={txStatus === 'confirming' || txStatus === 'pending' || mismatch || totalBaseUnits === 0n}>
              Approve
            </button>
          )}
        </ActionStep>
        <ActionStep label="Create escrow" letter="B"
          loading={phase === 'deposit' && (txStatus === 'confirming' || txStatus === 'pending')}>
          <button className="btn-primary text-sm py-2 px-4"
            onClick={onDeposit}
            disabled={!approved || mismatch || txStatus === 'confirming' || txStatus === 'pending'}>
            Lock funds
          </button>
        </ActionStep>
      </div>
    </>
  )
}

/* ---------- shared sub-components ---------- */
function Field({ label, hint, children, error }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-text-primary flex items-center">
        {label}{hint}
      </label>
      {children}
      {error && <div className="text-xs text-status-error">{error}</div>}
    </div>
  )
}

function ReviewRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-text-secondary">{label}</span>
      <div>{children}</div>
    </div>
  )
}

function ActionStep({ label, letter, done, loading, children }) {
  return (
    <div className={`flex items-center justify-between gap-3 card-surface p-4 ${done ? 'border-status-success/40' : ''}`}>
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center justify-center h-7 w-7 rounded-full font-mono text-xs ${done ? 'bg-status-success/15 text-status-success' : 'bg-accent-muted text-accent'}`}>
          {letter}
        </span>
        <span className="text-sm">{label}</span>
      </div>
      {loading ? <span className="text-sm text-text-secondary">Working…</span> : children}
    </div>
  )
}
