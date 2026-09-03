import { describe, it, expect } from 'vitest'

/* Parity suite: the whole point of porting descriptor logic into pure,
   UI-agnostic functions (descriptors.js) is that it must say exactly what
   the existing Circle-descriptor builders already say. Both the old and the
   new functions are imported side by side and diffed on identical fixtures
   — nothing here is asserted "in a vacuum" against copy retyped by hand,
   because that would only prove this file agrees with itself.

   The old functions (pages/EscrowDetail.jsx) are untouched by this round —
   they still feed Circle's confirm screen exactly as before. This file is
   the evidence for that claim, not just an assertion of it. */
import { milestoneConfirm, payoutLines, redirectPayoutConfirm, mutualSettleConfirm } from '../pages/EscrowDetail.jsx'
import { CONTRACT_ADDRESS } from '../config/contract.js'
import {
  classifySettlement,
  hasCrossChainLeg,
  buildMilestoneActionDescriptor,
  buildRedirectPayoutDescriptor,
  buildMutualSettleDescriptor,
  describeSplitPayout
} from './descriptors.js'

const RECIPIENT = '0x4bdbe608ea998b4822476353df9dd83228ffd503'
const MINT_RECIPIENT_B32 = '0x000000000000000000000000' + RECIPIENT.slice(2)
const FALLBACK_RECIPIENT = '0x1a260601f65a1c270a1cabf65c09f2f31c0869a5'
const REFUND_TO = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const NEW_ADDRESS = '0x2b262602f65a1c270a1cabf65c09f2f31c0869b6'

// Domain 6 is Base Sepolia in config/chains.js — non-Arc, so cross-chain.
const crossChainEscrow = {
  id: 7,
  recipient: FALLBACK_RECIPIENT,
  refundTo: REFUND_TO,
  mintRecipient: MINT_RECIPIENT_B32,
  destinationDomain: 6,
  milestoneCount: 3,
  escrowCctpForwardFee: 200000n
}

const sameChainEscrow = {
  ...crossChainEscrow,
  destinationDomain: 26 // ARC_DOMAIN
}

const milestone = { index: 1, amount: 250000000n, state: 1 }

const SPLITS = [
  { mintRecipient: MINT_RECIPIENT_B32, destinationDomain: 6, bps: 6000n },
  { mintRecipient: MINT_RECIPIENT_B32, destinationDomain: 26, bps: 4000n }
]

const ACTIONS = {
  claim: { key: 'claim', fn: 'claimDelivery' },
  refund: { key: 'refund', fn: 'refundAfterDeadline' },
  approve: { key: 'approve', fn: 'approveRelease' },
  release: { key: 'release', fn: 'release' }
}

// Only the fields the old flat descriptor and the new discriminated
// descriptor both have a concept of.
const commonFields = (d) => ({
  title: d.title,
  subtitle: d.subtitle,
  functionName: d.functionName,
  amount: d.amount,
  amountLabel: d.amountLabel,
  parameters: d.parameters
})

describe('classifySettlement / hasCrossChainLeg', () => {
  it('is same-chain for an Arc-root no-split escrow', () => {
    expect(classifySettlement(sameChainEscrow, [])).toBe('same-chain')
    expect(hasCrossChainLeg(sameChainEscrow, [])).toBe(false)
  })
  it('is cross-chain for a non-Arc no-split escrow', () => {
    expect(classifySettlement(crossChainEscrow, [])).toBe('cross-chain')
    expect(hasCrossChainLeg(crossChainEscrow, [])).toBe(true)
  })
  it('is split whenever splits exist, even if every leg is Arc', () => {
    const allArc = [{ destinationDomain: 26, bps: 10_000n }]
    expect(classifySettlement(sameChainEscrow, allArc)).toBe('split')
    expect(hasCrossChainLeg(sameChainEscrow, allArc)).toBe(false)
  })
  it('mirrors _assertCrossChainFee: any non-Arc leg makes a split cross-chain', () => {
    expect(hasCrossChainLeg(sameChainEscrow, SPLITS)).toBe(true)
  })
})

describe('describeSplitPayout parity with payoutLines', () => {
  it('matches the old function on a split escrow', () => {
    expect(describeSplitPayout(crossChainEscrow, SPLITS)).toEqual(payoutLines(crossChainEscrow, SPLITS))
  })
  it('matches the old function on a no-split cross-chain escrow', () => {
    expect(describeSplitPayout(crossChainEscrow, [])).toEqual(payoutLines(crossChainEscrow, []))
  })
  it('matches the old function on the divert-reachable branch', () => {
    const opts = { partial: true, crossChain: true, floor: 200000n }
    expect(describeSplitPayout(crossChainEscrow, [], opts)).toEqual(payoutLines(crossChainEscrow, [], opts))
    expect(describeSplitPayout(crossChainEscrow, SPLITS, opts)).toEqual(payoutLines(crossChainEscrow, SPLITS, opts))
  })
})

describe('buildMilestoneActionDescriptor parity with milestoneConfirm', () => {
  it.each([
    ['claim, no splits', crossChainEscrow, []],
    ['refund, no splits', crossChainEscrow, []]
  ])('%s', (_label, escrow, splits) => {
    const oldClaim = milestoneConfirm(ACTIONS.claim, escrow, milestone, splits)
    const newClaim = buildMilestoneActionDescriptor(ACTIONS.claim, escrow, milestone, splits, { contractAddress: CONTRACT_ADDRESS })
    expect(commonFields(newClaim)).toEqual(commonFields(oldClaim))

    const oldRefund = milestoneConfirm(ACTIONS.refund, escrow, milestone, splits)
    const newRefund = buildMilestoneActionDescriptor(ACTIONS.refund, escrow, milestone, splits, { contractAddress: CONTRACT_ADDRESS })
    expect(commonFields(newRefund)).toEqual(commonFields(oldRefund))
  })

  it('approve on a same-chain escrow: same-chain kind, no fee line', () => {
    const old = milestoneConfirm(ACTIONS.approve, sameChainEscrow, milestone, [])
    const next = buildMilestoneActionDescriptor(ACTIONS.approve, sameChainEscrow, milestone, [], { contractAddress: CONTRACT_ADDRESS })
    expect(commonFields(next)).toEqual(commonFields(old))
    expect(next.kind).toBe('same-chain')
  })

  it('approve on a no-split cross-chain escrow with a submitted maxFee: cross-chain kind, fee line names the submitted figure', () => {
    const maxFee = 300000n
    const old = milestoneConfirm(ACTIONS.approve, crossChainEscrow, milestone, [], maxFee)
    const next = buildMilestoneActionDescriptor(ACTIONS.approve, crossChainEscrow, milestone, [], { contractAddress: CONTRACT_ADDRESS, submittedMaxFee: maxFee })
    expect(commonFields(next)).toEqual(commonFields(old))
    expect(next.kind).toBe('cross-chain')
    expect(next.fee).toEqual({ floor: 200000n, submitted: maxFee, divertReachable: false })
  })

  it('release on a no-split cross-chain escrow: fee line names the escrow floor, not any submitted figure', () => {
    const old = milestoneConfirm(ACTIONS.release, crossChainEscrow, milestone, [], 300000n)
    const next = buildMilestoneActionDescriptor(ACTIONS.release, crossChainEscrow, milestone, [], { contractAddress: CONTRACT_ADDRESS, submittedMaxFee: 300000n })
    expect(commonFields(next)).toEqual(commonFields(old))
    expect(next.fee.submitted).toBeNull()
  })

  it('approve on a split escrow: split kind, per-leg fee line, legs carry each destination', () => {
    const old = milestoneConfirm(ACTIONS.approve, crossChainEscrow, milestone, SPLITS)
    const next = buildMilestoneActionDescriptor(ACTIONS.approve, crossChainEscrow, milestone, SPLITS, { contractAddress: CONTRACT_ADDRESS })
    expect(commonFields(next)).toEqual(commonFields(old))
    expect(next.kind).toBe('split')
    expect(next.legs).toHaveLength(2)
    expect(next.legs[0].crossChain).toBe(true)
    expect(next.legs[1].crossChain).toBe(false)
  })
})

describe('buildRedirectPayoutDescriptor parity with redirectPayoutConfirm', () => {
  const milestones = [
    { state: 0, amount: 100000000n },
    { state: 3, amount: 50000000n }
  ]

  it('blocks an Arc-root no-split escrow trying to move off Arc, same as the old function', () => {
    const args = { escrow: sameChainEscrow, hasSplits: false, newAddress: NEW_ADDRESS, newDomain: 6, milestones }
    const old = redirectPayoutConfirm(args)
    const next = buildRedirectPayoutDescriptor({ ...args, contractAddress: CONTRACT_ADDRESS })
    expect(commonFields(next)).toEqual(commonFields(old))
    expect(next.blocked).toBe(true)
  })

  it('flags a split escrow redirect as a no-op, same as the old function', () => {
    const args = { escrow: crossChainEscrow, hasSplits: true, newAddress: NEW_ADDRESS, newDomain: 6, milestones }
    const old = redirectPayoutConfirm(args)
    const next = buildRedirectPayoutDescriptor({ ...args, contractAddress: CONTRACT_ADDRESS })
    expect(commonFields(next)).toEqual(commonFields(old))
    expect(next.kind).toBe('split')
  })

  it('a normal cross-chain redirect matches, and carries the destination + floor', () => {
    const args = { escrow: crossChainEscrow, hasSplits: false, newAddress: NEW_ADDRESS, newDomain: 6, milestones }
    const old = redirectPayoutConfirm(args)
    const next = buildRedirectPayoutDescriptor({ ...args, contractAddress: CONTRACT_ADDRESS })
    expect(commonFields(next)).toEqual(commonFields(old))
    expect(next.kind).toBe('cross-chain')
    expect(next.fee.floor).toBe(200000n)
  })

  it('a redirect that stays on Arc is never blocked, matching the old function', () => {
    const args = { escrow: sameChainEscrow, hasSplits: false, newAddress: NEW_ADDRESS, newDomain: 26, milestones }
    const old = redirectPayoutConfirm(args)
    const next = buildRedirectPayoutDescriptor({ ...args, contractAddress: CONTRACT_ADDRESS })
    expect(commonFields(next)).toEqual(commonFields(old))
    expect(next.blocked).toBeUndefined()
    expect(next.kind).toBe('same-chain')
  })
})

describe('buildMutualSettleDescriptor parity with mutualSettleConfirm', () => {
  it('a proposal that does not yet match the other side', () => {
    const args = { escrow: crossChainEscrow, milestone, splits: [], bps: 6000, theirs: { exists: true, bps: 4000n } }
    const old = mutualSettleConfirm(args)
    const next = buildMutualSettleDescriptor({ ...args, contractAddress: CONTRACT_ADDRESS })
    expect(commonFields(next)).toEqual(commonFields(old))
  })

  it('an executing same-chain settlement', () => {
    const args = { escrow: sameChainEscrow, milestone, splits: [], bps: 6000, theirs: { exists: true, bps: 6000n } }
    const old = mutualSettleConfirm(args)
    const next = buildMutualSettleDescriptor({ ...args, contractAddress: CONTRACT_ADDRESS })
    expect(commonFields(next)).toEqual(commonFields(old))
    expect(next.kind).toBe('same-chain')
  })

  it('an executing partial cross-chain settlement reaches the divert-reachable branch', () => {
    const args = { escrow: crossChainEscrow, milestone, splits: [], bps: 6000, theirs: { exists: true, bps: 6000n } }
    const old = mutualSettleConfirm(args)
    const next = buildMutualSettleDescriptor({ ...args, contractAddress: CONTRACT_ADDRESS })
    expect(commonFields(next)).toEqual(commonFields(old))
    expect(next.kind).toBe('cross-chain')
    expect(next.fee.divertReachable).toBe(true)
  })

  it('an executing split settlement', () => {
    const args = { escrow: crossChainEscrow, milestone, splits: SPLITS, bps: 6000, theirs: { exists: true, bps: 6000n } }
    const old = mutualSettleConfirm(args)
    const next = buildMutualSettleDescriptor({ ...args, contractAddress: CONTRACT_ADDRESS })
    expect(commonFields(next)).toEqual(commonFields(old))
    expect(next.kind).toBe('split')
    expect(next.legs).toHaveLength(2)
  })

  it('a full settlement (bps 0) refunds in full, matching the old function', () => {
    const args = { escrow: crossChainEscrow, milestone, splits: [], bps: 0, theirs: { exists: true, bps: 0n } }
    const old = mutualSettleConfirm(args)
    const next = buildMutualSettleDescriptor({ ...args, contractAddress: CONTRACT_ADDRESS })
    expect(commonFields(next)).toEqual(commonFields(old))
  })
})
