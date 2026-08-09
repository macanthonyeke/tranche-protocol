import { describe, it, expect, vi, afterEach } from 'vitest'

/* Confirm-screen descriptors for the four milestone actions, plus the payout
   lines they embed. Both are pure, and both are the ONLY description a UCW
   user gets of a money-moving call — none of the four actions has an app-side
   confirmation in front of it — so the properties that matter here are about
   what the descriptor must never claim, not just what it says.

   The real functions are imported rather than restated; descriptors are then
   pushed through the real buildContractInteraction, because "has no amount
   key" only matters via that function's hasAmount check, which is what
   decides whether Circle renders a currency row at all. */
import { payoutLines, milestoneConfirm } from './EscrowDetail.jsx'
import { buildContractInteraction } from '../utils/circleTheme.js'

afterEach(() => { vi.restoreAllMocks() })

const RECIPIENT = '0x4bdbe608ea998b4822476353df9dd83228ffd503'
const MINT_RECIPIENT_B32 = '0x000000000000000000000000' + RECIPIENT.slice(2)
const FALLBACK_RECIPIENT = '0x1a260601f65a1c270a1cabf65c09f2f31c0869a5'
const REFUND_TO = '0x179cc4c8f23d257b7f4acb785464025570e3af86'

// Domain 6 is Base Sepolia in config/chains.js — a non-Arc domain, so a
// cross-chain payout, which is the case where naming the wrong destination
// would matter most.
const escrow = {
  id: 7,
  recipient: FALLBACK_RECIPIENT,
  refundTo: REFUND_TO,
  mintRecipient: MINT_RECIPIENT_B32,
  destinationDomain: 6,
  milestoneCount: 3,
  totalAmount: 600000000n
}

const milestone = { index: 1, amount: 250000000n, state: 1 }

const SPLITS = [
  { mintRecipient: MINT_RECIPIENT_B32, destinationDomain: 6, bps: 6000n },
  { mintRecipient: MINT_RECIPIENT_B32, destinationDomain: 0, bps: 4000n }
]

const paramText = (d) => (d.parameters || []).join('\n')

describe('payoutLines', () => {
  /* A split escrow pays each leg to its own address on its own domain. Naming
     escrow.mintRecipient there would put a single address on the screen that
     is not where the money goes. */
  it('describes the split as a CONFIGURATION fact, not a headcount of who got paid', () => {
    const lines = payoutLines(escrow, SPLITS)

    // Round 15 #11: "most delivered" was itself still an unsupported
    // quantifier — nothing in the contract guarantees a majority of legs
    // clear the rounding/floor thresholds. Round 16 #1: "Paid to: N split
    // recipients" (what Round 15 replaced it with) was STILL an outcome
    // claim — it asserts N recipients were paid, which rounding and the
    // sub-floor divert can both make false. The leading line now states only
    // the escrow's configuration (N split entries exist, with their own
    // share/chain), leaving what actually happens to the caveats below.
    expect(lines).toEqual([
      '2 configured split entries, by their configured share and destination chain',
      'A recipient whose share rounds down to zero is paid nothing.'
    ])
    // No claim of who got paid, or how many, at all in the leading line —
    // checked for absence, not just replaced with new exact wording, so a
    // future rewrite can't reintroduce "most"/"each"/"paid to N" without
    // this catching it.
    expect(lines[0]).not.toMatch(/\beach\b|\bmost\b|\ball\b|\bevery\b|\bsome\b|\bhalf\b|\bmajority\b|\bpaid\b|\breceiv\w*\b|%|\d+ of \d+/i)
    expect(lines.join('\n')).not.toContain(RECIPIENT)
    expect(lines.join('\n')).not.toContain(FALLBACK_RECIPIENT)
  })

  /* Round 16 #2: a DIFFERENT failure mode from the rounds-to-zero caveat
     above — a nonzero cross-chain share that still can't clear this
     escrow's forwarding-fee floor lands as an Arc credit instead of its
     configured chain (TrancheProtocol.sol:1291, :1319). Only surfaces when
     the caller says the sub-floor divert is actually reachable (`partial`
     AND `crossChain`) — a full release can never hit it (see the function's
     own doc comment), so omitting the options must not silently print a
     caveat that does not apply to that call. */
  describe('the sub-floor divert-to-Arc caveat', () => {
    it('is absent by default (a full release cannot reach it)', () => {
      expect(payoutLines(escrow, SPLITS).join('\n')).not.toMatch(/credited on Arc/i)
      expect(payoutLines(escrow, []).join('\n')).not.toMatch(/credited on Arc/i)
    })

    it('is present, and distinct from the rounds-to-zero caveat, for a reachable split payout', () => {
      const lines = payoutLines(escrow, SPLITS, { partial: true, crossChain: true, floor: 200000n })
      expect(lines).toContain('A recipient whose share rounds down to zero is paid nothing.')
      expect(lines).toContain('Any split leg whose share falls to 0.20 USDC or less is credited on Arc instead of being delivered to its chain.')
    })

    it('names escrow.recipient — not the redirectable mintRecipient — as the no-split divert destination', () => {
      const lines = payoutLines(escrow, [], { partial: true, crossChain: true, floor: 200000n })
      expect(lines).toContain(`If it does not clear the floor, it is credited on Arc to ${escrow.recipient} instead — no cross-chain delivery.`)
    })

    it('stays absent when crossChain is false even if partial is true (an Arc leg is never diverted)', () => {
      expect(payoutLines(escrow, SPLITS, { partial: true, crossChain: false, floor: 200000n }).join('\n'))
        .not.toMatch(/credited on Arc/i)
    })
  })

  /* Round 17 Phase A: a fifth Codex pass found that when the divert is
     reachable, this used to state "Paid to: X" / "Paid on: Y" as fact and
     append a caveat correcting it afterward if the divert actually fired —
     the frontend cannot compute the exact post-fee amount (no getter for
     escrowFeeBps), so it genuinely does not know in advance which branch
     fires. The bug that survived two prior rounds' review of this same
     function was tested only for the CAVEAT'S presence, never for whether
     the unconditional claim it was supposed to be replacing had actually
     gone away — so this checks absence, not just addition. */
  describe('the no-split destination hedges instead of asserting when the divert is reachable', () => {
    it('drops the unconditional "Paid to:" / "Paid on:" lines entirely', () => {
      const lines = payoutLines(escrow, [], { partial: true, crossChain: true, floor: 200000n })
      expect(lines.join('\n')).not.toMatch(/^Paid to:|^Paid on:/m)
    })

    it('states both possible destinations as one conditional, not one fact plus a correction', () => {
      const lines = payoutLines(escrow, [], { partial: true, crossChain: true, floor: 200000n })
      expect(lines).toEqual([
        `If this amount clears this escrow's forwarding-fee floor, it is paid to ${RECIPIENT} on Base Sepolia.`,
        `If it does not clear the floor, it is credited on Arc to ${escrow.recipient} instead — no cross-chain delivery.`
      ])
    })

    it('keeps the plain unconditional lines when the divert is not reachable (partial false, crossChain false, or omitted)', () => {
      const plain = [`Paid to: ${RECIPIENT}`, 'Paid on: Base Sepolia']
      expect(payoutLines(escrow, [])).toEqual(plain)
      expect(payoutLines(escrow, [], { partial: false, crossChain: true, floor: 200000n })).toEqual(plain)
      expect(payoutLines(escrow, [], { partial: true, crossChain: false, floor: 200000n })).toEqual(plain)
    })
  })

  it('decodes mintRecipient and names the destination chain when there is no split', () => {
    for (const splits of [undefined, null, []]) {
      expect(payoutLines(escrow, splits)).toEqual([
        `Paid to: ${RECIPIENT}`,
        'Paid on: Base Sepolia'
      ])
    }
  })

  /* mintRecipient is the redirectable payout target; escrow.recipient is the
     counterparty. They are usually the same address, so this fallback is only
     ever visible when mintRecipient is unset — and getting it wrong would
     silently show the wrong party on a signing screen. */
  it('falls back to escrow.recipient when mintRecipient is unset', () => {
    expect(payoutLines({ ...escrow, mintRecipient: null }, [])).toEqual([
      `Paid to: ${FALLBACK_RECIPIENT}`,
      'Paid on: Base Sepolia'
    ])
  })
})

describe('milestoneConfirm — claimDelivery', () => {
  const d = () => milestoneConfirm({ key: 'claim', fn: 'claimDelivery' }, escrow, milestone, [])

  /* claimDelivery moves nothing; it sets IN_REVIEW and starts the clock. The
     `amount` key must be ABSENT, not falsy — buildContractInteraction's
     hasAmount check treats 0n as a real figure and would render a currency
     row reading "0.00 USDC", while undefined omits the row entirely. */
  it('carries no amount key at all', () => {
    expect(d()).not.toHaveProperty('amount')
    expect(Object.keys(d())).not.toContain('amount')
  })

  it('produces no currency row once built for Circle', () => {
    const built = buildContractInteraction(d())
    expect(built).not.toHaveProperty('mainCurrency')
    expect(built).not.toHaveProperty('total')
    expect(built).not.toHaveProperty('totalLabel')
  })

  it('says outright that no funds move', () => {
    expect(d().parameters).toContain('No funds move on this transaction.')
  })
})

describe('milestoneConfirm — refundAfterDeadline', () => {
  const d = () => milestoneConfirm({ key: 'refund', fn: 'refundAfterDeadline' }, escrow, milestone, [])

  it('reports the milestone amount as the refunded figure', () => {
    expect(d().amount).toBe(milestone.amount)
    expect(d().amountLabel).toBe('Amount refunded')
  })

  /* The contract does refundBalances[e.refundTo] += m.amount — a credit on
     Arc, no transfer and no CCTP leg. "Paid to" would send the payer looking
     in their wallet for money that is sitting in a withdrawable balance. */
  it('says credited to the refund address, never paid or sent to it', () => {
    expect(paramText(d())).toContain(`Credited to: ${REFUND_TO}`)
    expect(paramText(d())).not.toContain('Paid to:')
    expect(paramText(d())).not.toContain('Paid on:')
  })

  it('spells out that the balance is withdrawable on Arc rather than in a wallet', () => {
    expect(paramText(d())).toMatch(/withdrawable refund balance on Arc/)
  })
})

/* approve and release differ in who may call and why, but both move the same
   milestone out of escrow to the same destination — so they owe the identical
   set of guarantees. Running one table over both also pins the fact that
   'release' comes from its own branch, not from a fallthrough. */
describe.each([
  ['approve', 'approveRelease'],
  ['release', 'release']
])('milestoneConfirm — %s', (key, fn) => {
  const d = () => milestoneConfirm({ key, fn }, escrow, milestone, [])

  it('reports the milestone amount as the released figure', () => {
    expect(d().amount).toBe(milestone.amount)
    expect(d().amountLabel).toBe('Amount released')
  })

  /* Literal expectations. Looping over payoutLines(...) and asserting the
     descriptor contains them is circular — both sides come from the same
     helper, so it holds even if that helper prints the wrong address. */
  it('embeds the real payout destination lines', () => {
    expect(d().parameters).toContain(`Paid to: ${RECIPIENT}`)
    expect(d().parameters).toContain('Paid on: Base Sepolia')
    // The stale field must not appear in its place.
    expect(d().parameters.join('\n')).not.toContain(FALLBACK_RECIPIENT)
  })

  it('discloses that the protocol fee comes out of the figure shown', () => {
    expect(d().parameters).toContain('Protocol fee is deducted from this amount before payout.')
  })

  /* Gross, never net: the fee actually applied is escrowFeeBps, snapshotted at
     deposit and unreadable from the frontend. Any USDC figure beyond the
     milestone amount itself would have been derived from the live global and
     could be wrong. */
  it('quotes no figure other than the milestone amount', () => {
    const amounts = paramText(d()).match(/[\d,]+\.\d\d USDC/g) || []
    expect(amounts).toEqual(['250.00 USDC'])
  })

  it('carries the milestone position and the correct function name', () => {
    expect(paramText(d())).toContain('Milestone 2 of 3: 250.00 USDC')
    expect(d().functionName).toBe(fn)
  })
})

describe('milestoneConfirm — unrecognised action key', () => {
  const d = () => milestoneConfirm({ key: 'somethingNew', fn: 'someNewFn' }, escrow, milestone, [])

  /* computeMilestoneAction returns a closed set of four keys today. A fifth
     added without a descriptor here must not inherit release's copy AND its
     Total row — that is a signing screen confidently describing a different
     transaction than the one being signed. */
  it('does not silently produce a release descriptor', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const release = milestoneConfirm({ key: 'release', fn: 'release' }, escrow, milestone, [])

    expect(d().title).not.toBe(release.title)
    expect(d().subtitle).not.toBe(release.subtitle)
    expect(d().parameters).not.toContain('Protocol fee is deducted from this amount before payout.')
  })

  it('claims no amount for an action whose value it cannot know', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(d()).not.toHaveProperty('amount')
    expect(buildContractInteraction(d())).not.toHaveProperty('mainCurrency')
  })

  it('warns, so the missing descriptor is visible rather than silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    d()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('somethingNew'))
  })

  it('still names the real function being called', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(d().functionName).toBe('someNewFn')
  })
})
