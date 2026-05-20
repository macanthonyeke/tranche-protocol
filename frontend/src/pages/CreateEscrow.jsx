import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, useWaitForTransactionReceipt, useWriteContract, useReadContract } from 'wagmi'
import { decodeEventLog } from 'viem'
import { motion, AnimatePresence } from 'framer-motion'

import ConnectGate from '../components/ConnectGate.jsx'
import CustomSelect from '../components/CustomSelect.jsx'
import DatePicker from '../components/DatePicker.jsx'
import Field, { FieldError } from '../components/Field.jsx'
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
  { num: 1, label: 'Parties', heading: 'Who are you paying?', description: 'Approved milestone payments go directly to this address.' },
  { num: 2, label: 'Invoice', heading: 'What is this for?', description: 'Give this escrow a description and link to the invoice document.' },
  { num: 3, label: 'Timeline', heading: 'Set the timeline', description: 'When work needs to be done, and how long each party has to respond.' },
  { num: 4, label: 'Milestones', heading: 'Allocate the milestones', description: 'Each milestone releases separately when the payer approves it.' },
  { num: 5, label: 'Review', heading: 'Review and lock funds', description: 'Two steps: approve USDC spending, then create the escrow.' }
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
    <ConnectGate title="Wallet not connected" message="Connect your wallet to create an escrow.">
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
      if (!isValidAddress(state.freelancer)) e.freelancer = "That doesn't look like a valid address."
      if (state.freelancer && address && state.freelancer.toLowerCase() === address.toLowerCase())
        e.freelancer = "The freelancer and payer can't be the same wallet."
      if (!supportedSet.has(Number(state.destinationDomain))) e.destinationDomain = 'Pick a supported destination chain.'
      else if (!isEvmDomain(state.destinationDomain)) e.destinationDomain = 'Only EVM-compatible chains are supported right now.'
      if (!totalAmountNum || totalAmountNum <= 0) e.totalAmount = 'Enter an amount greater than zero.'
    }
    if (s === 2) {
      if (!state.useCustomHash && !state.description.trim()) e.description = 'Add a description for this invoice.'
      if (state.useCustomHash && !isValidBytes32(state.customInvoiceHash)) e.customInvoiceHash = 'Custom hash must start with 0x followed by 64 hex characters.'
      if (!isValidUrl(state.invoiceURI)) e.invoiceURI = "That doesn't look like a valid URL."
    }
    if (s === 3) {
      if (!state.deadline) e.deadline = 'Set a project deadline.'
      else {
        const ts = Math.floor(state.deadline.getTime() / 1000)
        if (ts <= Math.floor(Date.now() / 1000) + 3600) e.deadline = 'Deadline needs to be at least 1 hour from now.'
      }
    }
    if (s === 4) {
      if (state.milestones.length === 0) e.milestones = 'Add at least one milestone to continue.'
      state.milestones.forEach((m, i) => {
        const eff = m.title === 'Custom' ? m.customTitle.trim() : m.title
        if (!eff) e[`milestone_${i}_title`] = 'Give this milestone a title.'
        const a = parseFloat(m.amount)
        if (!a || a <= 0) e[`milestone_${i}_amount`] = 'Milestone amount must be greater than zero.'
      })
      if (!exactMatch) e.milestonesTotal = 'Milestone amounts need to add up to the total.'
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
    const t = txToast({ loading: 'Approving USDC. Check your wallet.' })
    setTxToastApi(t)
    try {
      setTxError(null); setTxStatus('confirming'); setPhase('approve')
      const hash = await writeContractAsync({
        address: USDC_ADDRESS, abi: USDC_ABI, functionName: 'approve',
        args: [CONTRACT_ADDRESS, totalBaseUnits]
      })
      setTxHash(hash); setTxStatus('pending')
      t.update('Approval sent. Waiting for confirmation.')
    } catch (err) {
      setTxError(err); setTxStatus('error')
      t.error('Approval failed. Try again.')
    }
  }

  const onDeposit = async () => {
    const t = txToast({ loading: 'Creating escrow. Check your wallet.' })
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
      t.update('Transaction sent. Waiting for confirmation.')
    } catch (err) {
      setTxError(err); setTxStatus('error')
      t.error('Escrow creation failed. Try again.')
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
      txToastApi?.success('Escrow created. Funds are now locked.', { hash: txHash })
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

  const currentStep = STEP_DEFS.find((s) => s.num === step) ?? STEP_DEFS[0]

  return (
    <div className="flex flex-col md:flex-row gap-8 md:gap-12 max-w-4xl mx-auto w-full max-w-full">
      {/* Progress tracker */}
      <ProgressTracker step={step} onJump={(i) => i < step && setStep(i)} />

      {/* Form card */}
      <div className="w-full md:w-3/4 card-surface p-5 sm:p-6 md:p-8">
        <div className="flex flex-col gap-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col gap-6"
            >
              <StepHeading heading={currentStep.heading} description={currentStep.description} />
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

/* ---------- Step heading ---------- */
function StepHeading({ heading, description }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-2xl font-semibold tracking-tight text-text-primary">{heading}</h2>
      <p className="text-sm text-text-secondary">{description}</p>
    </div>
  )
}

/* ---------- Progress tracker ----------
   Desktop shows a vertical rail with three states per step:
     • completed — accent-filled circle with a checkmark
     • current   — solid accent, ring, prominent label
     • upcoming  — outlined, muted
   Mobile shows just numbered dots; labels are hidden to save room. */
function ProgressTracker({ step, onJump }) {
  const total = STEP_DEFS.length
  const current = STEP_DEFS.find((s) => s.num === step) ?? STEP_DEFS[0]
  return (
    <>
      {/* Mobile: header + segmented progress bar with numbered dots */}
      <div className="md:hidden flex flex-col gap-3 w-full max-w-full">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs uppercase tracking-[0.15em] text-text-tertiary">
            Step {step} of {total}
          </span>
          <span className="text-[10px] font-mono tabular text-text-tertiary">
            {Math.round((step / total) * 100)}%
          </span>
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-text-primary">
          {current.label}
        </h2>
        <div className="flex items-center gap-2">
          {STEP_DEFS.map((s) => {
            const isCurrent = s.num === step
            const isDone = s.num < step
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => onJump(s.num)}
                aria-label={`Go to step ${s.num}: ${s.label}`}
                className={`relative flex-1 h-1.5 rounded-full transition-colors duration-300 ${
                  isDone ? 'bg-accent' : isCurrent ? 'bg-accent/60' : 'bg-background-tertiary'
                }`}
              />
            )
          })}
        </div>
      </div>

      {/* Desktop: vertical rail, left of form */}
      <aside className="hidden md:flex md:w-1/4 flex-col gap-6 pl-1">
        <div className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-medium mb-2">
          New Escrow
        </div>
        <div className="relative flex flex-col gap-5">
          {/* Vertical line behind the dots */}
          <div className="absolute left-3 top-3 bottom-3 w-px bg-border-subtle" aria-hidden />
          <div
            className="absolute left-3 top-3 w-px bg-accent transition-[height] duration-300"
            style={{ height: `calc(${Math.max(0, (step - 1) / (STEP_DEFS.length - 1)) * 100}% - 1.5rem)` }}
            aria-hidden
          />
          {STEP_DEFS.map((s) => {
            const isCurrent = s.num === step
            const isDone = s.num < step
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => onJump(s.num)}
                disabled={!isDone && !isCurrent}
                className={`relative flex items-center gap-3 text-left pl-8 -ml-1 transition-opacity ${
                  isDone || isCurrent ? '' : 'opacity-50'
                } ${(isDone || isCurrent) ? 'cursor-pointer hover:opacity-90' : 'cursor-not-allowed'}`}
              >
                <span
                  className={`absolute left-0 inline-flex items-center justify-center h-6 w-6 rounded-full text-[11px] font-mono tabular border-2 transition-colors ${
                    isCurrent
                      ? 'bg-accent border-accent text-white shadow-[0_0_0_4px_var(--accent-muted)]'
                      : isDone
                        ? 'bg-accent border-accent text-white'
                        : 'bg-background-secondary border-border-medium text-text-tertiary'
                  }`}
                >
                  {isDone ? (
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d="M3 7.5l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    s.num
                  )}
                </span>
                <div className="flex flex-col">
                  <div className="text-[10px] uppercase tracking-[0.15em] text-text-tertiary">Step {s.num}</div>
                  <div className={`text-sm font-medium ${isCurrent ? 'text-text-primary' : isDone ? 'text-text-primary' : 'text-text-secondary'}`}>
                    {s.label}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </aside>
    </>
  )
}

/* ---------- Step 1 ---------- */
function Step1({ state, setState, errors, chainOptions, loadingDomains }) {
  const setField = (k) => (v) => setState((s) => ({ ...s, [k]: v }))
  return (
    <>
      <Field label="Freelancer's wallet address" error={errors.freelancer}
        hint={<Tooltip content="This is where payments land when milestones are approved." />}>
        {(props) => (
          <input {...props} className="input-field font-mono" placeholder="0x…"
            autoComplete="off" spellCheck={false} inputMode="text"
            value={state.freelancer}
            onChange={(e) => setField('freelancer')(e.target.value.trim())}
          />
        )}
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Payment chain" error={errors.destinationDomain}
          hint={<Tooltip content="The chain where the freelancer receives their USDC. Same-chain has no extra fee. Cross-chain uses Circle CCTP and a small forwarding fee applies." />}>
          {(props) => (
            <CustomSelect {...props}
              value={Number(state.destinationDomain)} onChange={setField('destinationDomain')}
              options={chainOptions} searchable
              placeholder={loadingDomains ? 'Loading supported chains...' : 'Select a chain'}
            />
          )}
        </Field>
        <Field label="Total amount (USDC)" error={errors.totalAmount}
          helper="Total locked from your wallet.">
          {(props) => (
            <div className="relative">
              <input {...props} type="number" step="0.01" min="0" inputMode="decimal"
                className="input-field font-mono tabular pr-16" placeholder="0.00"
                value={state.totalAmount}
                onChange={(e) => setField('totalAmount')(e.target.value)}
              />
              <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-tertiary font-medium">USDC</span>
            </div>
          )}
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
      {!state.useCustomHash ? (
        <Field label="Invoice description" error={errors.description}
          helper="Hashed locally. Only the hash is stored on-chain, not the text."
          hint={<Tooltip content="Your description is hashed locally. Only the hash is stored on-chain, not the text itself." />}>
          {(props) => (
            <textarea {...props} rows={3} className="input-field-multiline"
              placeholder="e.g. Brand identity redesign, Q3 deliverables"
              maxLength={500}
              value={state.description}
              onChange={(e) => setField('description')(e.target.value)}
            />
          )}
        </Field>
      ) : (
        <Field label="Custom invoice hash (bytes32)" error={errors.customInvoiceHash}>
          {(props) => (
            <input {...props} className="input-field font-mono" placeholder="0x…"
              autoComplete="off" spellCheck={false}
              value={state.customInvoiceHash}
              onChange={(e) => setField('customInvoiceHash')(e.target.value.trim())}
            />
          )}
        </Field>
      )}

      <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
        <input type="checkbox" className="rounded border-border-medium accent-[var(--accent-blue)] h-4 w-4"
          checked={state.useCustomHash}
          onChange={(e) => setField('useCustomHash')(e.target.checked)}
        />
        Use a custom hash instead
      </label>

      <Field label="Invoice URL" error={errors.invoiceURI}
        helper="A link to the full invoice document. Stored on-chain for reference."
        hint={<Tooltip content="A link to the actual invoice document. This gets stored on-chain for reference." />}>
        {(props) => (
          <input {...props} type="url" className="input-field" placeholder="https://…"
            autoComplete="url" spellCheck={false} inputMode="url"
            value={state.invoiceURI}
            onChange={(e) => setField('invoiceURI')(e.target.value.trim())}
          />
        )}
      </Field>

      <Field label="Invoice hash preview">
        {(props) => (
          <input {...props} className="input-field font-mono text-xs" readOnly value={hashPreview || '—'} />
        )}
      </Field>
    </>
  )
}

/* ---------- Step 3 ---------- */
function Step3({ state, setState, errors }) {
  const setField = (k) => (v) => setState((s) => ({ ...s, [k]: v }))
  return (
    <>
      <Field label="Project deadline" error={errors.deadline}
        helper="If milestones go undelivered past this date, they can be escalated."
        hint={<Tooltip content="If milestones are undelivered past this date, they can be escalated to the arbiter." />}>
        {(props) => (
          <DatePicker {...props} value={state.deadline} onChange={setField('deadline')} />
        )}
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Auto-release window"
          helper="How long the payer has to respond after delivery."
          hint={<Tooltip content="How long the payer has to respond after a milestone is marked delivered. If they go silent, the payment auto-releases when this runs out." />}>
          {(props) => (
            <CustomSelect {...props} value={state.noticeWindowDays}
              onChange={setField('noticeWindowDays')} options={NOTICE_WINDOW_OPTIONS} />
          )}
        </Field>
        <Field label="Dispute window"
          helper="How long either party has to dispute after approval."
          hint={<Tooltip content="How long either party has to open a dispute after a milestone is approved." />}>
          {(props) => (
            <CustomSelect {...props} value={state.disputeWindowHours}
              onChange={setField('disputeWindowHours')} options={DISPUTE_WINDOW_OPTIONS} />
          )}
        </Field>
      </div>
    </>
  )
}

/* ---------- Step 4 ----------
   Allocation table: index | title | amount | remove.
   Allocation tracker: progress bar fills toward 100%, turns red on overflow. */
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
      {/* Allocation table.
          Wrapper carries the surface and rounded edges; no overflow-hidden so
          per-row dropdowns (e.g. the milestone title CustomSelect) can float
          outside the row without being clipped. Zebra rows were dropped: the
          flat surface plus border-t separators read just as cleanly and
          remove the need to clip-to-rounded-corners. */}
      <div className="rounded-2xl border border-border-subtle bg-background-secondary">
        {/* Header row */}
        <div className="hidden sm:grid grid-cols-[3rem_1fr_11rem_4rem] gap-3 px-4 py-2.5 rounded-t-2xl bg-background-tertiary text-[10px] uppercase tracking-[0.15em] text-text-tertiary font-medium">
          <div>#</div>
          <div>Milestone</div>
          <div className="text-right">Amount (USDC)</div>
          <div />
        </div>

        <AnimatePresence initial={false}>
          {state.milestones.map((m, i) => (
            <motion.div
              key={i}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="relative grid grid-cols-1 sm:grid-cols-[3rem_1fr_11rem_4rem] gap-3 items-start px-4 py-3 border-t border-border-subtle"
            >
              <div className="hidden sm:flex items-center h-12 font-mono tabular text-sm text-text-tertiary">
                M{i + 1}
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="sm:hidden text-[10px] uppercase tracking-[0.15em] text-text-tertiary">Milestone {i + 1}</div>
                <CustomSelect
                  value={m.title}
                  onChange={(v) => update(i, 'title', v)}
                  options={titleOptions}
                  aria-label={`Milestone ${i + 1} title`}
                  aria-invalid={errors[`milestone_${i}_title`] ? true : undefined}
                />
                {m.title === 'Custom' && (
                  <input className="input-field" placeholder="Custom title"
                    aria-label={`Milestone ${i + 1} custom title`}
                    aria-invalid={errors[`milestone_${i}_title`] ? true : undefined}
                    maxLength={80}
                    value={m.customTitle} onChange={(e) => update(i, 'customTitle', e.target.value)} />
                )}
                {errors[`milestone_${i}_title`] && <FieldError text={errors[`milestone_${i}_title`]} />}
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="sm:hidden text-[10px] uppercase tracking-[0.15em] text-text-tertiary">Amount</div>
                <div className="relative">
                  <input type="number" step="0.01" min="0" inputMode="decimal"
                    aria-label={`Milestone ${i + 1} amount (USDC)`}
                    aria-invalid={errors[`milestone_${i}_amount`] ? true : undefined}
                    className="input-field font-mono tabular text-right pr-14" placeholder="0.00"
                    value={m.amount} onChange={(e) => update(i, 'amount', e.target.value)} />
                  <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-text-tertiary font-medium uppercase tracking-wider">USDC</span>
                </div>
                {errors[`milestone_${i}_amount`] && <FieldError text={errors[`milestone_${i}_amount`]} />}
              </div>
              <div className="flex items-center sm:justify-end">
                <button type="button"
                  className="h-12 w-12 inline-flex items-center justify-center rounded-xl text-text-tertiary hover:bg-status-error/10 hover:text-status-error transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-tertiary"
                  disabled={state.milestones.length <= 1}
                  onClick={() => removeMilestone(i)}
                  aria-label={`Remove milestone ${i + 1}`}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M3 5h10M6 5V3.5A1 1 0 0 1 7 2.5h2a1 1 0 0 1 1 1V5M5 5l.6 8a1 1 0 0 0 1 .9h2.8a1 1 0 0 0 1-.9L11 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {state.milestones.length < 10 && (
        <button type="button" className="btn-secondary self-start text-sm py-2" onClick={addMilestone}>
          + Add milestone
        </button>
      )}

      {/* Allocation tracker */}
      <AllocationTracker
        milestonesSum={milestonesSum}
        totalAmountNum={totalAmountNum}
        remaining={remaining}
        exactMatch={exactMatch}
        over={over}
        percentage={percentage}
      />
    </>
  )
}

function AllocationTracker({ milestonesSum, totalAmountNum, remaining, exactMatch, over, percentage }) {
  const tone = exactMatch ? 'success' : over ? 'error' : 'neutral'
  const fillCls = exactMatch ? 'bg-status-success' : over ? 'bg-status-error' : 'bg-accent'
  const statusText = totalAmountNum === 0
    ? 'Set a total amount in the first step before adding milestones.'
    : over
    ? `Over by ${Math.abs(remaining).toFixed(2)}`
    : exactMatch
    ? 'All funds allocated'
    : `${Math.abs(remaining).toFixed(2)} left`
  const statusCls = tone === 'success' ? 'text-status-success' : tone === 'error' ? 'text-status-error' : 'text-text-secondary'

  return (
    <div className="card-surface p-4 flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-medium">Allocated</div>
          <div className="font-mono tabular text-base">
            <span className={over ? 'text-status-error' : 'text-text-primary'}>
              {milestonesSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-text-tertiary"> / </span>
            <span className="text-text-secondary">
              {totalAmountNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-text-tertiary"> USDC</span>
          </div>
        </div>
        <div className={`font-mono tabular text-sm font-medium ${statusCls}`}>
          {statusText}
        </div>
      </div>
      <div
        className="bg-background-tertiary w-full h-2 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Milestone allocation"
      >
        <div
          className={`h-full w-full origin-left transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${fillCls}`}
          style={{ transform: `scaleX(${percentage / 100})` }}
        />
      </div>
    </div>
  )
}

/* ---------- Step 5 — Receipt-style review ---------- */
function Step5({ state, totalBaseUnits, protocolFee, milestoneAmountsBigInt, approved, onApprove, onDeposit, txStatus, phase }) {
  const totalSum = milestoneAmountsBigInt.reduce((a, b) => a + b, 0n)
  const mismatch = totalSum !== totalBaseUnits

  const approveLoading = phase === 'approve' && (txStatus === 'confirming' || txStatus === 'pending')
  const depositLoading = phase === 'deposit' && (txStatus === 'confirming' || txStatus === 'pending')
  const anyBusy = approveLoading || depositLoading

  return (
    <>
      {/* Parties */}
      <ReceiptSection title="Parties">
        <ReceiptRow label="Freelancer">
          <AddressDisplay address={state.freelancer} size="sm" />
        </ReceiptRow>
        <ReceiptRow label="Payment chain">
          <span className="text-sm">{getDomainName(state.destinationDomain)}</span>
        </ReceiptRow>
      </ReceiptSection>

      {/* Timeline */}
      <ReceiptSection title="Timeline">
        <ReceiptRow label="Deadline">
          <span className="font-mono tabular text-sm">{state.deadline ? formatDeadline(Math.floor(state.deadline.getTime() / 1000)) : '—'}</span>
        </ReceiptRow>
        <ReceiptRow label="Auto-release window">
          <span className="text-sm">{formatWindow(daysToSeconds(state.noticeWindowDays))}</span>
        </ReceiptRow>
        <ReceiptRow label="Dispute window">
          <span className="text-sm">{formatWindow(hoursToSeconds(state.disputeWindowHours))}</span>
        </ReceiptRow>
      </ReceiptSection>

      {/* Amount breakdown — mini financial table, right-aligned monospace numbers */}
      <ReceiptSection title="Amount breakdown">
        {state.milestones.map((m, i) => {
          const title = m.title === 'Custom' ? m.customTitle : m.title
          return (
            <ReceiptRow key={i} label={`${i + 1}. ${title || `Milestone ${i + 1}`}`}>
              <ReceiptAmount value={milestoneAmountsBigInt[i]} />
            </ReceiptRow>
          )
        })}
        <div className="h-px bg-border-subtle/60 my-1.5" />
        <ReceiptRow label="Subtotal">
          <ReceiptAmount value={totalSum} />
        </ReceiptRow>
        <ReceiptRow label="Protocol fee (1.99%)">
          <ReceiptAmount value={protocolFee} muted />
        </ReceiptRow>
        <div className="h-px bg-border-medium my-1.5" />
        <ReceiptRow label={<span className="text-sm font-semibold text-text-primary">Total to lock</span>}>
          <span className="font-mono tabular text-lg font-semibold text-accent">{formatUSDC(totalBaseUnits)}</span>
        </ReceiptRow>
        {mismatch && (
          <FieldError text="Milestone amounts don't add up to the total. Go back and fix the Milestones step." />
        )}
      </ReceiptSection>

      {/* Sequential approve + lock flow.
          Both steps are visible at the same time so the user understands the
          full flow before starting. Step A is active first. Once approved it
          shows a checkmark and Step B becomes the active step. */}
      <div className="flex flex-col gap-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-medium">Two-step submission</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 relative">
          <FlowStep
            letter="A"
            label="Approve USDC"
            description="Authorize the contract to move the USDC out of your wallet."
            done={approved}
            active={!approved}
            loading={approveLoading}
            actionLabel={approved ? 'Approved' : 'Approve USDC'}
            onAction={onApprove}
            disabled={anyBusy || mismatch || totalBaseUnits === 0n}
          />
          <FlowStep
            letter="B"
            label="Lock funds"
            description="Create the escrow on-chain. The USDC moves into the contract."
            done={false}
            active={approved}
            loading={depositLoading}
            actionLabel="Lock funds"
            onAction={onDeposit}
            disabled={!approved || mismatch || anyBusy}
          />
          {/* Connector arrow between the two steps on wider screens */}
          <span className="hidden sm:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 h-7 w-7 rounded-full bg-background-primary border border-border-subtle items-center justify-center text-text-tertiary">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M3 6h6M7 4l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        </div>
      </div>
    </>
  )
}

function ReceiptSection({ title, children }) {
  return (
    <div className="card-surface p-5 flex flex-col gap-2">
      <h3 className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-medium pb-2 border-b border-border-subtle/60 mb-1">
        {title}
      </h3>
      {children}
    </div>
  )
}

function ReceiptRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-text-secondary">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  )
}

function ReceiptAmount({ value, muted = false }) {
  return (
    <span className={`font-mono tabular text-sm ${muted ? 'text-text-secondary' : 'text-text-primary'}`}>
      {formatUSDC(value)}
    </span>
  )
}

/* A flow step that combines the letter chip, label/desc, and CTA.
   Visual states:
     • done — green check, success border, subtle success tint, button replaced with "Approved" status
     • active — accent border + accent letter chip, CTA enabled
     • idle — muted, CTA disabled
     • loading — CTA shows a spinner */
function FlowStep({ letter, label, description, done, active, loading, actionLabel, onAction, disabled }) {
  const borderCls = done
    ? 'border-status-success/40'
    : active
      ? 'border-accent/40 shadow-[0_0_0_4px_var(--accent-muted)]'
      : 'border-border-subtle'
  const chipCls = done
    ? 'bg-status-success/15 text-status-success'
    : active
      ? 'bg-accent text-white shadow-sm'
      : 'bg-background-tertiary text-text-tertiary'

  return (
    <div className={`card-surface p-4 flex flex-col gap-3 border ${borderCls} transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]`}>
      <div className="flex items-start gap-3">
        <span className={`inline-flex items-center justify-center h-8 w-8 rounded-full font-mono text-xs shrink-0 ${chipCls}`}>
          {done ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3 7.5l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : letter}
        </span>
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="text-sm font-medium text-text-primary">{label}</div>
          <p className="text-xs text-text-secondary leading-relaxed">{description}</p>
        </div>
      </div>
      <div className="pt-1">
        {done ? (
          <div className="inline-flex items-center gap-1.5 text-sm text-status-success font-medium">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3 7.5l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Approved
          </div>
        ) : (
          <button
            className="btn-primary text-sm py-2 px-4 w-full"
            onClick={onAction}
            disabled={disabled || loading || !active}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />
                Working…
              </span>
            ) : actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}

