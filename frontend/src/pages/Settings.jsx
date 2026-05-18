import { useEffect, useState } from 'react'
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { isAddress } from 'viem'

import ConnectGate from '../components/ConnectGate.jsx'
import Tooltip from '../components/Tooltip.jsx'
import TxModal from '../components/TxModal.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import { useRefundBalance } from '../hooks/useEscrows.js'
import { useTheme } from '../hooks/useTheme.jsx'
import { useAllCallerRoles } from '../hooks/useArbiter.js'
import { useSupportedDomains } from '../hooks/useSupportedDomains.js'
import { useTx, escrowWrite } from '../hooks/useTx.js'
import { txToast } from '../hooks/useToast.jsx'
import { useReadContract } from 'wagmi'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract.js'
import { formatUSDC, isValidAddress, truncateAddr } from '../utils/format.js'
import { getDomainName, ALL_DOMAIN_NUMBERS } from '../config/chains.js'

export default function Settings() {
  return (
    <ConnectGate>
      <SettingsInner />
    </ConnectGate>
  )
}

function SettingsInner() {
  const { address } = useAccount()
  const { roles, hasAny, isLoading: rolesLoading } = useAllCallerRoles(address)

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-8 w-full">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-text-secondary text-sm mt-1">Withdraw your refund balance and manage your preferences.</p>
      </div>

      <RefundSection />
      <AppearanceSection />
      <AccountSection />

      {!rolesLoading && hasAny && (
        <AdminPanel roles={roles} />
      )}
    </div>
  )
}

/* ---------- Refund Balance Withdrawal ---------- */
function RefundSection() {
  const { address } = useAccount()
  const { balance, refetch } = useRefundBalance(address)
  const [recipient, setRecipient] = useState(address || '')
  const { writeContractAsync } = useWriteContract()
  const [txStatus, setTxStatus] = useState('idle')
  const [txHash, setTxHash] = useState(null)
  const [txError, setTxError] = useState(null)
  const [txToastApi, setTxToastApi] = useState(null)
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => { if (address) setRecipient(address) }, [address])
  useEffect(() => {
    if (!receipt) return
    setTxStatus('success'); refetch()
    txToastApi?.success('Withdrawn successfully.', { hash: txHash })
  }, [receipt]) // eslint-disable-line

  const submit = async () => {
    const t = txToast({ loading: 'Submitting. Check your wallet.' })
    setTxToastApi(t)
    try {
      if (!isValidAddress(recipient)) throw new Error('Invalid recipient address')
      setTxError(null); setTxStatus('confirming')
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: 'withdrawRefund', args: [recipient]
      })
      setTxHash(hash); setTxStatus('pending')
      t.update('Transaction sent. Waiting for confirmation.')
    } catch (err) {
      setTxError(err); setTxStatus('error')
      t.error('Withdrawal failed. Try again.')
    }
  }

  return (
    <Section title="Refund balance" description="USDC that was returned to you from cancelled or disputed escrows. Withdraw it to any address you control.">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-text-secondary mb-1">Available to withdraw</div>
          <div className="font-mono text-2xl text-accent">{formatUSDC(balance)}</div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium flex items-center">
          Withdraw to
          <Tooltip content="You can send this to any wallet you control. If your original wallet is restricted, use a different one." />
        </label>
        <input className="input-field font-mono text-sm" placeholder="0x…"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())} />
        {recipient && !isValidAddress(recipient) && (
          <div className="text-xs text-status-error">That doesn't look like a valid address.</div>
        )}
      </div>

      <button className="btn-primary"
        onClick={submit}
        disabled={balance === 0n || !isValidAddress(recipient) || txStatus === 'confirming' || txStatus === 'pending'}>
        {txStatus === 'confirming' || txStatus === 'pending' ? 'Submitting…' : 'Withdraw funds'}
      </button>

      <TxModal status={txStatus} txHash={txHash} error={txError}
        onClose={() => { setTxStatus('idle'); setTxHash(null); setTxError(null) }}
        onRetry={submit} title="Processing withdrawal" />
    </Section>
  )
}

/* ---------- Appearance ---------- */
function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  return (
    <Section title="Appearance" description="Choose how the app looks on this device.">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Theme</span>
        <div className="grid grid-cols-2 gap-2">
          <ThemeOption active={theme === 'light'} onClick={() => setTheme('light')} label="Light" />
          <ThemeOption active={theme === 'dark'} onClick={() => setTheme('dark')} label="Dark" />
        </div>
      </div>
    </Section>
  )
}

function ThemeOption({ active, onClick, label }) {
  return (
    <button onClick={onClick}
      className={`p-4 rounded-xl border text-sm font-medium transition-all duration-200 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background-primary ${
        active ? 'border-accent-blue bg-accent-muted text-accent' : 'border-border-subtle bg-background-tertiary text-text-secondary hover:bg-border-subtle'
      }`}>
      {label}
    </button>
  )
}

/* ---------- Connected Account ---------- */
function AccountSection() {
  const { address } = useAccount()
  return (
    <Section title="Connected wallet" description="The wallet you are currently connected with.">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-secondary">Wallet address</span>
        <AddressDisplay address={address} full size="sm" />
      </div>
    </Section>
  )
}

/* ============================================================
   ADMIN PANEL — Protocol-level controls, only rendered for wallets
   that hold one or more privileged roles. Each subsection is
   independently role-gated.
   ============================================================ */
function AdminPanel({ roles }) {
  const activeLabels = [
    roles.isDefaultAdmin && 'Admin',
    roles.isArbiter && 'Arbiter',
    roles.isFeeManager && 'Fee Manager',
    roles.isDomainManager && 'Domain Manager',
    roles.isRecoveryManager && 'Recovery Manager',
    roles.isPauser && 'Pauser'
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 pt-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Protocol controls</h2>
          <span className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary font-mono">Privileged</span>
        </div>
        <p className="text-text-secondary text-sm">
          Your wallet holds protocol-level roles. Changes here affect every user of the contract.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {activeLabels.map((r) => (
            <span key={r} className="inline-flex items-center rounded-full border border-border-subtle bg-background-tertiary px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] font-medium text-text-secondary">
              {r}
            </span>
          ))}
        </div>
      </div>

      {roles.isFeeManager && <FeeManagerSection />}
      {roles.isDomainManager && <DomainManagerSection />}
      {roles.isPauser && <PauserSection />}
      {roles.isRecoveryManager && <RecoveryManagerSection />}
    </div>
  )
}

/* ---------- Fee Manager ---------- */
function FeeManagerSection() {
  const fee = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'protocolFeeBps' })
  const treasury = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'protocolTreasury' })
  const cctp = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'cctpForwardFee' })

  return (
    <Section title="Fee manager" description="Protocol fee rate, treasury destination, and CCTP forwarding fee.">
      <CurrentValueRow label="Current fee">
        <span className="font-mono tabular-nums text-base text-text-primary">
          {fee.data !== undefined ? `${(Number(fee.data) / 100).toFixed(2)}%` : '—'}
        </span>
      </CurrentValueRow>
      <WriteForm
        placeholder="New fee in basis points (e.g. 199 = 1.99%)"
        validate={(v) => /^\d+$/.test(v) && Number(v) <= 1000}
        label="Update fee"
        fn="setProtocolFee"
        toArgs={(v) => [BigInt(v)]}
        onSuccess={() => fee.refetch?.()}
      />

      <Divider />

      <CurrentValueRow label="Treasury">
        <span className="font-mono tabular-nums text-sm text-text-primary">
          {treasury.data ? truncateAddr(treasury.data) : '—'}
        </span>
      </CurrentValueRow>
      <WriteForm
        placeholder="New treasury address (0x…)"
        validate={(v) => isAddress(v)}
        label="Update treasury"
        fn="setProtocolTreasury"
        toArgs={(v) => [v]}
        onSuccess={() => treasury.refetch?.()}
      />

      <Divider />

      <CurrentValueRow label="CCTP forwarding fee">
        <span className="font-mono tabular-nums text-base text-text-primary">
          {cctp.data !== undefined ? `${(Number(cctp.data) / 1_000_000).toFixed(6)} USDC` : '—'}
        </span>
      </CurrentValueRow>
      <WriteForm
        placeholder="USDC base units (6 decimals, e.g. 1000000 = 1 USDC)"
        validate={(v) => /^\d+$/.test(v)}
        label="Update forwarding fee"
        fn="setCctpForwardFee"
        toArgs={(v) => [BigInt(v)]}
        onSuccess={() => cctp.refetch?.()}
      />
    </Section>
  )
}

/* ---------- Domain Manager ---------- */
function DomainManagerSection() {
  const { supported, refetch } = useSupportedDomains()
  return (
    <Section title="Domain manager" description="Add or remove supported destination chains.">
      <div className="flex flex-col gap-2">
        {supported.length === 0 ? (
          <div className="text-xs text-text-tertiary italic">No destination chains added yet.</div>
        ) : (
          supported.map((d) => <SupportedDomainRow key={d} domain={d} onRemoved={refetch} />)
        )}
      </div>

      <Divider />

      <WriteForm
        placeholder="CCTP domain ID (e.g. 6 for Base Sepolia)"
        validate={(v) => /^\d+$/.test(v) && ALL_DOMAIN_NUMBERS.includes(Number(v))}
        label="Add chain"
        fn="addSupportedDomain"
        toArgs={(v) => [Number(v)]}
        onSuccess={() => refetch?.()}
      />
    </Section>
  )
}

function SupportedDomainRow({ domain, onRemoved }) {
  const tx = useTx({ onConfirmed: () => onRemoved?.() })
  const remove = () => tx.run(
    escrowWrite('removeSupportedDomain', [Number(domain)]),
    { loadingMessage: `Removing ${getDomainName(domain)}…` }
  )
  return (
    <div className="flex items-center justify-between rounded-xl border border-border-subtle bg-background-tertiary px-3 py-2.5 text-sm">
      <span className="font-mono tabular-nums text-text-primary">
        {getDomainName(domain)} <span className="text-text-tertiary">#{domain}</span>
      </span>
      <button
        onClick={remove}
        disabled={tx.isBusy}
        className="text-xs font-medium text-status-error hover:opacity-80 transition-opacity disabled:opacity-50"
      >
        {tx.isBusy ? 'Removing…' : 'Remove'}
      </button>
    </div>
  )
}

/* ---------- Pauser ---------- */
function PauserSection() {
  const paused = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'paused' })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const tx = useTx({
    onConfirmed: () => { paused.refetch?.(); setConfirmOpen(false) }
  })
  const isPaused = !!paused.data

  const execute = () => tx.run(
    escrowWrite(isPaused ? 'unpause' : 'pause', []),
    { loadingMessage: isPaused ? 'Unpausing…' : 'Pausing…' }
  )

  return (
    <Section title="Pauser" description="Pause or unpause the entire protocol.">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-text-secondary mb-1">Protocol status</div>
          <div className={`font-mono uppercase tracking-[0.18em] text-lg ${isPaused ? 'text-status-error' : 'text-status-success'}`}>
            {paused.data === undefined ? '—' : isPaused ? 'Paused' : 'Active'}
          </div>
        </div>
        <span
          className={`h-2 w-2 rounded-full ${isPaused ? 'bg-status-error' : 'bg-status-success animate-pulse'}`}
          aria-hidden
        />
      </div>

      {!confirmOpen ? (
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={tx.isBusy || paused.data === undefined}
          className={isPaused ? 'btn-primary' : 'btn-danger'}
        >
          {isPaused ? 'Unpause protocol' : 'Pause protocol'}
        </button>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-status-error/30 bg-status-error/5 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-status-error font-medium animate-pulse">
            {isPaused ? 'Confirm unpause' : 'Confirm pause'}
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">
            {isPaused
              ? 'Unpausing lets users create new escrows again.'
              : 'Pausing blocks new escrow creation across the entire protocol.'}
          </p>
          <div className="flex gap-2">
            <button
              className="btn-secondary text-sm py-2 flex-1"
              onClick={() => setConfirmOpen(false)}
              disabled={tx.isBusy}
            >
              Cancel
            </button>
            <button
              className={`text-sm py-2 flex-1 ${isPaused ? 'btn-primary' : 'btn-danger'}`}
              onClick={execute}
              disabled={tx.isBusy}
            >
              {tx.isBusy ? 'Executing…' : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      {isPaused && !confirmOpen && (
        <p className="text-xs text-status-error">
          Protocol is paused. New escrows can't be created until you unpause.
        </p>
      )}
    </Section>
  )
}

/* ---------- Recovery Manager ---------- */
function RecoveryManagerSection() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const tx = useTx({
    onConfirmed: () => { setFrom(''); setTo(''); setConfirmOpen(false) }
  })

  const valid = isAddress(from) && isAddress(to) && from.toLowerCase() !== to.toLowerCase()

  const execute = () => tx.run(
    escrowWrite('adminTransferRefundCredit', [from, to]),
    { loadingMessage: 'Executing emergency recovery…' }
  )

  return (
    <Section title="Recovery manager" description="Transfer refund credit between wallets. This is irreversible.">
      <div className="rounded-xl border border-status-error/30 bg-status-error/5 px-3 py-2.5 text-xs text-status-error font-medium">
        Emergency action — only use when a wallet has lost access to its refund credit.
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Restricted wallet</label>
        <input
          className="input-field font-mono text-sm"
          placeholder="0x… (current credit holder)"
          value={from}
          onChange={(e) => setFrom(e.target.value.trim())}
          disabled={tx.isBusy}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Replacement wallet</label>
        <input
          className="input-field font-mono text-sm"
          placeholder="0x… (replacement)"
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          disabled={tx.isBusy}
        />
      </div>

      {!confirmOpen ? (
        <button
          className="btn-danger"
          disabled={!valid || tx.isBusy}
          onClick={() => setConfirmOpen(true)}
        >
          Transfer credit
        </button>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-status-error/30 bg-status-error/5 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-status-error font-medium animate-pulse">
            Confirm transfer
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">
            Move refund credit from <span className="font-mono tabular-nums">{truncateAddr(from)}</span> to <span className="font-mono tabular-nums">{truncateAddr(to)}</span>. This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              className="btn-secondary text-sm py-2 flex-1"
              onClick={() => setConfirmOpen(false)}
              disabled={tx.isBusy}
            >
              Cancel
            </button>
            <button
              className="btn-danger text-sm py-2 flex-1"
              onClick={execute}
              disabled={tx.isBusy}
            >
              {tx.isBusy ? 'Executing…' : 'Confirm execution'}
            </button>
          </div>
        </div>
      )}
    </Section>
  )
}

/* ---------- Admin primitives ---------- */
function CurrentValueRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-text-secondary">{label}</span>
      <div>{children}</div>
    </div>
  )
}

function Divider() {
  return <div className="h-px bg-border-subtle/60" aria-hidden />
}

function WriteForm({ label, fn, placeholder, validate, toArgs, onSuccess }) {
  const [value, setValue] = useState('')
  const tx = useTx({
    onConfirmed: () => { onSuccess?.(); setValue('') }
  })
  const valid = validate(value)

  const submit = () => tx.run(
    escrowWrite(fn, toArgs(value)),
    { loadingMessage: `${label} — check your wallet.` }
  )

  return (
    <div className="flex flex-col gap-2">
      <input
        className="input-field font-mono text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value.trim())}
        disabled={tx.isBusy}
      />
      <button
        className="btn-primary text-sm py-2.5 self-start"
        onClick={submit}
        disabled={!valid || tx.isBusy}
      >
        {tx.isBusy ? 'Submitting…' : label}
      </button>
    </div>
  )
}

/* ---------- Section wrapper ---------- */
function Section({ title, description, children }) {
  return (
    <section className="bg-background-secondary p-6 rounded-2xl border border-border-subtle shadow-sm flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-text-secondary mt-1">{description}</p>}
      </header>
      {children}
    </section>
  )
}
