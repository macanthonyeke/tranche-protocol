/* Pure, wallet-agnostic confirm-screen domain logic — Round 1 of the custom
   confirmation flow (see useTransactionConfirm.js and adapters.js).

   Everything in this file is a straight port of reasoning that already
   existed, scattered across pages/EscrowDetail.jsx and pages/ArbiterPanel.jsx
   as Circle-descriptor builders (milestoneConfirm, payoutLines,
   redirectPayoutConfirm, mutualSettleConfirm, refundToLines,
   settlementIsCrossChain). Those functions still exist, still feed Circle's
   confirm screen through utils/circleTheme.js, and are UNTOUCHED by this
   file — see the parity tests in descriptors.test.js, which import both the
   old and new functions and diff their output on the same fixtures.

   The one real change is the output shape. The old functions each returned
   one flat object with a pile of always-optional fields (amount may or may
   not be set, a redirect may or may not be `blocked`, a split payout may or
   may not have per-leg fee caveats...) because Circle's ContractInteraction
   shape is itself flat. Stage A's design system needs to render same-chain,
   cross-chain, and split payouts differently on purpose — different
   affordances, different warnings — so guessing which fields apply from
   their presence/absence is exactly the kind of bug this round is trying to
   design out. Every builder below returns a discriminated union tagged by
   `kind`, and each kind carries only the fields that make sense for it. */

import { ARC_DOMAIN, getDomainName } from '../config/chains.js'
import { formatUSDC } from '../utils/format.js'
import { bytes32ToAddress } from '../utils/encode.js'

const BPS = 10_000n

/**
 * @typedef {'same-chain' | 'cross-chain' | 'split'} SettlementKind
 *
 * @typedef {Object} DescriptorBase
 * @property {SettlementKind} kind
 * @property {string} title
 * @property {string} subtitle
 * @property {string} functionName
 * @property {string} contractName
 * @property {string} contractAddress
 * @property {string[]} parameters
 * @property {bigint} [amount]
 * @property {string} [amountLabel]
 * @property {boolean} [blocked]      True when the caller can build this
 *                                    descriptor but the underlying call is
 *                                    known to revert (see
 *                                    buildRedirectPayoutDescriptor). Stage A
 *                                    disables proceed() when this is set;
 *                                    Round 1 only surfaces the flag.
 *
 * @typedef {DescriptorBase & { kind: 'same-chain' }} SameChainDescriptor
 *
 * @typedef {DescriptorBase & {
 *   kind: 'cross-chain',
 *   destinationChain: string,
 *   fee: { floor: bigint, submitted: bigint|null, divertReachable: boolean }
 * }} CrossChainDescriptor
 *
 * @typedef {DescriptorBase & {
 *   kind: 'split',
 *   legs: Array<{ index: number, bps: number, destinationChain: string, crossChain: boolean }>,
 *   divertReachable: boolean
 * }} SplitDescriptor
 *
 * @typedef {SameChainDescriptor | CrossChainDescriptor | SplitDescriptor} ConfirmDescriptor
 */

/* Mirrors _assertCrossChainFee (TrancheProtocol.sol) and its three existing
   frontend copies (EscrowDetail.jsx's settlementIsCrossChain,
   ArbiterPanel.jsx's resolveIsCrossChain — same body, never unified because
   each file was independently audited against the contract line it mirrors;
   Round 1 unifies them here instead, since a UI-agnostic module has no
   reason to keep the duplication). With splits configured, ANY non-Arc leg
   makes the settlement cross-chain — the escrow-level destinationDomain is
   not what the burn loop reads once splits exist. */
export function hasCrossChainLeg(escrow, splits) {
  if (splits?.length > 0) return splits.some((s) => Number(s.destinationDomain) !== ARC_DOMAIN)
  return Number(escrow?.destinationDomain) !== ARC_DOMAIN
}

/* The discriminated union's tag. Split-first, matching every existing
   descriptor's branch order (payoutLines, redirectPayoutConfirm,
   mutualSettleConfirm all check `splits?.length > 0` before ever looking at
   a domain) — a split escrow is a structurally different payout (multiple
   legs, independent per-leg outcomes) even when every leg happens to be on
   the same chain, so it is never folded into 'same-chain' or 'cross-chain'. */
export function classifySettlement(escrow, splits) {
  if (splits?.length > 0) return 'split'
  return hasCrossChainLeg(escrow, splits) ? 'cross-chain' : 'same-chain'
}

/* Port of EscrowDetail.jsx's refundToLines. refundAfterDeadline and a
   mutualSettle payer-share both credit e.refundTo, not necessarily the
   depositor's own wallet — see refundTo's own note in the contract. */
export function describeRefundTo(escrow) {
  const to = escrow?.refundTo
  if (!to) return []
  const lines = [`Credited to: ${to}`]
  const depositor = escrow?.depositor
  if (depositor && to.toLowerCase() !== depositor.toLowerCase()) {
    lines.push("That is this escrow's configured refund address, not the payer's own wallet.")
  }
  return lines
}

/* Port of EscrowDetail.jsx's releaseFeeLines. The two release paths do NOT
   pay the same forwarding fee: approveRelease hands the caller's submitted
   maxFee straight through and the no-split burn uses it; release() always
   substitutes the escrow's own snapshotted floor, since it is permissionless
   and a griefer could otherwise authorise Circle to consume almost the whole
   payout. Split legs always burn at the snapshot regardless of which path
   ran (settled decision #7). */
export function describeCrossChainFee({ escrow, splits, actionKey, submittedMaxFee }) {
  if (!hasCrossChainLeg(escrow, splits)) return []

  if (actionKey === 'approve' && (!splits || splits.length === 0) && submittedMaxFee !== undefined && submittedMaxFee !== null) {
    return [`Delivery costs up to ${formatUSDC(submittedMaxFee)} in Circle forwarding fees, deducted from the payout on arrival.`]
  }

  const floor = escrow?.escrowCctpForwardFee ?? 0n
  if (floor === 0n) return []

  if (splits?.length > 0) {
    return [`Each cross-chain split leg pays this escrow's fixed forwarding fee of up to ${formatUSDC(floor)}, deducted on delivery.`]
  }
  return [`Delivery costs up to this escrow's fixed forwarding fee of ${formatUSDC(floor)}, deducted from the payout on arrival.`]
}

/* Port of EscrowDetail.jsx's payoutLines. `partial`/`crossChain`/`floor` are
   optional context from a caller that knows whether Finding 3's sub-floor
   divert-to-Arc is reachable for THIS call — a full release can never hit
   it, by construction of the deposit-time F2 floor check plus the F3
   redirect guard. */
export function describeSplitPayout(escrow, splits, { partial = false, crossChain = false, floor = 0n } = {}) {
  if (splits?.length > 0) {
    const lines = [
      `${splits.length} configured split entries, by their configured share and destination chain`,
      'A recipient whose share rounds down to zero is paid nothing.'
    ]
    if (partial && crossChain) {
      lines.push(`Any cross-chain split leg whose nonzero share falls to ${formatUSDC(floor)} or less is credited on Arc instead of being delivered to its chain.`)
    }
    return lines
  }
  const addr = escrow.mintRecipient ? bytes32ToAddress(escrow.mintRecipient) : escrow.recipient
  const chainName = getDomainName(Number(escrow.destinationDomain))
  if (partial && crossChain) {
    return [
      `If this amount clears this escrow's forwarding-fee floor, it is paid to ${addr} on ${chainName}.`,
      `If it does not clear the floor, it is credited on Arc to ${escrow.recipient} instead — no cross-chain delivery.`
    ]
  }
  return [
    `Paid to: ${addr}`,
    `Paid on: ${chainName}`
  ]
}

/* Port of EscrowDetail.jsx's unreleasedExposure. A CEILING on what could
   still route through a redirected address, not a promise it will — a
   pending milestone can end in refund or mutual cancellation, a disputed one
   can award the freelancer nothing. Terminal states are RELEASED(3) and
   REFUNDED(4). Returns null (not 0) when the list is missing, so an unknown
   exposure prints nothing instead of a confident "0.00 USDC". */
export function unreleasedExposure(milestones) {
  if (!Array.isArray(milestones) || milestones.length === 0) return null
  return milestones
    .filter((m) => m.state !== 3 && m.state !== 4)
    .reduce((sum, m) => sum + BigInt(m.amount ?? 0n), 0n)
}

const REDIRECT_BLOCKED_REASON =
  'An escrow paying on Arc cannot be moved to another chain after deposit — its milestones were never checked against the cross-chain forwarding fee.'

/* ---------------------------------------------------------------------- *
 * Flagship builders — compose the pieces above into the discriminated
 * union every wallet-agnostic surface (Stage A) will render from.
 * ---------------------------------------------------------------------- */

const CONTRACT_NAME = 'Tranche Protocol Escrow'

/* Port of EscrowDetail.jsx's milestoneConfirm. Covers all four actions
   computeMilestoneAction can return: claimDelivery (no funds move),
   refundAfterDeadline (Arc-only credit, never cross-chain), approveRelease
   and release (the two release paths — see describeCrossChainFee for why
   they can't share one fee line).
   @param {{ key: 'claim'|'refund'|'approve'|'release', fn: string }} action
   @param {object} escrow
   @param {object} milestone
   @param {object[]} splits
   @param {{ contractAddress: string, submittedMaxFee?: bigint }} ctx
   @returns {ConfirmDescriptor}
*/
export function buildMilestoneActionDescriptor(action, escrow, milestone, splits, ctx = {}) {
  const { contractAddress, submittedMaxFee } = ctx
  const n = milestone.index + 1
  const of = Number(escrow.milestoneCount) || n
  const milestoneLine = `Milestone ${n} of ${of}: ${formatUSDC(milestone.amount)}`
  const base = {
    contractName: CONTRACT_NAME,
    contractAddress,
    functionName: action.fn
  }

  if (action.key === 'claim') {
    return {
      ...base,
      kind: 'same-chain',
      title: 'Mark this milestone as delivered',
      subtitle: "Starts the client's review window. If they don't dispute before it ends, the milestone can be released.",
      parameters: [milestoneLine, 'No funds move on this transaction.']
    }
  }

  if (action.key === 'refund') {
    return {
      ...base,
      kind: 'same-chain',
      title: 'Refund this milestone',
      subtitle: 'The deadline and its 72-hour grace period have both passed, so this milestone can be refunded. No protocol fee is taken.',
      amount: milestone.amount,
      amountLabel: 'Amount refunded',
      parameters: [
        milestoneLine,
        ...describeRefundTo(escrow),
        'Credited as a withdrawable refund balance on Arc, not sent to a wallet.'
      ]
    }
  }

  if (action.key === 'approve' || action.key === 'release') {
    const kind = classifySettlement(escrow, splits)
    const crossChain = hasCrossChainLeg(escrow, splits)
    const feeLines = describeCrossChainFee({ escrow, splits, actionKey: action.key, submittedMaxFee })
    const parameters = [
      milestoneLine,
      ...describeSplitPayout(escrow, splits),
      'Protocol fee is deducted from this amount before payout.',
      ...feeLines
    ]
    const title = action.key === 'approve' ? 'Approve and release this milestone' : 'Release this milestone'
    const subtitle = action.key === 'approve'
      ? 'Releases the milestone out of escrow to the freelancer. This cannot be undone.'
      : 'The review window closed without a dispute, so this milestone can now be released to the freelancer by anyone.'

    const shared = {
      ...base,
      title,
      subtitle,
      amount: milestone.amount,
      amountLabel: 'Amount released',
      parameters
    }

    if (kind === 'split') {
      return {
        ...shared,
        kind: 'split',
        legs: splits.map((s, index) => ({
          index,
          bps: Number(s.bps),
          destinationChain: getDomainName(Number(s.destinationDomain)),
          crossChain: Number(s.destinationDomain) !== ARC_DOMAIN
        })),
        // A full release/approve can never hit Finding 3's sub-floor divert —
        // deposit-time validation guarantees every leg's minimum share
        // already clears the floor. See EscrowDetail.jsx's payoutChainLabel
        // note on releaseMaxFeePlan for the full citation.
        divertReachable: false
      }
    }
    if (kind === 'cross-chain') {
      return {
        ...shared,
        kind: 'cross-chain',
        destinationChain: getDomainName(Number(escrow.destinationDomain)),
        fee: {
          floor: escrow.escrowCctpForwardFee ?? 0n,
          submitted: action.key === 'approve' ? (submittedMaxFee ?? null) : null,
          divertReachable: false
        }
      }
    }
    return { ...shared, kind: 'same-chain' }
  }

  console.warn(`No confirm descriptor for milestone action "${action.key}" — falling back to generic copy.`)
  return {
    ...base,
    kind: 'same-chain',
    title: 'Confirm this milestone action',
    subtitle: 'Check the details below, then confirm to sign.',
    parameters: [milestoneLine]
  }
}

/* Port of EscrowDetail.jsx's redirectPayoutConfirm (no-split escrow only —
   the has-splits "this setting no longer affects where money goes" branch
   and the mixed-domain redirect blocked check both port here too, since
   both ARE the "mixed-domain recovery messaging" this round's brief names
   explicitly). Mirrors :982's guard exactly, including the splits carve-out:
   with splits configured, e.destinationDomain is not what the burn uses, so
   the Arc-lock guard does not apply at the escrow level. */
export function buildRedirectPayoutDescriptor({ escrow, hasSplits, newAddress, newDomain, milestones, contractAddress }) {
  const exposure = unreleasedExposure(milestones)
  const oldAddress = escrow.mintRecipient ? bytes32ToAddress(escrow.mintRecipient) : escrow.recipient
  const oldDomain = Number(escrow.destinationDomain)
  const domain = Number(newDomain)
  const blocked = domain !== ARC_DOMAIN && oldDomain === ARC_DOMAIN && !hasSplits

  const base = {
    contractName: CONTRACT_NAME,
    contractAddress,
    functionName: 'updateReceivingAddress'
  }

  if (blocked) {
    return {
      ...base,
      kind: 'same-chain',
      blocked: true,
      title: 'Change where this escrow pays out',
      subtitle: 'This transaction will not go through.',
      parameters: [
        `Escrow #${escrow.id}`,
        `Requested: ${getDomainName(oldDomain)} → ${getDomainName(domain)}`,
        REDIRECT_BLOCKED_REASON,
        'You can still change the address while staying on Arc.'
      ]
    }
  }

  if (hasSplits) {
    return {
      ...base,
      kind: 'split',
      legs: [],
      divertReachable: false,
      title: 'Change where this escrow pays out',
      subtitle: 'This escrow pays through split recipients, so this setting no longer affects where money goes.',
      parameters: [
        `Escrow #${escrow.id}`,
        `Address: ${oldAddress} → ${newAddress}`,
        `Chain: ${getDomainName(oldDomain)} → ${getDomainName(domain)}`,
        'Payouts follow the split recipients, not this address. The transaction will succeed but no payment will change destination.',
        'To redirect your own share, use the split address row instead.'
      ]
    }
  }

  const parameters = [
    `Escrow #${escrow.id}`,
    `Address: ${oldAddress} → ${newAddress}`,
    `Chain: ${getDomainName(oldDomain)} → ${getDomainName(domain)}`,
    "Applies to every milestone not yet released and settled through approval, dispute resolution, or mutual agreement, including any currently in review. A milestone that times out with no arbiter ruling is the one exception — it always pays the escrow's original recipient, never this redirected address.",
    ...(exposure === null
      ? []
      : [`That is a ceiling of ${formatUSDC(exposure)} in gross principal, before the protocol fee, that could still route through this address — not a guarantee. A pending milestone can end in a refund or a mutual cancellation, and a disputed one can award the freelancer nothing.`]),
    'Milestones already released are unaffected and cannot be recalled.'
  ]

  const shared = {
    ...base,
    title: 'Change where this escrow pays out',
    subtitle: 'Redirects your milestone payments to a different address, effective immediately.',
    parameters
  }

  if (domain !== ARC_DOMAIN) {
    return {
      ...shared,
      kind: 'cross-chain',
      destinationChain: getDomainName(domain),
      fee: { floor: escrow.escrowCctpForwardFee ?? 0n, submitted: null, divertReachable: false }
    }
  }
  return { ...shared, kind: 'same-chain' }
}

/* Port of EscrowDetail.jsx's mutualSettleExecutes — pure prediction from a
   pre-submission `theirs` snapshot, used only for the confirm descriptor's
   copy (no receipt exists yet at signing time). */
export function mutualSettleExecutes(theirs, bps) {
  const theirBps = theirs?.exists ? Number(theirs.bps) : null
  return theirBps !== null && theirBps === bps
}

/* Port of EscrowDetail.jsx's mutualSettleConfirm. The richest of the three
   flagship builders: exercises split wording, partial-settlement
   fee/remainder reasoning (Finding 3's sub-floor divert), and the
   rounds-to-zero edge case, all in one call. */
export function buildMutualSettleDescriptor({ escrow, milestone, splits, bps, theirs, contractAddress }) {
  const n = milestone.index + 1
  const of = Number(escrow.milestoneCount) || n
  const pct = bps / 100
  const recipientShare = (milestone.amount * BigInt(bps)) / BPS
  const payerShare = milestone.amount - recipientShare
  const milestoneLine = `Milestone ${n} of ${of}: ${formatUSDC(milestone.amount)} in dispute`

  const base = {
    contractName: CONTRACT_NAME,
    contractAddress,
    functionName: 'mutualSettle'
  }

  const theirBps = theirs?.exists ? Number(theirs.bps) : null
  const matches = mutualSettleExecutes(theirs, bps)

  if (!matches) {
    return {
      ...base,
      kind: 'same-chain',
      title: 'Propose settling this dispute',
      subtitle: 'Records the split you are proposing. Nothing settles until both sides have proposed exactly the same percentage.',
      parameters: [
        milestoneLine,
        `You are proposing ${pct}% to the freelancer, ${100 - pct}% to the payer.`,
        `Would settle at ${formatUSDC(recipientShare)} to the freelancer before the protocol fee, and ${formatUSDC(payerShare)} credited as a refund balance.`,
        ...describeRefundTo(escrow),
        ...(theirBps !== null
          ? [`The other party has proposed ${theirBps / 100}%. The two numbers do not match, so nothing settles yet.`]
          : ['The other party has not proposed anything yet.']),
        'You can change your number later by proposing again.',
        'No funds move on this transaction.'
      ]
    }
  }

  const kind = classifySettlement(escrow, splits)
  const crossChain = hasCrossChainLeg(escrow, splits)
  const floor = escrow.escrowCctpForwardFee ?? 0n
  const partial = bps > 0 && bps < 10_000
  const recipientGetsPaid = bps > 0 && recipientShare > 0n
  const divertReachable = partial && crossChain

  const params = [
    milestoneLine,
    `Agreed split: ${pct}% to the freelancer, ${100 - pct}% to the payer.`
  ]
  if (bps > 0) params.push(`Freelancer's share: ${formatUSDC(recipientShare)} before the protocol fee`)
  if (bps < 10_000) params.push(`Payer's share: ${formatUSDC(payerShare)} — no protocol fee is taken on this half`)

  if (recipientGetsPaid) {
    params.push(...describeSplitPayout(escrow, splits, { partial, crossChain, floor }))
    if (splits?.length > 0) {
      if (!crossChain) {
        params.push('Each split leg with a nonzero share is transferred on Arc as this transaction executes.')
      } else {
        const hasArcLeg = splits.some((s) => Number(s.destinationDomain) === ARC_DOMAIN)
        const legClauses = []
        if (hasArcLeg) legClauses.push('Any Arc split leg with a nonzero share transfers immediately as part of this transaction.')
        if (divertReachable) {
          legClauses.push(
            "Any cross-chain split leg with a nonzero share that clears this escrow's forwarding-fee floor leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.",
            'Any cross-chain split leg with a nonzero share that does not clear the floor is credited on Arc instead, as part of this transaction (see above).'
          )
        } else {
          legClauses.push("Any cross-chain split leg with a nonzero share leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.")
        }
        params.push(legClauses.join(' '))
      }
    } else if (divertReachable) {
      params.push("If it clears this escrow's forwarding-fee floor, it leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant. If it does not clear the floor, nothing leaves Arc — it is credited there instead, as part of this transaction.")
    } else {
      params.push(
        crossChain
          ? "The freelancer's share leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant."
          : "The freelancer's share is transferred on Arc as this transaction executes."
      )
    }
    params.push("The protocol fee is taken from the freelancer's share only.")
  } else if (bps > 0) {
    params.push("This percentage rounds down to zero USDC at this milestone's amount, so nothing is actually paid to the freelancer despite the nonzero share.")
  } else {
    params.push('Nothing is paid to the freelancer. The milestone is refunded in full.')
  }

  if (bps < 10_000) {
    params.push(...describeRefundTo(escrow))
    params.push('Credited as a withdrawable refund balance on Arc, not sent to a wallet.')
  }
  if (crossChain && recipientGetsPaid) {
    if (divertReachable) {
      params.push(
        splits?.length > 0
          ? `Each cross-chain split leg that clears the floor costs up to this escrow's fixed forwarding fee of ${formatUSDC(floor)}, deducted from that leg's own share. Legs that do not clear the floor are not charged.`
          : `If it clears the floor, delivery costs up to this escrow's fixed forwarding fee of ${formatUSDC(floor)}. If it does not clear the floor, no delivery fee is charged.`
      )
    } else {
      params.push(
        splits?.length > 0
          ? `Each cross-chain split leg costs up to this escrow's fixed forwarding fee of ${formatUSDC(floor)}, set when it was funded and deducted from that leg's own share on arrival.`
          : `Cross-chain delivery costs up to this escrow's fixed forwarding fee of ${formatUSDC(floor)}, set when it was funded and taken from the freelancer's share on arrival.`
      )
    }
  }
  params.push('This cannot be undone.')

  const shared = {
    ...base,
    title: 'Settle this dispute now',
    subtitle: 'Both sides have proposed the same split, so signing settles the milestone now. Where each share goes, and when it actually arrives, is set out below.',
    amount: milestone.amount,
    amountLabel: 'Amount settled',
    parameters: params
  }

  if (kind === 'split') {
    return {
      ...shared,
      kind: 'split',
      legs: splits.map((s, index) => ({
        index,
        bps: Number(s.bps),
        destinationChain: getDomainName(Number(s.destinationDomain)),
        crossChain: Number(s.destinationDomain) !== ARC_DOMAIN
      })),
      divertReachable
    }
  }
  if (kind === 'cross-chain') {
    return {
      ...shared,
      kind: 'cross-chain',
      destinationChain: getDomainName(Number(escrow.destinationDomain)),
      fee: { floor, submitted: null, divertReachable }
    }
  }
  return { ...shared, kind: 'same-chain' }
}
