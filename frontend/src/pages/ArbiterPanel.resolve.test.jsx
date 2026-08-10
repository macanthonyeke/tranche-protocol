import { describe, it, expect } from 'vitest'

/* resolveDispute — the arbiter's discretionary ruling, and the last signing
   site in the project.

   Its twin sits in the same panel: resolveDisputeByTimeout, a permissionless
   fixed 50/50 that never leaves Arc. This one is role-gated, the percentage is
   chosen, and the freelancer's share is really burned through CCTP to their
   destination chain. Most of what follows pins that separation, plus three
   things the form itself does not show:

   - maxFee is LIVE here (:510, :1298) where the identical parameter is dead in
     mutualSettle — but only for a no-split escrow. Split legs burn at the
     e.escrowCctpForwardFee snapshot instead (:1329), settled decision #7.
   - escrowFeeBps is snapshotted with no getter, so gross halves only.
   - Once ARBITER_WINDOW closes the timeout is open to anyone, so a late ruling
     races a 50/50. */
import { resolveDisputeConfirm } from './ArbiterPanel.jsx'
import { buildContractInteraction } from '../utils/circleTheme.js'

const ARC = 26
const BASE = 6
const ETH_SEPOLIA = 0

const RECIPIENT = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const REFUND_TO = '0x4bdbe608ea998b4822476353df9dd83228ffd503'
const B32 = (a) => '0x000000000000000000000000' + a.slice(2)

/* mintRecipient deliberately differs from recipient. The burn targets
   mintRecipient (:1298) while recipient is only the authorisation identity, and
   updateReceivingAddress moves one without the other (:986-990) — so a fixture
   where they match cannot tell a correct descriptor from one reading the stale
   field. REDIRECTED is what a freelancer redirected TO; RECIPIENT is what they
   redirected away from. */
const REDIRECTED = '0x8ba1f109551bd432803012645ac136ddd64dba72'
const escrowOn = (domain) => ({
  id: 7,
  milestoneCount: 3,
  recipient: RECIPIENT,
  mintRecipient: B32(REDIRECTED),
  refundTo: REFUND_TO,
  destinationDomain: domain,
  escrowCctpForwardFee: 200000n // 0.20 USDC
})

const milestone = { index: 1, amount: 250000000n, state: 2 } // 250 USDC
const URI = 'https://ipfs.io/ipfs/bafyRuling'
const DENOM = 10_000n

const build = (over = {}) => resolveDisputeConfirm({
  escrow: escrowOn(ARC),
  milestone,
  index: 1,
  splits: [],
  bps: 6000,
  resolutionUri: URI,
  maxFee: 0n,
  canTimeout: false,
  bpsDenominator: DENOM,
  ...over
})

const paramText = (d) => (d.parameters || []).join('\n')

describe('the ruling itself', () => {
  it('carries the full milestone amount as the settled total', () => {
    expect(build().amount).toBe(250000000n)
    expect(build().amountLabel).toBe('Amount settled')
    expect(buildContractInteraction(build())).toHaveProperty('mainCurrency')
  })

  it('names the real function', () => {
    expect(build().functionName).toBe('resolveDispute')
  })

  it('splits the milestone exactly the way the contract does', () => {
    const t = paramText(build())
    expect(t).toContain('Your ruling: 60% to the freelancer, 40% to the payer.')
    expect(t).toContain("Freelancer's share: 150.00 USDC before the protocol fee")
    expect(t).toContain("Payer's share: 100.00 USDC")
  })

  /* escrowFeeBps is snapshotted and has no getter, so the rate and the net are
     unknowable. The asymmetry holds at any rate and is stated instead. */
  it('states the fee asymmetry without inventing a rate or a net', () => {
    const t = paramText(build())
    expect(t).toContain("The protocol fee is taken from the freelancer's share only.")
    expect(t).toContain('no protocol fee is taken on this half')
    expect(t).not.toMatch(/\d+(\.\d+)?%\s*(protocol )?fee/i)
    expect(t).not.toMatch(/\bnet\b/i)
  })

  /* No appeal path exists: DISPUTED goes straight to RELEASED/REFUNDED. */
  it('says the ruling is final', () => {
    expect(build().subtitle).toContain('cannot be appealed, reversed, or re-ruled')
    expect(paramText(build())).toContain('This is final. The contract has no appeal path.')
  })

  it('says the written reasoning is public and permanent', () => {
    expect(paramText(build())).toContain(`Your written reasoning at ${URI} is stored on-chain permanently and readable by anyone.`)
  })
})

/* The separation timeoutSettlementConfirm's own comment warns about: the
   timeout never leaves Arc, this one really delivers cross-chain. */
describe('told apart from the fixed 50/50 timeout', () => {
  it('sends the freelancer share to their chain rather than crediting Arc', () => {
    // build()'s default bps (60%) makes this a partial cross-chain ruling,
    // so the destination is stated as a Round 17 Phase A hedge rather than
    // a bare fact — this checks the "clears the floor" half of it.
    const t = paramText(build({ escrow: escrowOn(BASE) }))
    expect(t).toContain(`it is paid to ${REDIRECTED} on Base Sepolia`)
  })

  /* The bug this guards: naming e.recipient shows the pre-redirect address as
     though it were the destination, so an arbiter signing after a redirect
     would be told the money goes somewhere it does not. */
  it('names the redirected mintRecipient, never the stale recipient field', () => {
    const t = paramText(build({ escrow: escrowOn(BASE) }))
    expect(t).toContain(REDIRECTED)
    expect(t).not.toContain(`sent to ${RECIPIENT}`)
  })

  /* Only the Finding 3 divert credits recipient (:1292), and it says so
     explicitly rather than reusing the delivery wording. */
  it('names recipient only for the Arc divert, and labels it as such', () => {
    const t = paramText(build({ escrow: escrowOn(BASE) }))
    expect(t).toContain(`credited on Arc to ${RECIPIENT} instead — no cross-chain delivery`)
  })

  /* The payer half genuinely is an Arc credit on both paths, so this line is
     the one thing the two screens legitimately share. */
  it('still credits the payer half on Arc', () => {
    expect(paramText(build())).toContain(`Payer's share is credited to ${REFUND_TO} as a withdrawable balance on Arc, not sent to a wallet.`)
  })

  it('describes the ruling as chosen, not as a fixed split', () => {
    expect(paramText(build())).toContain('Your ruling:')
    expect(paramText(build())).not.toContain('50/50 split written into the contract')
  })
})

describe('the two edges of the ruling', () => {
  it('0% pays the freelancer nothing and refunds the milestone', () => {
    const t = paramText(build({ bps: 0 }))
    expect(t).toContain('Nothing is paid to the freelancer. The milestone is refunded in full.')
    expect(t).toContain("Payer's share: 250.00 USDC")
    expect(t).not.toContain("Freelancer's share:")
  })

  it('100% pays the payer nothing', () => {
    const t = paramText(build({ bps: 10_000 }))
    expect(t).toContain("Freelancer's share: 250.00 USDC")
    expect(t).not.toContain("Payer's share:")
  })

  /* _assertCrossChainFee is skipped at 0% (:510) and no burn occurs, so no
     forwarding-fee copy may appear even on a cross-chain escrow. */
  it('says nothing about delivery fees when no share is burned', () => {
    const t = paramText(build({ bps: 0, escrow: escrowOn(BASE), maxFee: 0n }))
    expect(t).not.toMatch(/forwarding fee/i)
    expect(t).not.toContain('Delivery costs')
  })

  it('does not warn about the Arc divert on a full award', () => {
    // Substring must not assume the sentence's exact shape — a reworded divert
    // line would otherwise slip past this.
    expect(paramText(build({ bps: 10_000, escrow: escrowOn(BASE), maxFee: 500000n })))
      .not.toMatch(/credited on Arc/i)
  })
})

/* Settled decision #7 made concrete: the caller's maxFee governs a no-split
   burn (:1298); split legs ignore it and use the snapshot floor (:1329). The
   screen must name whichever figure actually applies. */
describe('the maxFee asymmetry between split and no-split', () => {
  const splits = [
    { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) },
    { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
  ]

  it('quotes the caller maxFee for a no-split cross-chain payout', () => {
    // build()'s default bps (60%) makes the divert reachable, so the fee
    // is stated as a Round 17 Phase A hedge — the property under test
    // (which figure is named) still holds inside it.
    const t = paramText(build({ escrow: escrowOn(BASE), maxFee: 450000n }))
    expect(t).toContain("delivery costs up to 0.45 USDC in Circle forwarding fees, deducted from the freelancer's share on arrival.")
  })

  /* The quoted fee is not what a split leg burns at, so showing it there would
     state a figure the contract never uses. */
  it('quotes the escrow snapshot floor for split legs, never the caller maxFee', () => {
    const t = paramText(build({ escrow: escrowOn(BASE), splits, maxFee: 450000n }))
    expect(t).toContain("pays a forwarding fee of up to 0.20 USDC, deducted from that leg's share on delivery.")
    expect(t).not.toContain('0.45 USDC')
  })

  it('describes a split payout as a CONFIGURATION fact, not a headcount of who got paid', () => {
    const t = paramText(build({ escrow: escrowOn(BASE), splits, maxFee: 450000n }))
    // Round 15 #11: "most delivered" (Round 14's fix) was itself still an
    // unsupported quantifier. Round 16 #1: "divided across N split
    // recipients" (what Round 15 replaced it with) was STILL an outcome
    // claim — it implies N recipients receive something, which rounding and
    // the sub-floor divert can both make false. The leading line now states
    // only the escrow's configuration (N split entries exist, with their own
    // share/chain) and leaves what actually happens to the caveats that
    // follow. The leading line is isolated rather than scanned for across
    // the whole screen: this same escrow's output legitimately contains
    // "Each cross-chain split leg pays..." a few lines down (the fee-cap
    // disclosure), which is not the claim under test — checking the whole
    // paramText for "each" would false-positive on it.
    const fanOutLine = t.split('\n').find((line) => line.startsWith(`${splits.length} configured split entries`))
    expect(fanOutLine).toBe('2 configured split entries, by their configured share and destination chain')
    expect(fanOutLine).not.toMatch(/\beach\b|\bmost\b|\ball\b|\bevery\b|\bsome\b|\bhalf\b|\bmajority\b|\bpaid\b|\breceiv\w*\b|%|\d+ of \d+/i)
    expect(t).not.toContain(`sent to ${RECIPIENT}`)
  })
})

describe('Finding 3 — a partial award can fall below the delivery floor', () => {
  /* Round 17 Phase A: a fifth Codex pass found that whenever the divert is
     reachable (partial && crossChain), this function stated destination,
     delivery-timing and fee facts UNCONDITIONALLY first, then appended a
     caveat that contradicted them if the divert actually fired. The gap
     the review found in the tests below was that they only ever checked
     the caveat's presence, never whether the unconditional claim it was
     "correcting" had actually gone away — so this checks absence too. */
  it('drops the unconditional destination and fee lines entirely when the divert is reachable', () => {
    const t = paramText(build({ escrow: escrowOn(BASE), maxFee: 450000n }))
    expect(t).not.toMatch(/^Freelancer's share is sent to /m)
    expect(t).not.toContain('Delivery costs up to 0.45 USDC in Circle forwarding fees, deducted from the freelancer\'s share on arrival.')
  })

  it('warns for a no-split cross-chain partial, stating both outcomes as one conditional', () => {
    const t = paramText(build({ escrow: escrowOn(BASE), maxFee: 450000n }))
    expect(t).toContain(`If this amount clears this escrow's forwarding-fee floor, it is paid to ${REDIRECTED} on Base Sepolia.`)
    expect(t).toContain(`If it does not clear the floor, it is credited on Arc to ${RECIPIENT} instead — no cross-chain delivery.`)
    // The fee hedge names the LIVE maxFee quote for no-split (:1298), not the
    // escrow's fixed floor — the same distinction settled decision #7 already
    // draws for the unconditional wording, preserved here.
    expect(t).toContain("If this amount clears this escrow's forwarding-fee floor, delivery costs up to 0.45 USDC in Circle forwarding fees, deducted from the freelancer's share on arrival.")
  })

  /* The destination hedge above already states both outcomes ("paid to X" /
     "credited on Arc to Z instead"). The fee hedge's job is to add the ONE
     new fact — the fee — not re-derive the destination a second time.
     Mirrors mutualSettleConfirm's lean "no delivery fee is charged", which
     never had a destination to duplicate in the first place since it reads
     that off payoutLines() separately. */
  it("the fee hedge's second half states only the fee, not a repeat of the destination", () => {
    const t = paramText(build({ escrow: escrowOn(BASE), maxFee: 450000n }))
    expect(t).toContain('If it does not clear the floor, no delivery fee is charged.')
    expect(t).not.toContain(`it does not clear the floor, it is credited on Arc to ${RECIPIENT} instead — no cross-chain delivery, no fee`)
  })

  it('phrases the divert per leg for a split escrow, consolidating fee and destination into one hedge', () => {
    const splits = [{ bps: 10_000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }]
    const t = paramText(build({ escrow: escrowOn(BASE), splits, maxFee: 450000n }))
    // Round 18 Phase A #2: "a given split leg" implied every leg in the
    // configuration faces this floor check. An Arc leg never does
    // (TrancheProtocol.sol:1343, direct transfer) — scoped to cross-chain legs.
    // Round 19 Phase A: also scoped to a NONZERO share — Solidity skips a
    // zero-share leg entirely (TrancheProtocol.sol:1310), so it is never
    // credited, let alone credited on Arc.
    expect(t).toContain("If a given cross-chain split leg's nonzero share clears this escrow's forwarding-fee floor, it is delivered to its configured chain and pays a forwarding fee of up to 0.20 USDC, deducted from that leg's share on delivery. If that nonzero share does not clear the floor, that leg is credited on Arc instead — no delivery, no fee.")
    // The old two-line shape (a fee line, then a separate divert caveat) is
    // gone — this is now one statement, not two adjacent ones.
    expect(t).not.toContain("Each cross-chain split leg pays this escrow's fixed forwarding fee of up to 0.20 USDC")
    expect(t).not.toMatch(/^Any split leg whose share falls to/m)
  })

  /* Round 18 Phase A: the fixture above has exactly one cross-chain leg,
     which cannot exercise a genuinely mixed settlement — Solidity evaluates
     each leg independently (TrancheProtocol.sol:1303-1312), so an Arc leg, a
     cross-chain leg that clears the floor, and a cross-chain leg that
     doesn't can all settle simultaneously within one ruling. Three legs
     across three different domains (one Arc, two different cross-chain
     domains) verifies the copy stays generically per-leg rather than reading
     as though it only covers a single specific domain or a single leg. */
  it('phrases the divert per leg for a genuinely mixed 3-leg split (Arc + two cross-chain domains)', () => {
    const splits = [
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
      { bps: 3000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) },
      { bps: 2000n, destinationDomain: ETH_SEPOLIA, mintRecipient: B32(RECIPIENT) }
    ]
    const t = paramText(build({ escrow: escrowOn(BASE), splits, maxFee: 450000n }))
    expect(t).toContain("If a given cross-chain split leg's nonzero share clears this escrow's forwarding-fee floor, it is delivered to its configured chain and pays a forwarding fee of up to 0.20 USDC, deducted from that leg's share on delivery. If that nonzero share does not clear the floor, that leg is credited on Arc instead — no delivery, no fee.")
    // Never singles out one cross-chain domain, or "the split" as one unit —
    // the hedge has to hold for both cross-chain legs (BASE and Ethereum
    // Sepolia) simultaneously, regardless of what the Arc leg does.
    expect(t).not.toMatch(/^Any split leg whose share falls to/m)
    expect(t).not.toContain("Each cross-chain split leg pays this escrow's fixed forwarding fee of up to 0.20 USDC")
  })

  /* Round 18 Phase A #3: timing is per-leg-type for a split escrow, not one
     outcome for the whole ruling — an Arc leg settles immediately regardless
     of what a cross-chain leg in the same ruling does. Zero prior coverage of
     this branch existed before this round. */
  it('separates Arc-leg timing from cross-chain-leg timing on a mixed partial split (divert reachable)', () => {
    const splits = [
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
    ]
    const t = paramText(build({ escrow: escrowOn(BASE), splits, maxFee: 450000n }))
    // Round 19 Phase A #1: scoped to "with a nonzero share" — Solidity skips
    // a zero-share leg entirely (TrancheProtocol.sol:1310), it is never
    // transferred, burned, or credited.
    expect(t).toContain("For any split leg with a nonzero share: an Arc leg transfers immediately as part of this transaction; a cross-chain leg that clears this escrow's forwarding-fee floor leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant; a cross-chain leg that does not clear the floor is credited on Arc instead, as part of this transaction (see above).")
    expect(t).not.toContain("The freelancer's share leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.")
  })

  /* Round 18 Phase A #4: a FULL (100%) split ruling can never reach the
     divert, but a mix of Arc and cross-chain legs is still not one timing
     outcome — "the entire freelancer share leaves Arc" was false for the Arc
     leg, which transfers inside this transaction rather than leaving it. */
  it('separates Arc-leg timing from cross-chain-leg timing on a mixed FULL split (divert not reachable)', () => {
    const splits = [
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
    ]
    const t = paramText(build({ escrow: escrowOn(BASE), splits, bps: 10_000, maxFee: 450000n }))
    expect(t).toContain("For any split leg with a nonzero share: an Arc leg transfers immediately as part of this transaction; a cross-chain leg leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.")
    expect(t).not.toContain("The freelancer's share leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.")
  })

  /* Round 19 Phase A #3: a single-entry, all-cross-chain split has NO Arc leg
     configured at all — the Arc-leg clause must not appear when there is
     nothing for it to describe. */
  it('omits the Arc-leg clause entirely for an all-cross-chain split with no Arc leg configured', () => {
    const splits = [{ bps: 10_000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }]
    const t = paramText(build({ escrow: escrowOn(BASE), splits, bps: 10_000, maxFee: 450000n }))
    expect(t).toContain('For any split leg with a nonzero share: a cross-chain leg leaves Arc on this transaction but only arrives once Circle\'s cross-chain delivery completes, which is not instant.')
    expect(t).not.toContain('an Arc leg transfers immediately')
    expect(t).not.toContain('Split legs on Arc')
  })

  /* Round 19 Phase A #1: a genuinely skewed split (1 bps / 9,999 bps) that
     produces a real per-leg ZERO share on a small enough milestone, not the
     50/50 or 50/30/20 splits Round 18's tests used (which never exercised
     this). The tiny leg vanishes from Solidity's accounting entirely
     (TrancheProtocol.sol:1310's `if (share > 0)` guard skips its whole
     if/else) — it is not transferred, not burned, and not credited on Arc —
     so the timing copy's "each"/"every"/"any" framing must not include it. */
  it('does not claim a timing outcome for a leg whose share genuinely rounds to zero', () => {
    // bps=10_000 (full release) makes recipientAmount == milestone.amount ==
    // 9999. floor(9999 * 1 / 10_000) = 0 — the 1-bps leg's share genuinely
    // rounds to zero, not merely a small nonzero number.
    const tinyMilestone = { index: 1, amount: 9_999n, state: 2 }
    const splits = [
      { bps: 1n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) }, // rounds to 0
      { bps: 9_999n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
    ]
    const t = paramText(build({
      escrow: escrowOn(BASE), milestone: tinyMilestone, splits, bps: 10_000, maxFee: 450000n
    }))
    // The nonzero cross-chain leg's timing is still stated correctly.
    expect(t).toContain("a cross-chain leg leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.")
    // Nothing on screen claims the zero-share Arc leg is "transferred" —
    // the "with a nonzero share" qualifier is exactly what prevents this
    // from reading as a blanket claim about every configured leg.
    expect(t).toContain('with a nonzero share')
  })

  /* With splits configured e.destinationDomain is not what the burn uses, so
     an Arc-domain escrow with one cross-chain leg is still cross-chain. This
     is the shape a naive escrow-domain-only check silently drops. */
  it('treats an Arc-domain escrow with a cross-chain split leg as cross-chain', () => {
    const splits = [
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
    ]
    const t = paramText(build({ escrow: escrowOn(ARC), splits }))
    expect(t).toContain("pays a forwarding fee of up to 0.20 USDC")
    expect(t).toContain('is credited on Arc instead')
  })

  it('says nothing about delivery for a same-chain Arc escrow', () => {
    const t = paramText(build())
    expect(t).not.toMatch(/forwarding fee/i)
    expect(t).not.toContain('credited on Arc instead')
  })

  /* Round 19 Phase A #1: an all-Arc split can have a zero-share leg too — the
     "nonzero share" scoping applies here the same as the mixed-split
     branches. No prior test pinned this exact branch's wording. */
  it('scopes the all-Arc-split timing line to a nonzero share', () => {
    const splits = [
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) }
    ]
    const t = paramText(build({ splits }))
    expect(t).toContain('Each split leg with a nonzero share is transferred on Arc as this transaction executes.')
  })
})

/* Round 16 #3: bps > 0 does not guarantee recipientShare > 0 — integer
   division can floor a small enough milestone amount times a small enough
   ruling to zero even though the arbiter assigned a genuinely nonzero
   percentage. Before this fix the code branched purely on `bps > 0` and
   would still walk through payout/chain/fee copy for a transfer that never
   happens. Distinct from a per-split-leg rounding-to-zero (still disclosed
   when applicable): this is the WHOLE freelancer amount, before any split
   division even runs. */
describe('Round 16 #3 — a nonzero bps can still round the whole share to zero', () => {
  // 9999 base units (0.009999 USDC): small enough that a 0.01% ruling floors
  // to exactly 0n, while what's left for the payer (9999n) is comfortably
  // nonzero at 2-decimal display precision.
  const tinyMilestone = { index: 1, amount: 9999n, state: 2 }
  const at = (bps, over = {}) => build({ milestone: tinyMilestone, bps, ...over })

  it('says nothing is paid despite the nonzero ruling, distinctly from a 0% ruling', () => {
    // bps=1 (0.01%): floor(9999 * 1 / 10000) = 0.
    const t = paramText(at(1))
    expect(t).toContain("This percentage rounds down to zero USDC at this milestone's amount, so nothing is actually paid to the freelancer despite the nonzero ruling.")
    expect(t).not.toContain('Nothing is paid to the freelancer. The milestone is refunded in full.')
    expect(t).toContain("Freelancer's share: 0.00 USDC before the protocol fee")
    expect(t).toContain("Payer's share: 0.01 USDC — no protocol fee is taken on this half")
  })

  it('does not describe a payout destination, chain, or delivery fee for the zero transfer', () => {
    const t = paramText(at(1, { escrow: escrowOn(BASE) }))
    expect(t).not.toMatch(/share is sent to|forwarding fee|Circle's cross-chain delivery|transferred on Arc/)
  })

  it('rules normally once the share clears zero', () => {
    // bps=5000 (50%): floor(9999 * 5000 / 10000) = 4999 — nonzero, so this
    // takes the normal ruling path. The property under test is the BRANCH,
    // not the formatted dollar string (4999 base units still displays as
    // "0.00 USDC" at 2-decimal precision). Uses an Arc-domain escrow (not
    // cross-chain) specifically to isolate this from the separate Round 17
    // Phase A divert hedge — any bps strictly between 0 and 10,000 is
    // "partial" by definition, so a cross-chain escrow here would also
    // exercise that unrelated property.
    const t = paramText(at(5000, { escrow: escrowOn(ARC) }))
    expect(t).toContain(`Freelancer's share is sent to ${REDIRECTED} on Arc`)
    expect(t).not.toContain('rounds down to zero USDC')
  })
})

/* Once ARBITER_WINDOW elapses the permissionless 50/50 is available to anyone,
   so a late ruling is in a race it can lose. */
describe('racing the timeout', () => {
  it('warns when the arbitration window has already closed', () => {
    expect(paramText(build({ canTimeout: true })))
      .toContain('The arbitration window has already closed, so anyone can now settle this at a fixed 50/50 instead.')
  })

  it('stays quiet while the window is still open', () => {
    expect(paramText(build({ canTimeout: false }))).not.toContain('arbitration window has already closed')
  })
})
