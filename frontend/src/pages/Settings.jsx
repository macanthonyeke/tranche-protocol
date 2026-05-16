import { useEffect, useState } from 'react'
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'

import ConnectGate from '../components/ConnectGate.jsx'
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
        <p className="text-text-secondary text-sm mt-1">Manage your account and withdraw refunded funds.</p>
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
    txToastApi?.success('Withdrawal complete.', { hash: txHash })
  }, [receipt]) // eslint-disable-line

  const submit = async () => {
    const t = txToast({ loading: 'Submitting withdrawal — confirm in wallet…' })
    setTxToastApi(t)
    try {
      if (!isValidAddress(recipient)) throw new Error('Invalid recipient address')
      setTxError(null); setTxStatus('confirming')
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: ESCROW_ABI,
        functionName: 'withdrawRefund', args: [recipient]
      })
      setTxHash(hash); setTxStatus('pending')
      t.update('Withdrawal submitted. Waiting for confirmation…')
    } catch (err) {
      setTxError(err); setTxStatus('error')
      t.error('Withdrawal failed.')
    }
  }

  return (
    <Section title="Refund balance" description="USDC refunded from cancelled or disputed escrows.">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-text-secondary mb-1">Available</div>
          <div className="font-mono text-2xl text-accent">{formatUSDC(balance)}</div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium flex items-center">
          Recipient address
          <Tooltip content="You can withdraw to any address — useful if your original wallet was restricted." />
        </label>
        <input className="input-field font-mono text-sm" placeholder="0x…"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())} />
        {recipient && !isValidAddress(recipient) && (
          <div className="text-xs text-status-error">Invalid address.</div>
        )}
      </div>

      <button className="btn-primary"
        onClick={submit}
        disabled={balance === 0n || !isValidAddress(recipient) || txStatus === 'confirming' || txStatus === 'pending'}>
        {txStatus === 'confirming' || txStatus === 'pending' ? 'Submitting…' : 'Withdraw'}
      </button>

      <TxModal status={txStatus} txHash={txHash} error={txError}
        onClose={() => { setTxStatus('idle'); setTxHash(null); setTxError(null) }}
        onRetry={submit} title="Withdrawing refund" />
    </Section>
  )
}

/* ---------- Appearance ---------- */
function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  return (
    <Section title="Appearance" description="Customize how the app looks on this device.">
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
    <Section title="Connected account" description="Your currently connected wallet.">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-secondary">Wallet address</span>
        <AddressDisplay address={address} full size="sm" />
      </div>
    </Section>
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
