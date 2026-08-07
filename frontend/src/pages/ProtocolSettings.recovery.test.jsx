import { describe, it, expect } from 'vitest'

/* The two-step refund-credit recovery — the highest-trust pair in the app: a
   RECOVERY_MANAGER moving somebody else's balance.

   The two halves are NOT mirrored, and each asymmetry is a disclosure:

   - The amount is never fixed at propose time. propose requires a non-zero
     balance (:924) but stores none; claim sweeps whatever the wallet holds at
     claim (:945). The proposer authorises a figure they cannot see and which
     can grow after they sign.
   - Only propose is role-gated; claim's gate is msg.sender == proposed (:943).
   - Expiry is enforced only on claim, at proposedAt + 14 days (:940), and a
     late claim reverts cleanly rather than no-opping.
   - A re-propose overwrites a standing proposal unconditionally (:926-927).
   - F5 liveness deletes a pending proposal the moment the "frozen" wallet
     withdraws or transfers (:851-852, :897-898), silently.

   And shared: neither moves USDC. Both only re-key an internal balance. */
import { proposeRecoveryConfirm, claimRecoveryConfirm, expiryOf } from './ProtocolSettings.jsx'
import { buildContractInteraction } from '../utils/circleTheme.js'

const FROM = '0x4bdbe608ea998b4822476353df9dd83228ffd503'
const TO = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const OTHER = '0x2Fcbb92566C51E92c1353d0a6a9AC86f10bb1a03'
const ZERO = '0x0000000000000000000000000000000000000000'

const PROPOSED_AT = 1767225600n // 1 Jan 2026
const DAY = 86400
const paramText = (d) => (d.parameters || []).join('\n')

describe('expiryOf', () => {
  /* ARBITER_WINDOW is internal constant with no getter, so the 14 days is
     mirrored in the frontend. Pin the arithmetic, not a rendered string. */
  it('adds exactly 14 days to the proposal timestamp', () => {
    expect(expiryOf(PROPOSED_AT)).toBe(Number(PROPOSED_AT) + 14 * DAY)
  })

  it('returns null when nothing is pending', () => {
    expect(expiryOf(0n)).toBeNull()
    expect(expiryOf(undefined)).toBeNull()
    expect(expiryOf(null)).toBeNull()
  })
})

describe('proposeRecoveryConfirm', () => {
  const d = (over = {}) => proposeRecoveryConfirm({
    from: FROM, to: TO, balance: 250000000n, existingOwner: ZERO, existingExpiry: null, ...over
  })

  /* Nothing moves: this writes a pointer and a timestamp. A Total would assert
     a sweep that happens in a different transaction, and would have to invent
     a figure the contract never captures. */
  it('carries no amount and renders no currency row', () => {
    expect(d()).not.toHaveProperty('amount')
    expect(buildContractInteraction(d())).not.toHaveProperty('mainCurrency')
    expect(paramText(d())).toContain('No funds move on this transaction.')
  })

  it('names both wallets in full, not truncated', () => {
    expect(paramText(d())).toContain(`Restricted wallet: ${FROM}`)
    expect(paramText(d())).toContain(`Proposed destination: ${TO}`)
  })

  /* Finding ①, the most important line on this screen: the balance shown is
     today's, and the claim takes whatever exists then. */
  it('shows the current balance AND warns it is not the final figure', () => {
    const t = paramText(d())
    expect(t).toContain('Balance today: 250.00 USDC')
    expect(t).toContain('the claim takes whatever the wallet holds at that moment, which may be more than this')
  })

  it('does not present the balance as the amount being transferred', () => {
    expect(paramText(d())).not.toMatch(/transferring 250\.00/i)
    expect(d()).not.toHaveProperty('amountLabel')
  })

  it('states the 14-day claim window', () => {
    expect(paramText(d())).toContain('14 days to claim')
  })

  /* Finding ④ — a proposal can evaporate with no notification to anyone. */
  it('warns that a live wallet silently cancels the proposal', () => {
    expect(paramText(d())).toContain('cancelled silently — neither party is notified')
  })

  describe('overwrite detection', () => {
    /* :926-927 assigns unconditionally, so a second propose replaces the first
       and the previously-proposed wallet loses its claim. */
    it('names the proposal being replaced, and its expiry', () => {
      const t = paramText(d({ existingOwner: OTHER, existingExpiry: expiryOf(PROPOSED_AT) }))
      expect(t).toContain(`Replaces the pending proposal to ${OTHER}`)
      expect(t).toContain('expires 15 Jan 2026')
      expect(t).toContain('That wallet can no longer claim.')
    })

    it('says plainly when nothing is pending', () => {
      expect(paramText(d({ existingOwner: ZERO }))).toContain('No proposal is currently pending for this wallet.')
    })

    /* An unset mapping reads as the zero address, not as null — treating it as
       a real prior owner would tell the manager they are replacing 0x000…000. */
    it('treats the zero address as no proposal, not as an existing one', () => {
      const t = paramText(d({ existingOwner: ZERO }))
      expect(t).not.toContain('Replaces the pending proposal')
      expect(t).not.toContain(ZERO)
    })

    it('treats a null owner as no proposal', () => {
      expect(paramText(d({ existingOwner: null }))).toContain('No proposal is currently pending')
    })

    it('omits the expiry clause when the timestamp is missing but an owner is set', () => {
      const t = paramText(d({ existingOwner: OTHER, existingExpiry: null }))
      expect(t).toContain(`Replaces the pending proposal to ${OTHER}`)
      expect(t).not.toContain('which expires')
    })
  })
})

describe('claimRecoveryConfirm', () => {
  const d = (over = {}) => claimRecoveryConfirm({
    blacklisted: FROM, balance: 250000000n, expiry: expiryOf(PROPOSED_AT), ...over
  })

  /* Same shape as transferRefundCredit: a real amount, because the whole
     credit changes hands — but no USDC moves, so the parameters have to stop
     it being read as a payout. */
  it('carries the live balance as the amount', () => {
    expect(d().amount).toBe(250000000n)
    expect(d().amountLabel).toBe('Credit claimed')
    expect(buildContractInteraction(d())).toHaveProperty('mainCurrency')
  })

  it('reflects a balance that grew after the proposal', () => {
    expect(d({ balance: 900000000n }).amount).toBe(900000000n)
  })

  /* The existing in-app copy said "to your connected wallet", which reads as
     USDC arriving. It does not — refundBalances is re-keyed and a separate
     withdrawRefund is still required. */
  it('says explicitly that no USDC lands in the wallet', () => {
    const t = paramText(d())
    expect(t).toContain('No USDC moves on this transaction — it re-keys who the credit belongs to.')
    expect(t).toContain('This does not put funds in your wallet.')
    expect(t).toContain('Withdraw the credit separately once it is yours.')
  })

  it('gives the claim deadline', () => {
    expect(paramText(d())).toContain('Must be claimed by 15 Jan 2026')
  })

  /* RecoveryProposalExpired (:940-942) reverts; it does not silently do
     nothing, and the copy should not imply a soft failure. */
  it('says a late claim is rejected rather than ignored', () => {
    expect(paramText(d())).toContain('the proposal expires and this transaction is rejected')
  })

  it('omits the deadline entirely when no proposal timestamp is known', () => {
    const t = paramText(d({ expiry: null }))
    expect(t).not.toContain('Must be claimed by')
    expect(t).not.toContain('undefined')
    expect(t).not.toContain('NaN')
  })

  /* msg.sender == proposed (:943). Not a role — a specific address. */
  it('states that only the proposed wallet can claim', () => {
    expect(paramText(d())).toContain('Only the wallet named in the proposal can claim')
  })

  it('names the source wallet and the real function', () => {
    expect(paramText(d())).toContain(`Claiming from: ${FROM}`)
    expect(d().functionName).toBe('claimRefundCreditTransfer')
  })
})

describe('the two screens are not interchangeable', () => {
  const p = proposeRecoveryConfirm({ from: FROM, to: TO, balance: 250000000n, existingOwner: ZERO })
  const c = claimRecoveryConfirm({ blacklisted: FROM, balance: 250000000n, expiry: expiryOf(PROPOSED_AT) })

  it('call different functions', () => {
    expect(p.functionName).toBe('proposeRefundCreditTransfer')
    expect(c.functionName).toBe('claimRefundCreditTransfer')
  })

  /* The proposer moves nothing; the claimer moves everything. If these ever
     converge, one of the two screens is lying. */
  it('differ on whether anything moves', () => {
    expect(p).not.toHaveProperty('amount')
    expect(c).toHaveProperty('amount')
  })
})
