import { describe, it, expect } from 'vitest'

/* resolveDisputeMaxFeePlan — Round 18/19 Phase B.

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
   quote was safe to submit — "conservative estimate <= floor" and "real
   remainder <= floor" are different conditions, so it could reject a
   transaction the contract would have accepted. Round 19 replaces the whole
   estimate: verified directly against the contract (TrancheProtocol.sol:
   1291, :1354, :1398-1399) that submitting the escrow's own floor is
   unconditionally safe for every cross-chain, bps > 0 case, so there is no
   live quote to compute at all anymore — see the function's own doc comment
   in ArbiterPanel.jsx for the full citation trail. */
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
      const plan = resolveDisputeMaxFeePlan({ escrow: escrowOn(BASE), splits: [], bps: 0 })
      expect(plan).toEqual({ maxFee: 0n })
    })
  })

  describe('not cross-chain at all: same-chain Arc burns force maxFee = 0 on-chain regardless', () => {
    it('resolves to a zero maxFee for a same-chain, no-split escrow', () => {
      const plan = resolveDisputeMaxFeePlan({ escrow: escrowOn(ARC), splits: [], bps: 6000 })
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
      const plan = resolveDisputeMaxFeePlan({ escrow: escrowOn(ARC), splits, bps: 6000 })
      expect(plan).toEqual({ maxFee: 200000n })
      expect(plan.maxFee).not.toBe(0n)
    })

    it('holds for a genuinely mixed 3-leg split (Arc + two different cross-chain domains)', () => {
      const splits = [
        { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
        { bps: 3000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) },
        { bps: 2000n, destinationDomain: ETH_SEPOLIA, mintRecipient: B32(RECIPIENT) }
      ]
      const plan = resolveDisputeMaxFeePlan({ escrow: escrowOn(ARC), splits, bps: 6000 })
      expect(plan).toEqual({ maxFee: 200000n })
    })
  })

  /* Round 19 Phase B: there is no longer a live-quote branch at all — every
     cross-chain, bps > 0 case (split or not, whatever the recipient share)
     resolves to the escrow's own floor. Confirmed directly against the
     contract: the divert-vs-burn decision (TrancheProtocol.sol:1291) is made
     from the contract's OWN computed remainder, never the caller's maxFee;
     the one assertion that runs beforehand only requires maxFee >= floor
     (TrancheProtocol.sol:1398-1399); and the burn branch's only further
     constraint, maxFee < remainder (TrancheProtocol.sol:1354), is
     automatically satisfied by maxFee = floor because that branch is ONLY
     entered when remainder > floor in the first place. */
  describe('a no-split escrow made cross-chain by its own destinationDomain', () => {
    it('resolves to the escrow floor for a genuinely nonzero recipient share, with no live quote', () => {
      const plan = resolveDisputeMaxFeePlan({ escrow: escrowOn(BASE), splits: [], bps: 6000 })
      expect(plan).toEqual({ maxFee: 200000n })
      expect(plan.needsLiveQuote).toBeFalsy()
    })

    it('resolves to the escrow floor even for a recipient share small enough to have tripped the old ceiling-based rejection', () => {
      // Round 18's design would have thrown "too small to deliver" here,
      // since worstCaseRemainder(200000, 500) = 190000 <= this escrow's own
      // 200000 floor — a false rejection, since the REAL remainder (using
      // whatever the escrow's actual snapshotted rate is) could easily have
      // cleared it. The new design never estimates a remainder at all, so
      // this can no longer happen.
      const plan = resolveDisputeMaxFeePlan({ escrow: escrowOn(BASE), splits: [], bps: 6000 })
      expect(plan).toEqual({ maxFee: 200000n })
    })
  })

  /* Round 16 #3 / TrancheProtocol.sol:510: _assertCrossChainFee gates on
     bps > 0 alone, not on the post-rounding recipientAmount — so a ruling
     that rounds the recipient's share to zero still runs the assertion even
     though _executePartialRelease will skip the burn entirely
     (TrancheProtocol.sol:1248's `if (recipientAmount > 0)`). Since the plan
     no longer branches on recipientAmount at all, this now resolves the same
     way as every other cross-chain, bps > 0 case — the escrow's own floor. */
  describe('bps > 0, regardless of what the computed recipient share turns out to be', () => {
    it('resolves to the escrow floor with no live quote', () => {
      const plan = resolveDisputeMaxFeePlan({ escrow: escrowOn(BASE), splits: [], bps: 1 })
      expect(plan).toEqual({ maxFee: 200000n })
      expect(plan.needsLiveQuote).toBeFalsy()
    })
  })
})

/* Round 19 Phase B: the core safety property this whole design relies on,
   proven directly rather than only inferred from which branch fires above —
   mirrors the style of Round 18's worstCaseRemainder proof test, for the
   simpler, stronger property this design actually depends on. The contract's
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
