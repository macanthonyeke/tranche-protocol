import { describe, it, expect } from 'vitest'

/* settlementTrackingDomain — Round 19 Phase C, the SettlementPanel/
   MilestoneAction/MilestoneRow twin of ArbiterPanel's resolveTrackingDomain
   (see that file's test for the full background).

   Three post-submission tracking sites in this file — mutual settlement
   (SettlementPanel.propose), approve/release (MilestoneAction.run), and the
   detail-page delivery renderer (MilestoneRow) — determined cross-chain
   status by reading the raw escrow.destinationDomain, instead of
   settlementIsCrossChain, the same split-aware determination
   mutualSettleConfirm/milestoneConfirm/releaseMaxFeePlan already use.

   Consequence: an Arc-root escrow with a genuine cross-chain split leg now
   SUBMITS correctly (Round 19 Phase B), but its delivery status would never
   be tracked or rendered, since the raw check sees only the Arc root.
   Conversely, a non-Arc-root escrow whose splits are all Arc would get
   tracking started for a delivery that was never going to happen.

   settlementTrackingDomain closes both gaps in one place: null (nothing to
   track) exactly when settlementIsCrossChain says so, otherwise a genuinely
   non-Arc domain — the escrow's own root when that's what makes it
   cross-chain, or the first non-Arc split leg when a split does. */
import { settlementTrackingDomain } from './EscrowDetail.jsx'

const ARC = 26
const BASE = 6
const ETH_SEPOLIA = 0

const RECIPIENT = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const B32 = (a) => '0x000000000000000000000000' + a.slice(2)

const escrowOn = (domain) => ({ id: 7, destinationDomain: domain })

describe('settlementTrackingDomain', () => {
  describe('Arc-root escrow with a genuine cross-chain split leg', () => {
    it('tracks — resolves to the cross-chain leg\'s domain, not null', () => {
      const splits = [
        { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
        { bps: 5000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) }
      ]
      const domain = settlementTrackingDomain(escrowOn(ARC), splits)
      expect(domain).not.toBeNull()
      expect(domain).toBe(BASE)
    })

    it('holds for a genuinely mixed 3-leg split (Arc + two different cross-chain domains)', () => {
      const splits = [
        { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
        { bps: 3000n, destinationDomain: BASE, mintRecipient: B32(RECIPIENT) },
        { bps: 2000n, destinationDomain: ETH_SEPOLIA, mintRecipient: B32(RECIPIENT) }
      ]
      const domain = settlementTrackingDomain(escrowOn(ARC), splits)
      expect(domain).not.toBeNull()
      expect(domain).not.toBe(ARC)
    })
  })

  describe('non-Arc-root escrow whose splits are all Arc', () => {
    it('does not track — resolves to null, not the stale non-Arc root', () => {
      const splits = [
        { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) },
        { bps: 5000n, destinationDomain: ARC, mintRecipient: B32(RECIPIENT) }
      ]
      const domain = settlementTrackingDomain(escrowOn(BASE), splits)
      expect(domain).toBeNull()
    })
  })

  describe('no-split escrows: the root domain alone decides', () => {
    it('tracks a cross-chain no-split escrow at its own root domain', () => {
      expect(settlementTrackingDomain(escrowOn(BASE), [])).toBe(BASE)
    })

    it('does not track a same-chain no-split escrow', () => {
      expect(settlementTrackingDomain(escrowOn(ARC), [])).toBeNull()
    })
  })
})
