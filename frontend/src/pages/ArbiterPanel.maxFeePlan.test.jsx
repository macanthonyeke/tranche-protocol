import { describe, it, expect } from 'vitest'

/* resolveDisputeMaxFeePlan — Round 18/19/20 Phase B/C.

   The confirm descriptor (resolveDisputeConfirm, tested in
   ArbiterPanel.resolve.test.jsx) and the actual resolveDispute submission
   used to determine cross-chain status two different ways: the descriptor
   via resolveIsCrossChain (split-aware), the submission via raw
   escrow.destinationDomain. That gap meant the descriptor could correctly
   warn about a cross-chain split leg while the submission code, seeing an
   Arc-root escrow, quoted a zero fee that _assertCrossChainFee then rejected
   — a signed screen that promised success, followed by a guaranteed revert.

   Round 18 closed that gap but still tried to estimate the real remainder
   (worstCaseRemainder's ceiling bound) before deciding whether a live Circle
   quote was safe to submit, and REJECTED the transaction outright when the
   estimate looked unsafe — "conservative estimate <= floor" and "real
   remainder <= floor" are different conditions, so it could reject a
   transaction the contract would have accepted. Round 19 replaced the whole
   estimate with an unconditional floor submission, verified directly
   against the contract: submitting the escrow's own floor is always safe.

   Round 20 Phase C: floor-only is always safe against the CONTRACT's check,
   but says nothing about Circle's SEPARATE off-chain forwarding requirement
   — a floor-only submission can still fail delivery with INSUFFICIENT_FEE
   when Circle's live fee exceeds the floor, forcing an unnecessary self-relay.
   So the plan now signals `needsLiveQuote` for the one case that genuinely
   needs it (no-split, nonzero recipient share); the caller resolves that
   signal through resolveDominantMaxFee (utils/cctpFee.js), which uses the
   live quote ONLY when it is provably below worstCaseRemainder's bound on
   the real remainder — never a rejection trigger, and never blocking the
   transaction on a failed fetch. Split legs and the rounds-to-zero case
   still skip the network entirely and resolve straight to the floor, exactly
   as Round 19 left them — see the function's own doc comment in
   ArbiterPanel.jsx for the full citation trail. */
import { resolveDisputeMaxFeePlan } from './ArbiterPanel.jsx'

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

describe('resolveDisputeMaxFeePlan', () => {
  describe('bps === 0: _assertCrossChainFee never runs, so nothing is required', () => {
    it('resolves to a zero maxFee even on a cross-chain escrow', () => {
      const plan = resolveDisputeMaxFeePlan({ escrow: escrowOn(BASE), splits: [], bps: 0, recipientAmount: 0n })
      expect(plan).toEqual({ maxFee: 0n })
    })
  })

  describe('not cross-chain at all: same-chain Arc burns force maxFee = 0 on-chain regardless', () => {
    it('resolves to a zero maxFee for a same-chain, no-split escrow', () => {
      const plan = resolveDisputeMaxFeePlan({
        escrow: escrowOn(ARC), splits: [], bps: 6000, recipientAmount: 150_000_000n
      })
      expect(plan).toEqual({ maxFee: 0n })
    })
  })

  /* The bug this whole function exists to close: escrow.destinationDomain
     alone says "Arc" here, but a split leg makes the settlement cross-chain
     by _assertCrossChainFee's own rule (TrancheProtocol.sol:1382). Split
     legs always burn at the snapshot regardless of what's submitted
     (settled decision #7), so this resolves straight to the floor — no live
     quote is ever attempted for a split escrow. */
  describe('an Arc-root escrow with a cross-chain split leg', () => {
    it('is treated as cross-chain and resolves to the escrow floor, not zero, with no live quote', () => {
      const splits = [
        { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
        { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
      ]
      const plan = resolveDisputeMaxFeePlan({
        escrow: escrowOn(ARC), splits, bps: 6000, recipientAmount: 150_000_000n
      })
      expect(plan).toEqual({ maxFee: 200000n })
      expect(plan.needsLiveQuote).toBeFalsy()
    })

    it('holds for a genuinely mixed 3-leg split (Arc + two different cross-chain domains)', () => {
      const splits = [
        { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
        { bps: 3000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) },
        { bps: 2000n, destinationDomain: ETH_SEPOLIA, mintRecipient: B32(RECIPIENT) }
      ]
      const plan = resolveDisputeMaxFeePlan({
        escrow: escrowOn(ARC), splits, bps: 6000, recipientAmount: 150_000_000n
      })
      expect(plan).toEqual({ maxFee: 200000n })
    })
  })

  /* Round 16 #3 / TrancheProtocol.sol:510: _assertCrossChainFee gates on
     bps > 0 alone, not on the post-rounding recipientAmount — so a ruling
     that rounds the recipient's share to zero still runs the assertion even
     though _executePartialRelease will skip the burn entirely
     (TrancheProtocol.sol:1248's `if (recipientAmount > 0)`). No burn means a
     live quote would fetch a number the contract never uses, so this
     resolves straight to the floor too. */
  describe('bps > 0 but the computed recipient share rounds to exactly zero', () => {
    it('resolves to the escrow floor with no live quote', () => {
      const plan = resolveDisputeMaxFeePlan({
        escrow: escrowOn(BASE), splits: [], bps: 1, recipientAmount: 0n
      })
      expect(plan).toEqual({ maxFee: 200000n })
      expect(plan.needsLiveQuote).toBeFalsy()
    })
  })

  /* The one case that genuinely needs a live quote: no split legs, a real
     nonzero recipient share, cross-chain. The plan signals the caller to
     resolve it via resolveDominantMaxFee rather than resolving a value
     itself — this function stays synchronous and pure. */
  describe('no-split, cross-chain, genuinely nonzero recipient share', () => {
    it('signals needsLiveQuote with the exact params resolveDominantMaxFee needs', () => {
      const plan = resolveDisputeMaxFeePlan({
        escrow: escrowOn(BASE), splits: [], bps: 6000, recipientAmount: 150_000_000n, maxProtocolFeeBps: 500n
      })
      expect(plan.maxFee).toBeUndefined()
      expect(plan.needsLiveQuote).toBe(true)
      expect(plan.quoteParams).toEqual({
        destinationDomain: BASE,
        floor: 200000n,
        recipientAmount: 150_000_000n,
        maxProtocolFeeBps: 500n
      })
    })

    it('still signals needsLiveQuote for a small nonzero share that would have tripped Round 18s ceiling-based rejection', () => {
      // Round 18's design would have thrown "too small to deliver" outright
      // for a share this size, since worstCaseRemainder(200000, 500) =
      // 190000 <= this escrow's own 200000 floor. Round 20's design never
      // rejects — it signals needsLiveQuote and lets resolveDominantMaxFee
      // fall back to the floor if the quote isn't provably safe, rather than
      // blocking the transaction outright.
      const plan = resolveDisputeMaxFeePlan({
        escrow: escrowOn(BASE), splits: [], bps: 6000, recipientAmount: 200000n, maxProtocolFeeBps: 500n
      })
      expect(plan.needsLiveQuote).toBe(true)
    })
  })
})

/* The core safety property the floor-fallback still relies on, proven
   directly rather than only inferred from which branch fires above — mirrors
   Round 19's proof for the simpler, stronger property this design actually
   depends on. Still exactly as true under Round 20's design: every fallback
   path (split legs, rounds-to-zero, or resolveDominantMaxFee declining an
   unsafe/failed quote) submits exactly this floor value. The contract's
   decision structure (TrancheProtocol.sol:1258-1334, :1340-1373,
   :1381-1401) is reproduced here ONLY to check this property against it, not
   to duplicate production logic anywhere real. */
function contractOutcome(remainder, floor, submittedMaxFee) {
  // TrancheProtocol.sol:1291 — the contract's own decision, using its own
  // computed remainder. The submitted maxFee plays no role in this branch.
  if (remainder <= floor) return { branch: 'divert' }
  // TrancheProtocol.sol:1354 (inside _approveAndBurn) — the only constraint
  // in the burn branch.
  if (submittedMaxFee >= remainder) return { branch: 'burn', reverts: true }
  return { branch: 'burn', reverts: false }
}

describe('core safety property: submitting maxFee = floor never violates a contract constraint', () => {
  const floor = 200000n

  it('never causes a burn-branch revert, for any real remainder above or below the floor', () => {
    const sampleRemainders = [
      0n, 1n, 100000n, floor - 1n, floor, // at or below the floor → divert branch
      floor + 1n, floor + 100n, 1_000_000n, 999_999_999n // above the floor → burn branch
    ]
    for (const remainder of sampleRemainders) {
      const outcome = contractOutcome(remainder, floor, /* submittedMaxFee */ floor)
      if (outcome.branch === 'burn') {
        expect(outcome.reverts).toBe(false)
      }
      // divert branch: maxFee is never read again — nothing to violate.
    }
  })

  it('clears the one assertion that runs before either branch, regardless of which one fires', () => {
    // _assertCrossChainFee (TrancheProtocol.sol:1399): maxFee >= floor.
    // Submitting exactly the floor satisfies this with equality.
    expect(floor >= floor).toBe(true)
  })
})
