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
  it('says it applies to everything unsettled, including milestones in review', () => {
    expect(paramText(d())).toContain('Applies to every milestone not yet released, including any currently in review.')
  })

  it('does not claim in-flight milestones are protected', () => {
    expect(paramText(d())).not.toMatch(/not affected|unaffected by this|keep the value they snapshotted/)
    expect(paramText(d())).toContain('Milestones already released are unaffected and cannot be recalled.')
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

  it('allows cross-chain → cross-chain', () => {
    expect(build(BASE, OP).subtitle).not.toBe('This transaction will not go through.')
  })

  it('allows cross-chain → Arc', () => {
    expect(build(BASE, ARC).subtitle).not.toBe('This transaction will not go through.')
  })

  it('allows Arc → Arc', () => {
    expect(build(ARC, ARC).subtitle).not.toBe('This transaction will not go through.')
  })

  /* The carve-out at :982: with splits configured, e.destinationDomain is not
     what the burn uses, so the guard does not apply and Arc → cross-chain is
     permitted on this path. */
  it('allows Arc → cross-chain when the escrow has splits', () => {
    expect(build(ARC, BASE, true).subtitle).not.toBe('This transaction will not go through.')
    expect(build(ARC, BASE, false).subtitle).toBe('This transaction will not go through.')
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
