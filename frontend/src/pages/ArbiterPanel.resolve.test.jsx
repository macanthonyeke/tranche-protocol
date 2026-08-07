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

const RECIPIENT = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const REFUND_TO = '0x4bdbe608ea998b4822476353df9dd83228ffd503'
const B32 = (a) => '0x000000000000000000000000' + a.slice(2)

const escrowOn = (domain) => ({
  id: 7,
  milestoneCount: 3,
  recipient: RECIPIENT,
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
    const t = paramText(build({ escrow: escrowOn(BASE) }))
    expect(t).toContain(`Freelancer's share is sent to ${RECIPIENT} on Base Sepolia`)
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
    expect(paramText(build({ bps: 10_000, escrow: escrowOn(BASE), maxFee: 500000n })))
      .not.toContain('credited on Arc instead')
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
    const t = paramText(build({ escrow: escrowOn(BASE), maxFee: 450000n }))
    expect(t).toContain("Delivery costs up to 0.45 USDC in Circle forwarding fees, deducted from the freelancer's share on arrival.")
  })

  /* The quoted fee is not what a split leg burns at, so showing it there would
     state a figure the contract never uses. */
  it('quotes the escrow snapshot floor for split legs, never the caller maxFee', () => {
    const t = paramText(build({ escrow: escrowOn(BASE), splits, maxFee: 450000n }))
    expect(t).toContain("Each cross-chain split leg pays this escrow's fixed forwarding fee of 0.20 USDC, deducted from that leg's share on delivery.")
    expect(t).not.toContain('0.45 USDC')
  })

  it('describes a split payout as a fan-out rather than one address', () => {
    const t = paramText(build({ escrow: escrowOn(BASE), splits, maxFee: 450000n }))
    expect(t).toContain("Freelancer's share is divided across 2 split recipients, each on their own chain")
    expect(t).not.toContain(`sent to ${RECIPIENT}`)
  })
})

describe('Finding 3 — a partial award can fall below the delivery floor', () => {
  it('warns for a no-split cross-chain partial', () => {
    expect(paramText(build({ escrow: escrowOn(BASE), maxFee: 450000n })))
      .toContain("If the freelancer's share after the protocol fee is 0.20 USDC or less, it is credited on Arc instead of being delivered cross-chain.")
  })

  it('phrases the divert per leg for a split escrow', () => {
    const splits = [{ bps: 10_000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }]
    expect(paramText(build({ escrow: escrowOn(BASE), splits, maxFee: 450000n })))
      .toContain('Any split leg whose share falls to 0.20 USDC or less is credited on Arc instead of being delivered to its chain.')
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
    expect(t).toContain("Each cross-chain split leg pays this escrow's fixed forwarding fee of 0.20 USDC")
    expect(t).toContain('Any split leg whose share falls to 0.20 USDC or less is credited on Arc')
  })

  it('says nothing about delivery for a same-chain Arc escrow', () => {
    const t = paramText(build())
    expect(t).not.toMatch(/forwarding fee/i)
    expect(t).not.toContain('credited on Arc instead')
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
