import { describe, it, expect } from 'vitest'

/* Phase B — three copy/behaviour corrections where the previous wording
   flattened a real asymmetry, plus the permissionless timeout trigger.

   Each of these is a case where the contract does two different things and the
   screen said one. */
import { milestoneConfirm } from './EscrowDetail.jsx'
import { timeoutSettlementConfirm } from './ArbiterPanel.jsx'
import { domainConfirm, protocolTreasuryConfirm } from './ProtocolSettings.jsx'

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

const milestone = { index: 1, amount: 250000000n, state: 1 }
const paramText = (d) => (d.parameters || []).join('\n')

const confirm = (key, { escrow = escrowOn(BASE), splits = [], maxFee } = {}) =>
  milestoneConfirm({ key, fn: key === 'approve' ? 'approveRelease' : 'release' }, escrow, milestone, splits, maxFee)

/* #6. approveRelease passes the caller's submitted maxFee straight to the
   burn (:647 → :1298). release() discards it and substitutes the escrow
   snapshot (:674, :682), precisely because it is permissionless. Split legs
   always burn at the snapshot (:1329). One shared line cannot be true for
   all three. */
describe('#6 — the two release paths do not pay the same forwarding fee', () => {
  it('names the caller-submitted maxFee when approving a no-split cross-chain release', () => {
    expect(paramText(confirm('approve', { maxFee: 450000n })))
      .toContain('Delivery costs up to 0.45 USDC in Circle forwarding fees, deducted from the payout on arrival.')
  })

  /* The permissionless path ignores whatever the caller submitted, so
     showing that figure would name a number the burn never uses. */
  it('names the escrow snapshot for a permissionless release, never the caller-submitted figure', () => {
    const t = paramText(confirm('release', { maxFee: 450000n }))
    expect(t).toContain("Delivery costs up to this escrow's fixed forwarding fee of 0.20 USDC, deducted from the payout on arrival.")
    expect(t).not.toContain('0.45 USDC')
  })

  /* Split legs burn at the snapshot even on the approve path. */
  it('names the snapshot for split legs even when approving', () => {
    const splits = [
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
    ]
    const t = paramText(confirm('approve', { splits, maxFee: 450000n }))
    expect(t).toContain("Each cross-chain split leg pays this escrow's fixed forwarding fee of up to 0.20 USDC, deducted on delivery.")
    expect(t).not.toContain('0.45 USDC')
  })

  /* _approveAndBurn forces maxFee = 0 on Arc (:1343-1346), so any fee line at
     all would be inventing a cost. */
  it('says nothing about forwarding fees for a same-chain Arc release', () => {
    for (const key of ['approve', 'release']) {
      const t = paramText(confirm(key, { escrow: escrowOn(ARC), maxFee: 450000n }))
      expect(t).not.toMatch(/forwarding fee|Delivery costs/i)
    }
  })

  it('still discloses the protocol fee on both paths', () => {
    for (const key of ['approve', 'release']) {
      expect(paramText(confirm(key, { maxFee: 450000n })))
        .toContain('Protocol fee is deducted from this amount before payout.')
    }
  })

  /* An unquoted approve (Arc, or a quote that never ran) must fall back to the
     snapshot rather than printing "up to undefined". */
  it('falls back to the snapshot when no quote was taken', () => {
    const t = paramText(confirm('approve', {}))
    expect(t).toContain("fixed forwarding fee of 0.20 USDC")
    expect(t).not.toMatch(/undefined|NaN/)
  })

  /* A zero or absent snapshot with no quote to fall back on means the fee is
     UNKNOWN, not zero — escrows funded before setFee.js ran carry
     escrowCctpForwardFee = 0, and the Goldsky read can omit the field entirely.
     Falling through to formatUSDC would print "0.00 USDC", which is both wrong
     and reassuring: the burn still pays Circle's live fee out of the payout.
     Saying nothing is the only honest option, so assert on the silence
     directly rather than leaning on the Arc case to cover it incidentally. */
  it('states no forwarding fee at all when the snapshot is zero or absent', () => {
    const zeroed = { ...escrowOn(BASE), escrowCctpForwardFee: 0n }
    const { escrowCctpForwardFee, ...omitted } = escrowOn(BASE)

    for (const escrow of [zeroed, omitted]) {
      // 'approve' with no maxFee is the unquoted path; 'release' discards any
      // quote by construction, so both land on the snapshot branch.
      for (const key of ['approve', 'release']) {
        const t = paramText(confirm(key, { escrow }))
        expect(t).not.toMatch(/forwarding fee|Delivery costs/i)
        // Boundary-anchored: a bare `toContain('0.00 USDC')` also matches
        // inside the milestone's own "250.00 USDC", so it would fail on a
        // correct descriptor. This rejects a standalone zero amount only.
        expect(t).not.toMatch(/(^|[^\d.])0(\.0+)? USDC/)
        // and it is silence about the fee specifically, not an empty descriptor
        expect(t).toContain('Protocol fee is deducted from this amount before payout.')
      }
    }
  })
})

/* #7. "Removing blocks everything / enabling restores everything" is false in
   three specific places, each keyed to a particular domain number. */
describe('#7 — domain toggles have three carve-outs', () => {
  const build = (domain, enabled) => domainConfirm({ domain, domainName: `Domain ${domain}`, enabled })

  /* withdrawRefund returns on the domain-0 sentinel before any supportedDomains
     lookup (:854-859). */
  it('says domain 0 refund withdrawals are unaffected by removal', () => {
    expect(paramText(build(0, true)))
      .toContain('Refund withdrawals are unaffected: domain 0 is the "stay on Arc" sentinel, which never consults this list.')
  })

  it('does not claim enabling domain 0 opens a cross-chain refund route', () => {
    expect(paramText(build(0, false)))
      .toContain('This does not open a cross-chain refund route: domain 0 is the "stay on Arc" sentinel, not a destination.')
  })

  /* Round 15 #7: domain 0's refund-sentinel meaning (withdrawRefund) and its
     ordinary meaning as a real CCTP destination (Ethereum, for redirects) are
     unrelated. F3 restricts redirecting an Arc-funded escrow there exactly
     like any other non-Arc domain — the ADD screen for domain 0 was dropping
     that caveat, unlike every other non-Arc domain. */
  it('still warns that enabling domain 0 does not unblock Arc-funded escrows', () => {
    expect(paramText(build(0, false)))
      .toContain('Escrows funded to pay on Arc still cannot be redirected here — that is blocked separately, not by this list.')
  })

  /* Both redirects read `!= ARC_DOMAIN && !supportedDomains[...]` (:975, :1027),
     so Arc is exempt from the list entirely. */
  it('says Arc redirects survive removing Arc', () => {
    expect(paramText(build(ARC, true)))
      .toContain('Payout redirects to Arc keep working regardless — the contract exempts Arc from this list.')
  })

  /* F3 blocks Arc-funded escrows from going cross-chain regardless of the
     allow-list (:982, :1033), so enabling a domain does not make it reachable
     for every escrow. */
  it('warns that enabling a domain does not unblock Arc-funded escrows', () => {
    expect(paramText(build(BASE, false)))
      .toContain('Escrows funded to pay on Arc still cannot be redirected here — that is blocked separately, not by this list.')
  })

  it('does not attach the Arc-funded caveat to Arc itself', () => {
    expect(paramText(build(ARC, false))).not.toContain('still cannot be redirected here')
  })

  /* Round 14 #7: the removal screen used to state a blanket "blocks
     everything" bullet and then correct part of it in a second, separate
     bullet — the screen arguing with itself. The leading sentence itself now
     has to be accurate, so neither exempt path should be named as blocked
     anywhere in the same sentence as "Blocks". */
  it('does not claim removing domain 0 blocks refund withdrawals (the self-contradiction it used to state)', () => {
    expect(paramText(build(0, true))).not.toMatch(/blocks[^.]*refund withdrawals/i)
  })

  it('does not claim removing Arc blocks redirecting a payout (the self-contradiction it used to state)', () => {
    expect(paramText(build(ARC, true))).not.toMatch(/blocks[^.]*redirect/i)
  })

  it('keeps the ordinary consequences on an ordinary domain', () => {
    expect(paramText(build(BASE, true)))
      .toContain('Escrows already heading to this chain still release and deliver normally.')
  })
})

/* #8. Round 6 established that a treasury rotation does not redirect in-flight
   fees. The old copy said those keep paying "the current address", which is a
   different and wrong claim: escrowTreasury is per-escrow (:345, paid :1269),
   so after two rotations the oldest escrows pay the OLDEST address. */
describe('#8 — each escrow pays the treasury it snapshotted', () => {
  const d = () => protocolTreasuryConfirm({
    currentTreasury: '0x1111111111111111111111111111111111111111',
    newTreasury: '0x2222222222222222222222222222222222222222'
  })

  it('attributes the payment to the escrow deposit, not to "the current address"', () => {
    expect(paramText(d()))
      .toContain('Each in-flight escrow pays whichever treasury address was set at its own deposit')
  })

  it('admits the paying address may be older than the one on screen', () => {
    expect(paramText(d())).toContain('which may be an older address than the one shown above')
  })

  /* The specific wrong phrase must not come back. */
  it('no longer claims in-flight escrows pay the current address', () => {
    const t = `${d().subtitle}\n${paramText(d())}`
    expect(t).not.toMatch(/continue going to the current address/i)
    expect(t).not.toMatch(/keep paying it on release/i)
  })

  it('still states the snapshot protection for future escrows', () => {
    expect(d().subtitle).toContain('keeps paying the address it snapshotted when it was funded')
  })
})

/* #22. resolveDisputeByTimeout carries no role gate (:561) — once the window
   closes, anyone can settle at the fixed 50/50. Until now the only button for
   it sat behind ArbiterPanel's role gate, so the permissionless escape hatch
   was reachable only by the party whose inaction it exists to route around.

   The descriptor is shared with ArbiterPanel's trigger rather than duplicated,
   which is what these assertions pin: the same call described the same way
   from either entry point. */
describe('#22 — the timeout settlement descriptor is shared, not duplicated', () => {
  const splits = []
  const disputed = { index: 1, amount: 250000000n, state: 2 }
  const escrow = { ...escrowOn(ARC), refundTo: '0x4bdbe608ea998b4822476353df9dd83228ffd503' }
  const timeoutAt = 1767225600

  const d = () => timeoutSettlementConfirm({
    escrow, milestone: disputed, index: 1, splits, timeoutAt, bpsDenominator: 10_000n
  })

  it('states the fixed split as something nobody chooses', () => {
    expect(paramText(d()))
      .toContain('Fixed 50/50 split written into the contract — this is not an arbiter ruling and the share cannot be adjusted.')
  })

  it('says explicitly that anyone can submit it', () => {
    expect(paramText(d())).toContain('Anyone can submit this.')
  })

  it('names the permissionless function, not the arbiter ruling', () => {
    expect(d().functionName).toBe('resolveDisputeByTimeout')
  })
})
