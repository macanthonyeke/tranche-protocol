import { useEffect, useState } from 'react'
import { isAddress } from 'viem'

import PageHeader from '../components/PageHeader.jsx'
import ConnectGate from '../components/ConnectGate.jsx'
import AddressDisplay from '../components/AddressDisplay.jsx'
import Field from '../components/Field.jsx'
import Skeleton from '../components/Skeleton.jsx'
import WalletButton from '../components/WalletButton.jsx'

import { useReadContract } from 'wagmi'

import { useAuth } from '../hooks/useAuth.jsx'
import { useRoles } from '../hooks/useRoles.jsx'
import { useSupportedDomains } from '../hooks/useSupportedDomains.js'
import { useProtocolConfig } from '../hooks/useArbiter.js'
import { useRefundBalance } from '../hooks/useEscrows.js'
import { useDebouncedValue } from '../hooks/useDebouncedValue.js'
import { useTx, escrowWrite } from '../hooks/useTx.js'
import { ALL_DOMAIN_NUMBERS, getDomainName, ARC_DOMAIN } from '../config/chains.js'
import { formatUSDC, formatTimestamp, truncateAddr, isNonZeroAddress } from '../utils/format.js'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/* How long the recovery panel waits after typing stops before looking a wallet
 * up. Long enough that correcting a mistyped character costs one read instead
 * of several, short enough that the submit button does not feel stuck — the
 * gate below holds it disabled for exactly this long after the last keystroke.
 */
const RECOVERY_LOOKUP_DELAY_MS = 400

/* The recovery panels' submit gate, unchanged in intent from the loading gate
 * it replaces: never let a proposal or a claim be submitted against figures
 * that have not actually been read.
 *
 * Debouncing the lookup opens a window the old expression could not see. A
 * freshly typed address is valid, but its reads have not been issued yet, so
 * both `isLoading` flags are false — a disabled react-query is not a loading
 * one. Gating on those alone would enable the button during the pause, which
 * is precisely the mid-read submit the gate exists to prevent: a confirm
 * screen showing 0.00 USDC and "no proposal is currently pending", both of
 * which are what an unread result looks like and both of which are wrong when
 * the truth is a funded wallet with a standing nomination.
 *
 * So "typed something the reads have not caught up with" counts as pending
 * too. Exact string comparison, not case-insensitive: the debounced value is
 * the same string arriving later, and a checksum-case difference is a
 * different lookup key to react-query anyway. */
export function recoveryReadsPending({ typed, debounced, balanceLoading, recoveryLoading, balanceError, recoveryError }) {
  if (isAddress(typed) && typed !== debounced) return true
  // A failed read is not a resolved one. `?? null` / `?? 0n` below make an
  // errored read LOOK like a genuine empty result — same shape as the
  // in-flight case this gate already exists to catch, so it is folded in
  // here rather than checked separately at every call site.
  return !!(balanceLoading || recoveryLoading || balanceError || recoveryError)
}

/* ARBITER_WINDOW is `internal constant` with no getter (see CLAUDE.md's
   bytecode-budget note), so the 14 days is mirrored here rather than read. */
const RECOVERY_WINDOW_SECONDS = 14 * 24 * 60 * 60

export function expiryOf(proposedAt) {
  const at = Number(proposedAt ?? 0)
  return at > 0 ? at + RECOVERY_WINDOW_SECONDS : null
}

/* Client Date.now() and the contract's block.timestamp (TrancheProtocol.sol
   :940) are two different clocks. A proposal that reads as valid client-side
   right up to the literal deadline can still revert on-chain if the two have
   drifted apart, or the reverse. 5 minutes comfortably covers realistic
   RPC-node/client clock drift without meaningfully shrinking a 14-day window
   — the same shape as SESSION_TTL_MS in useAuth.jsx sitting a day under the
   token's real 14-day life: a margin under the real boundary, not equality
   against it. */
const RECOVERY_EXPIRY_SAFETY_MARGIN_SECONDS = 5 * 60

export function isRecoveryExpired(expiry, atMs = Date.now()) {
  if (expiry === null) return false
  return Math.floor(atMs / 1000) > expiry - RECOVERY_EXPIRY_SAFETY_MARGIN_SECONDS
}

/* Both recovery getters are public on the contract and already in the ABI;
   nothing here writes, it only lets the confirm screens state what is true. */
function usePendingRecovery(address) {
  const enabled = !!address
  const base = { address: CONTRACT_ADDRESS, abi: ESCROW_ABI, query: { enabled } }
  const { data: proposedOwner, isLoading: ownerLoading, error: ownerError } = useReadContract({
    ...base, functionName: 'pendingRefundRecovery', args: enabled ? [address] : undefined
  })
  const { data: proposedAt, isLoading: atLoading, error: atError } = useReadContract({
    ...base, functionName: 'pendingRefundRecoveryAt', args: enabled ? [address] : undefined
  })
  // `?? null` / `?? 0n` are indistinguishable from a real empty result, so the
  // loading flag has to travel with them: "no pending proposal" and "haven't
  // looked yet" must not render as the same sentence on a confirm screen. An
  // RPC failure is a third case that reads identically to both if it is not
  // also carried out — see recoveryReadsPending.
  return {
    proposedOwner: proposedOwner ?? null,
    proposedAt: proposedAt ?? 0n,
    isLoading: enabled && (ownerLoading || atLoading),
    error: enabled ? (ownerError || atError || null) : null
  }
}

/* ---------- Confirm-screen descriptors ----------
   First CONFIG-CHANGE descriptor in the app: no `amount`, because nothing
   moves. buildContractInteraction omits the currency row cleanly when amount
   is absent, so there is no placeholder figure to invent. What replaces it is
   an old-value → new-value line in `parameters`, since a config change has no
   number to anchor on but does have a before and an after.

   Takes the CURRENT on-chain state and describes the transition away from it.
   PauseControl renders its two buttons from a ternary on the same flag, so a
   descriptor pinned to the wrong branch would read "Pause" while calling
   unpause — hence the direction and the function name are derived together
   here rather than written out twice at the call sites. */
export function pauseConfirm({ paused }) {
  const base = {
    contractName: 'Tranche Protocol Escrow',
    contractAddress: CONTRACT_ADDRESS
  }

  if (paused) {
    return {
      ...base,
      title: 'Resume new deposits',
      subtitle: 'Lets new escrows be created again, protocol-wide.',
      functionName: 'unpause',
      parameters: [
        'Deposits: Paused → Active',
        'Affects the whole protocol, not one escrow.'
      ]
    }
  }

  return {
    ...base,
    title: 'Pause new deposits',
    subtitle: 'Stops any new escrow from being created, protocol-wide. Money already in escrow is not affected.',
    functionName: 'pause',
    parameters: [
      'Deposits: Active → Paused',
      'Affects the whole protocol, not one escrow.',
      // Verified against the contract: deposit() is the ONLY function carrying
      // whenNotPaused, so every settlement path stays open while paused. If a
      // future change adds the modifier elsewhere, this line stops being true.
      'Only new deposits are blocked — release, refund and dispute paths stay open.',
      'Existing escrows carry on as normal.'
    ]
  }
}

/* The three fee-family setters share one real consequence, and it is the
   reassuring kind: all three values are snapshotted per-escrow at deposit
   (TrancheProtocol.sol:325, :348, :349), so none of them touches an escrow
   that already exists. That is the H-05 protection, and it is worth stating
   on the screen rather than leaving the admin to wonder.

   Treasury carries an extra consequence the other two do not, and it runs the
   opposite way to the obvious assumption. Changing it does NOT redirect all
   future fee payments: fees from escrows that already exist keep going to the
   OLD address, because :621 and :1269 pay escrowTreasury[escrowId], the
   snapshot. So rotating a compromised treasury does not stop money reaching
   it — that has to be said out loud, since the natural reading of "update
   treasury" is the opposite. */

const CONFIG_BASE = {
  contractName: 'Tranche Protocol Escrow',
  contractAddress: CONTRACT_ADDRESS
}

const SNAPSHOT_NOTE = 'Applies to escrows created after this transaction. Escrows that already exist keep the value they snapshotted at deposit.'

export function protocolFeeConfirm({ currentBps, newBps }) {
  return {
    ...CONFIG_BASE,
    title: 'Change the protocol fee',
    subtitle: 'Sets the fee charged on future escrows. Escrows already in flight are not affected.',
    functionName: 'setProtocolFee',
    parameters: [
      `Protocol fee: ${formatBps(currentBps)} → ${formatBps(newBps)}`,
      SNAPSHOT_NOTE
    ]
  }
}

export function protocolTreasuryConfirm({ currentTreasury, newTreasury }) {
  return {
    ...CONFIG_BASE,
    title: 'Change the protocol treasury',
    subtitle: 'Sets where fees from future escrows are paid. Every existing escrow keeps paying the address it snapshotted when it was funded.',
    functionName: 'setProtocolTreasury',
    parameters: [
      `Treasury: ${currentTreasury || 'unknown'} → ${newTreasury}`,
      SNAPSHOT_NOTE,
      // The one that catches people out: this is not a kill switch on the old
      // address. And "the current address" was itself wrong — escrowTreasury is
      // per-escrow (:345, paid at :1269), so after two rotations the oldest
      // escrows still pay the OLDEST address, not whatever is current now.
      'This does not stop fees already owed. Each in-flight escrow pays whichever treasury address was set at its own deposit — which may be an older address than the one shown above.'
    ]
  }
}

export function cctpForwardFeeConfirm({ currentFee, newFee }) {
  return {
    ...CONFIG_BASE,
    title: 'Change the CCTP forwarding fee floor',
    subtitle: "Sets the minimum forwarding fee the contract accepts on cross-chain releases for future escrows.",
    functionName: 'setCctpForwardFee',
    parameters: [
      `CCTP forwarding fee: ${formatUSDC(currentFee)} → ${formatUSDC(newFee)}`,
      SNAPSHOT_NOTE,
      // Not cosmetic: permissionless release() burns at the escrow's snapshot
      // and ignores the caller's quote, so a floor below Circle's live fee
      // leaves those burns attested but never minted (INSUFFICIENT_FEE).
      "Keep this at or above Circle's live forwarding fee, or permissionless releases will not auto-deliver."
    ]
  }
}

/* Domains are the one pair here that is NOT symmetric, so they do not share a
   builder with an inverted arrow.
 *
 * Removing a domain does not strand escrows already heading there: the release
 * paths never consult supportedDomains, so those deliver as normal. What it
 * does block is every path that consults it — new escrows to that domain
 * (:255, :264), cross-chain refund withdrawals to it (:866), and redirecting a
 * payout to it (:975, :1027). Someone holding a refund credit they meant to
 * withdraw there loses that route with no warning anywhere else in the UI. */
/* What removing a domain actually blocks, stated as one accurate sentence per
   case rather than a blanket "blocks everything" bullet followed by a bullet
   that walks part of it back. Two of the three gated paths — new escrows
   (:255, :264) and cross-chain refund withdrawals (:866) and payout redirects
   (:975, :1027) — are each exempted for exactly one domain number, so each
   exempt case gets its own sentence instead of sharing the general one:

   1. Domain 0 is withdrawRefund's Arc sentinel. That path returns before any
      supportedDomains lookup (:854-859), so removing domain 0 blocks no
      withdrawal — new escrows and redirects to it are still blocked normally.
   2. ARC_DOMAIN is exempt by construction in both redirects: the guard reads
      `newDestinationDomain != ARC_DOMAIN && !supportedDomains[...]` (:975,
      :1027), so an Arc redirect works whether or not Arc is on the list —
      new escrows and cross-chain refund withdrawals to it are still blocked
      normally. */
function domainRemovalBlocks(domain) {
  if (Number(domain) === 0) {
    return 'Blocks new escrows to this chain and redirecting a payout to it. Refund withdrawals are unaffected: domain 0 is the "stay on Arc" sentinel, which never consults this list.'
  }
  if (Number(domain) === ARC_DOMAIN) {
    return 'Blocks new escrows to this chain and cross-chain refund withdrawals to it. Payout redirects to Arc keep working regardless — the contract exempts Arc from this list.'
  }
  return 'Blocks new escrows to this chain, cross-chain refund withdrawals to it, and redirecting a payout to it.'
}

// F3 rejects redirecting an Arc-funded escrow cross-chain independently of
// supportedDomains (:982, :1033) — true for every domain except Arc itself,
// which this list has no power to change either way.
const ARC_FUNDED_REDIRECT_CAVEAT =
  'Escrows funded to pay on Arc still cannot be redirected here — that is blocked separately, not by this list.'

/* Two carve-outs that still belong on the ADD screen. Neither corrects a
   claim the leading sentence made — "new escrows may name this chain, and
   payouts may be redirected to it" says nothing about refund-withdrawal
   routes or about redirects having already worked before this change — so
   these stay appended facts rather than needing to move up into that
   sentence:

   1. Domain 0 doubles as withdrawRefund's Arc sentinel, so adding it to
      supportedDomains does not create a new withdrawal route through it.
      That sentinel meaning is unrelated to domain 0's OTHER, ordinary
      meaning as a real CCTP destination (Ethereum) for redirect purposes —
      F3 restricts an Arc-funded escrow from redirecting there exactly like
      any other domain, so this case still needs the same F3 caveat every
      other non-Arc domain gets, alongside the sentinel note.
   2. ARC_DOMAIN is exempt from both redirect guards by construction (:975,
      :1027), so re-adding it does not change redirect availability — it was
      already reachable, and (being Arc) it does not need the F3 caveat
      either: F3 restricts redirecting AWAY from Arc, not TO it.
   3. Enabling a domain does not make it reachable for every escrow. An
      Arc-funded escrow (or Arc split leg) still cannot be redirected
      cross-chain — F3 rejects it independently of supportedDomains (:982,
      :1033). */
function domainAdditionCaveats(domain) {
  if (Number(domain) === 0) {
    return [
      'This does not open a cross-chain refund route: domain 0 is the "stay on Arc" sentinel, not a destination.',
      ARC_FUNDED_REDIRECT_CAVEAT
    ]
  }
  if (Number(domain) === ARC_DOMAIN) {
    return ['Arc was already always available for redirects; the contract exempts it from this list.']
  }
  return [ARC_FUNDED_REDIRECT_CAVEAT]
}

export function domainConfirm({ domain, domainName, enabled }) {
  if (enabled) {
    return {
      ...CONFIG_BASE,
      title: `Stop accepting ${domainName}`,
      subtitle: 'Removes this chain as a destination for new escrows and payouts.',
      functionName: 'removeSupportedDomain',
      parameters: [
        `${domainName} (domain ${domain}): Accepted → Not accepted`,
        'Escrows already heading to this chain still release and deliver normally.',
        domainRemovalBlocks(domain)
      ]
    }
  }

  return {
    ...CONFIG_BASE,
    title: `Start accepting ${domainName}`,
    subtitle: 'Adds this chain as a destination for new escrows and payouts.',
    functionName: 'addSupportedDomain',
    parameters: [
      `${domainName} (domain ${domain}): Not accepted → Accepted`,
      'New escrows may name this chain, and payouts may be redirected to it.',
      ...domainAdditionCaveats(domain)
    ]
  }
}

// bps → percent, matching how the page already renders the current fee.
function formatBps(bps) {
  if (bps === undefined || bps === null) return 'unknown'
  return `${(Number(bps) / 100).toFixed(2)}% (${Number(bps)} bps)`
}

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
    /* claimRefundCreditTransfer is address-gated, not role-gated: the contract
       only requires msg.sender == the nominated wallet (:943). A nominee who
       holds no admin role was previously bounced off this page entirely and
       had no way to claim credit that is already theirs to take.

       The panel is shown rather than auto-detected because the nomination
       mapping is keyed by the BLACKLISTED wallet — there is no reverse index
       from nominee to source, and RefundCreditTransferProposed is in the ABI
       but not indexed by the subgraph, so "is this wallet nominated anywhere"
       is not a question the frontend can currently ask. The claimer supplies
       the source address, and the on-chain gate plus the live reads behind the
       confirm screen do the rest. Nothing here is privileged: every value it
       surfaces is already public. */
    return (
      <div className="max-w-prose flex flex-col gap-6">
        <p className="text-ink-2 text-[15px] leading-relaxed">
          This wallet doesn't hold any admin role. The default admin can grant{' '}
          <span className="num text-[12.5px]">FEE_MANAGER_ROLE</span>,{' '}
          <span className="num text-[12.5px]">DOMAIN_MANAGER_ROLE</span>,{' '}
          <span className="num text-[12.5px]">RECOVERY_MANAGER_ROLE</span>, or{' '}
          <span className="num text-[12.5px]">PAUSER_ROLE</span>.
        </p>
        <div><WalletButton /></div>
        <div className="rule" />
        <div className="flex flex-col gap-3">
          <h2 className="display text-[24px] leading-tight text-ink">Claim recovered refund credit</h2>
          <p className="text-[13.5px] text-ink-2 leading-relaxed">
            No admin role is needed for this. If a recovery manager has nominated this wallet to
            receive another wallet's refund credit, enter that wallet's address to claim it.
          </p>
          <ClaimRecovery />
        </div>
      </div>
    )
  }
  return <Body roles={roles} />
}

function Body({ roles }) {
  const { config, refetch } = useProtocolConfig()
  return (
    <div className="pb-20 flex flex-col gap-16">
      <Snapshot config={config} />
      <div className="rule" />
      {roles.isFeeManager && (<>
        <FeeControls config={config} refetch={refetch} />
        <div className="rule" />
      </>)}
      {roles.isDomainManager && (<>
        <DomainControls />
        <div className="rule" />
      </>)}
      <RecoveryControls canPropose={roles.isRecoveryManager} />
      <div className="rule" />
      {roles.isPauser && <PauseControl config={config} refetch={refetch} />}
    </div>
  )
}

/* ---------- Snapshot ----------
   Single source of truth for every protocol-wide setting, from one
   getProtocolConfig() call (replaces ~7 separate eth_calls). */
function Snapshot({ config }) {
  const has = !!config
  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-8 pt-2">
      <Stat
        label="Protocol fee"
        value={<span className="num">{has ? `${(Number(config.protocolFeeBps) / 100).toFixed(2)}%` : '—'}</span>}
      />
      <Stat
        label="Max fee ceiling"
        value={<span className="num">{has ? `${(Number(config.maxProtocolFeeBps) / 100).toFixed(2)}%` : '—'}</span>}
        hint="Hard cap enforced on-chain"
      />
      <Stat
        label="CCTP forward fee"
        value={<span className="num">{has ? formatUSDC(config.cctpForwardFee) : '—'}</span>}
      />
      <Stat
        label="Paused"
        value={
          <span className={has && config.paused ? 'text-bad' : has ? 'text-ok' : ''}>
            {!has ? '—' : config.paused ? 'Yes' : 'No'}
          </span>
        }
      />
      <Stat
        label="Treasury"
        value={has ? <AddressDisplay address={config.protocolTreasury} /> : <span className="text-ink-3">—</span>}
      />
      <Stat
        label="USDC token"
        value={has ? <AddressDisplay address={config.usdc} /> : <span className="text-ink-3">—</span>}
      />
      <Stat
        label="Token messenger"
        value={has ? <AddressDisplay address={config.tokenMessenger} /> : <span className="text-ink-3">—</span>}
        hint="CCTP burn router"
      />
      <Stat
        label="Total escrows"
        value={<span className="num">{has ? String(config.escrowCount) : '—'}</span>}
        hint={has ? `Arc domain ${config.arcDomain}` : undefined}
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
function FeeControls({ config, refetch }) {
  const [bps, setBps] = useState('')
  const [tr, setTr] = useState('')
  const [cctpVal, setCctpVal] = useState('')

  const feeTx  = useTx({ onConfirmed: () => { refetch?.(); setBps('') } })
  const trTx   = useTx({ onConfirmed: () => { refetch?.(); setTr('') } })
  const cctpTx = useTx({ onConfirmed: () => { refetch?.(); setCctpVal('') } })

  const maxBps = config ? Number(config.maxProtocolFeeBps) : 1000
  const bpsValid = /^\d+$/.test(bps) && Number(bps) <= maxBps
  // setProtocolTreasury reverts ZeroAddress (sol:197).
  const trValid = isAddress(tr) && isNonZeroAddress(tr)
  const cctpValid = /^\d+$/.test(cctpVal)

  const currentFee = config ? `${(Number(config.protocolFeeBps) / 100).toFixed(2)}%` : '—'
  const currentCctp = config ? formatUSDC(config.cctpForwardFee) : '—'

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-10">
      <div className="flex flex-col gap-4 max-w-prose">
        <h2 className="display text-[28px] leading-tight text-ink">Protocol fee</h2>
        <p className="text-[13.5px] text-ink-2 leading-relaxed">
          Currently <span className="num text-ink">{currentFee}</span>. Basis points (199 = 1.99%). Applies only to escrows created after this call.
        </p>
        <Field label="New fee (bps)" helper={`0–${maxBps}`}>
          {(p) => <input {...p} type="number" min="0" max={maxBps} className="input num" value={bps} onChange={(e) => setBps(e.target.value.trim())} />}
        </Field>
        <div>
          <button
            className="btn-primary"
            disabled={!bpsValid || feeTx.isBusy}
            onClick={() => feeTx.run(escrowWrite('setProtocolFee', [BigInt(bps || 0)]), {
              loadingMessage: 'Set protocol fee.',
              confirm: protocolFeeConfirm({ currentBps: config?.protocolFeeBps, newBps: BigInt(bps || 0) })
            })}
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
            onClick={() => trTx.run(escrowWrite('setProtocolTreasury', [tr]), {
              loadingMessage: 'Set treasury.',
              confirm: protocolTreasuryConfirm({ currentTreasury: config?.protocolTreasury, newTreasury: tr })
            })}
          >
            {trTx.isBusy ? 'Working…' : 'Update treasury'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 max-w-prose md:col-span-2">
        <h2 className="display text-[28px] leading-tight text-ink">CCTP forwarding fee</h2>
        <p className="text-[13.5px] text-ink-2 leading-relaxed">
          Currently <span className="num text-ink">{currentCctp}</span>. Floor the contract uses for cross-chain releases. USDC base units (6 decimals; 1000000 = 1 USDC). Keep in sync with Circle's published forwarding fee.
        </p>
        <Field label="Fee (USDC base units)">
          {(p) => <input {...p} type="number" min="0" className="input num" value={cctpVal} onChange={(e) => setCctpVal(e.target.value.trim())} />}
        </Field>
        <div>
          <button
            className="btn-primary"
            disabled={!cctpValid || cctpTx.isBusy}
            onClick={() => cctpTx.run(escrowWrite('setCctpForwardFee', [BigInt(cctpVal || 0)]), {
              loadingMessage: 'Set CCTP fee.',
              confirm: cctpForwardFeeConfirm({ currentFee: config?.cctpForwardFee, newFee: BigInt(cctpVal || 0) })
            })}
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
                onClick={() => {
                  const confirm = domainConfirm({ domain: d, domainName: getDomainName(d), enabled: on })
                  return on
                    ? removeTx.run(escrowWrite('removeSupportedDomain', [d]), { loadingMessage: `Remove ${getDomainName(d)}.`, confirm })
                    : addTx.run(escrowWrite('addSupportedDomain', [d]), { loadingMessage: `Add ${getDomainName(d)}.`, confirm })
                }}
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

/* ---------- Recovery Controls ----------
   claimRefundCreditTransfer has no onlyRole — the contract gates it on
   msg.sender == proposed (:943), a specific address, not a role. So Claim is
   always rendered here, independent of `canPropose`. Gating it on
   isRecoveryManager (as this used to) locked out a nominee who happens to
   also hold some unrelated role (fee manager, domain manager, pauser,
   default admin): that wallet reaches Body rather than the no-role fallback
   below, and Body used to show RecoveryControls — and therefore Claim — only
   to recovery managers. There is no reverse index from nominee to source (see
   the no-role branch's comment in Gate()), so this cannot detect "is this
   wallet nominated anywhere" up front; unconditional visibility is the only
   way every nominee reaches the form regardless of what else they hold. */
function RecoveryControls({ canPropose }) {
  return (
    <section className="flex flex-col gap-6 max-w-prose">
      <div>
        <h2 className="display text-[28px] leading-tight text-ink">Recovery</h2>
        <p className="text-[13.5px] text-ink-2 leading-relaxed mt-2">
          Two-step emergency refund credit recovery. Step 1 (admin): propose the transfer. Step 2 (new owner): claim from their wallet.
        </p>
      </div>
      {canPropose && <ProposeRecovery />}
      <ClaimRecovery />
    </section>
  )
}

/* ---------- Two-step refund-credit recovery (M-03) ----------
 *
 * The highest-trust pair in the app: a RECOVERY_MANAGER moving somebody
 * else's balance. Read against TrancheProtocol.sol:918-954. Four things the
 * two halves do NOT share, none of which the panels currently say:
 *
 * 1. The amount is never fixed at propose time. proposeRefundCreditTransfer
 *    requires a non-zero balance (:924) but stores no amount — claim sweeps
 *    refundBalances[blacklistedWallet] as it stands at CLAIM (:945). Anything
 *    credited to that wallet during the 14-day window (a milestone refund
 *    landing in refundBalances[e.refundTo], a partial settlement, a mutual
 *    cancel) is swept too. The manager is authorising a sweep of a figure
 *    they cannot see and which can grow after they sign. Settled #4 records
 *    the full-balance sweep as intentional; the timing is the part nothing
 *    discloses.
 *
 * 2. Only propose is role-gated. claimRefundCreditTransfer has no onlyRole at
 *    all — the gate is msg.sender == proposed (:943). Two different
 *    audiences, so two different screens rather than a mirrored pair.
 *
 * 3. Expiry is enforced only on claim, at proposedAt + ARBITER_WINDOW = 14
 *    days (:71, :940). Propose writes the timestamp and never reads it. A
 *    stale proposal simply becomes unclaimable and is overwritable by a fresh
 *    propose (:926-927, unconditional).
 *
 * 4. F5 liveness silently cancels a pending proposal: withdrawRefund
 *    (:851-852) and transferRefundCredit (:897-898) both delete it for
 *    msg.sender. If the supposedly-frozen wallet does anything at all, the
 *    proposal evaporates and the claim reverts NoPendingRecovery — with no
 *    notification to either party.
 *
 * Shared by both, and the trap Settings.jsx already documents for
 * transferRefundCredit: neither moves USDC. Both only re-key an internal
 * balance, so the claimer still has to call withdrawRefund afterwards. */

export function proposeRecoveryConfirm({ from, to, balance, existingOwner, existingExpiry }) {
  // No `amount`. This call writes a pointer and a timestamp; a Total would
  // assert a sweep that happens in a different transaction, and would have to
  // invent a figure the contract never captures.
  const replacing = !!existingOwner && existingOwner !== ZERO_ADDRESS

  return {
    title: 'Propose a recovery destination',
    subtitle: "Names the wallet allowed to claim this balance. Nothing moves now — the proposed wallet has to claim it itself, which is what proves it is real and controlled.",
    contractName: 'Tranche Protocol Escrow',
    contractAddress: CONTRACT_ADDRESS,
    functionName: 'proposeRefundCreditTransfer',
    parameters: [
      `Restricted wallet: ${from}`,
      `Proposed destination: ${to}`,
      // Finding ①, and the single most important line here.
      `Balance today: ${formatUSDC(balance ?? 0n)} — the claim takes whatever the wallet holds at that moment, which may be more than this.`,
      replacing
        ? `Replaces the pending proposal to ${existingOwner}${existingExpiry ? `, which expires ${formatTimestamp(existingExpiry)}` : ''}. That wallet can no longer claim.`
        : 'No proposal is currently pending for this wallet.',
      'The proposed wallet has 14 days to claim. After that this expires and a new proposal is needed.',
      'If the restricted wallet withdraws or transfers its own credit first, this proposal is cancelled silently — neither party is notified.',
      'No funds move on this transaction.'
    ]
  }
}

export function claimRecoveryConfirm({ blacklisted, balance, expiry }) {
  return {
    title: 'Claim this refund credit',
    subtitle: "Moves the restricted wallet's entire refund credit to you. Only the wallet named in the proposal can do this.",
    // An amount, like transferRefundCredit: the whole credit changes hands and
    // becomes yours to withdraw. Read live, because the contract sweeps the
    // balance as it stands right now rather than a figure fixed at proposal.
    amount: balance,
    amountLabel: 'Credit claimed',
    contractName: 'Tranche Protocol Escrow',
    contractAddress: CONTRACT_ADDRESS,
    functionName: 'claimRefundCreditTransfer',
    parameters: [
      `Claiming from: ${blacklisted}`,
      'No USDC moves on this transaction — it re-keys who the credit belongs to.',
      'This does not put funds in your wallet. Withdraw the credit separately once it is yours.',
      ...(expiry ? [`Must be claimed by ${formatTimestamp(expiry)}. After that the proposal expires and this transaction is rejected.`] : []),
      'Only the wallet named in the proposal can claim; any other caller is rejected.'
    ]
  }
}

function ProposeRecovery() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [confirm, setConfirm] = useState(false)
  const tx = useTx({ onConfirmed: () => { setFrom(''); setTo(''); setConfirm(false) } })
  // Read-only: what the balance is now, and whether a proposal is already
  // standing for this wallet. Feeds the confirm screen only — nothing here
  // changes what is clickable except the loading gate below.
  //
  // Debounced so investigating a wallet is one lookup after typing stops, not
  // one per keystroke that happens to parse as an address.
  const lookupFrom = useDebouncedValue(from, RECOVERY_LOOKUP_DELAY_MS)
  const { balance, isLoading: balanceLoading, error: balanceError } = useRefundBalance(isAddress(lookupFrom) ? lookupFrom : undefined)
  const { proposedOwner, proposedAt, isLoading: recoveryLoading, error: recoveryError } = usePendingRecovery(isAddress(lookupFrom) ? lookupFrom : undefined)
  const readsPending = recoveryReadsPending({
    typed: from, debounced: lookupFrom, balanceLoading, recoveryLoading, balanceError, recoveryError
  })
  // Only worth surfacing once the failure belongs to what's currently typed —
  // while `from` is still catching up to `lookupFrom` the mismatch alone
  // already holds `readsPending`, and an error left over from a
  // since-abandoned lookup would be a stale complaint about a wallet the
  // admin isn't even looking at anymore.
  const readFailed = isAddress(from) && from === lookupFrom && !!(balanceError || recoveryError)

  // Submitting mid-read would show "0.00 USDC" and "no proposal is currently
  // pending" — both of which are what an unresolved read looks like, and both
  // of which are exactly wrong when the truth is a funded wallet with a
  // standing nomination about to be overwritten. The same check runs again on
  // the confirm-stage button below: `from`/`to` stay editable once the
  // confirmation panel is open, so `valid` has to be re-evaluated live at the
  // moment of signing rather than trusted from when the panel opened, or
  // editing the fields afterward (to an unread wallet, or to the zero
  // address) would slip past the checks that already run below.
  //
  // proposeRefundCreditTransfer reverts NothingToWithdraw when
  // refundBalances[blacklistedWallet] == 0 (:924). A successfully-resolved
  // zero balance is not a pending read — readsPending alone does not catch
  // it — so it needs its own check, same as the zero-address guard on `to`.
  const valid =
    isAddress(from) && isAddress(to) && isNonZeroAddress(to) &&
    from.toLowerCase() !== to.toLowerCase() && !readsPending && balance > 0n

  return (
    <div className="panel p-4 flex flex-col gap-3">
      <p className="eyebrow text-ink-2">Step 1 — Propose (admin)</p>
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
      {readFailed && (
        <p className="text-[12px] text-bad">
          Could not read this wallet's balance or pending proposal. Try again before proposing.
        </p>
      )}
      {!confirm ? (
        <div>
          <button className="btn-danger" disabled={!valid || tx.isBusy} onClick={() => setConfirm(true)}>
            Propose transfer
          </button>
        </div>
      ) : (
        <div className="panel border-bad p-4 flex flex-col gap-3">
          <p className="eyebrow text-bad">Confirm proposal</p>
          <p className="text-[13px] text-ink-2 leading-relaxed">
            Propose moving refund credit from <span className="num">{truncateAddr(from)}</span> to <span className="num">{truncateAddr(to)}</span>. The replacement wallet must then claim it.
          </p>
          <div className="flex gap-2">
            <button className="btn-quiet" onClick={() => setConfirm(false)} disabled={tx.isBusy}>Cancel</button>
            <button
              className="btn-danger"
              onClick={() => tx.run(escrowWrite('proposeRefundCreditTransfer', [from, to]), {
                loadingMessage: 'Submitting proposal…',
                confirm: proposeRecoveryConfirm({
                  from, to, balance, existingOwner: proposedOwner, existingExpiry: expiryOf(proposedAt)
                })
              })}
              disabled={!valid || tx.isBusy}
            >
              {tx.isBusy ? 'Submitting…' : 'Confirm proposal'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ClaimRecovery() {
  const { address: connected } = useAuth()
  const [blacklisted, setBlacklisted] = useState('')
  const [confirm, setConfirm] = useState(false)
  const tx = useTx({ onConfirmed: () => { setBlacklisted(''); setConfirm(false) } })

  // The claim sweeps the balance as it stands at claim time, so the figure on
  // the confirm screen has to be read live off the source wallet — not off
  // anything captured when the proposal was made.
  // Same debounce as step 1: the claim panel looks up the same two getters
  // against the same restricted wallet, so it leaks the same trail.
  const lookupAddr = useDebouncedValue(blacklisted, RECOVERY_LOOKUP_DELAY_MS)
  const { balance, isLoading: balanceLoading, error: balanceError } = useRefundBalance(isAddress(lookupAddr) ? lookupAddr : undefined)
  const { proposedOwner, proposedAt, isLoading: recoveryLoading, error: recoveryError } = usePendingRecovery(isAddress(lookupAddr) ? lookupAddr : undefined)
  const readsPending = recoveryReadsPending({
    typed: blacklisted, debounced: lookupAddr, balanceLoading, recoveryLoading, balanceError, recoveryError
  })
  const readFailed = isAddress(blacklisted) && blacklisted === lookupAddr && !!(balanceError || recoveryError)

  // claimRefundCreditTransfer has no onlyRole — the contract's only gate is
  // msg.sender == proposed (:943). A wallet that reads a standing proposal
  // for a DIFFERENT address is a guaranteed revert, same as submitting the
  // zero address on the propose side: worth stopping client-side rather than
  // paying gas to learn it on-chain. `proposedOwner` reads as the zero
  // address when nothing is pending (see proposeRecoveryConfirm's own
  // handling of the same getter), so that case is deliberately not treated
  // as a mismatch here — it is "nothing to claim yet", not "wrong wallet".
  const hasProposal = isAddress(proposedOwner) && proposedOwner !== ZERO_ADDRESS
  const nomineeMismatch = hasProposal && !!connected && proposedOwner.toLowerCase() !== connected.toLowerCase()

  // claimRefundCreditTransfer also reverts RecoveryProposalExpired once
  // block.timestamp passes proposedAt + ARBITER_WINDOW (:940-942).
  // expiryOf(proposedAt) was previously read only for display; a proposal
  // read as genuinely expired is just as much a guaranteed revert as a
  // mismatched nominee, so it gates the same way.
  const expiry = expiryOf(proposedAt)

  // `expired` is a plain const, recomputed on every render — but nothing
  // forces a render purely from time passing, so if the confirm panel is
  // opened on a valid proposal and the expiry boundary is crossed while it
  // sits there, this would otherwise stay stale (`valid` below stuck at
  // true) until some unrelated state change happens to re-render this
  // component. The unused state slot below exists only to give a render a
  // reason to happen at the actual boundary; see the effect below. It is a
  // proactive UI nicety, not what makes signing safe — the click handler on
  // the confirm button re-derives expiry from its own fresh timestamp
  // regardless of whether this timer has fired yet.
  const [, forceExpiryRecheck] = useState(0)
  const expired = hasProposal && isRecoveryExpired(expiry, Date.now())

  useEffect(() => {
    if (expiry === null) return
    const boundaryMs = (expiry - RECOVERY_EXPIRY_SAFETY_MARGIN_SECONDS) * 1000
    const remaining = boundaryMs - Date.now()
    if (remaining <= 0) return
    // Single scheduled wakeup at the exact boundary, same shape as
    // useAuth.jsx's SESSION_TTL_MS timer — not a poll.
    const t = setTimeout(() => forceExpiryRecheck((n) => n + 1), remaining)
    return () => clearTimeout(t)
  }, [expiry])

  // A mid-read submit shows a 0.00 Total on a call that sweeps the full
  // execution-time balance (:945), and drops the expiry line entirely. The
  // same check runs again on the confirm-stage button below — see the note
  // in ProposeRecovery on why `valid` cannot be trusted only at panel-open
  // time once the field stays editable underneath it.
  //
  // hasProposal is its own required condition, not folded into
  // nomineeMismatch: "nothing pending" (proposed == address(0), reverts
  // NoPendingRecovery at :937) and "wrong wallet" (reverts NotProposedOwner
  // at :941) are two different reasons to block, not one — nomineeMismatch
  // is deliberately false when there is no proposal at all (see its own
  // comment above), so without hasProposal here a genuine "nothing pending"
  // read would sail through as valid.
  const valid = isAddress(blacklisted) && !readsPending && hasProposal && !expired && !nomineeMismatch

  return (
    <div className="panel p-4 flex flex-col gap-3">
      <p className="eyebrow text-ink-2">Step 2 — Claim (replacement wallet)</p>
      <p className="text-[13px] text-ink-2 leading-relaxed">
        Connect as the replacement wallet, then enter the restricted wallet address to claim its refund credit.
      </p>
      <Field
        label="Restricted wallet"
        error={blacklisted && !isAddress(blacklisted) ? 'Not a valid address.' : undefined}
      >
        {(p) => (
          <input {...p} className="input num" placeholder="0x… (the restricted wallet from step 1)"
            autoComplete="off" spellCheck={false}
            value={blacklisted} onChange={(e) => setBlacklisted(e.target.value.trim())} disabled={tx.isBusy}
          />
        )}
      </Field>
      {readFailed && (
        <p className="text-[12px] text-bad">
          Could not read this wallet's balance or pending proposal. Try again before claiming.
        </p>
      )}
      {nomineeMismatch && (
        <p className="text-[12px] text-bad">
          This proposal names <span className="num">{truncateAddr(proposedOwner)}</span> as the wallet allowed to claim it — not the one you're connected with. Signing from this wallet will revert.
        </p>
      )}
      {!confirm ? (
        <div>
          <button className="btn-primary" disabled={!valid || tx.isBusy} onClick={() => setConfirm(true)}>
            Claim credit
          </button>
        </div>
      ) : (
        <div className="panel border-bad p-4 flex flex-col gap-3">
          <p className="eyebrow text-bad">Confirm claim</p>
          <p className="text-[13px] text-ink-2 leading-relaxed">
            Transfer refund credit from <span className="num">{truncateAddr(blacklisted)}</span> to your connected wallet.
          </p>
          <div className="flex gap-2">
            <button className="btn-quiet" onClick={() => setConfirm(false)} disabled={tx.isBusy}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => {
                // `valid` (and the `disabled` prop below) reflect the last
                // render, and the proactive timer above is best-effort — it
                // can itself race this click. Re-derive expiry from a
                // timestamp read right now, not whatever `valid` computed to
                // last, so a proposal that expired in the gap since the last
                // render cannot be signed regardless.
                const stillValid =
                  isAddress(blacklisted) && !readsPending && hasProposal &&
                  !nomineeMismatch && !isRecoveryExpired(expiry, Date.now())
                if (!stillValid) {
                  forceExpiryRecheck((n) => n + 1)
                  return
                }
                tx.run(escrowWrite('claimRefundCreditTransfer', [blacklisted]), {
                  loadingMessage: 'Claiming refund credit…',
                  confirm: claimRecoveryConfirm({ blacklisted, balance, expiry })
                })
              }}
              disabled={!valid || tx.isBusy}
            >
              {tx.isBusy ? 'Claiming…' : 'Confirm claim'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- Pause Control ---------- */
function PauseControl({ config, refetch }) {
  const tx = useTx({ onConfirmed: () => refetch?.() })
  const loaded = !!config
  const isPaused = !!config?.paused

  return (
    <section className="flex flex-col gap-4 max-w-prose">
      <h2 className="display text-[28px] leading-tight text-ink">Kill switch</h2>
      <p className="text-[13.5px] text-ink-2 leading-relaxed">
        Pause blocks new deposits but not release, refund, or dispute paths. Money never gets stuck behind it.
      </p>
      <div className="flex items-center gap-3">
        <span className={`status ${isPaused ? 'status-bad' : 'status-ok'}`}>
          {!loaded ? '—' : isPaused ? 'Paused' : 'Active'}
        </span>
      </div>
      <div>
        {isPaused ? (
          <button
            className="btn-primary"
            disabled={tx.isBusy || !loaded}
            onClick={() => tx.run(escrowWrite('unpause', []), {
              loadingMessage: 'Unpause.',
              confirm: pauseConfirm({ paused: isPaused })
            })}
          >
            {tx.isBusy ? 'Working…' : 'Unpause deposits'}
          </button>
        ) : (
          <button
            className="btn-danger"
            disabled={tx.isBusy || !loaded}
            onClick={() => tx.run(escrowWrite('pause', []), {
              loadingMessage: 'Pause.',
              confirm: pauseConfirm({ paused: isPaused })
            })}
          >
            {tx.isBusy ? 'Working…' : 'Pause deposits'}
          </button>
        )}
      </div>
    </section>
  )
}
