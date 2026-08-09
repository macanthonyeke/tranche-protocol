import { describe, it, expect, vi } from 'vitest'

/* resolveDisputeMaxFeePlan — Round 18 Phase B.

   The confirm descriptor (resolveDisputeConfirm, tested in
   ArbiterPanel.resolve.test.jsx) and the actual resolveDispute submission
   used to determine cross-chain status two different ways: the descriptor
   via resolveIsCrossChain (split-aware), the submission via raw
   escrow.destinationDomain. That gap meant the descriptor could correctly
   warn about a cross-chain split leg while the submission code, seeing an
   Arc-root escrow, quoted a zero fee that _assertCrossChainFee then rejected
   — a signed screen that promised success, followed by a guaranteed revert.

   This function is the fix: the synchronous decision of what to submit,
   extracted so it's testable without mocking a live Circle fetch (which this
   harness can't meaningfully do) or executing real Solidity. Three things
   matter here, each with its own test group below:
     1. it uses the SAME split-aware cross-chain determination the descriptor
        uses, not raw escrow.destinationDomain;
     2. it never silently resolves to a zero maxFee in a case where the
        contract's _assertCrossChainFee will demand a nonzero one;
     3. when a live Circle quote genuinely is needed, the burnAmount handed
        to it is the safe (worst-case) one, not a live-fee-drifted estimate. */
import { resolveDisputeMaxFeePlan } from './ArbiterPanel.jsx'
import { worstCaseRemainder, resolveMaxFee } from '../utils/cctpFee.js'

const ARC = 26
const BASE = 6
const ETH_SEPOLIA = 0

const RECIPIENT = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const B32 = (a) => '0x000000000000000000000000' + a.slice(2)

const escrowOn = (domain) => ({
  id: 7,
  destinationDomain: domain,
  escrowCctpForwardFee: 200000n // 0.20 USDC
})

const MAX_PROTOCOL_FEE_BPS = 500n

describe('resolveDisputeMaxFeePlan', () => {
  describe('bps === 0: _assertCrossChainFee never runs, so nothing is required', () => {
    it('resolves to a zero maxFee even on a cross-chain escrow', () => {
      const plan = resolveDisputeMaxFeePlan({
        escrow: escrowOn(BASE), splits: [], bps: 0, recipientAmount: 0n, maxProtocolFeeBps: MAX_PROTOCOL_FEE_BPS
      })
      expect(plan).toEqual({ maxFee: 0n })
    })
  })

  describe('not cross-chain at all: same-chain Arc burns force maxFee = 0 on-chain regardless', () => {
    it('resolves to a zero maxFee for a same-chain, no-split escrow', () => {
      const plan = resolveDisputeMaxFeePlan({
        escrow: escrowOn(ARC), splits: [], bps: 6000, recipientAmount: 150000000n, maxProtocolFeeBps: MAX_PROTOCOL_FEE_BPS
      })
      expect(plan).toEqual({ maxFee: 0n })
    })
  })

  /* The bug this whole function exists to close: escrow.destinationDomain
     alone says "Arc" here, but a split leg makes the settlement cross-chain
     by _assertCrossChainFee's own rule (TrancheProtocol.sol:1382). The old
     code would have resolved maxFee via the domain alone and submitted 0,
     which _assertCrossChainFee then rejects with MaxFeeBelowFloor. */
  describe('an Arc-root escrow with a cross-chain split leg', () => {
    it('is treated as cross-chain and resolves to the escrow floor, not zero', () => {
      const splits = [
        { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
        { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
      ]
      const plan = resolveDisputeMaxFeePlan({
        escrow: escrowOn(ARC), splits, bps: 6000, recipientAmount: 150000000n, maxProtocolFeeBps: MAX_PROTOCOL_FEE_BPS
      })
      expect(plan).toEqual({ maxFee: 200000n })
      expect(plan.maxFee).not.toBe(0n)
    })

    it('holds for a genuinely mixed 3-leg split (Arc + two different cross-chain domains)', () => {
      const splits = [
        { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
        { bps: 3000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) },
        { bps: 2000n, destinationDomain: ETH_SEPOLIA, mintRecipient: B32(RECIPIENT) }
      ]
      const plan = resolveDisputeMaxFeePlan({
        escrow: escrowOn(ARC), splits, bps: 6000, recipientAmount: 150000000n, maxProtocolFeeBps: MAX_PROTOCOL_FEE_BPS
      })
      expect(plan).toEqual({ maxFee: 200000n })
    })
  })

  /* Split legs always burn at the snapshot regardless of what's submitted
     (settled decision #7) — a live Circle quote here would fetch a number
     the contract never uses. Confirms the "already cross-chain via
     destinationDomain, and ALSO has splits" case takes the same floor path,
     not a live quote, purely because splits are configured. */
  describe('a no-split escrow made cross-chain by its own destinationDomain', () => {
    it('quotes Circle live when the recipient share is genuinely nonzero', () => {
      const recipientAmount = 150000000n
      const plan = resolveDisputeMaxFeePlan({
        escrow: escrowOn(BASE), splits: [], bps: 6000, recipientAmount, maxProtocolFeeBps: MAX_PROTOCOL_FEE_BPS
      })
      expect(plan.needsLiveQuote).toBe(true)
      expect(plan.quoteParams).toEqual({
        destinationDomain: BASE,
        escrowCctpForwardFee: 200000n,
        burnAmount: worstCaseRemainder(recipientAmount, MAX_PROTOCOL_FEE_BPS)
      })
    })

    /* The plan function's job stops at "this needs a live quote" — it hands
       the caller quoteParams and does not itself judge whether the amount is
       viable. resolveMaxFee is where that judgment happens
       (cctpFee.js:81-95): maxFee = max(liveQuote, floor) is ALWAYS >= floor,
       so whenever the worst-case burnAmount is at or below the floor,
       maxFee >= burnAmount holds no matter what Circle quotes — the function
       throws its existing clear error before ever returning a value. Both
       submission sites already catch that in their existing try/catch and
       surface it as a toast, so nothing wrong or unexplained reaches the
       wallet. This proves the full round-trip rather than assuming it. */
    it('produces a clean, catchable error — not a silently wrong maxFee — when the worst-case remainder is at or below the escrow floor', async () => {
      // 200000 is this fixture's escrowCctpForwardFee (the floor). At the
      // ceiling rate, worstCaseRemainder(200000, 500) = 190000 <= 200000.
      const recipientAmount = 200000n
      const plan = resolveDisputeMaxFeePlan({
        escrow: escrowOn(BASE), splits: [], bps: 6000, recipientAmount, maxProtocolFeeBps: MAX_PROTOCOL_FEE_BPS
      })
      expect(plan.needsLiveQuote).toBe(true)
      expect(worstCaseRemainder(recipientAmount, MAX_PROTOCOL_FEE_BPS)).toBeLessThanOrEqual(plan.quoteParams.escrowCctpForwardFee)

      // A low, harmless live quote — the throw fires purely because the
      // floor alone already exceeds burnAmount, regardless of what Circle
      // says, so this is not "engineering the mock to force the outcome."
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

  /* Round 16 #3 / TrancheProtocol.sol:510: _assertCrossChainFee gates on
     bps > 0 alone, not on the post-rounding recipientAmount — so a ruling
     that rounds the recipient's share to zero still runs the assertion even
     though _executePartialRelease will skip the burn entirely
     (TrancheProtocol.sol:1248's `if (recipientAmount > 0)`). The old code
     would compute burnAmount = 0 and resolveMaxFee's own zero-burnAmount
     shortcut would return 0 — which _assertCrossChainFee then rejects. */
  describe('bps > 0 but the computed recipient share rounds to zero', () => {
    it('still resolves to the escrow floor rather than zero, with no live quote', () => {
      const plan = resolveDisputeMaxFeePlan({
        escrow: escrowOn(BASE), splits: [], bps: 1, recipientAmount: 0n, maxProtocolFeeBps: MAX_PROTOCOL_FEE_BPS
      })
      expect(plan).toEqual({ maxFee: 200000n })
      expect(plan.needsLiveQuote).toBeFalsy()
    })
  })
})
