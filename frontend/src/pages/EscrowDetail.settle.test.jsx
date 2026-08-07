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

  it('states the split as a conditional, not as a fact', () => {
    expect(paramText(first())).toContain('Would pay 125.00 USDC to the freelancer and 125.00 USDC to the payer.')
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

  it('says both sides agreed and that it pays out immediately', () => {
    expect(d().subtitle).toContain('Both sides have proposed the same split')
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
    expect(paramText(d())).toContain("The payer's share is credited as a withdrawable balance on Arc, not sent to a wallet.")
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

  it('names the escrow fixed forwarding fee rather than a live quote', () => {
    expect(paramText(cross(5000))).toContain("Cross-chain delivery uses this escrow's fixed forwarding fee of 0.20 USDC, set when it was funded.")
  })

  it('warns that a small share is credited on Arc instead of delivered', () => {
    expect(paramText(cross(5000))).toContain("If the freelancer's share after the protocol fee is 0.20 USDC or less, it is credited on Arc instead of being delivered cross-chain.")
  })

  /* Per-leg on a split escrow (:1319), so the wording has to change with it. */
  it('phrases the divert per leg when the escrow has splits', () => {
    const splits = [
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) }
    ]
    expect(paramText(cross(5000, splits))).toContain('Any split leg whose share falls to 0.20 USDC or less is credited on Arc instead of being delivered to its chain.')
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
    expect(t).toContain("Cross-chain delivery uses this escrow's fixed forwarding fee of 0.20 USDC")
    expect(t).toContain('Any split leg whose share falls to 0.20 USDC or less is credited on Arc')
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
  })

  it('says nothing about the divert on a same-chain Arc escrow', () => {
    const t = paramText(mutualSettleConfirm({
      escrow: escrowOn(ARC), milestone, splits: [], bps: 5000, theirs: agreed(5000)
    }))
    expect(t).not.toContain('forwarding fee')
  })
})
