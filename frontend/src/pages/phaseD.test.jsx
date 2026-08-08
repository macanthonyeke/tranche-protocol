import { describe, it, expect } from 'vitest'

/* Phase D #18 — figures the app had already loaded and then dropped before the
   signing screen.

   Different failure from Phase C's. Nothing here was false; each descriptor
   made a true statement with the number filed off — "the review window", "the
   arbitration window", "every milestone not yet released". True, and useless
   for deciding whether to sign, because the quantity is exactly what varies.
   In all three cases the value was already in scope one or two frames up. */
import {
  milestoneConfirm,
  raiseDisputeConfirm,
  redirectPayoutConfirm,
  redirectSplitConfirm,
  unreleasedExposure
} from './EscrowDetail.jsx'

const ARC = 26
const BASE = 6
const DAY = 24 * 60 * 60

const RECIPIENT = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const REFUND_TO = '0x4bdbe608ea998b4822476353df9dd83228ffd503'
const NEW_ADDR = '0x8ba1f109551bd432803012645ac136ddd64dba72'
const B32 = (a) => '0x000000000000000000000000' + a.slice(2)

const escrowOn = (domain, over = {}) => ({
  id: 7,
  milestoneCount: 3,
  recipient: RECIPIENT,
  mintRecipient: B32(RECIPIENT),
  refundTo: REFUND_TO,
  destinationDomain: domain,
  escrowCctpForwardFee: 200000n,
  reviewWindow: 7n * BigInt(DAY),
  ...over
})

const paramText = (d) => (d.parameters || []).join('\n')

/* #18.1. claimDelivery starts e.reviewWindow (sol:417), a per-escrow value set
   at deposit. It decides when this freelancer can actually be paid, and it was
   the one surface not printing it — the parameters row (:640) and FocusBar
   (:472) both already do, off the same object. */
describe('#18.1 — claimDelivery names the window it starts', () => {
  const claim = (escrow) =>
    milestoneConfirm({ key: 'claim', fn: 'claimDelivery' }, escrow, { index: 1, amount: 250000000n, state: 0 }, [])

  it('states the window length and what happens when it ends', () => {
    expect(paramText(claim(escrowOn(ARC))))
      .toContain('Review window: 7 days from this transaction. After it ends without a dispute, anyone can release the payment.')
  })

  it('reads the length off the escrow rather than assuming a default', () => {
    expect(paramText(claim(escrowOn(ARC, { reviewWindow: 3n * BigInt(DAY) })))).toContain('Review window: 3 days')
    expect(paramText(claim(escrowOn(ARC, { reviewWindow: BigInt(12 * 3600) })))).toContain('Review window: 12 hours')
  })

  /* An escrow object without the field must lose the line, not print
     "Review window: 0 minutes" — which would read as "no review at all", the
     opposite of what an unread value means. */
  it('drops the line entirely when the window is unknown', () => {
    for (const over of [{ reviewWindow: undefined }, { reviewWindow: 0n }]) {
      const t = paramText(claim(escrowOn(ARC, over)))
      expect(t).not.toMatch(/Review window|undefined|NaN|0 minutes/)
      expect(t).toContain('No funds move on this transaction.')
    }
  })

  it('still moves no money', () => {
    expect(claim(escrowOn(ARC))).not.toHaveProperty('amount')
  })
})

/* #18.2. ARBITER_WINDOW is 14 days (sol:69) and the timeout fallback is a
   hardcoded 5000 bps (:576). Both are compile-time constants, so the vague
   phrasing bought nothing. */
describe('#18.2 — raiseDispute measures the arbitration window', () => {
  const d = (over = {}) => raiseDisputeConfirm({
    escrow: escrowOn(ARC),
    milestone: { index: 1, amount: 250000000n, state: 1 },
    reason: 'Not delivered',
    uri: 'ipfs://x',
    arbiterWindow: 1_209_600n,
    ...over
  })

  it('names the 14 days and the fixed 50/50 in one sentence', () => {
    expect(paramText(d())).toContain('An arbiter is not the only way out: you and the other party can still agree a split directly, and if no arbiter rules within 14 days, anyone can settle it at a fixed 50/50.')
  })

  /* The Phase C disclosure is extended, not duplicated — two sentences about
     the same escape hatch read as two different hatches. */
  it('states the escape hatch exactly once', () => {
    const matches = paramText(d()).match(/not the only way out/g) || []
    expect(matches).toHaveLength(1)
  })

  it('falls back to the unmeasured phrasing when the window is unknown', () => {
    const t = paramText(d({ arbiterWindow: undefined }))
    expect(t).toContain('if no arbiter rules within the arbitration window')
    expect(t).not.toMatch(/undefined|NaN/)
  })

  it('still moves no money', () => {
    expect(d()).not.toHaveProperty('amount')
  })
})

/* #18.3. "Applies to every milestone not yet released" covers the whole escrow
   on a fresh one and nothing on a finished one, and the screen gave the signer
   no way to tell which. The milestones were already in LedgerColumn and were
   dropped one frame before the descriptor. */
describe('#18.3 — a redirect states what it is worth', () => {
  // 250 released, 250 in review, 250 pending → 500 still exposed.
  const MS = [
    { index: 0, amount: 250000000n, state: 3 },
    { index: 1, amount: 250000000n, state: 1 },
    { index: 2, amount: 250000000n, state: 0 }
  ]

  describe('unreleasedExposure', () => {
    it('counts everything that has not reached a terminal state', () => {
      expect(unreleasedExposure(MS)).toBe(500000000n)
    })

    /* DISPUTED(2) still pays through the address being changed, so excluding
       it would understate the exposure on exactly the escrows where the
       destination matters most. */
    it('counts a disputed milestone as still exposed', () => {
      expect(unreleasedExposure([{ index: 0, amount: 100000000n, state: 2 }])).toBe(100000000n)
    })

    it('excludes released and refunded milestones', () => {
      expect(unreleasedExposure([
        { index: 0, amount: 100000000n, state: 3 },
        { index: 1, amount: 100000000n, state: 4 }
      ])).toBe(0n)
    })

    /* null, not 0n: an unknown exposure and a fully-settled escrow are
       different facts, and only one of them should print a figure. */
    it('returns null rather than zero when there is nothing to read', () => {
      expect(unreleasedExposure(undefined)).toBeNull()
      expect(unreleasedExposure([])).toBeNull()
    })
  })

  const payout = (over = {}) => redirectPayoutConfirm({
    escrow: escrowOn(BASE), hasSplits: false, newAddress: NEW_ADDR, newDomain: BASE, milestones: MS, ...over
  })

  it('puts the remaining figure on the escrow-level redirect', () => {
    expect(paramText(payout())).toContain('That is 500.00 USDC still to be paid, before the protocol fee.')
  })

  it('says gross, since the fee snapshot is not readable', () => {
    expect(paramText(payout())).toMatch(/before the protocol fee/)
    expect(paramText(payout())).not.toMatch(/\bnet\b/i)
  })

  it('omits the figure when the milestones are not available', () => {
    const t = paramText(payout({ milestones: undefined }))
    expect(t).not.toMatch(/still to be paid|undefined|NaN/)
    expect(t).toContain('Applies to every milestone not yet released, including any currently in review.')
  })

  /* The split branch's write changes no destination at all, and the blocked
     branch reverts. Attaching a value to either would put a number on a
     transaction that moves nothing. */
  it('stays off the branches where the redirect does nothing', () => {
    const noop = paramText(payout({ hasSplits: true }))
    const blocked = paramText(redirectPayoutConfirm({
      escrow: escrowOn(ARC), hasSplits: false, newAddress: NEW_ADDR, newDomain: BASE, milestones: MS
    }))
    expect(noop).not.toMatch(/still to be paid/)
    expect(blocked).not.toMatch(/still to be paid/)
  })

  const split = (over = {}) => redirectSplitConfirm({
    escrow: escrowOn(BASE),
    splitIndex: 1,
    currentAddress: RECIPIENT,
    currentDomain: BASE,
    pct: 25,
    newAddress: NEW_ADDR,
    newDomain: BASE,
    milestones: MS,
    ...over
  })

  /* Stated as pool-and-share rather than a multiplied-out figure: the leg's
     amount comes off each release's post-fee remainder (:1309), so 25% of the
     gross pool is a number the contract never computes. */
  it('scopes the split redirect to the leg without inventing a product', () => {
    const t = paramText(split())
    expect(t).toContain('500.00 USDC is still to be paid across this escrow, of which this leg takes 25% share after the protocol fee.')
    expect(t).not.toContain('125.00 USDC')
  })

  it('omits it on the split redirect too when unavailable', () => {
    expect(paramText(split({ milestones: [] }))).not.toMatch(/still to be paid/)
  })
})
