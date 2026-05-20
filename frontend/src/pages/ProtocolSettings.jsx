import { useState } from 'react'
import { useReadContract } from 'wagmi'
import { isAddress } from 'viem'

import ConnectGate from '../components/ConnectGate.jsx'
import Field from '../components/Field.jsx'
import Skeleton from '../components/Skeleton.jsx'
import WalletButton from '../components/WalletButton.jsx'
import { useRoles } from '../hooks/useRoles.jsx'
import { useSupportedDomains } from '../hooks/useSupportedDomains.js'
import { useTx, escrowWrite } from '../hooks/useTx.js'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract.js'
import { truncateAddr } from '../utils/format.js'
import { getDomainName, ALL_DOMAIN_NUMBERS } from '../config/chains.js'

export default function ProtocolSettings() {
  return (
    <ConnectGate>
      <ProtocolSettingsInner />
    </ConnectGate>
  )
}

function ProtocolSettingsInner() {
  const { roles, isLoading } = useRoles()

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col gap-8 w-full">
        <PageHeader />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    )
  }

  const hasAdminRole =
    roles.isFeeManager || roles.isDomainManager ||
    roles.isRecoveryManager || roles.isPauser

  if (!hasAdminRole) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col gap-8 w-full">
        <PageHeader />
        <AccessDenied />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6 w-full">
      <PageHeader />
      <ActiveRoleChips roles={roles} />

      {roles.isFeeManager && (
        <CollapsibleSection title="Fee manager" description="Protocol fee rate, treasury destination, and CCTP forwarding fee.">
          <FeeManagerSection />
        </CollapsibleSection>
      )}
      {roles.isDomainManager && (
        <CollapsibleSection title="Domain manager" description="Add or remove supported destination chains.">
          <DomainManagerSection />
        </CollapsibleSection>
      )}
      {roles.isRecoveryManager && (
        <CollapsibleSection title="Recovery manager" description="Transfer refund credit between wallets. This is irreversible.">
          <RecoveryManagerSection />
        </CollapsibleSection>
      )}
      {roles.isPauser && (
        <CollapsibleSection title="Pauser" description="Pause or unpause the entire protocol.">
          <PauserSection />
        </CollapsibleSection>
      )}
    </div>
  )
}

function PageHeader() {
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Protocol Settings</h1>
      <p className="text-text-secondary text-sm mt-1">
        Configuration and emergency controls. Only visible to wallets with admin roles.
      </p>
    </div>
  )
}

function AccessDenied() {
  return (
    <div className="card-surface p-10 text-center max-w-md mx-auto">
      <div className="w-12 h-12 rounded-full bg-status-error/10 text-status-error flex items-center justify-center mx-auto mb-4">
        <LockIcon size={20} />
      </div>
      <h2 className="text-lg font-semibold text-text-primary mb-2">Access denied</h2>
      <p className="text-sm text-text-secondary mb-6">
        Your connected wallet does not hold any admin roles. Switch to an authorised wallet to manage the protocol.
      </p>
      <div className="inline-flex justify-center">
        <WalletButton />
      </div>
    </div>
  )
}

function ActiveRoleChips({ roles }) {
  const labels = [
    roles.isFeeManager && 'Fee Manager',
    roles.isDomainManager && 'Domain Manager',
    roles.isRecoveryManager && 'Recovery Manager',
    roles.isPauser && 'Pauser'
  ].filter(Boolean)
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((r) => (
        <span
          key={r}
          className="inline-flex items-center rounded-full border border-border-subtle bg-background-tertiary px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] font-medium text-text-secondary"
        >
          {r}
        </span>
      ))}
    </div>
  )
}

/* ---------- Collapsible section card ---------- */
function CollapsibleSection({ title, description, children }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="bg-background-secondary rounded-2xl border border-border-subtle shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-start justify-between gap-3 p-6 text-left"
      >
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-text-secondary mt-1">{description}</p>}
        </div>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="px-6 pb-6 pt-0 flex flex-col gap-4 border-t border-border-subtle">
          <div className="pt-4 flex flex-col gap-4">{children}</div>
        </div>
      )}
    </section>
  )
}

/* ---------- Fee Manager ---------- */
function FeeManagerSection() {
  const fee = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'protocolFeeBps' })
  const treasury = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'protocolTreasury' })
  const cctp = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'cctpForwardFee' })

  return (
    <>
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
    </>
  )
}

/* ---------- Domain Manager ---------- */
function DomainManagerSection() {
  const { supported, refetch } = useSupportedDomains()
  return (
    <>
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
    </>
  )
}

function SupportedDomainRow({ domain, onRemoved }) {
  const tx = useTx({ onConfirmed: () => onRemoved?.() })
  const remove = () => tx.run(
    escrowWrite('removeSupportedDomain', [Number(domain)]),
    { loadingMessage: `Removing ${getDomainName(domain)}…` }
  )
  return (
    <div className="flex items-center justify-between rounded-xl border border-border-subtle bg-background-tertiary pl-3 pr-1 py-1 text-sm">
      <span className="font-mono tabular-nums text-text-primary">
        {getDomainName(domain)} <span className="text-text-tertiary">#{domain}</span>
      </span>
      <button
        type="button"
        onClick={remove}
        disabled={tx.isBusy}
        aria-label={`Remove ${getDomainName(domain)}`}
        className="inline-flex items-center justify-center h-11 min-w-[5rem] px-3 rounded-lg text-xs font-medium text-status-error hover:bg-status-error/10 transition-colors disabled:opacity-50 disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-status-error focus-visible:ring-offset-2 focus-visible:ring-offset-background-primary"
      >
        {tx.isBusy ? 'Removing…' : 'Remove'}
      </button>
    </div>
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
    <>
      <div className="rounded-xl border border-status-error/30 bg-status-error/5 px-3 py-2.5 text-xs text-status-error font-medium">
        Emergency action — only use when a wallet has lost access to its refund credit.
      </div>

      <Field
        label="Restricted wallet"
        error={from && !isAddress(from) ? 'Not a valid address.' : undefined}
      >
        {(props) => (
          <input
            {...props}
            className="input-field font-mono text-sm"
            placeholder="0x… (current credit holder)"
            autoComplete="off"
            spellCheck={false}
            value={from}
            onChange={(e) => setFrom(e.target.value.trim())}
            disabled={tx.isBusy}
          />
        )}
      </Field>

      <Field
        label="Replacement wallet"
        error={
          to && !isAddress(to)
            ? 'Not a valid address.'
            : isAddress(from) && isAddress(to) && from.toLowerCase() === to.toLowerCase()
              ? 'Replacement must differ from the restricted wallet.'
              : undefined
        }
      >
        {(props) => (
          <input
            {...props}
            className="input-field font-mono text-sm"
            placeholder="0x… (replacement)"
            autoComplete="off"
            spellCheck={false}
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
            disabled={tx.isBusy}
          />
        )}
      </Field>

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
    </>
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
    <>
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
    </>
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
  // Only surface the invalid state once the user has actually typed something;
  // empty inputs aren't "errors", they're starting state.
  const showInvalid = value.length > 0 && !valid

  return (
    <Field
      label={label}
      error={showInvalid ? 'Value does not satisfy the expected format.' : undefined}
    >
      {(props) => (
        <div className="flex flex-col gap-2">
          <input
            {...props}
            className="input-field font-mono text-sm"
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value.trim())}
            disabled={tx.isBusy}
          />
          <button
            type="button"
            className="btn-primary text-sm py-2.5 self-start"
            onClick={() => tx.run(
              escrowWrite(fn, toArgs(value)),
              { loadingMessage: `${label}. Check your wallet.` }
            )}
            disabled={!valid || tx.isBusy}
          >
            {tx.isBusy ? 'Submitting…' : label}
          </button>
        </div>
      )}
    </Field>
  )
}

function ChevronIcon({ open = false }) {
  return (
    <svg
      width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      className={`shrink-0 text-text-tertiary transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
    >
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  )
}

function LockIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  )
}
