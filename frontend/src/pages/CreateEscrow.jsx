import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, useReadContract } from 'wagmi'
import { decodeEventLog } from 'viem'
import { motion, AnimatePresence } from 'framer-motion'

import PageHeader from '../components/PageHeader.jsx'
import ConnectGate from '../components/ConnectGate.jsx'
import Field, { FieldError } from '../components/Field.jsx'
import IconButton from '../components/IconButton.jsx'
import Tooltip from '../components/Tooltip.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import { useTx, escrowWrite } from '../hooks/useTx.js'
import { useSupportedDomains } from '../hooks/useSupportedDomains.js'
import { ARC_DOMAIN, getDomainName, isEvmDomain } from '../config/chains.js'
import { CONTRACT_ADDRESS, USDC_ADDRESS, ESCROW_ABI, USDC_ABI } from '../config/contract.js'
import {
  addressToBytes32, hashDescription, daysToSeconds,
  usdcToBaseUnits, isValidBytes32
} from '../utils/encode.js'
import {
  isValidAddress, isValidUrl, formatUSDC, formatDeadline, formatWindow
} from '../utils/format.js'

const DRAFT_KEY = 'escrow-draft'
const MAX_DEADLINE_SECONDS = 5 * 365 * 86400

const STEPS = [
  { num: 1, label: 'Parties',    head: 'Who are you paying?', kicker: 'Approved milestones go directly to this address on the chain they choose.' },
  { num: 2, label: 'Invoice',    head: 'What is this for?',   kicker: "Give the escrow a description and link to the invoice. Only the description's hash is stored on-chain." },
  { num: 3, label: 'Timeline',   head: 'Set the timeline',    kicker: 'When work needs to be done, and how long each side has to respond at each step.' },
  { num: 4, label: 'Milestones', head: 'Break the payment',   kicker: 'Each milestone releases independently. They must sum to the total.' },
  { num: 5, label: 'Review',     head: 'Confirm and lock',    kicker: 'Two transactions: approve USDC, then create the escrow.' }
]

const TITLE_PRESETS = [
  'Upfront payment', 'Kickoff', 'First draft', 'Revision round 1',
  'Revision round 2', 'Final delivery', 'Post-launch support', 'QA', 'Documentation', 'Custom'
]
// Optimistic review window: how long the payer has, after the freelancer marks
// a milestone delivered, to approve or dispute before anyone can auto-release.
// Bounded to MIN_REVIEW_WINDOW (1 day) .. MAX_REVIEW_WINDOW (7 days) on-chain.
const REVIEW_OPTS = [1, 2, 3, 5, 7].map((v) => ({ value: v, label: `${v} day${v === 1 ? '' : 's'}` }))

const emptyMilestone = () => ({ title: 'Upfront payment', customTitle: '', amount: '' })

const emptyState = () => ({
  freelancer: '',
  destinationDomain: ARC_DOMAIN,
  totalAmount: '',
  description: '',
  invoiceURI: '',
  useCustomHash: false,
  customInvoiceHash: '',
  deadline: '',
  reviewWindowDays: 3,
  milestones: [emptyMilestone()]
})

const sanitizeMilestone = (m) => {
  if (!m || typeof m !== 'object') return emptyMilestone()
  const title = typeof m.title === 'string' && TITLE_PRESETS.includes(m.title) ? m.title : TITLE_PRESETS[0]
  const customTitle = typeof m.customTitle === 'string' ? m.customTitle.slice(0, 80) : ''
  const amount = typeof m.amount === 'string' ? m.amount : ''
  return { title, customTitle, amount }
}

const sanitizeDraft = (raw) => {
  const base = emptyState()
  if (!raw || typeof raw !== 'object') return base
  const merged = { ...base, ...raw }
  const arr = Array.isArray(raw.milestones) ? raw.milestones : []
  const milestones = arr.length === 0 ? [emptyMilestone()] : arr.slice(0, 10).map(sanitizeMilestone)
  return { ...merged, milestones }
}

export default function CreateEscrow() {
  return (
    <div>
      <PageHeader
        eyebrow="Create a new escrow"
        title="Lock funds into milestones."
        kicker="The ledger on the right is what the contract sees. Fill in the form on the left and watch it build."
      />
      <ConnectGate title="Connect to create an escrow">
        <Flow />
      </ConnectGate>
    </div>
  )
}

function Flow() {
  const navigate = useNavigate()
  const { address } = useAccount()
  const { supported, isLoading: loadingDomains, refetch: refetchDomains } = useSupportedDomains()

  const [step, setStep] = useState(1)
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) return sanitizeDraft(JSON.parse(raw))
    } catch {}
    return emptyState()
  })
  const [errors, setErrors] = useState({})

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...state, step })) } catch {}
  }, [state, step])

  const totalBaseUnits = useMemo(() => {
    try { return usdcToBaseUnits(state.totalAmount) } catch { return 0n }
  }, [state.totalAmount])

  const {
    data: allowance,
    refetch: refetchAllowance,
    isError: allowanceIsError,
    isLoading: allowanceLoading
  } = useReadContract({
    address: USDC_ADDRESS, abi: USDC_ABI, functionName: 'allowance',
    args: address && CONTRACT_ADDRESS ? [address, CONTRACT_ADDRESS] : undefined,
    query: { enabled: !!address }
  })
  const approved = allowance !== undefined && totalBaseUnits > 0n && BigInt(allowance) >= totalBaseUnits

  const milestoneAmountsBigInt = useMemo(
    () => state.milestones.map((m) => { try { return usdcToBaseUnits(m.amount) } catch { return 0n } }),
    [state.milestones]
  )
  const milestoneSumBaseUnits = useMemo(
    () => milestoneAmountsBigInt.reduce((a, b) => a + b, 0n),
    [milestoneAmountsBigInt]
  )
  const exactMatch = totalBaseUnits > 0n && milestoneSumBaseUnits === totalBaseUnits
  const overBaseUnits = milestoneSumBaseUnits > totalBaseUnits
  const remainingBaseUnits = totalBaseUnits - milestoneSumBaseUnits
  const milestoneSum = Number(milestoneSumBaseUnits) / 1e6
  const totalAmountNum = Number(totalBaseUnits) / 1e6

  const supportedSet = useMemo(() => new Set(supported), [supported])
  const domainsFailed = !loadingDomains && supported.length === 0

  const validate = (s) => {
    const e = {}
    if (s === 1) {
      if (!isValidAddress(state.freelancer)) e.freelancer = "That doesn't look like a valid 0x address."
      if (state.freelancer && address && state.freelancer.toLowerCase() === address.toLowerCase())
        e.freelancer = "The freelancer and payer can't be the same wallet."
      if (!supportedSet.has(Number(state.destinationDomain))) e.destinationDomain = 'Pick a supported destination chain.'
      else if (!isEvmDomain(state.destinationDomain)) e.destinationDomain = 'Only EVM-compatible chains are supported right now.'
      if (!totalAmountNum || totalAmountNum <= 0) e.totalAmount = 'Enter an amount greater than zero.'
    }
    if (s === 2) {
      if (!state.useCustomHash && !state.description.trim()) e.description = 'Add a description for this invoice.'
      if (state.useCustomHash && !isValidBytes32(state.customInvoiceHash))
        e.customInvoiceHash = 'Hash must be 0x followed by 64 hex characters.'
      if (!isValidUrl(state.invoiceURI)) e.invoiceURI = "That doesn't look like a valid URL."
    }
    if (s === 3) {
      if (!state.deadline) e.deadline = 'Set a project deadline.'
      else {
        const ts = Math.floor(new Date(state.deadline).getTime() / 1000)
        const now = Math.floor(Date.now() / 1000)
        if (!ts || ts <= now + 3600) e.deadline = 'Deadline must be at least 1 hour from now.'
        else if (ts - now > MAX_DEADLINE_SECONDS) e.deadline = 'Deadline can be at most 5 years from now.'
      }
    }
    if (s === 4) {
      if (state.milestones.length === 0) e.milestones = 'Add at least one milestone.'
      state.milestones.forEach((m, i) => {
        const eff = m.title === 'Custom' ? m.customTitle.trim() : m.title
        if (!eff) e[`m_${i}_title`] = 'Give this milestone a title.'
        const a = parseFloat(m.amount)
        if (!a || a <= 0) e[`m_${i}_amount`] = 'Amount must be greater than zero.'
      })
      if (!exactMatch) e.milestonesTotal = 'Milestones must sum to the total.'
    }
    return e
  }

  const next = () => {
    const e = validate(step); setErrors(e)
    if (Object.keys(e).length === 0) setStep((s) => Math.min(s + 1, STEPS.length))
  }
  const back = () => setStep((s) => Math.max(s - 1, 1))

  const protocolFee = totalBaseUnits * 199n / 10_000n

  const approveTx = useTx({ onConfirmed: () => refetchAllowance() })
  const depositTx = useTx({
    onConfirmed: (receipt) => {
      let escrowId = null
      try {
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue
          try {
            const dec = decodeEventLog({ abi: ESCROW_ABI, data: log.data, topics: log.topics })
            if (dec.eventName === 'EscrowCreated') { escrowId = Number(dec.args.escrowId); break }
          } catch {}
        }
      } catch {}
      if (escrowId !== null) {
        try {
          const titles = state.milestones.map((m) => m.title === 'Custom' ? m.customTitle : m.title)
          localStorage.setItem(`escrow-titles-${escrowId}`, JSON.stringify(titles))
        } catch {}
      }
      try { localStorage.removeItem(DRAFT_KEY) } catch {}
      setTimeout(() => navigate(escrowId !== null ? `/escrow/${escrowId}` : '/dashboard'), 600)
    }
  })

  const onApprove = () => {
    if (!address) return
    approveTx.run({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: 'approve',
      args: [CONTRACT_ADDRESS, totalBaseUnits]
    }, { loadingMessage: 'Approve USDC in your wallet.' }).catch(() => {})
  }

  const onDeposit = () => {
    if (!address) return
    const invoiceHash = state.useCustomHash ? state.customInvoiceHash : hashDescription(state.description)
    const mintRecipient = addressToBytes32(state.freelancer)
    const deadline = BigInt(Math.floor(new Date(state.deadline).getTime() / 1000))
    const reviewWindow = BigInt(daysToSeconds(state.reviewWindowDays))
    depositTx.run(escrowWrite('deposit', [
      state.freelancer,
      '0x0000000000000000000000000000000000000000',
      totalBaseUnits,
      Number(state.destinationDomain),
      mintRecipient,
      reviewWindow,
      invoiceHash,
      state.invoiceURI,
      milestoneAmountsBigInt,
      deadline,
      []
    ]), { loadingMessage: 'Sign to create the escrow.' }).catch(() => {})
  }

  const reset = () => { setState(emptyState()); setStep(1); setErrors({}); try { localStorage.removeItem(DRAFT_KEY) } catch {} }

  return (
    <div className="grid grid-cols-12 lg:gap-x-10 gap-y-12 pb-20">
      <div className="col-span-12 lg:col-span-7">
        <Progress step={step} onJump={(i) => i < step && setStep(i)} />
        <div className="rule mt-4 mb-10" />

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-7 max-w-[640px]"
          >
            <StepHeading step={STEPS[step - 1]} />
            {step === 1 && <Step1 state={state} setState={setState} errors={errors} supported={supported} loadingDomains={loadingDomains} domainsFailed={domainsFailed} refetchDomains={refetchDomains} />}
            {step === 2 && <Step2 state={state} setState={setState} errors={errors} />}
            {step === 3 && <Step3 state={state} setState={setState} errors={errors} />}
            {step === 4 && <Step4 state={state} setState={setState} errors={errors} milestoneSum={milestoneSum} totalAmountNum={totalAmountNum} overBaseUnits={overBaseUnits} remainingBaseUnits={remainingBaseUnits} exactMatch={exactMatch} />}
            {step === 5 && <Step5 approved={approved} approveTx={approveTx} depositTx={depositTx} onApprove={onApprove} onDeposit={onDeposit} totalBaseUnits={totalBaseUnits} address={address} allowanceLoading={allowanceLoading} allowanceIsError={allowanceIsError} refetchAllowance={refetchAllowance} />}

            <div className="rule mt-2" />
            <div className="flex items-center justify-between pt-1">
              <button className="btn-quiet" onClick={back} disabled={step === 1 || approveTx.isBusy || depositTx.isBusy}>← Back</button>
              <div className="flex items-center gap-2">
                <button className="btn-quiet" onClick={reset} disabled={approveTx.isBusy || depositTx.isBusy}>Reset draft</button>
                {step < STEPS.length && <button className="btn-primary" onClick={next}>Continue</button>}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <aside className="col-span-12 lg:col-span-5">
        <div className="lg:sticky lg:top-24">
          <Ledger
            state={state}
            address={address}
            totalBaseUnits={totalBaseUnits}
            protocolFee={protocolFee}
            milestoneAmountsBigInt={milestoneAmountsBigInt}
            step={step}
          />
        </div>
      </aside>
    </div>
  )
}

/* ------- Progress (segmented bar) ------- */
function Progress({ step, onJump }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">Step {step} of {STEPS.length} · {STEPS[step - 1].label}</p>
        <p className="seq text-[11px] text-ink-3">{Math.round((step / STEPS.length) * 100)}%</p>
      </div>
      <div className="flex items-center gap-1.5">
        {STEPS.map((s) => {
          const done = s.num < step, cur = s.num === step
          return (
            <button
              key={s.num} type="button"
              onClick={() => onJump(s.num)}
              aria-label={`Step ${s.num}: ${s.label}`}
              className={`relative flex-1 h-[3px] rounded-full transition-colors ${done ? 'bg-clay' : cur ? 'bg-clay-soft' : 'bg-rule'}`}
            />
          )
        })}
      </div>
    </div>
  )
}

function StepHeading({ step }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <span className="seq text-ink-3 text-[12px]">{String(step.num).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}</span>
      </div>
      <h2 className="display text-[36px] leading-tight text-ink">{step.head}</h2>
      <p className="text-ink-2 text-[14.5px] leading-relaxed">{step.kicker}</p>
    </div>
  )
}

/* ------- Step 1 ------- */
function Step1({ state, setState, errors, supported, loadingDomains, domainsFailed, refetchDomains }) {
  const set = (k) => (v) => setState((s) => ({ ...s, [k]: v }))
  const evmDomains = supported.filter(isEvmDomain)
  const domainHelper = loadingDomains
    ? 'Loading supported chains.'
    : domainsFailed
      ? "Couldn't reach the contract. Check your RPC and retry."
      : 'Same-chain Arc has no forwarding fee.'
  return (
    <div className="flex flex-col gap-6">
      <Field label="Freelancer address" error={errors.freelancer}
        hint={<Tooltip content="This wallet receives released milestones. Same address on the chain you choose below." />}
        helper="The wallet that will receive USDC when milestones release.">
        {(p) => (
          <input {...p} className="input num" placeholder="0x…"
            autoComplete="off" spellCheck={false}
            value={state.freelancer}
            onChange={(e) => set('freelancer')(e.target.value.trim())}
          />
        )}
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Destination chain" error={errors.destinationDomain} helper={domainHelper}>
          {(p) => (
            <div className="flex flex-col gap-2">
              <select {...p} className="input"
                disabled={domainsFailed}
                value={Number(state.destinationDomain)}
                onChange={(e) => set('destinationDomain')(Number(e.target.value))}
              >
                {evmDomains.length === 0 && (
                  <option>{loadingDomains ? 'Loading…' : 'No chains available'}</option>
                )}
                {evmDomains.sort((a, b) => getDomainName(a).localeCompare(getDomainName(b))).map((d) => (
                  <option key={d} value={d}>{getDomainName(d)}</option>
                ))}
              </select>
              {domainsFailed && (
                <button type="button" className="btn-quiet self-start px-0 text-[12.5px]" onClick={() => refetchDomains?.()}>
                  Retry
                </button>
              )}
            </div>
          )}
        </Field>

        <Field label="Total amount" error={errors.totalAmount}
          helper="Total locked from your wallet.">
          {(p) => (
            <div className="relative">
              <input {...p} type="number" step="0.01" min="0" inputMode="decimal"
                className="input num pr-16 text-right" placeholder="0.00"
                value={state.totalAmount}
                onChange={(e) => set('totalAmount')(e.target.value)}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-ink-3 uppercase tracking-wider">USDC</span>
            </div>
          )}
        </Field>
      </div>
    </div>
  )
}

/* ------- Step 2 ------- */
function Step2({ state, setState, errors }) {
  const set = (k) => (v) => setState((s) => ({ ...s, [k]: v }))
  const hashPreview = useMemo(() => {
    if (state.useCustomHash) return state.customInvoiceHash
    if (!state.description.trim()) return ''
    try { return hashDescription(state.description) } catch { return '' }
  }, [state.description, state.useCustomHash, state.customInvoiceHash])

  return (
    <div className="flex flex-col gap-6">
      {!state.useCustomHash ? (
        <Field label="Invoice description" error={errors.description}
          helper="Hashed locally. Only the hash is stored on-chain.">
          {(p) => (
            <textarea {...p} rows={3} className="input-multiline"
              placeholder="e.g. Brand identity redesign, Q3 deliverables"
              maxLength={500}
              value={state.description}
              onChange={(e) => set('description')(e.target.value)}
            />
          )}
        </Field>
      ) : (
        <Field label="Custom invoice hash (bytes32)" error={errors.customInvoiceHash}>
          {(p) => (
            <input {...p} className="input num" placeholder="0x…"
              autoComplete="off" spellCheck={false}
              value={state.customInvoiceHash}
              onChange={(e) => set('customInvoiceHash')(e.target.value.trim())}
            />
          )}
        </Field>
      )}

      <label className="inline-flex items-center gap-2 text-[14px] text-ink-2 cursor-pointer select-none">
        <input type="checkbox"
          className="rounded border-rule-2 h-4 w-4"
          style={{ accentColor: 'var(--clay)' }}
          checked={state.useCustomHash}
          onChange={(e) => set('useCustomHash')(e.target.checked)}
        />
        Use a pre-computed hash instead
      </label>

      <Field label="Invoice URL" error={errors.invoiceURI}
        helper="Stored on-chain as a reference.">
        {(p) => (
          <input {...p} type="url" className="input" placeholder="https://…"
            autoComplete="url"
            value={state.invoiceURI}
            onChange={(e) => set('invoiceURI')(e.target.value.trim())}
          />
        )}
      </Field>

      <div className="pt-1">
        <p className="eyebrow mb-1.5">Hash preview</p>
        <p className="num text-[12px] text-ink-2 break-all">{hashPreview || '—'}</p>
      </div>
    </div>
  )
}

/* ------- Step 3 ------- */
function Step3({ state, setState, errors }) {
  const set = (k) => (v) => setState((s) => ({ ...s, [k]: v }))
  const dlBounds = useMemo(() => {
    const fmt = (d) => {
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    const now = new Date()
    const min = new Date(now.getTime() + 3600 * 1000)
    const max = new Date(now.getTime() + MAX_DEADLINE_SECONDS * 1000)
    return { min: fmt(min), max: fmt(max) }
  }, [])
  return (
    <div className="flex flex-col gap-6">
      <Field label="Project deadline" error={errors.deadline}
        helper="Past this date, any milestone the freelancer never delivered can be refunded to the payer.">
        {(p) => (
          <input {...p} type="datetime-local" className="input"
            min={dlBounds.min} max={dlBounds.max}
            value={state.deadline}
            onChange={(e) => set('deadline')(e.target.value)}
          />
        )}
      </Field>

      <Field label="Review window"
        helper="After the freelancer marks a milestone delivered, how long the payer has to approve or dispute before it can auto-release.">
        {(p) => (
          <select {...p} className="input"
            value={state.reviewWindowDays}
            onChange={(e) => set('reviewWindowDays')(Number(e.target.value))}
          >
            {REVIEW_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </Field>
    </div>
  )
}

/* ------- Step 4 ------- */
function Step4({ state, setState, errors, milestoneSum, totalAmountNum, overBaseUnits, remainingBaseUnits, exactMatch }) {
  const update = (i, field, val) => setState((s) => {
    const next = [...s.milestones]
    next[i] = { ...next[i], [field]: val }
    return { ...s, milestones: next }
  })
  const add = () => state.milestones.length < 10 && setState((s) => ({
    ...s, milestones: [...s.milestones, { title: TITLE_PRESETS[0], customTitle: '', amount: '' }]
  }))
  const remove = (i) => state.milestones.length > 1 && setState((s) => ({
    ...s, milestones: s.milestones.filter((_, idx) => idx !== i)
  }))

  const over = overBaseUnits
  const pct = totalAmountNum > 0 ? Math.min(100, (milestoneSum / totalAmountNum) * 100) : 0
  const absRemaining = Math.abs(Number(remainingBaseUnits)) / 1e6
  const remainingText = absRemaining.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="flex flex-col gap-7">
      <ol className="flex flex-col">
        <div className="rule" />
        {state.milestones.map((m, i) => (
          <li key={i} className="grid grid-cols-12 gap-3 items-start py-4 border-b border-rule">
            <span className="col-span-1 seq text-[12px] text-ink-3 pt-3">M{i + 1}</span>
            <div className="col-span-7 flex flex-col gap-2">
              <select className="input"
                value={m.title}
                onChange={(e) => update(i, 'title', e.target.value)}
                aria-label={`Milestone ${i + 1} title`}
              >
                {TITLE_PRESETS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {m.title === 'Custom' && (
                <input className="input"
                  placeholder="Custom title" maxLength={80}
                  value={m.customTitle}
                  onChange={(e) => update(i, 'customTitle', e.target.value)}
                />
              )}
              <FieldError text={errors[`m_${i}_title`]} />
            </div>
            <div className="col-span-3">
              <div className="relative">
                <input type="number" step="0.01" min="0" inputMode="decimal"
                  className="input num text-right pr-14" placeholder="0.00"
                  value={m.amount}
                  onChange={(e) => update(i, 'amount', e.target.value)}
                  aria-label={`Milestone ${i + 1} amount`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10.5px] text-ink-3 uppercase tracking-wider">USDC</span>
              </div>
              <FieldError text={errors[`m_${i}_amount`]} />
            </div>
            <div className="col-span-1 flex justify-end">
              <IconButton
                size="md"
                tone="ghost-danger"
                label={`Remove milestone ${i + 1}`}
                disabled={state.milestones.length <= 1}
                onClick={() => remove(i)}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3 5h10M6 5V3.5A1 1 0 0 1 7 2.5h2a1 1 0 0 1 1 1V5M5 5l.6 8a1 1 0 0 0 1 .9h2.8a1 1 0 0 0 1-.9L11 5"
                    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </IconButton>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex items-center justify-between">
        <button type="button" className="btn-secondary" onClick={add} disabled={state.milestones.length >= 10}>
          + Add milestone
        </button>
        <p className="seq text-[11px] text-ink-3">{state.milestones.length} / 10</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="eyebrow">Allocated</span>
          <span className={`num text-[14px] ${over ? 'text-bad' : exactMatch ? 'text-ok' : 'text-ink-2'}`}>
            {milestoneSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="text-ink-3"> / </span>
            {totalAmountNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="text-ink-3"> USDC</span>
          </span>
        </div>
        <div className="h-1.5 bg-sunk rounded-full overflow-hidden">
          <motion.div
            className={`h-full ${exactMatch ? 'bg-ok' : over ? 'bg-bad' : 'bg-clay'}`}
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
        <p className={`text-[12.5px] ${exactMatch ? 'text-ok' : over ? 'text-bad' : 'text-ink-3'}`}>
          {totalAmountNum === 0
            ? 'Set a total in step 1 before allocating milestones.'
            : over ? `Over by ${remainingText} USDC.`
              : exactMatch ? 'All funds allocated.'
                : `${remainingText} USDC left to allocate.`}
        </p>
        {errors.milestonesTotal && <FieldError text={errors.milestonesTotal} />}
      </div>
    </div>
  )
}

/* ------- Step 5 ------- */
function Step5({ approved, approveTx, depositTx, onApprove, onDeposit, totalBaseUnits, address, allowanceLoading, allowanceIsError, refetchAllowance }) {
  const disconnected = !address
  const busy = approveTx.isBusy || depositTx.isBusy
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="eyebrow">Two-step submission</p>
        <p className="text-[14.5px] text-ink-2 leading-relaxed max-w-prose">
          First you authorise the contract to move USDC from your wallet, then you create the escrow. The lock isn't complete until both succeed.
        </p>
      </div>

      {disconnected && (
        <div className="panel-sunk p-4 text-[13px] text-ink-2" role="status">
          Wallet disconnected. Reconnect to continue from this draft.
        </div>
      )}

      {!disconnected && allowanceIsError && (
        <div className="panel-sunk p-4 flex items-center justify-between gap-3 text-[13px] text-ink-2" role="status">
          <span>Couldn't read USDC allowance. The network may be down.</span>
          <button type="button" className="btn-secondary h-9 px-3 text-[13px]" onClick={() => refetchAllowance?.()}>
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FlowStep
          letter="A"
          label="Approve USDC"
          description="Authorise the escrow contract to move the locked amount."
          done={approved}
          loading={approveTx.isBusy}
          actionLabel={approved ? 'Approved' : allowanceLoading ? 'Checking…' : 'Approve'}
          onAction={onApprove}
          disabled={busy || totalBaseUnits === 0n || disconnected || allowanceLoading}
        />
        <FlowStep
          letter="B"
          label="Lock funds"
          description="Create the escrow. USDC moves into the contract."
          done={false}
          loading={depositTx.isBusy}
          actionLabel="Lock funds"
          onAction={onDeposit}
          disabled={!approved || busy || disconnected}
          primary
        />
      </div>
    </div>
  )
}

function FlowStep({ letter, label, description, done, loading, actionLabel, onAction, disabled, primary }) {
  const tone = done ? 'border-ok' : disabled ? 'border-rule' : primary ? 'border-clay' : 'border-rule-2'
  return (
    <div className={`panel p-5 flex flex-col gap-3 border ${tone}`}>
      <div className="flex items-baseline gap-3">
        <span className={`seq text-[12px] ${done ? 'text-ok' : disabled ? 'text-ink-3' : primary ? 'text-clay' : 'text-ink-2'}`}>{done ? '✓' : letter}</span>
        <span className="text-[15px] text-ink font-medium">{label}</span>
      </div>
      <p className="text-[13px] text-ink-2 leading-relaxed">{description}</p>
      {done ? (
        <div className="text-[13px] text-ok font-medium">Approved</div>
      ) : (
        <button
          className={primary ? 'btn-primary' : 'btn-secondary'}
          onClick={onAction} disabled={disabled || loading}
        >
          {loading ? 'Working…' : actionLabel}
        </button>
      )}
    </div>
  )
}

/* ------- Live ledger (right pane) ------- */
function Ledger({ state, address, totalBaseUnits, protocolFee, milestoneAmountsBigInt, step }) {
  const dl = state.deadline ? Math.floor(new Date(state.deadline).getTime() / 1000) : 0
  const totalSum = milestoneAmountsBigInt.reduce((a, b) => a + b, 0n)
  return (
    <div className="panel p-6 flex flex-col gap-5">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">Escrow ledger</p>
        <p className="seq text-[11px] text-ink-3">Draft</p>
      </div>

      <Row label="Payer" complete={!!address} placeholder="connect wallet">
        {address && <AddressDisplay address={address} />}
      </Row>
      <Row label="Freelancer" complete={isValidAddress(state.freelancer)} placeholder="step 01 / Parties">
        {isValidAddress(state.freelancer) && <AddressDisplay address={state.freelancer} />}
      </Row>
      <Row label="Destination" complete={!!state.destinationDomain} placeholder="any chain">
        <span className="text-[13px] text-ink">{getDomainName(state.destinationDomain)}</span>
      </Row>
      <Row label="Amount" complete={totalBaseUnits > 0n} placeholder="step 01 / Parties">
        {totalBaseUnits > 0n && <span className="num text-[14px] text-ink">{formatUSDC(totalBaseUnits)}</span>}
      </Row>
      <Row label="Deadline" complete={!!dl} placeholder="step 03 / Timeline">
        {dl > 0 && <span className="num text-[13px] text-ink">{formatDeadline(dl)}</span>}
      </Row>
      <Row label="Review window" complete={!!state.reviewWindowDays}>
        <span className="text-[13px] text-ink">{formatWindow(daysToSeconds(state.reviewWindowDays))}</span>
      </Row>

      <div className="rule" />

      <div>
        <p className="eyebrow mb-2.5">Milestones</p>
        <ol className="flex flex-col">
          {state.milestones.map((m, i) => {
            const title = m.title === 'Custom' ? (m.customTitle || `Milestone ${i + 1}`) : m.title
            const amount = milestoneAmountsBigInt[i] ?? 0n
            return (
              <li key={i} className="flex items-baseline justify-between gap-3 py-1.5 border-b border-rule last:border-b-0">
                <span className="text-[13.5px] text-ink-2 min-w-0 flex-1 truncate" title={title}>
                  <span className="seq text-ink-3 mr-2">M{i + 1}</span>{title}
                </span>
                <span className="num text-[13.5px] text-ink shrink-0">{amount === 0n ? '—' : formatUSDC(amount).replace(' USDC', '')}</span>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="rule" />

      <Row label="Subtotal" muted>
        <span className="num text-[13px] text-ink-2">{formatUSDC(totalSum).replace(' USDC', '')}</span>
      </Row>
      <Row label="Protocol fee (1.99%)" muted>
        <span className="num text-[13px] text-ink-2">{formatUSDC(protocolFee).replace(' USDC', '')}</span>
      </Row>

      <div className="rule-2" />

      <div className="flex items-baseline justify-between">
        <p className="text-[13px] text-ink font-medium">Total to lock</p>
        <p className="num text-[22px] text-clay font-medium">{formatUSDC(totalBaseUnits).replace(' USDC', '')} <span className="text-ink-3 text-[13px] font-sans">USDC</span></p>
      </div>

      {step === 5 && (
        <p className="text-[12px] text-ink-3 leading-relaxed pt-1">
          You'll sign twice: USDC approval, then escrow creation. Both happen on Arc Testnet.
        </p>
      )}
    </div>
  )
}

function Row({ label, children, placeholder, complete = false, muted = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`text-[12px] shrink-0 ${muted ? 'text-ink-3' : 'text-ink-2'}`}>{label}</span>
      <div className="text-right min-w-0 max-w-full">
        {complete || children ? children : <span className="text-[12px] text-ink-3 italic">{placeholder ? `· ${placeholder}` : '·'}</span>}
      </div>
    </div>
  )
}
