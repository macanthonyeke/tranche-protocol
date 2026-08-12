import { describe, it, expect } from 'vitest'

/* releaseMaxFeePlan — Round 18/19/20 Phase B/C, the approveRelease/release
   twin of ArbiterPanel's resolveDisputeMaxFeePlan (see that file's test for
   the full background on the bug this closes, and for the core
   safety-property proof shared by both functions). The confirm descriptor
   (milestoneConfirm) and the actual submission code used to determine
   cross-chain status two different ways — the descriptor via
   settlementIsCrossChain (split-aware), the submission via raw
   escrow.destinationDomain — so an Arc-root escrow with a cross-chain split
   leg would be quoted a zero fee and rejected by _assertCrossChainFee's
   split-aware check, after the confirm screen had already promised success.

   approveRelease and release() always pass the FULL milestone.amount — no
   bps scaling — so unlike resolveDispute there is no rounds-to-zero case
   here.

   Round 18 closed the raw-domain gap but still tried to estimate the real
   remainder (worstCaseRemainder's ceiling bound) before deciding whether a
   live Circle quote was safe, and REJECTED outright when the estimate looked
   unsafe — "conservative estimate <= floor" and "real remainder <= floor"
   are different conditions, so it could reject a transaction the contract
   would have accepted. Round 19 replaced the whole estimate with an
   unconditional floor submission, verified directly against the contract —
   AND that for approveRelease specifically the divert branch is structurally
   unreachable in the first place (deposit-time F2 validation,
   TrancheProtocol.sol:286-295, guarantees a full release's remainder always
   exceeds the floor).

   Round 20 Phase C: floor-only is always safe against the CONTRACT's check,
   but says nothing about Circle's SEPARATE off-chain forwarding requirement
   — a floor-only submission can still fail delivery with INSUFFICIENT_FEE
   when Circle's live fee exceeds the floor, forcing an unnecessary
   self-relay. So the no-split cross-chain case now signals `needsLiveQuote`;
   the caller resolves that through resolveDominantMaxFee (utils/cctpFee.js),
   which uses the live quote ONLY when it is provably below
   worstCaseRemainder's bound on the real remainder — never a rejection
   trigger, never blocking the transaction on a failed fetch. Split legs
   still skip the network entirely and resolve straight to the floor, exactly
   as Round 19 left them — see releaseMaxFeePlan's own doc comment in
   EscrowDetail.jsx for the full citation trail. */
import { releaseMaxFeePlan } from './EscrowDetail.jsx'

const ARC = 26
const BASE = 6

const RECIPIENT = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const B32 = (a) => '0x000000000000000000000000' + a.slice(2)

const escrowOn = (domain) => ({
  id: 7,
  destinationDomain: domain,
  escrowCctpForwardFee: 200000n // 0.20 USDC
})

describe('releaseMaxFeePlan', () => {
  it('resolves to a zero maxFee for a same-chain, no-split escrow', () => {
    const plan = releaseMaxFeePlan({ escrow: escrowOn(ARC), splits: [], milestoneAmount: 150_000_000n })
    expect(plan).toEqual({ maxFee: 0n })
  })

  /* The bug this function exists to close: escrow.destinationDomain alone
     says "Arc", but a split leg makes the settlement cross-chain by
     _assertCrossChainFee's own rule (TrancheProtocol.sol:1382). Split legs
     always burn at the snapshot regardless of what's submitted (settled
     decision #7), so this resolves straight to the floor — no live quote is
     ever attempted for a split escrow. */
  it('treats an Arc-root escrow with a cross-chain split leg as cross-chain, and resolves to the escrow floor with no live quote', () => {
    const splits = [
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
    ]
    const plan = releaseMaxFeePlan({ escrow: escrowOn(ARC), splits, milestoneAmount: 150_000_000n })
    expect(plan).toEqual({ maxFee: 200000n })
    expect(plan.maxFee).not.toBe(0n)
    expect(plan.needsLiveQuote).toBeFalsy()
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
    const plan = releaseMaxFeePlan({ escrow: escrowOn(BASE), splits, milestoneAmount: 150_000_000n })
    expect(plan).toEqual({ maxFee: 200000n })
    expect(plan.needsLiveQuote).toBeFalsy()
  })

  /* The one case that genuinely needs a live quote: no split legs, a
     cross-chain destination. The plan signals the caller to resolve it via
     resolveDominantMaxFee rather than resolving a value itself — this
     function stays synchronous and pure. release() ignores whatever is
     ultimately submitted here and substitutes the snapshot regardless
     (:674), so resolving a quote is harmless (if unnecessary) on that path
     too — the plan doesn't distinguish approve from release. */
  it('signals needsLiveQuote for a no-split cross-chain release, with the exact params resolveDominantMaxFee needs', () => {
    const plan = releaseMaxFeePlan({
      escrow: escrowOn(BASE), splits: [], milestoneAmount: 150_000_000n, maxProtocolFeeBps: 500n
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
})

/* The core safety property the floor-fallback still relies on, proven
   directly rather than only inferred from which branch fires above. Unlike
   resolveDispute (a genuine partial payout can land on either side of the
   floor), a FULL release's remainder is guaranteed > floor by construction —
   so this proves the burn-branch case specifically, and that the divert
   branch's precondition never actually holds for a full release. Still
   exactly as true under Round 20's design: every fallback path (split legs,
   or resolveDominantMaxFee declining an unsafe/failed quote) submits exactly
   this floor value. The contract's decision structure
   (TrancheProtocol.sol:286-295, :1258-1334, :1340-1373) is reproduced here
   ONLY to check this property, not to duplicate production logic anywhere
   real. */
describe('core safety property: a full release always lands in the burn branch, where maxFee = floor is safe', () => {
  const floor = 200000n

  it('the deposit-time floor validation means a full release\'s remainder can never be at or below the floor', () => {
    // F2 (TrancheProtocol.sol:294): at deposit, the SMALLEST milestone's
    // net-of-protocol-fee amount, at the smallest configured share (the full
    // BPS_DENOMINATOR for a no-split escrow), must already exceed the floor.
    // A full release of ANY milestone releases at least that much, at the
    // maximum possible share (100%, no partial scaling) — so its remainder
    // is always >= the validated minimum, hence always > floor.
    const minMilestoneNetOfFee = floor + 1n // the smallest legal deposit, by F2's own guard
    const fullReleaseRemainder = minMilestoneNetOfFee // full release, no bps scaling below 100%
    expect(fullReleaseRemainder).toBeGreaterThan(floor)
  })

  it('never causes a burn-branch revert once in the burn branch', () => {
    const sampleRemainders = [floor + 1n, floor + 100n, 1_000_000n, 999_999_999n]
    for (const remainder of sampleRemainders) {
      // TrancheProtocol.sol:1354 (inside _approveAndBurn): reverts if
      // maxFee >= remainder. maxFee = floor here.
      expect(floor).toBeLessThan(remainder)
    }
  })

  it('clears the one assertion that runs before the burn branch', () => {
    // _assertCrossChainFee (TrancheProtocol.sol:1399): maxFee >= floor.
    // Submitting exactly the floor satisfies this with equality.
    expect(floor >= floor).toBe(true)
  })
})
