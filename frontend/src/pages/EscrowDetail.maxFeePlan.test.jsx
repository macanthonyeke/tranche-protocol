import { describe, it, expect, vi } from 'vitest'

/* releaseMaxFeePlan — Round 18 Phase B, the approveRelease/release twin of
   ArbiterPanel's resolveDisputeMaxFeePlan (see that file's test for the full
   background on the bug this closes). The confirm descriptor
   (milestoneConfirm) and the actual submission code used to determine
   cross-chain status two different ways — the descriptor via
   settlementIsCrossChain (split-aware), the submission via raw
   escrow.destinationDomain — so an Arc-root escrow with a cross-chain split
   leg would be quoted a zero fee and rejected by _assertCrossChainFee's
   split-aware check, after the confirm screen had already promised success.

   approveRelease and release() always pass the FULL milestone.amount — no
   bps scaling — so unlike resolveDispute there is no rounds-to-zero case
   here; that branch is exercised only in ArbiterPanel's test. */
import { releaseMaxFeePlan } from './EscrowDetail.jsx'
import { worstCaseRemainder, resolveMaxFee } from '../utils/cctpFee.js'

const ARC = 26
const BASE = 6

const RECIPIENT = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const B32 = (a) => '0x000000000000000000000000' + a.slice(2)

const escrowOn = (domain) => ({
  id: 7,
  destinationDomain: domain,
  escrowCctpForwardFee: 200000n // 0.20 USDC
})

const MAX_PROTOCOL_FEE_BPS = 500n
const MILESTONE_AMOUNT = 250000000n // 250 USDC

describe('releaseMaxFeePlan', () => {
  it('resolves to a zero maxFee for a same-chain, no-split escrow', () => {
    const plan = releaseMaxFeePlan({
      escrow: escrowOn(ARC), splits: [], milestoneAmount: MILESTONE_AMOUNT, maxProtocolFeeBps: MAX_PROTOCOL_FEE_BPS
    })
    expect(plan).toEqual({ maxFee: 0n })
  })

  /* The bug this function exists to close: escrow.destinationDomain alone
     says "Arc", but a split leg makes the settlement cross-chain by
     _assertCrossChainFee's own rule (TrancheProtocol.sol:1382). The old code
     would have resolved maxFee via the domain alone and submitted 0, which
     _assertCrossChainFee then rejects with MaxFeeBelowFloor. */
  it('treats an Arc-root escrow with a cross-chain split leg as cross-chain, and resolves to the escrow floor', () => {
    const splits = [
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
    ]
    const plan = releaseMaxFeePlan({
      escrow: escrowOn(ARC), splits, milestoneAmount: MILESTONE_AMOUNT, maxProtocolFeeBps: MAX_PROTOCOL_FEE_BPS
    })
    expect(plan).toEqual({ maxFee: 200000n })
    expect(plan.maxFee).not.toBe(0n)
  })

  /* Split legs always burn at the snapshot regardless of what's submitted
     (settled decision #7) — a live Circle quote here would fetch a number
     the contract never uses, even when the escrow's OWN domain already
     makes it cross-chain (not just via a split leg). */
  it('resolves to the escrow floor for any cross-chain split, with no live quote', () => {
    const splits = [
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
    ]
    const plan = releaseMaxFeePlan({
      escrow: escrowOn(BASE), splits, milestoneAmount: MILESTONE_AMOUNT, maxProtocolFeeBps: MAX_PROTOCOL_FEE_BPS
    })
    expect(plan).toEqual({ maxFee: 200000n })
    expect(plan.needsLiveQuote).toBeFalsy()
  })

  it('quotes Circle live for a no-split cross-chain escrow, using the worst-case burn amount', () => {
    const plan = releaseMaxFeePlan({
      escrow: escrowOn(BASE), splits: [], milestoneAmount: MILESTONE_AMOUNT, maxProtocolFeeBps: MAX_PROTOCOL_FEE_BPS
    })
    expect(plan.needsLiveQuote).toBe(true)
    expect(plan.quoteParams).toEqual({
      destinationDomain: BASE,
      escrowCctpForwardFee: 200000n,
      burnAmount: worstCaseRemainder(MILESTONE_AMOUNT, MAX_PROTOCOL_FEE_BPS)
    })
  })

  /* The plan function's job stops at "this needs a live quote" — it hands the
     caller quoteParams and does not itself judge whether the amount is
     viable. resolveMaxFee is where that judgment happens (cctpFee.js:81-95):
     maxFee = max(liveQuote, floor) is ALWAYS >= floor, so whenever the
     worst-case burnAmount is at or below the floor, maxFee >= burnAmount
     holds no matter what Circle quotes — the function throws its existing
     clear error before ever returning a value. MilestoneAction's existing
     try/catch already surfaces that as a toast, so nothing wrong or
     unexplained reaches the wallet. This proves the full round-trip rather
     than assuming it. */
  it('produces a clean, catchable error — not a silently wrong maxFee — when the worst-case remainder is at or below the escrow floor', async () => {
    // 200000 is this fixture's escrowCctpForwardFee (the floor). At the
    // ceiling rate, worstCaseRemainder(200000, 500) = 190000 <= 200000.
    const tinyMilestoneAmount = 200000n
    const plan = releaseMaxFeePlan({
      escrow: escrowOn(BASE), splits: [], milestoneAmount: tinyMilestoneAmount, maxProtocolFeeBps: MAX_PROTOCOL_FEE_BPS
    })
    expect(plan.needsLiveQuote).toBe(true)
    expect(worstCaseRemainder(tinyMilestoneAmount, MAX_PROTOCOL_FEE_BPS)).toBeLessThanOrEqual(plan.quoteParams.escrowCctpForwardFee)

    // A low, harmless live quote — the throw fires purely because the floor
    // alone already exceeds burnAmount, regardless of what Circle says, so
    // this is not "engineering the mock to force the outcome."
    const originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([{ finalityThreshold: 2000, forwardFee: { high: '1' } }])
    })
    try {
      await expect(resolveMaxFee(plan.quoteParams)).rejects.toThrow(
        'This payout is too small to deliver on another chain — increase the milestone amount or choose Arc as the destination.'
      )
    } finally {
      global.fetch = originalFetch
    }
  })
})
