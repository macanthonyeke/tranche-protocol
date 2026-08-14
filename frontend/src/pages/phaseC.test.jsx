import { describe, it, expect } from 'vitest'

/* Phase C — eight copy corrections, all of the same kind: a descriptor that
   states more than the contract does. None of these screens was missing
   information; each asserted something specific and false, which is worse on a
   signing screen than saying nothing.

   The failures cluster into three shapes:

   - a cap presented as a charge (#5),
   - a destination presented as certain when the contract has a branch that
     sends the money elsewhere, or nowhere (#9, #11, #12),
   - a timing or a beneficiary asserted for a whole transaction when it is only
     true of one of its halves (#10, #13, #14, #15). */
import {
  mutualSettleConfirm,
  payoutLines,
  refundToLines,
  refundDestinationPhrase,
  proposeMilestoneCancelConfirm,
  milestoneCancelCompletion,
  milestoneCancelBlurb,
  milestoneConfirm,
  cancelEscrowConfirm,
  raiseDisputeConfirm,
  extendDeadlineConfirm
} from './EscrowDetail.jsx'
import { resolveDisputeConfirm, timeoutCreditLines } from './ArbiterPanel.jsx'
import { withdrawRefundConfirm, transferRefundCreditConfirm } from './Settings.jsx'

const ARC = 26
const BASE = 6
const DAY = 24 * 60 * 60

const RECIPIENT = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const DEPOSITOR = '0x2fcbb92566c51e92c1353d0a6a9ac86f10bb1a03'
const REFUND_TO = '0x4bdbe608ea998b4822476353df9dd83228ffd503'
const B32 = (a) => '0x000000000000000000000000' + a.slice(2)

const escrowOn = (domain, over = {}) => ({
  id: 7,
  milestoneCount: 3,
  recipient: RECIPIENT,
  mintRecipient: B32(RECIPIENT),
  depositor: DEPOSITOR,
  refundTo: REFUND_TO,
  destinationDomain: domain,
  escrowCctpForwardFee: 200000n, // 0.20 USDC
  deadline: 1767225600n, // 1 Jan 2026
  ...over
})

const milestone = { index: 1, amount: 250000000n, state: 2 } // 250 USDC
const agreed = (bps) => ({ exists: true, bps: BigInt(bps) })
const paramText = (d) => (d.parameters || []).join('\n')

const splitsOn = (...domains) =>
  domains.map((d) => ({ bps: BigInt(10_000 / domains.length), destinationDomain: d, mintRecipient: B32(RECIPIENT) }))

const resolve = (over = {}) => resolveDisputeConfirm({
  escrow: escrowOn(BASE),
  milestone,
  index: 1,
  splits: [],
  bps: 5000,
  resolutionUri: 'https://ipfs.io/ipfs/bafyRuling',
  maxFee: 450000n,
  canTimeout: false,
  bpsDenominator: 10_000n,
  ...over
})

const settle = (over = {}) => mutualSettleConfirm({
  escrow: escrowOn(BASE),
  milestone,
  splits: [],
  bps: 5000,
  theirs: agreed(5000),
  ...over
})

/* #5. cctpMaxFee is a ceiling, not a price. _approveAndBurn passes it to CCTP
   as maxFee and Circle deducts its own forwarding fee — which may be lower —
   from the burned amount on the destination (TrancheProtocol.sol:874-877). A
   screen that names it as the amount deducted overstates the cost of every
   delivery that comes in under the cap. */
describe('#5 — the forwarding fee is a cap, not a charge', () => {
  it('caps the split-leg fee on an arbiter ruling', () => {
    // resolve()'s default bps (50%) on a cross-chain escrow makes the divert
    // reachable, so this is now a Round 17 Phase A hedge — the "cap, not a
    // charge" property (up to X, not exactly X) still holds inside it.
    const t = paramText(resolve({ splits: splitsOn(BASE, BASE) }))
    expect(t).toContain("pays a forwarding fee of up to 0.20 USDC")
  })

  it('caps the delivery fee on a mutual settlement', () => {
    expect(paramText(settle())).toContain("delivery costs up to this escrow's fixed forwarding fee of 0.20 USDC")
  })

  /* The specific fixed-amount phrasings that were there before must not come
     back — "pays ... fee of 0.20" and "uses ... fee of 0.20" both read as a
     price rather than a limit. */
  it('no longer states the fee as an amount that is simply taken', () => {
    const t = `${paramText(resolve({ splits: splitsOn(BASE, BASE) }))}\n${paramText(settle())}`
    expect(t).not.toMatch(/fee of 0\.20 USDC, deducted/)
    expect(t).not.toMatch(/delivery uses this escrow's fixed forwarding fee/i)
  })
})

/* #9. refundTo is whatever address the depositor passed; it falls back to the
   depositor only when address(0) was supplied (:274-275). Every refund path
   credits it (:715, :809, :1091, :1241), so "refund the payer" is a guess the
   contract never makes. */
describe('#9 — refunds go to refundTo, which need not be the payer', () => {
  it('discloses the divergence when refundTo is not the depositor', () => {
    const lines = refundToLines(escrowOn(ARC))
    expect(lines[0]).toBe(`Credited to: ${REFUND_TO}`)
    expect(lines[1]).toBe("That is this escrow's configured refund address, not the payer's own wallet.")
  })

  /* The ordinary case must stay quiet, or the disclosure becomes noise that
     signers learn to skip on the screens where it matters. */
  it('stays silent when refundTo is the depositor', () => {
    expect(refundToLines(escrowOn(ARC, { refundTo: DEPOSITOR }))).toEqual([`Credited to: ${DEPOSITOR}`])
  })

  it('compares addresses case-insensitively', () => {
    const mixed = escrowOn(ARC, { refundTo: DEPOSITOR.toUpperCase().replace('0X', '0x') })
    expect(refundToLines(mixed)).toHaveLength(1)
  })

  /* Titles are the part a signer reads first, and three of them named a
     beneficiary the transaction does not necessarily have. */
  it('no longer names the payer as the beneficiary in any refund title', () => {
    const titles = [
      proposeMilestoneCancelConfirm({ escrow: escrowOn(ARC), milestone, role: 'payer', otherProposed: true }).title,
      milestoneConfirm({ key: 'refund', fn: 'refundAfterDeadline' }, escrowOn(ARC), { ...milestone, state: 0 }, []).title,
      cancelEscrowConfirm({ escrow: escrowOn(ARC), milestones: [{ index: 0, amount: 1n, state: 0 }], otherApproved: true }).title
    ]
    for (const title of titles) {
      expect(title).not.toMatch(/the payer/i)
    }
  })

  it('carries the disclosure through to the refund descriptors themselves', () => {
    const refund = milestoneConfirm({ key: 'refund', fn: 'refundAfterDeadline' }, escrowOn(ARC), { ...milestone, state: 0 }, [])
    expect(paramText(refund)).toContain("That is this escrow's configured refund address, not the payer's own wallet.")
  })

  /* Round 14 #9: Round 13 reached refundAfterDeadline, proposeMilestoneCancel
     and cancelEscrowConfirm, but not mutualSettle's own two branches — both
     still said flatly "the payer's refund balance" regardless of what
     refundTo actually was. */
  it('carries the disclosure through the settlement proposal (would-settle branch)', () => {
    const t = paramText(settle({ theirs: { exists: false, bps: 0n } }))
    expect(t).toContain(`Credited to: ${REFUND_TO}`)
    expect(t).toContain("That is this escrow's configured refund address, not the payer's own wallet.")
    expect(t).not.toMatch(/credited to the payer's refund balance/)
  })

  it('carries the disclosure through the settlement execution (agreed branch)', () => {
    const t = paramText(settle())
    expect(t).toContain(`Credited to: ${REFUND_TO}`)
    expect(t).toContain("That is this escrow's configured refund address, not the payer's own wallet.")
    expect(t).not.toMatch(/The payer's share is credited/)
  })

  /* The mutual-cancel card's own prose (not the confirm descriptor) had the
     same flat "the payer's refund balance" line — refundDestinationPhrase is
     what CancelCard renders inline. */
  it('hedges the mutual-cancel card copy the same way, and stays quiet in the ordinary case', () => {
    expect(refundDestinationPhrase(escrowOn(ARC))).toBe(
      "this escrow's configured refund address, not necessarily the payer's own wallet"
    )
    expect(refundDestinationPhrase(escrowOn(ARC, { refundTo: DEPOSITOR }))).toBe("the payer's refund balance")
  })
})

/* #10. "Pays both sides immediately" was true of neither side. The payer's
   half is a refund credit that is never sent anywhere (:1241); the
   freelancer's is a safeTransfer inside the transaction on Arc (:1343-1346)
   but a burn Circle mints minutes later when cross-chain. And both figures are
   gross — escrowFeeBps comes off the freelancer's share (:1270-1271). */
describe('#10 — credit, transfer and pending delivery are three different things', () => {
  it('does not claim an arbiter ruling pays both sides immediately', () => {
    expect(resolve().subtitle).not.toMatch(/pays both sides immediately/i)
  })

  it('does not claim a mutual settlement pays out immediately', () => {
    expect(settle().subtitle).not.toMatch(/pays out immediately/i)
  })

  it('says a cross-chain share arrives later, on both screens', () => {
    // resolve()/settle()'s defaults (a 50% cross-chain ruling/settlement)
    // make the divert reachable, so this is a Round 17 Phase A hedge now —
    // the "arrives later, not instant" property still holds inside it.
    for (const t of [paramText(resolve()), paramText(settle())]) {
      expect(t).toContain("it leaves Arc on this transaction but only arrives once Circle's cross-chain delivery completes, which is not instant.")
    }
  })

  it('says an Arc share moves within the transaction, on both screens', () => {
    const t = `${paramText(resolve({ escrow: escrowOn(ARC) }))}\n${paramText(settle({ escrow: escrowOn(ARC) }))}`
    expect(t).not.toMatch(/not instant/)
    expect(t).toContain("The freelancer's share is transferred on Arc as this transaction executes.")
  })

  /* The proposal screen's figures are what WOULD happen, and it stated both as
     plain payments. The payer's is a credit; the freelancer's is pre-fee. */
  it('distinguishes gross from credited on the settlement proposal', () => {
    const t = paramText(settle({ theirs: { exists: false, bps: 0n } }))
    // Round 14 #9: dropped "credited to the payer's refund balance" — the
    // real destination now comes from refundToLines, tested separately above.
    expect(t).toContain("Would settle at 125.00 USDC to the freelancer before the protocol fee, and 125.00 USDC credited as a refund balance.")
    expect(t).not.toMatch(/Would pay .* to the payer/)
  })

  /* A 0% ruling pays the freelancer nothing, so the delivery-timing line would
     be describing a transfer that does not happen. */
  it('says nothing about delivery timing when the freelancer gets nothing', () => {
    expect(paramText(resolve({ bps: 0 }))).not.toMatch(/arrives once Circle|transferred on Arc as this/)
  })
})

/* #11. Neither split loop pays every configured recipient. Both are guarded by
   `share > 0` (:608, :1312), so a leg whose proportional share rounds down to
   zero is skipped outright — no credit, no burn, no event. */
describe('#11 — a configured split recipient does not always receive value', () => {
  it('drops the "each on their own chain" promise from the payout line', () => {
    const lines = payoutLines(escrowOn(BASE), splitsOn(BASE, BASE))
    // Round 15 #11: "most delivered" (Round 14's fix) was itself still an
    // unsupported quantifier. Round 16 #1: "Paid to: N split recipients"
    // (what Round 15 replaced it with) was STILL an outcome claim — it
    // asserts N recipients were paid, which rounding and the sub-floor
    // divert can both make false. The leading line now states only the
    // escrow's CONFIGURATION (N split entries exist, with their own
    // share/chain), not a headcount of who got paid.
    expect(lines[0]).toBe('2 configured split entries, by their configured share and destination chain')
    expect(lines[0]).not.toMatch(/\beach\b|\bmost\b|\ball\b|\bevery\b|\bsome\b|\bhalf\b|\bmajority\b|\bpaid\b|\breceiv\w*\b|%|\d+ of \d+/i)
    expect(lines.join('\n')).not.toMatch(/each (on their own|to their configured) chain/)
  })

  it('states the rounding case on the payout line', () => {
    expect(payoutLines(escrowOn(BASE), splitsOn(BASE, BASE)).join('\n'))
      .toContain('A recipient whose share rounds down to zero is paid nothing.')
  })

  it('states it on the timeout credit lines too', () => {
    expect(timeoutCreditLines(escrowOn(ARC), splitsOn(ARC, ARC)).join('\n'))
      .toContain('A recipient whose share rounds down to zero is credited nothing.')
  })

  it('states it on an arbiter ruling over a split escrow', () => {
    expect(paramText(resolve({ splits: splitsOn(BASE, BASE) })))
      .toContain('A recipient whose share rounds down to zero is paid nothing.')
  })

  /* A no-split escrow has exactly one destination and no rounding step, so the
     caveat would be describing a branch that cannot execute. */
  it('does not attach the caveat to a no-split escrow', () => {
    const t = `${payoutLines(escrowOn(BASE), []).join('\n')}\n${paramText(resolve())}`
    expect(t).not.toMatch(/rounds down to zero/)
  })
})

/* #12. The refund branch calls _checkEscrowCompletion (:814), which flips the
   escrow to COMPLETED once every milestone is RELEASED(3) or REFUNDED(4)
   (:722-733). Cancelling the last nonterminal milestone therefore ends the
   engagement — the opposite of what the screen promised. */
describe('#12 — cancelling the last nonterminal milestone completes the escrow', () => {
  const cancel = (milestones) =>
    proposeMilestoneCancelConfirm({ escrow: escrowOn(ARC), milestone, milestones, role: 'payer', otherProposed: true })

  const carriesOn = [
    { index: 0, amount: 1n, state: 3 },
    { index: 1, amount: 250000000n, state: 1 },
    { index: 2, amount: 1n, state: 0 }
  ]
  const lastOne = [
    { index: 0, amount: 1n, state: 3 },
    { index: 1, amount: 250000000n, state: 1 },
    { index: 2, amount: 1n, state: 4 }
  ]

  it('says the escrow completes when every sibling has already settled', () => {
    const t = paramText(cancel(lastOne))
    expect(t).toContain('Every other milestone has already settled, so this completes the whole escrow — nothing carries on afterwards.')
    expect(t).not.toMatch(/rest of the escrow carries on/)
  })

  it('keeps the ordinary wording when a sibling is still running', () => {
    const t = paramText(cancel(carriesOn))
    expect(t).toContain('The rest of the escrow carries on — only this milestone is cancelled.')
    expect(t).not.toMatch(/completes the whole escrow/)
  })

  /* Both readings are consequential, so an unreadable milestone list must
     produce neither claim rather than defaulting to the friendlier one. */
  it('claims neither when the milestone list cannot be reconciled', () => {
    for (const list of [undefined, [], [{ index: 1, amount: 1n, state: 1 }]]) {
      const t = paramText(cancel(list))
      expect(t).not.toMatch(/carries on|completes the whole escrow/)
    }
  })

  /* The panel's own blurb sits directly above the button and made the same
     claim, but with only two branches — so an unreconciled list fell through to
     "the rest of the escrow continues", the exact sentence the descriptor
     refuses to say. Both now read the same flags off one helper.

     Not reachable through the app today: getEscrowDetail sizes `milestones` as
     new Milestone[](e.milestoneCount) in the call that returns the escrow
     (:1163-1184), useEscrowDetail derives both from that one response, and the
     page renders a skeleton until it lands. This pins the guard on the exported
     helpers, where a future caller can supply a partial list. */
  describe('the panel blurb agrees with the descriptor', () => {
    const flags = (milestones) => milestoneCancelCompletion(escrowOn(ARC), 1, milestones)

    it('makes no claim either way when the list cannot be reconciled', () => {
      for (const list of [undefined, [], [{ index: 1, amount: 1n, state: 1 }]]) {
        const text = milestoneCancelBlurb(flags(list))
        expect(text).not.toMatch(/rest of the escrow continues|completes the whole escrow/)
        expect(text).toBe('Both the payer and freelancer must propose. Once both agree, this milestone is refunded.')
      }
    })

    it('says the escrow continues when a sibling is still running', () => {
      expect(milestoneCancelBlurb(flags(carriesOn))).toContain('the rest of the escrow continues')
    })

    it('says the escrow completes when this is the last nonterminal milestone', () => {
      expect(milestoneCancelBlurb(flags(lastOne))).toContain('that completes the whole escrow')
    })

    /* The point of sharing the helper: for any given input the two surfaces
       reach the same conclusion, so a signer cannot read one thing on the page
       and the opposite on the signing screen. */
    it('never disagrees with the descriptor about the same input', () => {
      for (const list of [undefined, [], carriesOn, lastOne]) {
        const blurb = milestoneCancelBlurb(flags(list))
        const params = paramText(cancel(list))
        expect(/completes the whole escrow/.test(blurb)).toBe(/completes the whole escrow/.test(params))
        expect(/rest of the escrow continues/.test(blurb)).toBe(/rest of the escrow carries on/.test(params))
      }
    })
  })
})

/* #13. raiseDispute does not hand the milestone to an arbiter. mutualSettle
   accepts DISPUTED explicitly (:534), so the parties can still settle it
   between themselves, and resolveDisputeByTimeout has no role gate (:561), so
   anyone can close it at 50/50 once ARBITER_WINDOW elapses. Telling a signer
   the arbiter decides invites exactly the waiting the timeout exists for. */
describe('#13 — an arbiter is not the only way out of a dispute', () => {
  const d = () => raiseDisputeConfirm({ escrow: escrowOn(ARC), milestone, reason: 'Not delivered', uri: 'ipfs://x' })

  it('names both non-arbiter exits', () => {
    expect(paramText(d())).toContain('An arbiter is not the only way out: you and the other party can still agree a split directly, and if no arbiter rules within the arbitration window, anyone can settle it at a fixed 50/50.')
  })

  it('no longer says the dispute is handed to the arbiter to decide', () => {
    expect(d().subtitle).not.toMatch(/hands it to the arbiter/i)
  })

  it('still says the dispute cannot be withdrawn', () => {
    expect(d().subtitle).toContain('cannot be withdrawn once raised')
  })
})

/* #14. F5: both refund actions delete any pending two-step recovery proposal
   targeting the caller (:851-852, :897-898). Correct — a wallet that can
   transact does not need recovering — but it silently destroys a
   RECOVERY_MANAGER's in-flight proposal and restarts the 14-day clock. */
describe('#14 — the refund actions silently cancel a pending recovery', () => {
  const DISCLOSURE = 'Cancels any pending recovery proposal for this wallet. If someone is recovering this wallet on your behalf, they will have to start again.'

  it('discloses it when withdrawing', () => {
    expect(paramText(withdrawRefundConfirm({ balance: 1000000n, recipient: RECIPIENT, signer: RECIPIENT })))
      .toContain(DISCLOSURE)
  })

  it('discloses it when transferring the credit', () => {
    expect(paramText(transferRefundCreditConfirm({ balance: 1000000n, recipient: RECIPIENT })))
      .toContain(DISCLOSURE)
  })
})

/* #15. Two errors in one line. refundAfterDeadline's guard is
   `block.timestamp <= deadline + GRACE` (:703), so the refund opens strictly
   after that instant — a signer who submits at the stated time is reverted. And
   it credits e.refundTo (:715), not the caller, so "refundable to you" names
   the wrong party whenever refundTo was configured. */
describe('#15 — the refund date is a threshold to pass, not a date to arrive at', () => {
  const d = () => extendDeadlineConfirm({
    escrow: escrowOn(ARC),
    newDeadline: Number(escrowOn(ARC).deadline) + 30 * DAY
  })

  it('says refunds open after the date, not from it', () => {
    const t = paramText(d())
    expect(t).toMatch(/refundable only after /)
    expect(t).toContain('72 hours past the new deadline, not at it')
    expect(t).not.toMatch(/refundable to you from /)
  })

  it('names the refund address rather than the signer', () => {
    const t = paramText(d())
    expect(t).toContain(`Refunds are credited to this escrow's refund address, ${REFUND_TO}`)
    expect(t).not.toMatch(/refundable to you/)
  })
})
