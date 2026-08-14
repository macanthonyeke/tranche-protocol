import { describe, it, expect } from 'vitest'

/* The two payout redirects. Nominally CONFIG-CHANGE, but they decide where
   money later goes, so the properties under test are the ones a value-moving
   site would get.

   Two things drive nearly all of these: the redirect is NOT snapshotted (it
   takes effect on everything unsettled, unlike Round 6's protocol setters),
   and F3 makes an Arc → cross-chain redirect revert while the dropdown still
   offers it. */
import { redirectPayoutConfirm, redirectSplitConfirm } from './EscrowDetail.jsx'
import { buildContractInteraction } from '../utils/circleTheme.js'

const OLD_ADDR = '0x4bdbe608ea998b4822476353df9dd83228ffd503'
const NEW_ADDR = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const B32 = (a) => '0x000000000000000000000000' + a.slice(2)

const ARC = 26
const BASE = 6          // Base Sepolia
const ETH = 0           // Ethereum Sepolia — see the sentinel test below
const OP = 2            // OP Sepolia

const escrowOn = (domain) => ({
  id: 7,
  recipient: OLD_ADDR,
  mintRecipient: B32(OLD_ADDR),
  destinationDomain: domain,
  milestoneCount: 3
})

const paramText = (d) => (d.parameters || []).join('\n')

// The real rejection sentence, so the negative assertions below track the copy
// rather than a paraphrase of it.
const REDIRECT_BLOCKED_TEXT =
  'An escrow paying on Arc cannot be moved to another chain after deposit'

describe('redirectPayoutConfirm — an allowed redirect', () => {
  const d = () => redirectPayoutConfirm({
    escrow: escrowOn(BASE), hasSplits: false, newAddress: NEW_ADDR, newDomain: OP
  })

  it('carries no amount and renders no currency row', () => {
    expect(d()).not.toHaveProperty('amount')
    expect(buildContractInteraction(d())).not.toHaveProperty('mainCurrency')
  })

  it('states both the address and the chain as old → new', () => {
    expect(paramText(d())).toContain(`Address: ${OLD_ADDR} → ${NEW_ADDR}`)
    expect(paramText(d())).toContain('Chain: Base Sepolia → OP Sepolia')
  })

  /* The opposite of Round 6's protocol setters. mintRecipient and
     destinationDomain are read at release time, never snapshotted, so this
     reaches milestones that already exist — including one already claimed and
     waiting on the payer. */
  /* Round 15 #6: the leading sentence itself now names the timeout exception
     rather than a separate line appended after it — "every milestone" was
     never quite true of a milestone that times out with no arbiter ruling,
     which always pays the ORIGINAL recipient regardless of this redirect. */
  it('says it applies to everything unsettled, including milestones in review, except a timeout', () => {
    const t = paramText(d())
    expect(t).toContain('Applies to every milestone not yet released and settled through approval, dispute resolution, or mutual agreement, including any currently in review.')
    expect(t).toContain("A milestone that times out with no arbiter ruling is the one exception — it always pays the escrow's original recipient, never this redirected address.")
  })

  it('does not claim in-flight milestones are protected', () => {
    expect(paramText(d())).not.toMatch(/not affected|unaffected by this|keep the value they snapshotted/)
    expect(paramText(d())).toContain('Milestones already released are unaffected and cannot be recalled.')
  })

  /* Round 16 #1: the subtitle used to independently claim "takes effect
     immediately for everything not yet released" — the same completeness
     claim the leading parameter above already states, including its
     timeout exception. Two fields asserting the same fact is exactly how
     they drifted apart across rounds (the parameter got the Round 15 fix,
     the subtitle didn't); the subtitle now states only what's
     unconditionally true — the write happens now — and defers scope
     entirely to the parameter tested above. */
  it('does not duplicate the scope/exception claim in the subtitle', () => {
    const dd = d()
    expect(dd.subtitle).not.toMatch(/everything not yet released|every milestone/i)
    expect(dd.subtitle).toBe('Redirects your milestone payments to a different address, effective immediately.')
  })

  it('names the real function', () => {
    expect(d().functionName).toBe('updateReceivingAddress')
  })

  it('falls back to escrow.recipient when mintRecipient is unset', () => {
    const e = { ...escrowOn(BASE), mintRecipient: null }
    expect(paramText(redirectPayoutConfirm({ escrow: e, hasSplits: false, newAddress: NEW_ADDR, newDomain: OP })))
      .toContain(`Address: ${OLD_ADDR} → ${NEW_ADDR}`)
  })
})

/* F3 (TrancheProtocol.sol:982): an Arc escrow cannot become cross-chain after
   deposit, because its milestones were never floor-validated against the
   forwarding fee. The chain dropdown does not filter this out. */
describe('redirectPayoutConfirm — F3-blocked Arc → cross-chain', () => {
  const d = () => redirectPayoutConfirm({
    escrow: escrowOn(ARC), hasSplits: false, newAddress: NEW_ADDR, newDomain: BASE
  })

  it('says the transaction will not go through', () => {
    expect(d().subtitle).toBe('This transaction will not go through.')
  })

  it('explains why, in terms of the escrow rather than the error name', () => {
    expect(paramText(d())).toMatch(/cannot be moved to another chain after deposit/)
    expect(paramText(d())).not.toMatch(/MilestoneBelowForwardFee/)
  })

  it('offers the redirect that would work', () => {
    expect(paramText(d())).toContain('You can still change the address while staying on Arc.')
  })

  /* A blocked call changes nothing, so it must not describe a change as if it
     will happen. */
  it('does not promise the address change', () => {
    expect(paramText(d())).not.toMatch(/^Address: /m)
    expect(paramText(d())).not.toMatch(/Applies to every milestone/)
  })
})

describe('redirectPayoutConfirm — the directions F3 allows', () => {
  const build = (from, to, hasSplits = false) => redirectPayoutConfirm({
    escrow: escrowOn(from), hasSplits, newAddress: NEW_ADDR, newDomain: to
  })

  /* Asserting the ALLOWED descriptor positively. Excluding one exact rejection
     sentence passes for any other wrong output too — including a reworded
     block, or the split no-op branch. */
  const allows = (d) => {
    expect(d.parameters.join('\n')).toContain('Applies to every milestone not yet released and settled through approval, dispute resolution, or mutual agreement, including any currently in review.')
    expect(d.parameters.join('\n')).not.toContain(REDIRECT_BLOCKED_TEXT)
    expect(d.subtitle).toContain('Redirects your milestone payments')
  }

  it('allows cross-chain → cross-chain', () => {
    allows(build(BASE, OP))
  })

  it('allows cross-chain → Arc', () => {
    allows(build(BASE, ARC))
  })

  it('allows Arc → Arc', () => {
    allows(build(ARC, ARC))
  })

  /* The carve-out at :982: with splits configured, e.destinationDomain is not
     what the burn uses, so the F3 guard does not apply and the call is not
     blocked. Asserting the blocked TEXT rather than an exact subtitle, so the
     split branch (which is also not blocked, and also not the allowed one)
     cannot satisfy this by accident. */
  it('is not F3-blocked when the escrow has splits', () => {
    expect(paramText(build(ARC, BASE, true))).not.toContain(REDIRECT_BLOCKED_TEXT)
    expect(paramText(build(ARC, BASE, false))).toContain(REDIRECT_BLOCKED_TEXT)
  })
})

/* Not blocked is not the same as effective. With splits configured the burn
   loop reads s[i].mintRecipient exclusively (:1280-1332) and never consults
   e.mintRecipient, so updateReceivingAddress succeeds and moves no payout at
   all. Promising a redirect here costs a signature and a fee for nothing. */
describe('redirectPayoutConfirm — a split escrow makes this a no-op', () => {
  const build = (hasSplits) => redirectPayoutConfirm({
    escrow: escrowOn(BASE), hasSplits, newAddress: NEW_ADDR, newDomain: OP
  })

  it('says payouts follow the split recipients instead', () => {
    expect(paramText(build(true))).toContain('Payouts follow the split recipients, not this address. The transaction will succeed but no payment will change destination.')
  })

  it('does not promise the redirect applies to unreleased milestones', () => {
    expect(paramText(build(true))).not.toContain('Applies to every milestone not yet released')
  })

  it('points at the split row as the thing that does work', () => {
    expect(paramText(build(true))).toContain('To redirect your own share, use the split address row instead.')
  })

  it('leaves the no-split case promising a real redirect', () => {
    expect(paramText(build(false))).toContain('Applies to every milestone not yet released')
    expect(paramText(build(false))).not.toContain('Payouts follow the split recipients')
  })
})

/* Domain 0 is Ethereum Sepolia HERE. In Settings.jsx's withdrawRefund, 0 is
   the sentinel meaning "stay on Arc". Same number, opposite meaning, so this
   pins that getDomainName is right on this screen and that Arc is never
   silently substituted. */
describe('redirectPayoutConfirm — domain 0 is a real chain here, not the Arc sentinel', () => {
  it('renders domain 0 as Ethereum Sepolia', () => {
    const d = redirectPayoutConfirm({
      escrow: escrowOn(BASE), hasSplits: false, newAddress: NEW_ADDR, newDomain: ETH
    })
    expect(paramText(d)).toContain('Chain: Base Sepolia → Ethereum Sepolia')
    expect(paramText(d)).not.toMatch(/→ Arc/)
  })

  it('treats a move to domain 0 as cross-chain, so Arc → 0 is blocked', () => {
    const d = redirectPayoutConfirm({
      escrow: escrowOn(ARC), hasSplits: false, newAddress: NEW_ADDR, newDomain: ETH
    })
    expect(d.subtitle).toBe('This transaction will not go through.')
  })
})

describe('redirectSplitConfirm', () => {
  const d = (over = {}) => redirectSplitConfirm({
    escrow: escrowOn(BASE), splitIndex: 1, currentAddress: OLD_ADDR, currentDomain: BASE,
    pct: 60, newAddress: NEW_ADDR, newDomain: OP, ...over
  })

  it('identifies which split leg and share is moving', () => {
    expect(paramText(d())).toContain('Escrow #7, split 2 — your 60% share')
  })

  it('states both the address and the chain as old → new', () => {
    expect(paramText(d())).toContain(`Address: ${OLD_ADDR} → ${NEW_ADDR}`)
    expect(paramText(d())).toContain('Chain: Base Sepolia → OP Sepolia')
  })

  it('says other recipients are untouched', () => {
    expect(d().subtitle).toMatch(/Other recipients are not affected/)
  })

  it('names the real function, not the single-recipient one', () => {
    expect(d().functionName).toBe('updateSplitReceivingAddress')
    expect(d().functionName).not.toBe('updateReceivingAddress')
  })

  /* :1033 has no splits carve-out — this leg's own domain is what its burn
     uses, so an Arc leg can never go cross-chain. */
  it('blocks Arc → cross-chain for the leg regardless of the escrow', () => {
    expect(d({ currentDomain: ARC, newDomain: BASE }).subtitle).toBe('This transaction will not go through.')
  })

  it('allows the same directions F3 permits', () => {
    expect(d({ currentDomain: BASE, newDomain: OP }).subtitle).not.toBe('This transaction will not go through.')
    expect(d({ currentDomain: BASE, newDomain: ARC }).subtitle).not.toBe('This transaction will not go through.')
    expect(d({ currentDomain: ARC, newDomain: ARC }).subtitle).not.toBe('This transaction will not go through.')
  })

  it('survives an unknown current address', () => {
    expect(paramText(d({ currentAddress: null }))).toContain(`Address: unknown → ${NEW_ADDR}`)
  })

  /* Round 15 #7: unlike the no-split branch (where a timeout ignores the
     redirect entirely), a split leg's timeout credit reads the LIVE
     mintRecipient (TrancheProtocol.sol:609) — so an address change here does
     reach a timeout settlement. What it never reads is destinationDomain
     (:594-610): every leg's timeout share lands in refundBalances (an Arc
     credit) no matter what chain is configured. Two different answers for
     the two things this screen redirects together, so both need saying.

     Round 16 #2: this used to be its own separate line, appended after an
     unqualified "every milestone not yet released" leading sentence — the
     same split-across-two-fields shape Round 15 already fixed on the
     no-split screen (see 'does not duplicate the scope/exception claim in
     the subtitle' above). Now folded into the leading sentence itself: one
     place states scope, and it is never wrong about what it covers.

     Deliberately NOT phrased as "with one exception" — unlike the no-split
     screen's clean exclusion (a timeout pays the original recipient, full
     stop), this is a partial modification: the address change still
     applies at timeout, only the chain doesn't. "Exception" reads as a full
     carve-out to anyone who just saw the no-split screen's genuine one. */
  it('says a timeout still honors the updated address, but always credited on Arc rather than the configured chain', () => {
    const t = paramText(d())
    expect(t).toContain("If a milestone times out with no arbiter ruling, this leg's updated address is still honored — but always credited on Arc, since a timeout never reads the destination chain")
    expect(t).toContain('changing the chain alone has no effect there.')
  })

  it('folds the caveat into the SAME parameter as the scope claim, not a separate one, and does not call it an exception', () => {
    const scopeLine = d().parameters.find((p) => p.startsWith('Applies to every milestone'))
    expect(scopeLine).toBeDefined()
    expect(scopeLine).toContain('is still honored')
    expect(scopeLine).toContain('always credited on Arc')
    expect(scopeLine).not.toMatch(/exception/i)
  })
})

describe('the two redirects are not interchangeable', () => {
  const single = redirectPayoutConfirm({
    escrow: escrowOn(BASE), hasSplits: false, newAddress: NEW_ADDR, newDomain: OP
  })
  const split = redirectSplitConfirm({
    escrow: escrowOn(BASE), splitIndex: 1, currentAddress: OLD_ADDR, currentDomain: BASE,
    pct: 60, newAddress: NEW_ADDR, newDomain: OP
  })

  it('differ in title and function', () => {
    expect(single.title).not.toBe(split.title)
    expect(single.functionName).not.toBe(split.functionName)
  })

  it('only the split one scopes itself to one share', () => {
    expect(paramText(split)).toMatch(/your 60% share/)
    expect(paramText(single)).not.toMatch(/share/)
  })
})
