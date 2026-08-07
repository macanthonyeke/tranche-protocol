import { describe, it, expect } from 'vitest'

/* mutualCancel is two different transactions behind one button: the first
   party's call only writes an approval flag, the second party's call falls
   into the refund branch and cancels the escrow. The descriptor has to tell
   them apart, and it has to compute the refundable figure the way the
   contract does — PENDING milestones only, with IN_REVIEW/DISPUTED making the
   finalising call revert rather than refund. */
import { cancelEscrowConfirm } from './EscrowDetail.jsx'
import { buildContractInteraction } from '../utils/circleTheme.js'

const REFUND_TO = '0x179cc4c8f23d257b7f4acb785464025570e3af86'

// Milestone states, as normaliseMilestone yields them:
// PENDING 0, IN_REVIEW 1, DISPUTED 2, RELEASED 3, REFUNDED 4.
const PENDING = (amount) => ({ state: 0, amount })
const IN_REVIEW = (amount) => ({ state: 1, amount })
const DISPUTED = (amount) => ({ state: 2, amount })
const RELEASED = (amount) => ({ state: 3, amount })
const REFUNDED = (amount) => ({ state: 4, amount })

const escrow = { id: 7, refundTo: REFUND_TO, milestoneCount: 4, totalAmount: 400000000n }

const d = (milestones, otherApproved) =>
  cancelEscrowConfirm({ escrow, milestones, otherApproved })

const paramText = (x) => (x.parameters || []).join('\n')

describe('cancelEscrowConfirm — first party approving', () => {
  const ms = [PENDING(100000000n), PENDING(100000000n), RELEASED(100000000n), REFUNDED(100000000n)]

  /* This call writes a flag and returns (TrancheProtocol.sol:742-746). A Total
     here would put the refund figure on the one call that does not refund. */
  it('carries no amount, because this call moves nothing', () => {
    expect(d(ms, false)).not.toHaveProperty('amount')
    const built = buildContractInteraction(d(ms, false))
    expect(built).not.toHaveProperty('mainCurrency')
    expect(built).not.toHaveProperty('total')
  })

  it('says outright that no funds move', () => {
    expect(d(ms, false).parameters).toContain('No funds move on this transaction.')
  })

  it('still previews what would be refunded, phrased conditionally', () => {
    expect(paramText(d(ms, false)))
      .toContain('Would refund 200.00 USDC across 2 unstarted milestones once both parties approve.')
  })

  it('is titled as an approval, not as a cancellation', () => {
    expect(d(ms, false).title).toBe('Approve cancelling this escrow')
  })
})

describe('cancelEscrowConfirm — second party finalising', () => {
  const ms = [PENDING(100000000n), PENDING(50000000n), RELEASED(100000000n), REFUNDED(100000000n)]

  it('reports the refundable figure as the amount', () => {
    expect(d(ms, true).amount).toBe(150000000n)
    expect(d(ms, true).amountLabel).toBe('Amount refunded')
    expect(buildContractInteraction(d(ms, true)).total).toEqual(['150.00 USDC'])
  })

  /* The contract sums PENDING only (:755-757). Released milestones are already
     paid out and refunded ones already credited, so counting either would
     promise the payer money that does not exist. */
  it('counts PENDING milestones only, not total-minus-released', () => {
    expect(d([PENDING(10n), RELEASED(999n)], true).amount).toBe(10n)
    expect(d([PENDING(10n), REFUNDED(999n)], true).amount).toBe(10n)
    expect(d(ms, true).amount).not.toBe(escrow.totalAmount)
  })

  it('reports zero when nothing is left to refund', () => {
    const done = d([RELEASED(100n), REFUNDED(100n)], true)
    expect(done.amount).toBe(0n)
    expect(paramText(done)).toContain('0 of 4 milestones refunded')
  })

  it('says released milestones are not clawed back', () => {
    expect(d(ms, true).parameters).toContain('Already-released milestones are not clawed back.')
  })

  /* Same language as every other refund path in this app (Round 1's
     refundAfterDeadline and declineEscrow): the contract credits
     refundBalances, it does not transfer. */
  it('says credited to the refund address, not sent', () => {
    expect(paramText(d(ms, true))).toContain(`Credited to: ${REFUND_TO}`)
    expect(paramText(d(ms, true))).toMatch(/withdrawable refund balance on Arc/)
    expect(paramText(d(ms, true))).not.toMatch(/\bSent to:/)
  })

  it('states that no protocol fee is taken', () => {
    expect(d(ms, true).parameters).toContain('No protocol fee is taken.')
  })

  it('is titled as the cancellation it performs', () => {
    expect(d(ms, true).title).toBe('Cancel this escrow and refund the payer')
  })
})

/* The refund branch reverts with CannotCancelDuringDispute while any milestone
   is IN_REVIEW or DISPUTED (:752). A descriptor promising a refund there would
   describe a transaction that cannot succeed. */
describe.each([
  ['in review', IN_REVIEW(100000000n)],
  ['disputed', DISPUTED(100000000n)]
])('cancelEscrowConfirm — finalising blocked by a milestone %s', (_label, blocker) => {
  const ms = [PENDING(100000000n), blocker]

  it('promises no amount for a transaction that will revert', () => {
    expect(d(ms, true)).not.toHaveProperty('amount')
    expect(buildContractInteraction(d(ms, true))).not.toHaveProperty('mainCurrency')
  })

  it('says the transaction will not go through, and why', () => {
    expect(d(ms, true).subtitle).toMatch(/will not go through/)
    expect(paramText(d(ms, true))).toContain('Blocked by 1 milestone in review or disputed.')
  })

  /* Only the finalising call reaches the refund branch — the first party's
     approval succeeds regardless of milestone state. */
  it('does not block the first party from approving', () => {
    expect(d(ms, false).title).toBe('Approve cancelling this escrow')
    expect(paramText(d(ms, false))).not.toMatch(/Blocked by/)
  })
})

describe('cancelEscrowConfirm — wording and edge cases', () => {
  it('pluralises milestone counts', () => {
    expect(paramText(d([PENDING(1n)], false))).toContain('1 unstarted milestone once')
    expect(paramText(d([PENDING(1n), PENDING(1n)], false))).toContain('2 unstarted milestones once')
    expect(paramText(d([PENDING(1n), IN_REVIEW(1n)], true))).toContain('1 milestone in review')
    expect(paramText(d([IN_REVIEW(1n), DISPUTED(1n)], true))).toContain('2 milestones in review')
  })

  it('survives milestones being absent rather than crashing the signing flow', () => {
    expect(() => d(undefined, false)).not.toThrow()
    expect(() => d(undefined, true)).not.toThrow()
    expect(d(undefined, true).amount).toBe(0n)
  })

  it('names the real function in every branch', () => {
    for (const x of [d([PENDING(1n)], false), d([PENDING(1n)], true), d([IN_REVIEW(1n)], true)]) {
      expect(x.functionName).toBe('mutualCancel')
    }
  })
})
