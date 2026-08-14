import { describe, it, expect } from 'vitest'

/* mutualSettleExecutes — Round 20 Phase B #6.

   SettlementPanel.propose used to write a post-submission delivery-tracking
   entry to localStorage whenever the mutualSettle CALL succeeded on-chain,
   not whenever it actually EXECUTED a settlement. The contract only executes
   when both sides' proposals match at the moment this call lands
   (TrancheProtocol.sol:549, dep.bps == rec.bps) — a proposal that doesn't
   match the other side's still succeeds as a transaction (it just records
   the proposal) but moves no funds and starts no CCTP delivery. Recording a
   tracker entry for that case leaves a stale tx hash the detail page polls
   forever.

   This is the same match check mutualSettleConfirm already used to decide
   its "would settle" vs. "settles now" copy — extracted so propose() and the
   confirm descriptor can't independently drift on what "will this execute"
   means. */
import { mutualSettleExecutes } from './EscrowDetail.jsx'

describe('mutualSettleExecutes', () => {
  it('is false when the other side has not proposed anything yet', () => {
    expect(mutualSettleExecutes({ exists: false }, 5000)).toBe(false)
    expect(mutualSettleExecutes(undefined, 5000)).toBe(false)
    expect(mutualSettleExecutes(null, 5000)).toBe(false)
  })

  it('is false when the other side proposed a different percentage', () => {
    expect(mutualSettleExecutes({ exists: true, bps: 4000n }, 5000)).toBe(false)
  })

  it('is true when the other side already proposed the exact same percentage', () => {
    expect(mutualSettleExecutes({ exists: true, bps: 5000n }, 5000)).toBe(true)
  })

  it('matches at the boundaries — 0% and 100%', () => {
    expect(mutualSettleExecutes({ exists: true, bps: 0n }, 0)).toBe(true)
    expect(mutualSettleExecutes({ exists: true, bps: 10_000n }, 10_000)).toBe(true)
  })

  it('handles a BigInt bps on the other side matching a Number bps being proposed', () => {
    // useSettlementProposals reads bps off-chain as a BigInt; propose()'s own
    // argument is a plain Number — the comparison has to work across both.
    expect(mutualSettleExecutes({ exists: true, bps: 3333n }, 3333)).toBe(true)
  })
})
