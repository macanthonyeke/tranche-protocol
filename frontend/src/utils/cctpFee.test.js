import { describe, it, expect } from 'vitest'

/* worstCaseRemainder — the arithmetic Round 18 Phase B's submission-side fix
   depends on for fund safety, so it gets tested directly rather than only
   inferred from which code path fires.

   escrowFeeBps (the per-escrow snapshot the contract actually deducts,
   TrancheProtocol.sol:1268) has no getter, so the frontend cannot read the
   real rate for a given escrow. What it CAN read is maxProtocolFeeBps
   (getProtocolConfig().maxProtocolFeeBps, mirroring the contract's hardcoded
   MAX_PROTOCOL_FEE = 500 at TrancheProtocol.sol:23) — an immutable ceiling
   every escrow's snapshot was checked against at set time
   (TrancheProtocol.sol:191's `if (_newFeeBps > MAX_PROTOCOL_FEE) revert`).
   Because the real rate can never exceed the ceiling, the real fee can never
   exceed the ceiling-based fee, so this function's output is a proven lower
   bound on the real remainder — never an upper bound, never a guess. */
import { worstCaseRemainder } from './cctpFee.js'

const MAX_PROTOCOL_FEE_BPS = 500n // mirrors TrancheProtocol.sol:23

// What the contract itself computes for a given (real) snapshotted rate —
// TrancheProtocol.sol:1268-1271's `fee`/`remainder` arithmetic, reproduced
// here only to check worstCaseRemainder against it, not to duplicate
// production logic.
const actualRemainder = (amount, feeBps) => {
  const fee = (amount * feeBps) / 10_000n
  return amount - fee
}

describe('worstCaseRemainder', () => {
  it('is a proven lower bound on the actual remainder for every legal snapshot rate', () => {
    // Every bps the contract could ever have snapshotted for an escrow: 0
    // through the ceiling itself, inclusive, plus points in between.
    const sampleRates = [0n, 1n, 100n, 199n, 300n, 499n, 500n]
    const sampleAmounts = [1n, 999n, 1_000_000n, 250_000_000n, 999_999_999n]

    for (const amount of sampleAmounts) {
      for (const realBps of sampleRates) {
        const worstCase = worstCaseRemainder(amount, MAX_PROTOCOL_FEE_BPS)
        const actual = actualRemainder(amount, realBps)
        expect(worstCase).toBeLessThanOrEqual(actual)
      }
    }
  })

  it('is exactly equal to the actual remainder at the ceiling rate itself', () => {
    // The one point where "lower bound" and "actual" must coincide exactly —
    // an escrow funded at the maximum legal rate. Confirms this isn't an
    // arbitrarily-padded margin; it is the ceiling's own arithmetic.
    const amount = 250_000_000n
    expect(worstCaseRemainder(amount, MAX_PROTOCOL_FEE_BPS)).toBe(actualRemainder(amount, MAX_PROTOCOL_FEE_BPS))
  })

  it('is strictly less than the gross amount whenever the ceiling is nonzero', () => {
    // A worst case of "no fee at all" would silently defeat the whole point —
    // the fee must actually be subtracted, not floored at the full amount.
    expect(worstCaseRemainder(250_000_000n, MAX_PROTOCOL_FEE_BPS)).toBeLessThan(250_000_000n)
  })

  it('defaults to the contract ceiling (500 bps), not zero, when maxProtocolFeeBps is unavailable', () => {
    // getProtocolConfig() can still be loading when a signer submits fast.
    // Defaulting to 0 would assume no fee at all — the UNSAFE direction,
    // since it would overestimate the remainder and reproduce the exact bug
    // this function exists to close. Defaulting to the ceiling stays safe.
    const amount = 250_000_000n
    expect(worstCaseRemainder(amount, undefined)).toBe(worstCaseRemainder(amount, MAX_PROTOCOL_FEE_BPS))
    expect(worstCaseRemainder(amount, undefined)).toBeLessThanOrEqual(actualRemainder(amount, 0n))
  })

  it('returns the full amount when the ceiling itself is zero', () => {
    expect(worstCaseRemainder(250_000_000n, 0n)).toBe(250_000_000n)
  })
})
