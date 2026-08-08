import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'

import ConnectGate from '../components/ConnectGate.jsx'
import Field from '../components/Field.jsx'
import Tooltip from '../components/Tooltip.jsx'
import TxModal from '../components/TxModal.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import { useRefundBalance } from '../hooks/useEscrows.js'
import { useTheme } from '../hooks/useTheme.jsx'
import { useTx, escrowWrite } from '../hooks/useTx.js'
import { formatUSDC, isValidAddress, isNonZeroAddress } from '../utils/format.js'
import { CONTRACT_ADDRESS } from '../config/contract.js'

/* ---------- Confirm-screen descriptors ----------
   Both refund actions move a user's whole balance in one irreversible step
   against a free-text address, and neither has an app-side confirmation in
   front of it — so Circle's signing screen is the last checkpoint before an
   address typo becomes permanent. Descriptor shape: utils/circleTheme.js.

   These are the far end of the language used on the release/refund screens
   in EscrowDetail: milestones are "credited" to a refund balance, and this
   is where credited finally becomes sent. Only withdrawRefund actually sends
   anything — see transferRefundCreditConfirm below. */

export function withdrawRefundConfirm({ balance, recipient, signer }) {
  const parameters = [
    `Sent to: ${recipient}`,
    // The UI always calls withdrawRefund with destinationDomain = 0, which in
    // this contract is the sentinel for the Arc path — a plain
    // usdc.safeTransfer, no CCTP (TrancheProtocol.sol:854). Do NOT render this
    // with getDomainName(0): in CCTP_DOMAINS domain 0 is Ethereum Sepolia, so
    // that would name the wrong chain on a signing screen.
    'Sent on: Arc — a direct USDC transfer, not a cross-chain delivery.',
    'Withdraws your entire refund balance. Partial withdrawals are not supported.'
  ]

  // Withdrawing to a wallet other than the signer is a supported flow (that is
  // the point of the "withdraw to any address you control" field), so this
  // states the fact rather than warning — but it states it, because it is the
  // difference between a routine withdrawal and sending everything to a typo.
  if (signer && recipient?.toLowerCase() !== signer.toLowerCase()) {
    parameters.push('This is not the wallet you are signing with.')
  }

  return {
    title: 'Withdraw your refund balance',
    subtitle: 'Sends your full refund balance out of the escrow contract to the address below. This cannot be undone.',
    amount: balance,
    amountLabel: 'Amount withdrawn',
    contractName: 'Tranche Protocol Escrow',
    contractAddress: CONTRACT_ADDRESS,
    functionName: 'withdrawRefund',
    parameters
  }
}

export function transferRefundCreditConfirm({ balance, recipient }) {
  return {
    title: 'Transfer your refund credit',
    subtitle: 'Hands your entire refund credit to another wallet. Only that wallet can withdraw it afterwards — you cannot reverse this yourself.',
    // An amount, because the whole credit does leave you and becomes someone
    // else's to withdraw. But no USDC moves here: the contract only re-keys
    // refundBalances (TrancheProtocol.sol:900-901, "Does NOT transfer USDC").
    // The figure says how much is at stake; the parameters say what actually
    // happens, so this cannot be misread as a payout.
    amount: balance,
    amountLabel: 'Credit transferred',
    contractName: 'Tranche Protocol Escrow',
    contractAddress: CONTRACT_ADDRESS,
    functionName: 'transferRefundCredit',
    parameters: [
      `New owner: ${recipient}`,
      'No USDC moves on this transaction — it re-keys who the credit belongs to.',
      'The new owner withdraws it from their own wallet.'
    ]
  }
}

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
      <TransferRefundCreditSection />
      <AppearanceSection />
      <AccountSection />
    </div>
  )
}

/* ---------- Refund Balance Withdrawal ---------- */
function RefundSection() {
  const { address } = useAuth()
  const { balance, refetch } = useRefundBalance(address)
  const [recipient, setRecipient] = useState(address || '')
  const tx = useTx({ onConfirmed: () => refetch() })

  useEffect(() => { if (address) setRecipient(address) }, [address])

  const submit = () => {
    if (!isNonZeroAddress(recipient)) return
    tx.run(
      escrowWrite('withdrawRefund', [recipient, 0, '0x0000000000000000000000000000000000000000', 0n]),
      {
        loadingMessage: 'Submitting. Check your wallet.',
        confirm: withdrawRefundConfirm({ balance, recipient, signer: address })
      }
    )
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
        disabled={balance === 0n || !isNonZeroAddress(recipient) || tx.isBusy}
      >
        {tx.isBusy ? 'Submitting…' : 'Withdraw funds'}
      </button>

      <TxModal status={tx.status} txHash={tx.hash} error={tx.error}
        onClose={tx.reset}
        onRetry={submit} title="Processing withdrawal" />
    </Section>
  )
}

/* ---------- Transfer Refund Credit ---------- */
function TransferRefundCreditSection() {
  const { address } = useAuth()
  const { balance, refetch } = useRefundBalance(address)
  const [recipient, setRecipient] = useState('')
  const tx = useTx({ onConfirmed: () => refetch() })

  const submit = () => {
    if (!isNonZeroAddress(recipient)) return
    tx.run(
      escrowWrite('transferRefundCredit', [recipient]),
      {
        loadingMessage: 'Submitting. Check your wallet.',
        confirm: transferRefundCreditConfirm({ balance, recipient })
      }
    )
  }

  return (
    <Section title="Transfer refund credit" description="Move your entire refund balance to a different wallet — useful if your current wallet is restricted and you need to withdraw from another address.">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-ink-2 mb-1">Credit to transfer</div>
          <div className="font-mono text-2xl text-clay">{formatUSDC(balance)}</div>
        </div>
      </div>
      <Field
        label="Recipient address"
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
        disabled={balance === 0n || !isNonZeroAddress(recipient) || tx.isBusy}
      >
        {tx.isBusy ? 'Submitting…' : 'Transfer credit'}
      </button>
      <TxModal status={tx.status} txHash={tx.hash} error={tx.error}
        onClose={tx.reset}
        onRetry={submit} title="Transferring refund credit" />
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
  const { address } = useAuth()
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
