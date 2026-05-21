import { useState } from 'react'
import { isAddress } from 'viem'
import { useReadContract } from 'wagmi'

import PageHeader from '../components/PageHeader.jsx'
import ConnectGate from '../components/ConnectGate.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import Field from '../components/Field.jsx'
import Skeleton from '../components/Skeleton.jsx'
import WalletButton from '../components/WalletButton.jsx'

import { useRoles } from '../hooks/useRoles.jsx'
import { useSupportedDomains } from '../hooks/useSupportedDomains.js'
import { useTx, escrowWrite } from '../hooks/useTx.js'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract.js'
import { ALL_DOMAIN_NUMBERS, getDomainName, ARC_DOMAIN } from '../config/chains.js'
import { formatUSDC, truncateAddr } from '../utils/format.js'

export default function ProtocolSettings() {
  return (
    <div>
      <PageHeader
        eyebrow="Protocol controls"
        title="Protocol."
        kicker="Settings here change the protocol globally for future escrows. In-flight escrows snapshot fees at deposit time and aren't affected."
      />
      <ConnectGate><Gate /></ConnectGate>
    </div>
  )
}

function Gate() {
  const { roles, isLoading } = useRoles()
  if (isLoading) return <Skeleton className="h-48" />
  const allowed =
    roles.isDefaultAdmin || roles.isFeeManager ||
    roles.isDomainManager || roles.isRecoveryManager || roles.isPauser
  if (!allowed) {
    return (
      <div className="max-w-prose flex flex-col gap-4">
        <p className="text-ink-2 text-[15px] leading-relaxed">
          This wallet doesn't hold any admin role. The default admin can grant{' '}
          <span className="num text-[12.5px]">FEE_MANAGER_ROLE</span>,{' '}
          <span className="num text-[12.5px]">DOMAIN_MANAGER_ROLE</span>,{' '}
          <span className="num text-[12.5px]">RECOVERY_MANAGER_ROLE</span>, or{' '}
          <span className="num text-[12.5px]">PAUSER_ROLE</span>.
        </p>
        <div><WalletButton /></div>
      </div>
    )
  }
  return <Body roles={roles} />
}

function Body({ roles }) {
  return (
    <div className="pb-20 flex flex-col gap-16">
      <Snapshot />
      <div className="rule" />
      {roles.isFeeManager && (<>
        <FeeControls />
        <div className="rule" />
      </>)}
      {roles.isDomainManager && (<>
        <DomainControls />
        <div className="rule" />
      </>)}
      {roles.isRecoveryManager && (<>
        <RecoveryControls />
        <div className="rule" />
      </>)}
      {roles.isPauser && <PauseControl />}
    </div>
  )
}

/* ---------- Snapshot ---------- */
function Snapshot() {
  const fee = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'protocolFeeBps' })
  const treasury = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'protocolTreasury' })
  const cctp = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'cctpForwardFee' })
  const paused = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'paused' })

  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-8 pt-2">
      <Stat
        label="Protocol fee"
        value={
          <span className="num">
            {fee.data !== undefined ? `${(Number(fee.data) / 100).toFixed(2)}%` : '—'}
          </span>
        }
      />
      <Stat
        label="CCTP forward fee"
        value={
          <span className="num">
            {cctp.data !== undefined ? formatUSDC(cctp.data) : '—'}
          </span>
        }
      />
      <Stat
        label="Paused"
        value={
          <span className={paused.data ? 'text-bad' : 'text-ok'}>
            {paused.data === undefined ? '—' : paused.data ? 'Yes' : 'No'}
          </span>
        }
      />
      <Stat
        label="Treasury"
        value={treasury.data ? <AddressDisplay address={treasury.data} /> : <span className="text-ink-3">—</span>}
      />
    </section>
  )
}

function Stat({ label, value, hint }) {
  return (
    <div>
      <p className="eyebrow mb-1.5">{label}</p>
      <div className="text-[16px] text-ink">{value}</div>
      {hint && <p className="text-[12px] text-ink-3 mt-0.5">{hint}</p>}
    </div>
  )
}

/* ---------- Fee Controls ---------- */
function FeeControls() {
  const fee = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'protocolFeeBps' })
  const treasury = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'protocolTreasury' })
  const cctp = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'cctpForwardFee' })

  const [bps, setBps] = useState('')
  const [tr, setTr] = useState('')
  const [cctpVal, setCctpVal] = useState('')

  const feeTx  = useTx({ onConfirmed: () => { fee.refetch?.(); setBps('') } })
  const trTx   = useTx({ onConfirmed: () => { treasury.refetch?.(); setTr('') } })
  const cctpTx = useTx({ onConfirmed: () => { cctp.refetch?.(); setCctpVal('') } })

  const bpsValid = /^\d+$/.test(bps) && Number(bps) <= 1000
  const trValid = isAddress(tr)
  const cctpValid = /^\d+$/.test(cctpVal)

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-10">
      <div className="flex flex-col gap-4 max-w-prose">
        <h2 className="display text-[28px] leading-tight text-ink">Protocol fee</h2>
        <p className="text-[13.5px] text-ink-2 leading-relaxed">
          Basis points (199 = 1.99%). Applies only to escrows created after this call.
        </p>
        <Field label="New fee (bps)" helper="0–1000">
          {(p) => <input {...p} type="number" min="0" max="1000" className="input num" value={bps} onChange={(e) => setBps(e.target.value.trim())} />}
        </Field>
        <div>
          <button
            className="btn-primary"
            disabled={!bpsValid || feeTx.isBusy}
            onClick={() => feeTx.run(escrowWrite('setProtocolFee', [BigInt(bps || 0)]), { loadingMessage: 'Set protocol fee.' })}
          >
            {feeTx.isBusy ? 'Working…' : 'Update fee'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 max-w-prose">
        <h2 className="display text-[28px] leading-tight text-ink">Treasury</h2>
        <p className="text-[13.5px] text-ink-2 leading-relaxed">
          Where new escrow fees are sent on release. Affects new escrows only.
        </p>
        <Field label="Treasury address">
          {(p) => <input {...p} className="input num" placeholder="0x…" value={tr} onChange={(e) => setTr(e.target.value.trim())} />}
        </Field>
        <div>
          <button
            className="btn-primary"
            disabled={!trValid || trTx.isBusy}
            onClick={() => trTx.run(escrowWrite('setProtocolTreasury', [tr]), { loadingMessage: 'Set treasury.' })}
          >
            {trTx.isBusy ? 'Working…' : 'Update treasury'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 max-w-prose md:col-span-2">
        <h2 className="display text-[28px] leading-tight text-ink">CCTP forwarding fee</h2>
        <p className="text-[13.5px] text-ink-2 leading-relaxed">
          Floor the contract uses for cross-chain releases. USDC base units (6 decimals; 1000000 = 1 USDC). Keep in sync with Circle's published forwarding fee.
        </p>
        <Field label="Fee (USDC base units)">
          {(p) => <input {...p} type="number" min="0" className="input num" value={cctpVal} onChange={(e) => setCctpVal(e.target.value.trim())} />}
        </Field>
        <div>
          <button
            className="btn-primary"
            disabled={!cctpValid || cctpTx.isBusy}
            onClick={() => cctpTx.run(escrowWrite('setCctpForwardFee', [BigInt(cctpVal || 0)]), { loadingMessage: 'Set CCTP fee.' })}
          >
            {cctpTx.isBusy ? 'Working…' : 'Update CCTP fee'}
          </button>
        </div>
      </div>
    </section>
  )
}

/* ---------- Domain Controls ---------- */
function DomainControls() {
  const { supported, refetch } = useSupportedDomains()
  const supportedSet = new Set(supported)
  const addTx = useTx({ onConfirmed: () => refetch?.() })
  const removeTx = useTx({ onConfirmed: () => refetch?.() })

  return (
    <section className="flex flex-col gap-5">
      <h2 className="display text-[28px] leading-tight text-ink">Supported destination domains</h2>
      <p className="text-[13.5px] text-ink-2 max-w-prose leading-relaxed">
        CCTP domains the contract will accept as a destination. Arc ({ARC_DOMAIN}) is always accepted on-chain.
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
        {ALL_DOMAIN_NUMBERS.map((d) => {
          const on = supportedSet.has(d)
          return (
            <li key={d} className="flex items-baseline justify-between gap-3 py-2 border-b border-rule">
              <span className="text-[13.5px] text-ink">
                <span className="seq text-[11px] text-ink-3 mr-2">D{String(d).padStart(2, '0')}</span>
                {getDomainName(d)}
              </span>
              <button
                className={on ? 'btn-quiet text-bad hover:text-bad' : 'btn-quiet text-clay hover:text-clay'}
                disabled={(on ? removeTx.isBusy : addTx.isBusy)}
                onClick={() => (on
                  ? removeTx.run(escrowWrite('removeSupportedDomain', [d]), { loadingMessage: `Remove ${getDomainName(d)}.` })
                  : addTx.run(escrowWrite('addSupportedDomain', [d]), { loadingMessage: `Add ${getDomainName(d)}.` })
                )}
              >
                {on ? 'Disable' : 'Enable'}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ---------- Recovery Controls ---------- */
function RecoveryControls() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [confirm, setConfirm] = useState(false)
  const tx = useTx({ onConfirmed: () => { setFrom(''); setTo(''); setConfirm(false) } })
  const valid = isAddress(from) && isAddress(to) && from.toLowerCase() !== to.toLowerCase()

  return (
    <section className="flex flex-col gap-4 max-w-prose">
      <h2 className="display text-[28px] leading-tight text-ink">Recovery</h2>
      <p className="text-[13.5px] text-ink-2 leading-relaxed">
        Emergency action: transfer refund credit between wallets when one has lost access. Irreversible once confirmed.
      </p>

      <Field
        label="Restricted wallet"
        error={from && !isAddress(from) ? 'Not a valid address.' : undefined}
      >
        {(p) => (
          <input {...p} className="input num" placeholder="0x… (current credit holder)"
            autoComplete="off" spellCheck={false}
            value={from} onChange={(e) => setFrom(e.target.value.trim())} disabled={tx.isBusy}
          />
        )}
      </Field>
      <Field
        label="Replacement wallet"
        error={
          to && !isAddress(to) ? 'Not a valid address.'
            : isAddress(from) && isAddress(to) && from.toLowerCase() === to.toLowerCase()
              ? 'Replacement must differ from the restricted wallet.' : undefined
        }
      >
        {(p) => (
          <input {...p} className="input num" placeholder="0x… (replacement)"
            autoComplete="off" spellCheck={false}
            value={to} onChange={(e) => setTo(e.target.value.trim())} disabled={tx.isBusy}
          />
        )}
      </Field>

      {!confirm ? (
        <div>
          <button className="btn-danger" disabled={!valid || tx.isBusy} onClick={() => setConfirm(true)}>
            Transfer credit
          </button>
        </div>
      ) : (
        <div className="panel border-bad p-4 flex flex-col gap-3">
          <p className="eyebrow text-bad">Confirm transfer</p>
          <p className="text-[13px] text-ink-2 leading-relaxed">
            Move refund credit from <span className="num">{truncateAddr(from)}</span> to <span className="num">{truncateAddr(to)}</span>. This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button className="btn-quiet" onClick={() => setConfirm(false)} disabled={tx.isBusy}>Cancel</button>
            <button
              className="btn-danger"
              onClick={() => tx.run(escrowWrite('adminTransferRefundCredit', [from, to]), { loadingMessage: 'Executing emergency recovery.' })}
              disabled={tx.isBusy}
            >
              {tx.isBusy ? 'Executing…' : 'Confirm execution'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/* ---------- Pause Control ---------- */
function PauseControl() {
  const paused = useReadContract({ address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'paused' })
  const tx = useTx({ onConfirmed: () => paused.refetch?.() })
  const isPaused = !!paused.data

  return (
    <section className="flex flex-col gap-4 max-w-prose">
      <h2 className="display text-[28px] leading-tight text-ink">Kill switch</h2>
      <p className="text-[13.5px] text-ink-2 leading-relaxed">
        Pause blocks new deposits but not release, refund, or dispute paths. Money never gets stuck behind it.
      </p>
      <div className="flex items-center gap-3">
        <span className={`status ${isPaused ? 'status-bad' : 'status-ok'}`}>
          {paused.data === undefined ? '—' : isPaused ? 'Paused' : 'Active'}
        </span>
      </div>
      <div>
        {isPaused ? (
          <button
            className="btn-primary"
            disabled={tx.isBusy || paused.data === undefined}
            onClick={() => tx.run(escrowWrite('unpause', []), { loadingMessage: 'Unpause.' })}
          >
            {tx.isBusy ? 'Working…' : 'Unpause deposits'}
          </button>
        ) : (
          <button
            className="btn-danger"
            disabled={tx.isBusy || paused.data === undefined}
            onClick={() => tx.run(escrowWrite('pause', []), { loadingMessage: 'Pause.' })}
          >
            {tx.isBusy ? 'Working…' : 'Pause deposits'}
          </button>
        )}
      </div>
    </section>
  )
}
