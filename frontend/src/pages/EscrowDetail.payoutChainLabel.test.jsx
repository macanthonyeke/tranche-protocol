import { describe, it, expect } from 'vitest'

/* payoutChainLabel — Round 20 Phase A #3.

   The Ledger's "Payout chain" row used to print escrow.destinationDomain
   unconditionally. That's correct for a no-split escrow, but false once
   splits are configured: the contract pays out per split leg's own
   destinationDomain, never the escrow-level field (TrancheProtocol.sol:1298
   vs :1329) — a mixed split can pay to several different chains in one
   settlement, so no single "Payout chain" value is ever accurate for it. */
import { payoutChainLabel } from './EscrowDetail.jsx'

const ARC = 26
const BASE = 6

const RECIPIENT = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const B32 = (a) => '0x000000000000000000000000' + a.slice(2)

const escrowOn = (domain) => ({ id: 7, destinationDomain: domain })

describe('payoutChainLabel', () => {
  it('names the single chain for a no-split escrow', () => {
    expect(payoutChainLabel(escrowOn(BASE), [])).toBe('Base Sepolia')
  })

  it('names Arc for a no-split escrow on Arc', () => {
    expect(payoutChainLabel(escrowOn(ARC), [])).toBe('Arc Testnet')
  })

  it('does not assert a single chain once splits are configured, even when every leg happens to share one destination', () => {
    const splits = [
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
    ]
    const label = payoutChainLabel(escrowOn(BASE), splits)
    expect(label).not.toBe('Base Sepolia')
    expect(label).toMatch(/split/i)
  })

  it('defers to the split list for a genuinely mixed-destination split', () => {
    const splits = [
      { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
      { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
    ]
    const label = payoutChainLabel(escrowOn(ARC), splits)
    expect(label).not.toBe('Arc Testnet')
    expect(label).toMatch(/split/i)
  })
})
