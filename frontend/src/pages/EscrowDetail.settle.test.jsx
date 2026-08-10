import { describe, it, expect } from 'vitest'

/* mutualSettle — the densest signing site in the app.

   Most of what these tests pin is a negative, because the frontend's view of
   this call is misleading in three separate ways:

   - The caller's maxFee is never read by the contract (:521-559). The panel
     quotes Circle live and passes it anyway, so the screen must not present
     that number as a cost.
   - escrowFeeBps is snapshotted and has no getter, so no rate and no net
     figure may appear — same rule payoutLines and timeoutSettlementConfirm
     already follow.
   - Execution requires an EXACT bps match (:549). A different number from the
     other side neither part-settles nor counter-offers.

   And one positive that only bites here: a partial settlement can scale the
   freelancer's share below the forwarding-fee floor, which diverts it to Arc
   (:1291/:1319). A full release provably cannot (:1285-1288). */
import { mutualSettleConfirm } from './EscrowDetail.jsx'
import { buildContractInteraction } from '../utils/circleTheme.js'

const ARC = 26
const BASE = 6

const RECIPIENT = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const B32 = (a) => '0x000000000000000000000000' + a.slice(2)

const escrowOn = (domain) => ({
  id: 7,
  milestoneCount: 3,
  recipient: RECIPIENT,
  mintRecipient: B32(RECIPIENT),
  destinationDomain: domain,
  escrowCctpForwardFee: 200000n // 0.20 USDC
})

const milestone = { index: 1, amount: 250000000n, state: 2 } // 250 USDC
const none = { exists: false, bps: 0n }
const agreed = (bps) => ({ exists: true, bps: BigInt(bps) })

const paramText = (d) => (d.parameters || []).join('\n')

describe('a proposal that does not match settles nothing', () => {
  const first = () =>
    mutualSettleConfirm({ escrow: escrowOn(ARC), milestone, splits: [], bps: 5000, theirs: none })
  const mismatch = () =>
    mutualSettleConfirm({ escrow: escrowOn(ARC), milestone, splits: [], bps: 5000, theirs: agreed(6000) })

  /* The figures shown are conditional, so a Total would assert they are
     happening now. Same reasoning as cancelEscrowConfirm's unapproved branch. */
  it.each([['first proposal', first], ['mismatched proposal', mismatch]])(
    '%s carries no amount and renders no currency row',
    (_n, build) => {
      expect(build()).not.toHaveProperty('amount')
      expect(buildContractInteraction(build())).not.toHaveProperty('mainCurrency')
      expect(paramText(build())).toContain('No funds move on this transaction.')
    }
  )

  /* Phase C #10 split this line into the three things it was flattening: the
     freelancer's figure is gross, and the payer's is a credit, not a payment.
     Round 14 #9 dropped the flat "the payer's refund balance" clause — the
     real destination comes from refundToLines, covered with a real refundTo
     in phaseC.test.jsx; this fixture has none set, so no Credited-to line. */
  it('states the split as a conditional, not as a fact', () => {
    expect(paramText(first())).toContain("Would settle at 125.00 USDC to the freelancer before the protocol fee, and 125.00 USDC credited as a refund balance.")
  })

  /* The case most likely to be misread as agreement: the contract requires
     dep.bps == rec.bps exactly (:549), so 50 against 60 does nothing at all. */
  it('names the other number and says it does not match', () => {
    expect(paramText(mismatch())).toContain('The other party has proposed 60%. The two numbers do not match, so nothing settles yet.')
  })

  it('says so plainly when there is no counterparty proposal yet', () => {
    expect(paramText(first())).toContain('The other party has not proposed anything yet.')
  })

  /* :541-542 assigns unconditionally, so a proposal is revisable — the exact
     opposite of proposeMilestoneCancel, which is one screen away. */
  it('says the number can be changed later', () => {
    expect(paramText(first())).toContain('You can change your number later by proposing again.')
  })
})

describe('a matching proposal settles now', () => {
  const d = (over = {}) =>
    mutualSettleConfirm({
      escrow: escrowOn(ARC), milestone, splits: [], bps: 5000, theirs: agreed(5000), ...over
    })

  it('carries the full milestone amount as the settled total', () => {
    expect(d().amount).toBe(250000000n)
    expect(d().amountLabel).toBe('Amount settled')
    expect(buildContractInteraction(d())).toHaveProperty('mainCurrency')
  })

  // Phase C #10: the subtitle no longer claims it "pays out immediately" —
  // only one of the three destinations behaves that way.
  it('says both sides agreed and that this settles the milestone', () => {
    expect(d().subtitle).toContain('Both sides have proposed the same split')
    expect(d().subtitle).not.toMatch(/pays out immediately/i)
    expect(paramText(d())).toContain('This cannot be undone.')
  })

  it('splits the milestone exactly the way the contract does', () => {
    expect(paramText(d())).toContain("Freelancer's share: 125.00 USDC before the protocol fee")
    expect(paramText(d())).toContain("Payer's share: 125.00 USDC")
  })

  /* escrowFeeBps is snapshotted with no getter. The asymmetry holds at any
     rate, so it is stated; the rate and the net are not knowable and must not
     be guessed. */
  it('states the fee asymmetry without inventing a rate or a net', () => {
    const t = paramText(d())
    expect(t).toContain("The protocol fee is taken from the freelancer's share only.")
    expect(t).toContain('no protocol fee is taken on this half')
    expect(t).not.toMatch(/\d+(\.\d+)?%\s*(protocol )?fee/i)
    // \b matters: "Arc Testnet" contains the substring "net".
    expect(t).not.toMatch(/\bnet\b/i)
  })

  it('says the payer half is an Arc credit, not a transfer', () => {
    expect(paramText(d())).toContain('Credited as a withdrawable refund balance on Arc, not sent to a wallet.')
  })

  /* The caller's maxFee is never read (:521-559). Whatever Circle quoted, it
     is not a cost of this transaction and may not appear as one. */
  it('never presents a live forwarding quote as a cost', () => {
    const t = paramText(d({ escrow: escrowOn(BASE) }))
    expect(t).not.toMatch(/max ?fee/i)
    expect(t).not.toMatch(/estimated fee/i)
  })
})

describe('the two edges of the split', () => {
  const at = (bps, over = {}) =>
    mutualSettleConfirm({
      escrow: escrowOn(ARC), milestone, splits: [], bps, theirs: agreed(bps), ...over
    })

  /* bps == 0 takes the REFUNDED branch (:1234-1235): no burn, no fee, and no
     payout line at all. */
  it('0% pays the freelancer nothing and says the milestone is refunded', () => {
    const t = paramText(at(0))
    expect(t).toContain('Nothing is paid to the freelancer. The milestone is refunded in full.')
    expect(t).toContain("Payer's share: 250.00 USDC")
    expect(t).not.toContain("Freelancer's share:")
  })

  it('100% pays the payer nothing', () => {
    const t = paramText(at(10_000))
    expect(t).toContain("Freelancer's share: 250.00 USDC")
    expect(t).not.toContain("Payer's share:")
  })

  /* A full release provably clears the floor (:1285-1288), so the divert
     warning would be false there. */
  it('does not warn about the Arc divert on a full release', () => {
    expect(paramText(at(10_000, { escrow: escrowOn(BASE) }))).not.toContain('credited on Arc instead')
  })
})

describe('Finding 3 — a partial settlement can fall below the delivery floor', () => {
  const cross = (bps, splits = []) =>
    mutualSettleConfirm({ escrow: escrowOn(BASE), milestone, splits, bps, theirs: agreed(bps) })

  /* Round 17 Phase A: a fifth Codex pass found that whenever the divert is
     reachable (partial && crossChain), this function stated destination,
     delivery-timing and fee facts UNCONDITIONALLY first, then appended a
     caveat that contradicted them if the divert actually fired — the same
     leading-claim-vs-trailing-caveat shape already fixed three times this
     round for other findings. The frontend cannot compute the exact
     post-fee amount (no getter for escrowFeeBps), so it cannot know in
     advance which branch fires — both outcomes are stated together now.
     The gap the review found in the EXISTING tests below was that they only
     ever checked the caveat's presence, never whether the unconditional
     claim it was "correcting" had actually gone away — so this checks
     absence explicitly, not just replacement text. */
  it('drops the unconditional delivery-timing and fee lines entirely when the divert is reachable', () => {
    const t = paramText(cross(5000))
    expect(t).not.toContain("The freelancer's share leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.")
    expect(t).not.toContain("Cross-chain delivery costs up to this escrow's fixed forwarding fee of 0.20 USDC, set when it was funded and taken from the freelancer's share on arrival.")
  })

  it('states the fixed forwarding fee as a hedge covering both outcomes, not a live quote asserted as fact', () => {
    expect(paramText(cross(5000))).toContain('If it clears the floor, delivery costs up to this escrow\'s fixed forwarding fee of 0.20 USDC. If it does not clear the floor, no delivery fee is charged.')
  })

  /* Round 16 #2: this caveat now lives inside payoutLines() itself rather
     than being hand-rolled by this function — and payoutLines names
     escrow.recipient explicitly as the divert destination, not the
     redirectable mintRecipient (TrancheProtocol.sol:1292). Round 17 Phase
     A: restructured from one fact plus a correction into one conditional
     stating both outcomes together. */
  it('warns that a small share is credited on Arc instead of delivered', () => {
    const t = paramText(cross(5000))
    expect(t).toContain(`If this amount clears this escrow's forwarding-fee floor, it is paid to ${RECIPIENT} on Base Sepolia.`)
    expect(t).toContain(`If it does not clear the floor, it is credited on Arc to ${RECIPIENT} instead — no cross-chain delivery.`)
    expect(t).not.toMatch(/^Paid to:|^Paid on:/m)
  })

  /* Per-leg on a split escrow (:1319), so the wording has to change with it. */
  it('phrases the divert per leg when the escrow has splits', () => {
    const splits = [
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) }
    ]
    const t = paramText(cross(5000, splits))
    // Round 18 Phase A #1: scoped to cross-chain legs — an Arc leg
    // (destinationDomain: ARC in this very fixture) never faces this floor
    // check at all. Round 19 Phase A #2: also scoped to a NONZERO share —
    // Solidity skips a zero-share leg entirely (TrancheProtocol.sol:1310),
    // so it is never credited at all.
    expect(t).toContain('Any cross-chain split leg whose nonzero share falls to 0.20 USDC or less is credited on Arc instead of being delivered to its chain.')
    // Round 18 Phase A #3: timing is per-leg-type for a split escrow, not one
    // outcome for the whole settlement — this fixture's Arc leg settles
    // immediately regardless of what the cross-chain leg does. Round 19
    // Phase A #1: scoped to "with a nonzero share" for the same reason.
    expect(t).toContain("For any split leg with a nonzero share: an Arc leg transfers immediately as part of this transaction; a cross-chain leg that clears this escrow's forwarding-fee floor leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant; a cross-chain leg that does not clear the floor is credited on Arc instead, as part of this transaction (see above).")
    expect(t).not.toContain("The freelancer's share leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.")
    // Round 18 Phase A #5: each delivered cross-chain leg carries its own
    // independent fee cap (:1324) — a settlement with more than one such leg
    // can incur this fee more than once, so it is no longer one combined
    // figure for the whole settlement.
    expect(t).toContain("Each cross-chain split leg that clears the floor costs up to this escrow's fixed forwarding fee of 0.20 USDC, deducted from that leg's own share. Legs that do not clear the floor are not charged.")
    expect(t).not.toContain('If it clears the floor, delivery costs up to this escrow\'s fixed forwarding fee of 0.20 USDC. If it does not clear the floor, no delivery fee is charged.')
    expect(t).not.toContain("Cross-chain delivery costs up to this escrow's fixed forwarding fee of 0.20 USDC, set when it was funded")
  })

  /* The case escrow.destinationDomain alone cannot answer: with splits
     configured, e.destinationDomain is not what the burn uses, so an
     Arc-domain escrow with one cross-chain leg IS cross-chain by
     _assertCrossChainFee's rule. Reading only the escrow domain here would
     silently drop the warning for every split escrow of this shape. */
  it('treats an Arc-domain escrow with a cross-chain split leg as cross-chain', () => {
    const splits = [
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
    ]
    const t = paramText(mutualSettleConfirm({
      escrow: escrowOn(ARC), milestone, splits, bps: 5000, theirs: agreed(5000)
    }))
    expect(t).toContain("Each cross-chain split leg that clears the floor costs up to this escrow's fixed forwarding fee of 0.20 USDC, deducted from that leg's own share. Legs that do not clear the floor are not charged.")
    expect(t).toContain('Any cross-chain split leg whose nonzero share falls to 0.20 USDC or less is credited on Arc')
  })

  /* Round 18 Phase A #4: a FULL (100%) split settlement can never reach the
     divert, but a mix of Arc and cross-chain legs is still not one timing
     outcome — "the entire freelancer share leaves Arc" was false for the Arc
     leg, which transfers inside this transaction rather than leaving it. */
  it('separates Arc-leg timing from cross-chain-leg timing on a mixed FULL split (divert not reachable)', () => {
    const splits = [
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
    ]
    const t = paramText(mutualSettleConfirm({
      escrow: escrowOn(BASE), milestone, splits, bps: 10_000, theirs: agreed(10_000)
    }))
    expect(t).toContain("For any split leg with a nonzero share: an Arc leg transfers immediately as part of this transaction; a cross-chain leg leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.")
    expect(t).not.toContain("The freelancer's share leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.")
    // Round 18 Phase A #5: each cross-chain split leg carries its own
    // independent fee cap (:1324) even on a full, non-divertable payout — not
    // one combined figure for the whole settlement.
    expect(t).toContain("Each cross-chain split leg costs up to this escrow's fixed forwarding fee of 0.20 USDC, set when it was funded and deducted from that leg's own share on arrival.")
    expect(t).not.toContain("Cross-chain delivery costs up to this escrow's fixed forwarding fee of 0.20 USDC, set when it was funded and taken from the freelancer's share on arrival.")
  })

  /* Round 19 Phase A #3: a single-entry, all-cross-chain split has NO Arc leg
     configured at all — the Arc-leg clause must not appear when there is
     nothing for it to describe. */
  it('omits the Arc-leg clause entirely for an all-cross-chain split with no Arc leg configured', () => {
    const splits = [{ bps: 10_000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }]
    const t = paramText(mutualSettleConfirm({
      escrow: escrowOn(BASE), milestone, splits, bps: 10_000, theirs: agreed(10_000)
    }))
    expect(t).toContain("For any split leg with a nonzero share: a cross-chain leg leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.")
    expect(t).not.toContain('an Arc leg transfers immediately')
    expect(t).not.toContain('Split legs on Arc')
  })

  /* Round 19 Phase A #1: a genuinely skewed split (1 bps / 9,999 bps) that
     produces a real per-leg ZERO share on a small enough milestone, not the
     50/50 or 50/30/20 splits Round 18's tests used (which never exercised
     this). floor(9999 * 1 / 10_000) = 0 — the 1-bps leg's share genuinely
     rounds to zero. Solidity's `if (share > 0)` guard (TrancheProtocol.sol:
     1310) skips its whole if/else — it is not transferred, not burned, and
     not credited on Arc — so the timing copy's "any"/"a leg" framing must
     not read as a claim about every configured leg. */
  it('does not claim a timing outcome for a leg whose share genuinely rounds to zero', () => {
    const tinyMilestone = { index: 1, amount: 9_999n, state: 2 }
    const splits = [
      { bps: 1n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) }, // rounds to 0
      { bps: 9_999n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
    ]
    const t = paramText(mutualSettleConfirm({
      escrow: escrowOn(BASE), milestone: tinyMilestone, splits, bps: 10_000, theirs: agreed(10_000)
    }))
    expect(t).toContain("a cross-chain leg leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.")
    expect(t).toContain('with a nonzero share')
  })

  /* _assertCrossChainFee treats an escrow as cross-chain if ANY leg is, so an
     all-Arc split must not produce cross-chain copy. */
  it('says nothing about forwarding fees for an all-Arc split', () => {
    const splits = [
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) }
    ]
    const t = paramText(mutualSettleConfirm({
      escrow: escrowOn(ARC), milestone, splits, bps: 5000, theirs: agreed(5000)
    }))
    expect(t).not.toContain('forwarding fee')
    expect(t).not.toContain('credited on Arc instead')
    // Round 19 Phase A #1: scoped to "with a nonzero share" — same reason as
    // the mixed-split branches, an all-Arc split can have a zero-share leg too.
    expect(t).toContain('Each split leg with a nonzero share is transferred on Arc as this transaction executes.')
  })

  it('says nothing about the divert on a same-chain Arc escrow', () => {
    const t = paramText(mutualSettleConfirm({
      escrow: escrowOn(ARC), milestone, splits: [], bps: 5000, theirs: agreed(5000)
    }))
    expect(t).not.toContain('forwarding fee')
  })
})

/* Round 16 #3: bps > 0 does not guarantee recipientShare > 0 — integer
   division can floor a small enough milestone amount times a small enough
   bps to zero even though a genuinely nonzero percentage was agreed. Before
   this fix, the code branched purely on `bps > 0` and would still walk
   through payoutLines/chain/fee copy for a transfer that never happens,
   showing "Freelancer's share: 0.00 USDC" alongside delivery details for a
   $0 delivery. Distinct from a per-split-leg rounding-to-zero (still
   disclosed via payoutLines when applicable): this is the WHOLE freelancer
   amount, before any split division even runs. */
describe('Round 16 #3 — a nonzero bps can still round the whole share to zero', () => {
  // 9999 base units (0.009999 USDC): small enough that a 0.01% ruling floors
  // to exactly 0n in integer division, while what's LEFT for the payer
  // (9999n) is comfortably nonzero at 2-decimal display precision.
  const tinyMilestone = { index: 1, amount: 9999n, state: 2 }
  const at = (bps, over = {}) => mutualSettleConfirm({
    escrow: escrowOn(BASE), milestone: tinyMilestone, splits: [], bps, theirs: agreed(bps), ...over
  })

  it('says nothing is paid despite the nonzero share, distinctly from the 0% ruling', () => {
    // bps=1 (0.01%): floor(9999 * 1 / 10000) = 0.
    const t = paramText(at(1))
    expect(t).toContain("This percentage rounds down to zero USDC at this milestone's amount, so nothing is actually paid to the freelancer despite the nonzero share.")
    expect(t).not.toContain('Nothing is paid to the freelancer. The milestone is refunded in full.')
    expect(t).toContain("Freelancer's share: 0.00 USDC before the protocol fee")
    expect(t).toContain("Payer's share: 0.01 USDC — no protocol fee is taken on this half")
  })

  it('does not describe a payout destination, chain, or delivery fee for the zero transfer', () => {
    const t = paramText(at(1, { escrow: escrowOn(BASE) }))
    expect(t).not.toMatch(/Paid to:|Paid on:|forwarding fee|Circle's cross-chain delivery|transferred on Arc/)
  })

  it('pays the freelancer normally once the share clears zero', () => {
    // bps=5000 (50%): floor(9999 * 5000 / 10000) = 4999 — nonzero, so this
    // takes the normal payout path. The property under test is which BRANCH
    // runs, not the formatted dollar string (4999 base units still displays
    // as "0.00 USDC" at 2-decimal precision, which is exactly why the
    // branch condition checks the real recipientShare, not the display).
    // Uses an Arc-domain escrow (not cross-chain) specifically to isolate
    // this from the separate Round 17 Phase A divert hedge — any bps
    // strictly between 0 and 10,000 is "partial" by definition, so a
    // cross-chain escrow here would also exercise that unrelated property.
    const t = paramText(at(5000, { escrow: escrowOn(ARC) }))
    expect(t).toContain('Paid to:')
    expect(t).toContain('Paid on:')
    expect(t).not.toContain('rounds down to zero USDC')
  })
})
