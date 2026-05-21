import { useEffect, useState } from 'react'
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'

import ConnectGate from '../components/ConnectGate.jsx'
import Field from '../components/Field.jsx'
import Tooltip from '../components/Tooltip.jsx'
import TxModal from '../components/TxModal.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import { useRefundBalance } from '../hooks/useEscrows.js'
import { useTheme } from '../hooks/useTheme.jsx'
import { txToast } from '../hooks/useToast.jsx'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract.js'
import { formatUSDC, isValidAddress } from '../utils/format.js'

export default function Settings() {
  return (
    <ConnectGate>
      <SettingsInner />
    </ConnectGate>
  )
}

function SettingsInner() {
  return (
    <div className="max-w-xl mx-auto flex flex-col gap-8 w-full">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-ink-2 text-sm mt-1">Withdraw your refund balance and manage your preferences.</p>
      </div>

      <RefundSection />
      <AppearanceSection />
      <AccountSection />
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
          <div className="text-xs text-ink-2 mb-1">Available to withdraw</div>
          <div className="font-mono text-2xl text-clay">{formatUSDC(balance)}</div>
        </div>
      </div>

      <Field
        label={<>Withdraw to<Tooltip content="You can send this to any wallet you control. If your original wallet is restricted, use a different one." /></>}
        error={recipient && !isValidAddress(recipient) ? "That doesn't look like a valid address." : undefined}
      >
        {(props) => (
          <input
            {...props}
            className="input-field font-mono text-sm"
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value.trim())}
          />
        )}
      </Field>

      <button
        type="button"
        className="btn-primary"
        onClick={submit}
        disabled={balance === 0n || !isValidAddress(recipient) || txStatus === 'confirming' || txStatus === 'pending'}
      >
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
      <div
        role="radiogroup"
        aria-label="Theme"
        className="flex flex-col gap-2"
      >
        <span className="text-sm font-medium">Theme</span>
        <div className="grid grid-cols-2 gap-2">
          <ThemeOption active={theme === 'light'} onClick={() => setTheme('light')} label="Light" />
          <ThemeOption active={theme === 'dark'}  onClick={() => setTheme('dark')}  label="Dark" />
        </div>
      </div>
    </Section>
  )
}

function ThemeOption({ active, onClick, label }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`p-4 rounded-xl border text-sm font-medium transition-[background-color,border-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${
        active
          ? 'border-clay bg-clay-soft text-clay'
          : 'border-rule bg-sunk text-ink-2 hover:bg-rule'
      }`}
    >
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
        <span className="text-sm text-ink-2">Wallet address</span>
        <AddressDisplay address={address} full size="sm" />
      </div>
    </Section>
  )
}

/* ---------- Section wrapper ---------- */
function Section({ title, description, children }) {
  return (
    <section className="bg-paper p-6 rounded-2xl border border-rule flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-ink-2 mt-1">{description}</p>}
      </header>
      {children}
    </section>
  )
}
