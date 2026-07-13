import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, useReadContract } from 'wagmi'
import { decodeEventLog, keccak256, toHex } from 'viem'
import { motion, AnimatePresence } from 'framer-motion'

import PageHeader from '../components/PageHeader.jsx'
import ConnectGate from '../components/ConnectGate.jsx'
import Field, { FieldError } from '../components/Field.jsx'
import IconButton from '../components/IconButton.jsx'
import Modal from '../components/Modal.jsx'
import TxModal from '../components/TxModal.jsx'
import Tooltip from '../components/Tooltip.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import ClayBar, { parseAmt, round2, ordinal } from '../components/ClayBar.jsx'
import { pinFile, pinUrl } from '../utils/invoicePin.js'
import { useTx, escrowWrite } from '../hooks/useTx.js'
import { useSupportedDomains } from '../hooks/useSupportedDomains.js'
import { useProtocolConfig } from '../hooks/useArbiter.js'
import { ARC_DOMAIN, getDomainName, isEvmDomain } from '../config/chains.js'
import { CONTRACT_ADDRESS, USDC_ADDRESS, ESCROW_ABI, USDC_ABI } from '../config/contract.js'
import {
  addressToBytes32, daysToSeconds, usdcToBaseUnits
} from '../utils/encode.js'
import {
  isValidAddress, formatUSDC, formatDeadline, formatWindow, NO_ATTACHMENT_URI
} from '../utils/format.js'

const DRAFT_KEY = 'escrow-draft'
const MAX_DEADLINE_SECONDS = 5 * 365 * 86400

const TITLE_PRESETS = [
  'Upfront payment', 'Kickoff', 'First draft', 'Revision round 1',
  'Revision round 2', 'Final delivery', 'Post-launch support', 'QA', 'Documentation', 'Custom'
]
// Optimistic review window: how long the payer has, after the freelancer marks
// a milestone delivered, to approve or dispute before anyone can auto-release.
// Bounded to MIN_REVIEW_WINDOW (1 day) .. MAX_REVIEW_WINDOW (7 days) on-chain.
const REVIEW_OPTS = [1, 2, 3, 5, 7].map((v) => ({ value: v, label: `${v} day${v === 1 ? '' : 's'}` }))

const ERROR_SECTION = {
  freelancer: 'section-parties',
  destinationDomain: 'section-advanced',
  total: 'section-work',
  description: 'section-work',
  deadline: 'section-timeline',
  milestones: 'section-milestones',
  invoicePinning: 'section-advanced'
}
const sectionForErrorKey = (key) => (key.startsWith('m_') ? 'section-milestones' : ERROR_SECTION[key] || null)

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `m${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

const emptyMilestone = () => ({ id: uid(), title: 'Upfront payment', customTitle: '', amount: '' })

const emptyInvoice = () => ({ mode: 'file', status: 'idle', name: '', size: 0, error: '' })

const emptyState = () => ({
  freelancer: '',
  destinationDomain: ARC_DOMAIN,
  total: '',
  description: '',
  invoiceNumber: '',
  // attachmentURI/attachmentHash are the canonical resolved values — the only
  // fields onDeposit() reads when it builds invoiceObject.attachments (and
  // pre-date this redesign; onDeposit() is untouched). `invoice` below is NOT
  // a second copy of the same data — it holds only transient uploader UI
  // state (mode/status/name/size/error) for driving the idle/pinning/pinned/
  // error views. A resolved pin writes attachmentURI/attachmentHash directly;
  // `invoice` only ever gets `status: 'pinned'`, never its own ipfsUri/sha256.
  // Both are always reset together in the same setState call (see
  // onRemoveInvoice) so they can't drift out of sync.
  attachmentURI: '',
  attachmentHash: '',
  invoice: emptyInvoice(),
  privateMode: false,
  deadline: '',
  reviewWindowDays: 3,
  milestones: [emptyMilestone()]
})

const sanitizeInvoice = (inv) => {
  if (!inv || typeof inv !== 'object') return emptyInvoice()
  const mode = inv.mode === 'url' ? 'url' : 'file'
  // 'pinning' can never survive a reload — the in-flight request is gone with the tab.
  const status = inv.status === 'pinned' || inv.status === 'error' ? inv.status : 'idle'
  const name = typeof inv.name === 'string' ? inv.name : ''
  const size = typeof inv.size === 'number' ? inv.size : 0
  const error = typeof inv.error === 'string' ? inv.error : ''
  return { mode, status, name, size, error }
}

const sanitizeMilestone = (m) => {
  if (!m || typeof m !== 'object') return emptyMilestone()
  const title = typeof m.title === 'string' && TITLE_PRESETS.includes(m.title) ? m.title : TITLE_PRESETS[0]
  const customTitle = typeof m.customTitle === 'string' ? m.customTitle.slice(0, 80) : ''
  const amount = typeof m.amount === 'string' ? m.amount : ''
  const id = typeof m.id === 'string' && m.id ? m.id : uid()
  return { id, title, customTitle, amount }
}

const sanitizeDraft = (raw) => {
  const base = emptyState()
  if (!raw || typeof raw !== 'object') return base
  const merged = { ...base, ...raw }
  const arr = Array.isArray(raw.milestones) ? raw.milestones : []
  const milestones = arr.length === 0 ? [emptyMilestone()] : arr.slice(0, 10).map(sanitizeMilestone)
  const invoice = sanitizeInvoice(raw.invoice)
  return { ...merged, milestones, invoice }
}

export default function CreateEscrow() {
  return (
    <div>
      <PageHeader
        eyebrow="Create a new escrow"
        title="Lock funds into milestones."
        kicker="The ledger tracks exactly what the contract will hold as you fill this in."
      />
      <div className="mb-6 rounded-xl bg-sunk border border-rule px-4 py-3 flex items-center gap-3 flex-wrap text-[12.5px] text-ink-2">
        <span>Gas on Arc is paid in USDC.</span>
        <a
          href="https://faucet.circle.com"
          target="_blank"
          rel="noreferrer"
          className="text-clay hover:opacity-80 underline-offset-2 hover:underline"
        >
          Get testnet USDC ↗
        </a>
      </div>
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
  const { config } = useProtocolConfig()
  const feeBps = config?.protocolFeeBps ?? 199n
  const cctpForwardFee = config?.cctpForwardFee ?? 0n

  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) return sanitizeDraft(JSON.parse(raw))
    } catch {}
    return emptyState()
  })
  const [touched, setTouched] = useState({})
  const touch = (key) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }))
  // Lifted out of AdvancedSection so jumping to a blocker inside it (chain,
  // invoice-pinning) can also expand the disclosure, not just scroll to it.
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)) } catch {}
  }, [state])

  // Invoice number is no longer a user-visible field — silently backfilled once,
  // same value shape as before (INV-YYYY-NNNN), still required by validate().
  useEffect(() => {
    if (state.invoiceNumber) return
    const year = new Date().getFullYear()
    const rand = String(Math.floor(Math.random() * 9000) + 1000)
    setState((s) => (s.invoiceNumber ? s : { ...s, invoiceNumber: `INV-${year}-${rand}` }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Pin a file/URL to permanent storage via the real invoicePin.js helpers.
  // Resolved results mirror into attachmentURI/attachmentHash — the exact
  // fields onDeposit() already folds into invoiceObject before it's hashed —
  // so the hash-ordering guarantee (sha256 in the envelope before keccak256)
  // holds without onDeposit() needing to know anything changed here.
  const onPinFile = async (file) => {
    setState((s) => ({
      ...s,
      invoice: { mode: 'file', status: 'pinning', name: file.name, size: file.size, error: '' }
    }))
    try {
      const { ipfsUri, sha256 } = await pinFile(file)
      setState((s) => ({
        ...s,
        attachmentURI: ipfsUri,
        attachmentHash: sha256,
        invoice: { mode: 'file', status: 'pinned', name: file.name, size: file.size, error: '' }
      }))
    } catch (err) {
      setState((s) => ({
        ...s,
        attachmentURI: '',
        attachmentHash: '',
        invoice: { mode: 'file', status: 'error', name: file.name, size: file.size, error: err.message }
      }))
    }
  }
  const onPinUrl = async (url) => {
    setState((s) => ({ ...s, invoice: { mode: 'url', status: 'pinning', name: '', size: 0, error: '' } }))
    try {
      const { ipfsUri, sha256 } = await pinUrl(url)
      setState((s) => ({
        ...s,
        attachmentURI: ipfsUri,
        attachmentHash: sha256,
        invoice: { mode: 'url', status: 'pinned', name: '', size: 0, error: '' }
      }))
    } catch (err) {
      setState((s) => ({
        ...s,
        attachmentURI: '',
        attachmentHash: '',
        invoice: { mode: 'url', status: 'error', name: '', size: 0, error: err.message }
      }))
    }
  }
  // Remove clears the stale hash/URI too — never leave a dangling commitment
  // to a file that's no longer actually attached.
  const onRemoveInvoice = () => setState((s) => ({ ...s, attachmentURI: '', attachmentHash: '', invoice: emptyInvoice() }))

  const milestoneAmountsBigInt = useMemo(
    () => state.milestones.map((m) => { try { return usdcToBaseUnits(m.amount) } catch { return 0n } }),
    [state.milestones]
  )
  const totalBaseUnits = useMemo(
    () => milestoneAmountsBigInt.reduce((a, b) => a + b, 0n),
    [milestoneAmountsBigInt]
  )
  const totalAmountNum = Number(totalBaseUnits) / 1e6
  // The user's authoritative target (Section 02) vs. the actual sum of milestone
  // amounts (Section 03) — bigint-exact so "balanced" here can never disagree
  // with what ClayBar's float-based readout shows for realistic 2-decimal inputs.
  const targetTotalBaseUnits = useMemo(() => {
    try { return usdcToBaseUnits(state.total) } catch { return 0n }
  }, [state.total])
  const milestonesBalanced = targetTotalBaseUnits === 0n || targetTotalBaseUnits === totalBaseUnits
  const milestonesOver = targetTotalBaseUnits > 0n && totalBaseUnits > targetTotalBaseUnits

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

  const { data: usdcBalance, isLoading: balanceLoading } = useReadContract({
    address: USDC_ADDRESS, abi: USDC_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address }
  })

  const supportedSet = useMemo(() => new Set(supported), [supported])
  const domainsFailed = !loadingDomains && supported.length === 0

  // Property insertion order below IS the single-blocker priority order
  // (Object.keys(e)[0] in onApprove picks the first-inserted key) — matches
  // the design spec exactly: recipient -> total -> description -> milestone
  // titles/amounts -> balanced -> deadline -> invoice-still-saving. destinationDomain
  // and invoiceNumber are real validations but not part of that spec'd chain
  // (destinationDomain defaults valid to Arc; invoiceNumber is auto-generated
  // and practically never empty) — kept last as low-priority safety nets.
  const validate = () => {
    const e = {}
    if (!isValidAddress(state.freelancer)) e.freelancer = "That doesn't look like a valid 0x address."
    if (state.freelancer && address && state.freelancer.toLowerCase() === address.toLowerCase())
      e.freelancer = "The freelancer and payer can't be the same wallet."

    const totalNum = parseFloat(state.total)
    if (!totalNum || totalNum <= 0) e.total = 'Enter the total amount you want to lock.'
    if (!state.description.trim()) e.description = 'Describe the work in a sentence or two.'

    if (state.milestones.length === 0) e.milestones = 'Add at least one milestone.'
    let anyPositive = false
    state.milestones.forEach((m, i) => {
      const eff = m.title === 'Custom' ? m.customTitle.trim() : m.title
      if (!eff) e[`m_${i}_title`] = 'Give this milestone a title.'
      const a = parseFloat(m.amount)
      if (!a || a <= 0) {
        e[`m_${i}_amount`] = 'Amount must be greater than zero.'
      } else {
        anyPositive = true
        if (Number(state.destinationDomain) !== ARC_DOMAIN && cctpForwardFee > 0n) {
          // Cross-chain: verify each milestone's net burn amount exceeds the forwarding fee floor.
          const amtBigInt = milestoneAmountsBigInt[i]
          const milestoneProtocolFee = (amtBigInt * feeBps) / 10_000n
          const burnAmount = amtBigInt - milestoneProtocolFee
          if (burnAmount <= cctpForwardFee) {
            e[`m_${i}_amount`] = 'Too small to deliver to this chain — increase this milestone or switch to Arc.'
          }
        }
      }
    })
    if (!anyPositive) e.milestones = e.milestones || 'Add at least one milestone amount greater than zero.'
    if (!milestonesBalanced) {
      e.milestones = e.milestones || (milestonesOver
        ? `Your milestones are ${formatUSDC(totalBaseUnits - targetTotalBaseUnits)} over the total. Trim them to match.`
        : `${formatUSDC(targetTotalBaseUnits - totalBaseUnits)} is still unallocated. Assign it across your milestones.`)
    }

    if (!state.deadline) e.deadline = 'Set a project deadline.'
    else {
      const ts = Math.floor(new Date(state.deadline).getTime() / 1000)
      const now = Math.floor(Date.now() / 1000)
      if (!ts || ts <= now + 3600) e.deadline = 'Deadline must be at least 1 hour from now.'
      else if (ts - now > MAX_DEADLINE_SECONDS) e.deadline = 'Deadline can be at most 5 years from now.'
    }

    if (state.invoice.status === 'pinning') e.invoicePinning = 'Your document is still saving.'

    if (!supportedSet.has(Number(state.destinationDomain))) e.destinationDomain = 'Pick a supported destination chain.'
    else if (!isEvmDomain(state.destinationDomain)) e.destinationDomain = 'Only EVM-compatible chains are supported right now.'
    if (!state.invoiceNumber.trim()) e.invoiceNumber = 'Invoice number is required.'

    return e
  }

  const errors = validate()

  const scrollToSection = (id) => {
    if (!id) return
    if (id === 'section-advanced') setAdvancedOpen(true)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const protocolFee = totalBaseUnits * feeBps / 10_000n
  // The aside Ledger + mobile bar are a "draft, here's where you're headed"
  // view driven by the user's target (state.total / Section 02), so its
  // headline stays stable while milestones are mid-edit — unlike totalBaseUnits
  // above, which is the real milestone sum and stays authoritative for every
  // actual on-chain amount (approve/deposit args, allowance/balance checks,
  // ReviewSection's "You lock X" and the confirm modal). The two only ever
  // differ while unbalanced, which already blocks submission.
  const ledgerTotalBaseUnits = targetTotalBaseUnits
  const ledgerProtocolFee = targetTotalBaseUnits * feeBps / 10_000n

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
      try { localStorage.removeItem(DRAFT_KEY) } catch {}
      setTimeout(() => navigate(escrowId !== null ? `/escrow/${escrowId}` : '/dashboard'), 600)
    }
  })

  const onApprove = () => {
    if (!address) return
    const e = validate()
    if (Object.keys(e).length > 0) {
      setTouched((t) => ({ ...t, ...Object.fromEntries(Object.keys(e).map((k) => [k, true])) }))
      scrollToSection(sectionForErrorKey(Object.keys(e)[0]))
      return
    }
    approveTx.run({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: 'approve',
      args: [CONTRACT_ADDRESS, totalBaseUnits]
    }, { loadingMessage: 'Approve USDC in your wallet.' }).catch(() => {})
  }

  const onDeposit = () => {
    if (!address) return
    const invoiceObject = {
      version: 1,
      invoiceNumber: state.invoiceNumber,
      issuedAt: new Date().toISOString(),
      payer: address,
      payee: state.freelancer,
      currency: 'USDC',
      total: totalAmountNum.toString(),
      lineItems: state.milestones.map((m, i) => ({
        milestone: i,
        title: m.title === 'Custom' ? m.customTitle.trim() : m.title,
        amount: m.amount
      })),
      notes: state.description || undefined,
      attachments: state.attachmentURI ? [{
        uri: state.attachmentURI,
        sha256: state.attachmentHash || undefined
      }] : []
    }
    const invoiceJson = JSON.stringify(invoiceObject)
    const invoiceHash = keccak256(toHex(invoiceJson))
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
      state.attachmentURI || NO_ATTACHMENT_URI,
      milestoneAmountsBigInt,
      deadline,
      [],
      state.privateMode ? '' : invoiceJson
    ]), { loadingMessage: 'Sign to create the escrow.' }).catch(() => {})
  }

  const reset = () => { setState(emptyState()); setTouched({}); try { localStorage.removeItem(DRAFT_KEY) } catch {} }

  const busy = approveTx.isBusy || depositTx.isBusy
  const canSubmit = Object.keys(errors).length === 0

  return (
    <div className="grid grid-cols-12 lg:gap-x-10 gap-y-12 pb-36 lg:pb-20">
      <div className="col-span-12 lg:col-span-7 flex flex-col">
        <Section id="section-parties" n="01" title="Who are you paying?" sub="Parties" first>
          <PartiesSection
            state={state} setState={setState} errors={errors} touched={touched} touch={touch}
          />
        </Section>
        <div className="rule" />

        <Section id="section-work" n="02" title="What are you paying for?" sub="The work">
          <WorkSection state={state} setState={setState} errors={errors} touched={touched} touch={touch} />
        </Section>
        <div className="rule" />

        <Section id="section-milestones" n="03" title="Break the payment into milestones" sub="the total is their sum">
          <MilestonesSection
            state={state} setState={setState} errors={errors} touched={touched} touch={touch}
            total={Number(targetTotalBaseUnits) / 1e6}
          />
        </Section>
        <div className="rule" />

        <Section id="section-timeline" n="04" title="Set the deadline" sub="Timeline">
          <TimelineSection state={state} setState={setState} errors={errors} touched={touched} touch={touch} />
        </Section>
        <div className="rule" />

        <div id="section-advanced" className="py-8">
          <AdvancedSection
            state={state} setState={setState}
            supported={supported} loadingDomains={loadingDomains} domainsFailed={domainsFailed} refetchDomains={refetchDomains}
            onPinFile={onPinFile} onPinUrl={onPinUrl} onRemoveInvoice={onRemoveInvoice}
            open={advancedOpen} setOpen={setAdvancedOpen}
          />
        </div>
        <div className="rule" />

        <Section id="section-review" n="05" title="Confirm and lock" sub="Review & Lock">
          <ReviewSection
            state={state} totalBaseUnits={totalBaseUnits} errors={errors}
            approved={approved} approveTx={approveTx} depositTx={depositTx}
            onApprove={onApprove} onDeposit={onDeposit} address={address}
            allowanceLoading={allowanceLoading} allowanceIsError={allowanceIsError} refetchAllowance={refetchAllowance}
            usdcBalance={usdcBalance} balanceLoading={balanceLoading}
            onJump={scrollToSection}
          />
          <div className="flex items-center justify-between pt-8">
            <button className="btn-quiet" onClick={reset} disabled={busy}>Reset draft</button>
          </div>
        </Section>
      </div>

      <aside className="hidden lg:block lg:col-span-5">
        <div className="lg:sticky lg:top-24">
          <Ledger
            state={state}
            address={address}
            totalBaseUnits={ledgerTotalBaseUnits}
            protocolFee={ledgerProtocolFee}
            milestoneAmountsBigInt={milestoneAmountsBigInt}
            feeBps={feeBps}
            cctpForwardFee={cctpForwardFee}
            onJump={scrollToSection}
          />
        </div>
      </aside>

      <MobileLedgerBar
        state={state}
        address={address}
        totalBaseUnits={ledgerTotalBaseUnits}
        protocolFee={ledgerProtocolFee}
        milestoneAmountsBigInt={milestoneAmountsBigInt}
        feeBps={feeBps}
        cctpForwardFee={cctpForwardFee}
        onJump={scrollToSection}
        onReview={() => scrollToSection('section-review')}
        canSubmit={canSubmit}
      />
    </div>
  )
}

/* ------- Section shell ------- */
function Section({ id, n, title, sub, first = false, children }) {
  return (
    <section id={id} className={`scroll-mt-24 ${first ? 'pt-0' : 'pt-8'} pb-8`}>
      <div className="flex items-baseline gap-3 mb-6">
        <span className="seq text-[12px] text-ink-3">{n}</span>
        <h3 className="text-[15px] font-medium text-ink tracking-[-0.005em]">{title}</h3>
        {sub && <span className="text-[12px] text-ink-3 ml-auto">{sub}</span>}
      </div>
      {children}
    </section>
  )
}

/* ------- Parties ------- */
function PartiesSection({ state, setState, errors, touched, touch }) {
  const set = (k) => (v) => setState((s) => ({ ...s, [k]: v }))
  return (
    <div className="flex flex-col gap-6">
      <Field label="Freelancer address" error={touched.freelancer ? errors.freelancer : undefined}
        hint={<Tooltip content="This wallet receives released milestones. Same address on the chain set in Advanced settings." />}
        helper="The wallet that will receive USDC when milestones release.">
        {(p) => (
          <input {...p} className="input num" placeholder="0x…"
            autoComplete="off" spellCheck={false}
            value={state.freelancer}
            onChange={(e) => set('freelancer')(e.target.value.trim())}
            onBlur={() => touch('freelancer')}
          />
        )}
      </Field>

      {Number(state.destinationDomain) !== ARC_DOMAIN && (
        <div className="rounded-xl bg-sunk border border-rule px-3 py-2.5 text-[12.5px] text-ink-2 leading-relaxed">
          You're paying out on a different chain (set in Advanced settings). Safe and smart contract wallets have different addresses per chain — make sure this address is correct there.
        </div>
      )}
    </div>
  )
}

/* ------- Work (total + scope) ------- */
function WorkSection({ state, setState, errors, touched, touch }) {
  const set = (k) => (v) => setState((s) => ({ ...s, [k]: v }))
  return (
    <div className="flex flex-col gap-6">
      <Field label="Total amount" error={touched.total ? errors.total : undefined}
        helper="The full amount you will lock. You'll divide it into milestones next.">
        {(p) => (
          <div className="relative" style={{ maxWidth: 280 }}>
            <input {...p} type="number" step="0.01" min="0" inputMode="decimal"
              className="input num h-[52px] text-[20px] font-medium pr-14"
              placeholder="0.00"
              value={state.total}
              onChange={(e) => set('total')(e.target.value)}
              onBlur={() => touch('total')}
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 num text-[12px] text-ink-3 uppercase tracking-wider pointer-events-none">USDC</span>
          </div>
        )}
      </Field>

      <Field label="Scope of work" error={touched.description ? errors.description : undefined}
        hint={<span className="text-[11.5px] text-ink-3">{state.description.length}/500</span>}>
        {(p) => (
          <textarea {...p} rows={3} className="input-multiline" maxLength={500}
            placeholder="Describe the work in plain language. What is being delivered?"
            value={state.description}
            onChange={(e) => set('description')(e.target.value)}
            onBlur={() => touch('description')}
          />
        )}
      </Field>
    </div>
  )
}

/* ------- Milestones ------- */
function MilestonesSection({ state, setState, errors, touched, touch, total }) {
  const [hoverIdx, setHoverIdx] = useState(null)
  const [flashIds, setFlashIds] = useState(() => new Set())
  const [removingIds, setRemovingIds] = useState([])
  const flashTimer = useRef(null)
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  const amounts = state.milestones.map((m) => parseAmt(m.amount))
  const allocated = amounts.reduce((a, b) => a + b, 0)
  const remaining = round2(total - allocated)

  const flash = (ids) => {
    setFlashIds(new Set(ids))
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashIds(new Set()), 650)
  }

  const setAmount = (i, v) => setState((s) => {
    const next = [...s.milestones]
    next[i] = { ...next[i], amount: v }
    return { ...s, milestones: next }
  })
  const update = (i, field, val) => setState((s) => {
    const next = [...s.milestones]
    next[i] = { ...next[i], [field]: val }
    return { ...s, milestones: next }
  })

  // Add = split the largest slice in two, inserted immediately after its
  // source (not appended) — everything else keeps its relative order.
  // Falls back to a plain append only when nothing is allocated yet.
  const add = () => {
    if (state.milestones.length >= 10) return
    const maxV = Math.max(0, ...amounts)
    if (total > 0 && maxV > 0) {
      const idx = amounts.indexOf(maxV)
      const half = round2(maxV / 2)
      const other = round2(maxV - half)
      const splitId = state.milestones[idx].id
      const newM = { id: uid(), title: TITLE_PRESETS[0], customTitle: '', amount: String(other) }
      setState((s) => {
        const copy = s.milestones.map((m, i) => (i === idx ? { ...m, amount: String(half) } : m))
        copy.splice(idx + 1, 0, newM)
        return { ...s, milestones: copy }
      })
      flash([splitId, newM.id])
    } else {
      const newM = { id: uid(), title: TITLE_PRESETS[0], customTitle: '', amount: '' }
      setState((s) => ({ ...s, milestones: [...s.milestones, newM] }))
      flash([newM.id])
    }
  }

  // Remove = zero the amount first (money visibly flows back into the
  // unallocated remainder as the bar reflows), then collapse the row and
  // splice it out by id — never by index, since indices can shift if the
  // user triggers another add/remove during the 340ms collapse animation.
  const remove = (i) => {
    if (state.milestones.length <= 1) return
    const id = state.milestones[i].id
    setState((s) => {
      const next = [...s.milestones]
      next[i] = { ...next[i], amount: '' }
      return { ...s, milestones: next }
    })
    setRemovingIds((r) => [...r, id])
    setTimeout(() => {
      setState((s) => ({ ...s, milestones: s.milestones.filter((m) => m.id !== id) }))
      setRemovingIds((r) => r.filter((x) => x !== id))
    }, 340)
  }

  const distributeEvenly = () => {
    if (total <= 0) return
    const n = state.milestones.length
    const base = Math.floor((total / n) * 100) / 100
    setState((s) => ({
      ...s,
      milestones: s.milestones.map((m, i) => ({
        ...m, amount: String(i === n - 1 ? round2(total - base * (n - 1)) : base)
      }))
    }))
  }
  const fillRemaining = () => {
    if (remaining <= 0.005) return
    const last = state.milestones.length - 1
    setState((s) => ({
      ...s,
      milestones: s.milestones.map((m, i) =>
        i === last ? { ...m, amount: String(round2(parseAmt(m.amount) + remaining)) } : m)
    }))
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12.5px] text-ink-3 leading-relaxed -mt-2" style={{ maxWidth: '54ch' }}>
        Enter an amount for each milestone and the bar above shows how the total is divided. Milestones are paid out in order, left to right.
      </p>

      <ClayBar milestones={state.milestones} total={total} hoverIdx={hoverIdx} setHoverIdx={setHoverIdx} flashIds={flashIds} />

      <div className="flex items-center flex-wrap gap-2">
        <button type="button" className="btn-secondary h-[34px] text-[13px]" onClick={distributeEvenly} disabled={total <= 0}>
          Split evenly
        </button>
        {remaining > 0.005 && (
          <button type="button" className="btn-quiet h-[34px] text-[13px]" onClick={fillRemaining}>
            Assign remaining {remaining.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} to last
          </button>
        )}
      </div>

      <ol className="flex flex-col gap-2">
        {state.milestones.map((m, i) => {
          const amtErr = touched[`m_${i}_amount`] ? errors[`m_${i}_amount`] : undefined
          const titleErr = touched[`m_${i}_title`] ? errors[`m_${i}_title`] : undefined
          const active = hoverIdx === i
          const flashing = flashIds.has(m.id)
          const removing = removingIds.includes(m.id)
          const pctRaw = total > 0 ? Math.round((parseAmt(m.amount) / total) * 1000) / 10 : 0

          return (
            <li key={m.id}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              className={`rounded-md overflow-hidden transition-[max-height,opacity,padding,background-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${active || flashing ? 'bg-sunk' : 'bg-transparent'}`}
              style={{
                boxShadow: flashing ? 'inset 0 0 0 1.5px var(--clay)' : 'none',
                padding: removing ? '0 8px' : '8px',
                maxHeight: removing ? 0 : 220,
                opacity: removing ? 0 : 1
              }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="shrink-0 inline-flex items-center justify-center num rounded-full mt-2.5 h-6 w-6 text-[11.5px] font-medium bg-clay-soft text-clay"
                  title={`Paid ${ordinal(i + 1)}`}
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="flex-1 min-w-[150px]">
                      <select className="input"
                        value={m.title}
                        onChange={(e) => update(i, 'title', e.target.value)}
                        aria-label={`Milestone ${i + 1} title`}
                      >
                        {TITLE_PRESETS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1 w-[168px]">
                      <div className="relative">
                        <input type="number" step="0.01" min="0" inputMode="decimal"
                          className="input num text-right pr-12" placeholder="0.00"
                          value={m.amount}
                          onChange={(e) => setAmount(i, e.target.value)}
                          onBlur={() => touch(`m_${i}_amount`)}
                          aria-label={`Milestone ${i + 1} amount`}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-ink-3 uppercase tracking-wider pointer-events-none">USDC</span>
                      </div>
                      <span className="num text-[10.5px] text-ink-3 text-right">
                        {total > 0
                          ? <>{Number.isInteger(pctRaw) ? pctRaw : pctRaw.toFixed(1)}% of total · Paid {ordinal(i + 1)}</>
                          : `Paid ${ordinal(i + 1)}`}
                      </span>
                    </div>
                    <IconButton
                      size="md"
                      tone="ghost-danger"
                      label={`Remove milestone ${i + 1}`}
                      disabled={state.milestones.length <= 1}
                      onClick={() => remove(i)}
                    >
                      <TrashIcon />
                    </IconButton>
                  </div>
                  {m.title === 'Custom' && (
                    <input className="input" placeholder="Name this milestone" maxLength={60}
                      value={m.customTitle}
                      onChange={(e) => update(i, 'customTitle', e.target.value)}
                    />
                  )}
                  {(amtErr || titleErr) && <FieldError text={amtErr || titleErr} />}
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="flex items-center justify-between">
        <button type="button" className="btn-secondary" onClick={add} disabled={state.milestones.length >= 10}>
          + Add milestone
        </button>
        <p className="seq text-[11px] text-ink-3">{state.milestones.length} / 10</p>
      </div>

      {touched.milestones && <FieldError text={errors.milestones} />}
    </div>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 5h10M6 5V3.5A1 1 0 0 1 7 2.5h2a1 1 0 0 1 1 1V5M5 5l.6 8a1 1 0 0 0 1 .9h2.8a1 1 0 0 0 1-.9L11 5"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SpinnerIcon({ size = 15 }) {
  return <span className="inline-block rounded-full border-2 border-clay/25 border-t-clay animate-spin" style={{ width: size, height: size }} aria-hidden />
}
function UploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M11 14V4M7 8l4-4 4 4M4 15v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M5 2h5l3 3v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}
function LinkIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
      <path d="M7 10l3-3M6.5 11.5l-1 1a2.1 2.1 0 0 1-3-3l2-2a2.1 2.1 0 0 1 3-.1M10.5 5.5l1-1a2.1 2.1 0 0 1 3 3l-2 2a2.1 2.1 0 0 1-3 .1"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="3" y="6.5" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
function ExternalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}
function WarnIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 1.5l6 10.5H1L7 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M7 5.5v3M7 10.5v0.05" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/* ------- Timeline ------- */
function TimelineSection({ state, setState, errors, touched, touch }) {
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
      <Field label="Project deadline" error={touched.deadline ? errors.deadline : undefined}
        helper="If the freelancer hasn't delivered a milestone within 72 hours after this date, you can refund it.">
        {(p) => (
          <input {...p} type="datetime-local" className="input"
            min={dlBounds.min} max={dlBounds.max}
            value={state.deadline}
            onChange={(e) => set('deadline')(e.target.value)}
            onBlur={() => touch('deadline')}
          />
        )}
      </Field>
      <p className="text-[12px] text-ink-3 leading-relaxed -mt-3">
        The review window, how long you get to approve or dispute after delivery, is set in Advanced settings below.
      </p>
    </div>
  )
}

/* ------- Documentation ------- */
/* ------- Invoice uploader (idle / pinning / pinned-file / pinned-url / error) ------- */
function InvoiceUploader({ invoice, attachmentURI, attachmentHash, onPinFile, onPinUrl, onRemove }) {
  const [dragging, setDragging] = useState(false)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const fileInputRef = useRef(null)

  const handleFiles = (files) => {
    const file = files && files[0]
    if (file) onPinFile(file)
  }

  if (invoice.status === 'pinning') {
    return (
      <div className="rounded-xl border border-rule bg-sunk px-4 py-3.5 flex items-center gap-3">
        <SpinnerIcon size={18} />
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-medium text-ink">Saving to permanent storage</p>
          <p className="text-[12px] text-ink-3 truncate">
            {invoice.mode === 'url' ? 'Fetching link…' : invoice.name} · this takes a few seconds
          </p>
          <div className="mt-2 h-[3px] rounded-full bg-rule overflow-hidden">
            <div className="skeleton-shimmer h-full w-full rounded-full" />
          </div>
        </div>
      </div>
    )
  }

  if (invoice.status === 'pinned') {
    const isUrl = invoice.mode === 'url'
    return (
      <div className="rounded-xl border border-ok/30 bg-ok/[0.07] px-4 py-3.5">
        <div className="flex items-start gap-3">
          <span className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-md border border-rule bg-paper text-ink-2">
            {isUrl ? <LinkIcon /> : <DocIcon />}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13.5px] font-medium text-ink truncate">{isUrl ? attachmentURI : invoice.name}</p>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ok">
                <LockIcon /> {isUrl ? 'Linked' : 'Locked, cannot be changed later'}
              </span>
              {attachmentHash && (
                <span className="hash text-[11px]" title="Content fingerprint">{attachmentHash.slice(0, 14)}…</span>
              )}
              <a href={attachmentURI} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] text-clay hover:opacity-80">
                View <ExternalIcon />
              </a>
            </div>
            {!isUrl && (
              <p className="text-[11.5px] text-ink-3 mt-1.5 leading-relaxed">
                A fingerprint of this document is stored with the escrow, so it can never be swapped for a different file later.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button type="button" className="btn-secondary h-[34px] text-[13px]" onClick={() => fileInputRef.current?.click()}>Replace</button>
          <button type="button" className="btn-quiet h-[34px] text-[13px]" onClick={onRemove}>Remove</button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        </div>
      </div>
    )
  }

  // idle / error
  return (
    <div className="flex flex-col gap-2">
      <div
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onClick={() => fileInputRef.current?.click()}
        className={`rounded-xl border-[1.5px] border-dashed px-5 py-6 flex flex-col items-center text-center cursor-pointer transition-colors ${dragging ? 'border-clay bg-clay/5' : 'border-rule-2'}`}
      >
        <span className={dragging ? 'text-clay' : 'text-ink-3'}><UploadIcon /></span>
        <p className="text-[13.5px] text-ink mt-2"><span className="text-clay font-medium">Browse</span> or drag a document here</p>
        <p className="text-[11.5px] text-ink-3 mt-1">PDF, image, or doc up to 4 MB</p>
        <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      </div>

      {invoice.status === 'error' && (
        <div className="rounded-xl bg-bad/8 border border-bad/20 px-3 py-2.5 flex items-start gap-2 text-[12.5px] leading-relaxed text-bad">
          <span className="mt-[1px]"><WarnIcon /></span>
          <span>{invoice.error}</span>
        </div>
      )}

      {!showUrlInput ? (
        <button type="button" className="btn-quiet self-start h-8 px-1 text-[12.5px]" onClick={() => setShowUrlInput(true)}>
          Paste a link instead
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input type="url" className="input" placeholder="https://… link to an invoice"
            value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)}
          />
          <button type="button" className="btn-secondary shrink-0"
            onClick={() => { if (urlDraft.trim()) { onPinUrl(urlDraft.trim()); setUrlDraft(''); setShowUrlInput(false) } }}
          >
            Attach
          </button>
        </div>
      )}
    </div>
  )
}

/* ------- Advanced settings (invoice + visibility + destination chain + review window) ------- */
function AdvancedSection({
  state, setState, supported, loadingDomains, domainsFailed, refetchDomains, onPinFile, onPinUrl, onRemoveInvoice,
  open, setOpen
}) {
  const set = (k) => (v) => setState((s) => ({ ...s, [k]: v }))
  const evmDomains = supported.filter(isEvmDomain)
  const domainHelper = loadingDomains
    ? 'Loading supported chains.'
    : domainsFailed
      ? "Couldn't reach the contract. Check your RPC and retry."
      : 'Where your freelancer gets paid. Arc has no forwarding fee; other chains do.'

  return (
    <div className="rounded-xl border border-rule overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-sunk transition-colors"
        aria-expanded={open}
      >
        <span className="text-[14px] font-medium text-ink">Advanced settings</span>
        <span className="text-[12px] text-ink-3 ml-auto mr-1">
          {state.invoice.status === 'pinned' ? 'Document attached' : 'No document'} · Review {state.reviewWindowDays}d · {state.privateMode ? 'Private' : 'Public'}
        </span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
          className={`text-ink-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-rule"
          >
            <div className="px-4 py-5 flex flex-col gap-6">
              <div className="flex flex-col gap-2.5">
                <div className="flex items-baseline justify-between">
                  <label className="field-label">Invoice or contract</label>
                  <span className="text-[11.5px] text-ink-3">Optional</span>
                </div>
                <p className="text-[12px] text-ink-3 leading-relaxed -mt-1">
                  Attach the document this payment is for. It's saved so neither side can quietly change it later.
                </p>
                <InvoiceUploader
                  invoice={state.invoice}
                  attachmentURI={state.attachmentURI}
                  attachmentHash={state.attachmentHash}
                  onPinFile={onPinFile}
                  onPinUrl={onPinUrl}
                  onRemove={onRemoveInvoice}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="field-label">Where the freelancer gets paid</label>
                <select className="input"
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
                <p className="text-[12px] text-ink-3 leading-relaxed">{domainHelper}</p>
              </div>

              <div className="flex flex-col gap-2">
                <label className="field-label">Review window</label>
                <div className="inline-flex bg-sunk border border-rule rounded-lg p-1 gap-1 flex-wrap w-fit">
                  {REVIEW_OPTS.map((o) => (
                    <button key={o.value} type="button"
                      onClick={() => set('reviewWindowDays')(o.value)}
                      className={`h-8 px-3.5 rounded-md text-[13px] transition-colors ${state.reviewWindowDays === o.value ? 'bg-clay text-paper font-medium' : 'text-ink-2 hover:bg-paper'}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <p className="text-[12px] text-ink-3 leading-relaxed">
                  After the freelancer marks a milestone delivered, how long you have to approve or dispute before it can auto-release. Most escrows leave this at 3 days.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label className="field-label">Invoice visibility</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => set('privateMode')(false)}
                    className={`rounded-xl border px-4 py-3 text-left transition-colors ${!state.privateMode ? 'border-clay bg-clay/5 text-clay' : 'border-rule text-ink-2 hover:border-rule-2'}`}
                  >
                    <p className="text-[13.5px] font-medium">Public (recommended)</p>
                    <p className="text-[11.5px] mt-0.5 opacity-60">Invoice published on-chain</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => set('privateMode')(true)}
                    className={`rounded-xl border px-4 py-3 text-left transition-colors ${state.privateMode ? 'border-clay bg-clay/5 text-clay' : 'border-rule text-ink-2 hover:border-rule-2'}`}
                  >
                    <p className="text-[13.5px] font-medium">Private — hash only</p>
                    <p className="text-[11.5px] mt-0.5 opacity-60">Contents kept off-chain</p>
                  </button>
                </div>
                {state.privateMode && (
                  <p className="text-[12.5px] text-ink-2 leading-relaxed">
                    Download and keep your invoice file. Anyone verifying will need a copy of it.
                    {state.attachmentURI && ' The attached document itself still sits at a public storage link — this only keeps the invoice details off-chain.'}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------- Review & Lock ------- */
function summarizeMissing(errors) {
  const out = []
  if (errors.freelancer) out.push({ text: 'a valid freelancer address', id: 'section-parties' })
  if (errors.total) out.push({ text: 'the total amount', id: 'section-work' })
  if (errors.description) out.push({ text: 'a short description of the work', id: 'section-work' })
  if (errors.milestones) out.push({ text: 'at least one milestone amount', id: 'section-milestones' })
  else if (Object.keys(errors).some((k) => k.startsWith('m_'))) out.push({ text: 'valid milestone details', id: 'section-milestones' })
  if (errors.deadline) out.push({ text: 'a deadline', id: 'section-timeline' })
  if (errors.destinationDomain) out.push({ text: 'a supported destination chain', id: 'section-advanced' })
  // invoicePinning gets its own spinner banner in ReviewSection, not a jump link here.
  return out
}

function ReviewSection({
  state, totalBaseUnits, errors, approved, approveTx, depositTx, onApprove, onDeposit, address,
  allowanceLoading, allowanceIsError, refetchAllowance, usdcBalance, balanceLoading, onJump
}) {
  const disconnected = !address
  const busy = approveTx.isBusy || depositTx.isBusy
  const hasInsufficientBalance = !balanceLoading && usdcBalance !== undefined
    && totalBaseUnits > 0n && BigInt(usdcBalance) < totalBaseUnits
  const chainName = getDomainName(state.destinationDomain)
  const pinning = state.invoice.status === 'pinning'
  const missing = summarizeMissing(errors)
  const isComplete = Object.keys(errors).length === 0
  // Idle-summary confirm step lives in this Modal; once "Sign and lock" calls
  // onDeposit(), depositTx.status flips off 'idle' so this Modal's own open
  // condition goes false right as TxModal's (driven by that same status)
  // goes true — a clean handoff between the two, no double-modal overlap.
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <div className={`rounded-xl border px-5 py-4 text-[14px] leading-relaxed ${isComplete ? 'border-rule-2 bg-paper text-ink-2' : 'border-rule bg-sunk text-ink-3'}`}>
        {isComplete ? (
          <>
            You lock <b className="num text-ink">{formatUSDC(totalBaseUnits)}</b>.{' '}
            <AddressDisplay address={state.freelancer} size="sm" /> is paid as each of your{' '}
            <b className="text-ink">{state.milestones.length}</b> milestone{state.milestones.length === 1 ? '' : 's'} is approved, delivered on{' '}
            <b className="text-ink">{chainName}</b>. If a milestone isn't delivered by{' '}
            <b className="text-ink">{formatDeadline(Math.floor(new Date(state.deadline).getTime() / 1000))}</b>, that portion is refundable to you.
            If you don't respond within <b className="text-ink">{state.reviewWindowDays} day{state.reviewWindowDays === 1 ? '' : 's'}</b> of a delivery, that milestone releases automatically.
          </>
        ) : (
          <>Fill in the sections above to see the full terms before you lock funds.</>
        )}
      </div>

      {pinning && (
        <div className="rounded-xl bg-sunk border border-rule-2 px-4 py-3 flex items-center gap-2.5 text-[13px] text-ink-2 leading-relaxed" role="status">
          <span className="text-clay"><SpinnerIcon /></span>
          Your document is still saving. This takes a few seconds, then you can continue.
        </div>
      )}

      {!isComplete && !pinning && missing.length > 0 && (
        <div className="rounded-xl bg-sunk border border-rule-2 px-4 py-3 text-[12.5px] text-ink-2 leading-relaxed" role="status">
          Add{' '}
          {missing.map((m, i) => (
            <span key={m.text}>
              <button type="button" className="text-clay hover:underline underline-offset-2" onClick={() => onJump?.(m.id)}>{m.text}</button>
              {i < missing.length - 1 ? ', ' : ''}
            </span>
          ))}
          {' '}to continue.
        </div>
      )}

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

      {!disconnected && hasInsufficientBalance && (
        <div className="rounded-xl bg-bad/8 border border-bad/20 px-4 py-3 text-[13px] text-bad leading-relaxed" role="alert">
          Insufficient USDC — you have {formatUSDC(BigInt(usdcBalance))}, need {formatUSDC(totalBaseUnits)}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="eyebrow">Two transactions</span>
        <p className="text-[13px] text-ink-2 leading-relaxed">
          First you allow the contract to move your USDC, then you create the escrow. Nothing is locked until both are confirmed in your wallet.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FlowStep
          letter="A"
          label="Approve USDC"
          description="Authorise the escrow contract to move the locked amount."
          done={approved}
          loading={approveTx.isBusy}
          actionLabel={approved ? 'Approved' : allowanceLoading ? 'Checking…' : 'Approve'}
          onAction={onApprove}
          disabled={busy || totalBaseUnits === 0n || disconnected || allowanceLoading || hasInsufficientBalance}
        />
        <FlowStep
          letter="B"
          label="Lock funds"
          description="Create the escrow. USDC moves into the contract."
          done={false}
          loading={depositTx.isBusy}
          actionLabel="Lock funds"
          onAction={() => setConfirmOpen(true)}
          disabled={!approved || busy || disconnected}
          primary
        />
      </div>

      <Modal
        open={confirmOpen && depositTx.status === 'idle'}
        onClose={() => setConfirmOpen(false)}
        title="Lock funds into escrow"
        footer={
          <>
            <button className="btn-quiet" onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={onDeposit}>Sign and lock</button>
          </>
        }
      >
        <div className="flex flex-col gap-2.5">
          <p className="text-[13.5px] text-ink-2 leading-relaxed">
            This is the second and final signature. Your USDC moves into the contract and is held until milestones are approved.
          </p>
          <div className="rule" />
          <div className="flex items-baseline justify-between pt-1">
            <span className="text-[13px] text-ink-2">Locking</span>
            <span className="num text-[15px] text-ink font-medium">{formatUSDC(totalBaseUnits)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-ink-2">Freelancer</span>
            <AddressDisplay address={state.freelancer} size="sm" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-ink-2">Paid on</span>
            <span className="text-[13px] text-ink">{chainName}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-ink-2">Milestones</span>
            <span className="num text-[13px] text-ink">{state.milestones.length}</span>
          </div>
        </div>
      </Modal>

      <TxModal
        status={depositTx.status}
        txHash={depositTx.hash}
        error={depositTx.error}
        title="Creating your escrow"
        onClose={() => { setConfirmOpen(false); depositTx.reset() }}
        onRetry={onDeposit}
      />
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

/* ------- Live ledger ------- */
function Ledger({ state, address, totalBaseUnits, protocolFee, milestoneAmountsBigInt, feeBps, cctpForwardFee, onJump, bare = false }) {
  const dl = state.deadline ? Math.floor(new Date(state.deadline).getTime() / 1000) : 0
  const effectiveFeeBps = feeBps ?? 199n
  const effectiveCctpFee = cctpForwardFee ?? 0n
  const isCrossChain = Number(state.destinationDomain) !== ARC_DOMAIN
  const feePct = (Number(effectiveFeeBps) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })
  // Estimated per-release forwarding fee × number of milestones. The real fee is
  // Circle's live quote at release time; this floor estimate can only be lower.
  const totalForwardFeeEst = isCrossChain ? effectiveCctpFee * BigInt(state.milestones.length) : 0n
  const freelancerReceivesEst = totalBaseUnits > protocolFee + totalForwardFeeEst
    ? totalBaseUnits - protocolFee - totalForwardFeeEst
    : 0n

  return (
    <div className={bare ? 'flex flex-col gap-5' : 'panel p-6 flex flex-col gap-5'}>
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">Escrow ledger</p>
        <p className="seq text-[11px] text-ink-3">Draft</p>
      </div>

      <Row label="Payer" complete={!!address} placeholder="connect wallet">
        {address && <AddressDisplay address={address} />}
      </Row>
      <Row label="Freelancer" complete={isValidAddress(state.freelancer)} placeholder="add address" onClick={() => onJump?.('section-parties')}>
        {isValidAddress(state.freelancer) && <AddressDisplay address={state.freelancer} />}
      </Row>
      <Row label="Destination" complete>
        <span className="text-[13px] text-ink">{getDomainName(state.destinationDomain)}</span>
      </Row>
      <Row label="Deadline" complete={!!dl} placeholder="set a date" onClick={() => onJump?.('section-timeline')}>
        {dl > 0 && <span className="num text-[13px] text-ink">{formatDeadline(dl)}</span>}
      </Row>
      <Row label="Review window" complete>
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

      <Row label={`Protocol fee (${feePct}%)`} muted complete>
        <span className="num text-[13px] text-ink-2">−{formatUSDC(protocolFee).replace(' USDC', '')}</span>
      </Row>
      {isCrossChain && effectiveCctpFee > 0n && (
        <Row label="Est. forwarding fee (varies)" muted complete>
          <span className="num text-[13px] text-ink-2">≈ {formatUSDC(effectiveCctpFee).replace(' USDC', '')} / payout</span>
        </Row>
      )}
      <Row label="Invoice" muted complete>
        {state.invoice.status === 'pinned' ? (
          <span className="text-[13px] text-ok">{state.invoice.mode === 'url' ? 'Linked' : 'Attached'}</span>
        ) : (
          <span className="num text-[13px] text-ink-3">—</span>
        )}
      </Row>

      <div className="rule-2" />

      <div className="flex items-baseline justify-between">
        <p className="text-[13px] text-ink font-medium">Total to lock</p>
        <p className="num text-[22px] text-clay font-medium">{formatUSDC(totalBaseUnits).replace(' USDC', '')} <span className="text-ink-3 text-[13px] font-sans">USDC</span></p>
      </div>

      {totalBaseUnits > 0n && (
        <p className="text-[12px] text-ink-3 leading-relaxed">
          Freelancer receives ≈ {formatUSDC(freelancerReceivesEst).replace(' USDC', '')} USDC after {feePct}% protocol fee{isCrossChain ? ' and transfer fees' : ''}.
        </p>
      )}
    </div>
  )
}

function Row({ label, children, placeholder, complete = false, muted = false, onClick }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`text-[12px] shrink-0 ${muted ? 'text-ink-3' : 'text-ink-2'}`}>{label}</span>
      <div className="text-right min-w-0 max-w-full">
        {complete || children ? children : (
          <button type="button" onClick={onClick} className="text-[12px] text-ink-3 italic hover:text-clay transition-colors">
            {placeholder ? `· ${placeholder}` : '·'}
          </button>
        )}
      </div>
    </div>
  )
}

/* ------- Mobile sticky ledger bar ------- */
function MobileLedgerBar({ state, address, totalBaseUnits, protocolFee, milestoneAmountsBigInt, feeBps, cctpForwardFee, onJump, onReview, canSubmit }) {
  const [open, setOpen] = useState(false)
  const isCrossChain = Number(state.destinationDomain) !== ARC_DOMAIN
  const totalForwardFeeEst = isCrossChain ? (cctpForwardFee ?? 0n) * BigInt(state.milestones.length) : 0n
  const receives = totalBaseUnits > protocolFee + totalForwardFeeEst ? totalBaseUnits - protocolFee - totalForwardFeeEst : 0n

  return (
    // bottom offset = AppShell's BottomNav total height (min-h-16 = 4rem, plus
    // its own safe-area gutter) + 0.5rem gap, so this card floats above the
    // tab bar instead of colliding with it — both are position:fixed at the
    // same viewport edge, so without this offset the tab bar (z-50, opaque)
    // paints over this card's CTA button and makes it untappable.
    <div className="lg:hidden fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)] z-40 px-3">
      <div className="bg-paper border border-rule-2 rounded-xl shadow-lg overflow-hidden max-w-[520px] mx-auto">
        <button
          type="button"
          className="w-full flex items-center gap-3 px-4 py-3 text-left"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-ink-3">Total to lock</span>
            <span className="num text-[17px] text-clay font-medium">{formatUSDC(totalBaseUnits).replace(' USDC', '')}</span>
          </div>
          <div className="ml-auto text-right">
            <span className="text-[10.5px] text-ink-3 block">Freelancer nets</span>
            <span className="num text-[12.5px] text-ink-2">{formatUSDC(receives).replace(' USDC', '')}</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
            className={`text-ink-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="sheet"
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden border-t border-rule"
            >
              <div className="max-h-[46vh] overflow-y-auto px-4 pt-4">
                <Ledger
                  state={state} address={address} totalBaseUnits={totalBaseUnits}
                  protocolFee={protocolFee} milestoneAmountsBigInt={milestoneAmountsBigInt}
                  feeBps={feeBps} cctpForwardFee={cctpForwardFee}
                  onJump={(id) => { setOpen(false); onJump(id) }}
                  bare
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="px-4 pb-4 pt-3">
          <button type="button" className="btn-primary w-full" onClick={onReview}>
            {canSubmit ? 'Review & lock funds' : 'Add details to continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
