import { describe, it, expect } from 'vitest'

/* resolveTrackingDomain — Round 19 Phase C.

   A seventh Codex review pass found that DisputeBlock's post-submission
   Circle delivery tracking (both the localStorage write in handleResolve and
   the ArbiterDeliveryStatus render gate) determined cross-chain status by
   reading the raw escrow.destinationDomain, instead of resolveIsCrossChain —
   the same split-aware determination resolveDisputeConfirm and
   resolveDisputeMaxFeePlan already use.

   Consequence: an Arc-root escrow with a genuine cross-chain split leg now
   SUBMITS correctly (Round 19 Phase B fixed the maxFee side of that gap), but
   its delivery status would never be tracked or displayed, since the raw
   check sees only the Arc root and never starts polling. Conversely, a
   non-Arc-root escrow whose splits are all Arc would get tracking started for
   a delivery that was never going to happen, since the raw check sees the
   non-Arc root alone.

   resolveTrackingDomain closes both gaps in one place: it returns null
   (nothing to track) exactly when resolveIsCrossChain says so, and otherwise
   returns a genuinely non-Arc domain — the escrow's own root when that's what
   makes it cross-chain, or the first non-Arc split leg when a split does. */
import { resolveTrackingDomain } from './ArbiterPanel.jsx'

const ARC = 26
const BASE = 6
const ETH_SEPOLIA = 0

const RECIPIENT = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const B32 = (a) => '0x000000000000000000000000' + a.slice(2)

const escrowOn = (domain) => ({ id: 7, destinationDomain: domain })

describe('resolveTrackingDomain', () => {
  describe('Arc-root escrow with a genuine cross-chain split leg', () => {
    it('tracks — resolves to the cross-chain leg\'s domain, not null', () => {
      const splits = [
        { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
        { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
      ]
      const domain = resolveTrackingDomain(escrowOn(ARC), splits)
      expect(domain).not.toBeNull()
      expect(domain).toBe(BASE)
    })

    it('holds for a genuinely mixed 3-leg split (Arc + two different cross-chain domains)', () => {
      const splits = [
        { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
        { bps: 3000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) },
        { bps: 2000n, destinationDomain: ETH_SEPOLIA, mintRecipient: B32(RECIPIENT) }
      ]
      const domain = resolveTrackingDomain(escrowOn(ARC), splits)
      expect(domain).not.toBeNull()
      // Whichever non-Arc leg is found first — either is a valid non-Arc
      // domain to poll Iris on; the point under test is "not null, not Arc".
      expect(domain).not.toBe(ARC)
    })
  })

  describe('non-Arc-root escrow whose splits are all Arc', () => {
    it('does not track — resolves to null, not the stale non-Arc root', () => {
      const splits = [
        { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
        { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) }
      ]
      const domain = resolveTrackingDomain(escrowOn(BASE), splits)
      expect(domain).toBeNull()
    })
  })

  describe('no-split escrows: the root domain alone decides', () => {
    it('tracks a cross-chain no-split escrow at its own root domain', () => {
      expect(resolveTrackingDomain(escrowOn(BASE), [])).toBe(BASE)
    })

    it('does not track a same-chain no-split escrow', () => {
      expect(resolveTrackingDomain(escrowOn(ARC), [])).toBeNull()
    })
  })
})
