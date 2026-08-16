import { useEffect, useState } from 'react'
import ConnectGate from '../components/ConnectGate.jsx'
import { useAuth } from '../hooks/useAuth.jsx'

function Mono({ children }) {
  return <span className="font-mono text-[12px] break-all">{children ?? '—'}</span>
}

function Row({ label, value, mono = false }) {
  return (
    <div className="flex flex-col gap-1 border-b border-rule px-5 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <span className="text-sm text-ink-2">{label}</span>
      <span className={`text-right text-sm font-medium text-ink ${mono ? 'font-mono text-[12px] break-all' : ''}`}>
        {value ?? '—'}
      </span>
    </div>
  )
}

function Card({ eyebrow, title, children }) {
  return (
    <section className="card-surface overflow-hidden">
      <div className="border-b border-rule px-5 py-4">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h2 className="text-base font-semibold text-ink">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function GateRow({ gate }) {
  return (
    <li className="flex items-start gap-3 border-b border-rule px-5 py-3 last:border-b-0">
      <span
        aria-label={gate.pass ? 'pass' : 'fail'}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          gate.pass ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'
        }`}
      >
        {gate.pass ? '✓' : '!' }
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink">{gate.label}</span>
          {!gate.critical && <span className="eyebrow text-clay">evidence</span>}
        </div>
        <p className="mt-1 break-words font-mono text-[11px] text-ink-3">{gate.detail}</p>
      </div>
    </li>
  )
}

function JsonBlock({ value }) {
  return (
    <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-all bg-sunk px-5 py-4 font-mono text-[11px] leading-relaxed text-ink-2">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function EmptyState({ title, message }) {
  return (
    <div className="card-surface mx-auto max-w-xl p-8 text-center">
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{message}</p>
    </div>
  )
}

function CanaryInner() {
  const { isSca, runCanaryPreflight } = useAuth()
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setReport(await runCanaryPreflight())
    } catch (err) {
      setError(err?.message || 'Could not load the read-only canary preflight.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isSca) load()
  }, [isSca, runCanaryPreflight])

  if (!isSca) {
    return <EmptyState title="SCA wallet required" message="This harness is only for a Circle user-controlled SCA. EOA behavior is intentionally not part of the canary." />
  }

  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="eyebrow mb-2">Phase 2 · disposable wallet harness</div>
          <h1 className="display text-3xl tracking-tight text-ink md:text-4xl">Atomic UCW batch preflight</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">
            Read-only review of one Circle SCA, one exact approve call, and one exact Tranche deposit call.
            No challenge is created and no transaction can be submitted from this page.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full border border-warn/40 bg-warn/10 px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.12em] text-warn">
            NOT EXECUTED
          </span>
          <button type="button" onClick={load} disabled={loading} className="btn-secondary text-xs">
            {loading ? 'Reading…' : 'Refresh preflight'}
          </button>
        </div>
      </header>

      {loading && !report && (
        <div className="card-surface p-8 text-sm text-ink-2">Reading Circle wallet metadata and Arc state…</div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-warn/40 bg-warn/10 px-5 py-4 text-sm text-warn">
          {error}
        </div>
      )}

      {report && (
        <>
          <div className={`rounded-xl border px-5 py-4 text-sm ${report.pass ? 'border-ok/35 bg-ok/10 text-ok' : 'border-warn/40 bg-warn/10 text-warn'}`}>
            <div className="font-semibold">{report.pass ? 'Preflight gates pass' : 'Preflight is not ready'}</div>
            <div className="mt-1 text-current/80">The report is a review artifact only. It does not authorize or execute anything.</div>
          </div>

          <Card eyebrow="01 · identity" title="Canonical Circle wallet">
            <div>
              <Row label="Tranche session identity" value={report.identity?.matchesSession ? 'matched' : 'not matched'} />
              <Row label="Canonical Circle user ID" value={report.identity?.circleUserId} mono />
              <Row label="Circle wallet ID" value={report.wallet.id} mono />
              <Row label="Address" value={report.wallet.address} mono />
              <Row label="Blockchain" value={report.wallet.blockchain} />
              <Row label="State" value={report.wallet.state} />
              <Row label="Account type" value={report.wallet.accountType} />
              <Row label="Exact scaCore" value={report.wallet.scaCore} mono />
              <Row label="On-chain implementation evidence" value={report.wallet.implementationAddress} mono />
            </div>
          </Card>

          <Card eyebrow="02 · balances" title="USDC and allowance preflight">
            <div>
              <Row label="ERC-20 USDC balance" value={`${report.balances.erc20.balanceBaseUnits} base units · ${report.balances.erc20.balanceUsdc} USDC`} mono />
              <Row label="ERC-20 precision" value={`${report.balances.erc20.decimals} decimals`} />
              <Row label="Required ERC-20 reserve" value={`${report.balances.erc20.requiredBaseUnits} base units`} mono />
              <Row label="Native Arc USDC balance" value={`${report.balances.native.balanceNative18} native units · ${report.balances.native.balanceUsdc} USDC`} mono />
              <Row label="Native precision" value={`${report.balances.native.decimals} decimals`} />
              <Row label="Required native reserve" value={`${report.balances.native.requiredNative18} native units`} mono />
              <Row label="Allowance to Tranche" value={`${report.balances.allowanceToTrancheBaseUnits} base units`} mono />
            </div>
          </Card>

          <Card eyebrow="03 · sponsorship" title="Gas Station evidence">
            <div>
              <Row label="Gas payer assumption" value={report.gasStation.gasPayer} />
              <Row label="Fallback payer" value={report.gasStation.fallbackGasPayer} />
              <Row label="Arc Testnet SCA support" value={report.gasStation.documentedArcTestnetSCA ? 'documented' : 'not documented'} />
              <Row label="Exact self-target batch path" value={report.gasStation.exactPath} />
              <Row label="Circle Gas Station paymaster" value={report.gasStation.paymasterAddress} mono />
              <Row label="Public fee estimate" value={report.gasStation.feeEstimate.available ? 'available' : 'unavailable'} />
            </div>
            <div className="border-t border-rule px-5 py-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-3">Public Circle fee-estimate response</p>
              <JsonBlock value={report.gasStation.feeEstimate} />
            </div>
            <div className="border-t border-rule px-5 py-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-3">Prior Phase 1 evidence</p>
              <JsonBlock value={report.gasStation.priorPhase1Evidence} />
            </div>
          </Card>

          <Card eyebrow="04 · action identity" title="Review-only request summary">
            <div>
              <Row label="Outer SCA target" value={report.payload?.contractAddress} mono />
              <Row label="Action digest" value={report.actionDigest} mono />
              <Row label="refId" value={report.refId} mono />
              <Row label="Proposed idempotency key" value={report.proposedIdempotencyKey} mono />
              <Row label="Status" value={report.status} />
            </div>
          </Card>

          <Card eyebrow="05 · exact calls" title="Two ordered inner operations">
            <div className="divide-y divide-rule">
              {(report.innerCalls || []).map((call, index) => (
                <div key={`${call.target}-${index}`} className="px-5 py-4">
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <span className="text-sm font-semibold text-ink">{index + 1}. {index === 0 ? 'Approve USDC' : 'Deposit escrow'}</span>
                    <span className="eyebrow text-clay">value {call.value}</span>
                  </div>
                  <Row label="Target" value={call.target} mono />
                  <div className="mt-3">
                    <div className="mb-1 text-xs text-ink-3">Calldata</div>
                    <div className="rounded-md bg-sunk p-3 font-mono text-[11px] leading-relaxed text-ink-2 break-all">{call.data}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-rule">
              <div className="px-5 pt-4 text-xs font-semibold uppercase tracking-[0.12em] text-ink-3">Canonical deposit terms</div>
              <JsonBlock value={report.terms} />
            </div>
          </Card>

          <Card eyebrow="06 · decoded batch" title="executeBatch calldata">
            <div className="border-b border-rule px-5 py-4">
              <Row label="Function" value={report.decodedExecuteBatch?.functionName} mono />
              <Row label="Outer calldata" value={report.payload?.callData} mono />
            </div>
            <JsonBlock value={report.decodedExecuteBatch} />
          </Card>

          <Card eyebrow="07 · gates" title="Every preflight gate">
            <ul>
              {(report.gates || []).map((gate) => <GateRow key={gate.id} gate={gate} />)}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}

export default function UcwCanary() {
  const { isConnected } = useAuth()
  if (!isConnected) {
    return (
      <ConnectGate
        title="Sign in with the disposable UCW"
        message="Use the fresh email-OTP Circle wallet for this read-only canary review."
      />
    )
  }
  return <CanaryInner />
}
