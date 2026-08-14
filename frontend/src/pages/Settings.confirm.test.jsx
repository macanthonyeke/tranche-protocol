import { describe, it, expect } from 'vitest'

/* Confirm-screen descriptors for the two refund actions. Both hand a user's
   ENTIRE balance to a free-text address in one irreversible step with no
   app-side confirmation in front of them, so these assertions are mostly
   about what the screen must never imply.

   The two are deliberately near-identical in shape and completely different
   in effect — withdrawRefund does usdc.safeTransfer, transferRefundCredit
   moves no USDC at all — which is exactly the pair a future edit is most
   likely to blur. Descriptors go through the real buildContractInteraction,
   since that is what decides whether Circle renders a currency row. */
import { withdrawRefundConfirm, transferRefundCreditConfirm } from './Settings.jsx'
import { buildContractInteraction } from '../utils/circleTheme.js'

const SIGNER = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const OTHER = '0x4bdbe608ea998b4822476353df9dd83228ffd503'
const BALANCE = 1250000n

const paramText = (d) => (d.parameters || []).join('\n')

describe('withdrawRefundConfirm', () => {
  const d = (over = {}) =>
    withdrawRefundConfirm({ balance: BALANCE, recipient: SIGNER, signer: SIGNER, ...over })

  it('reports the whole balance as the withdrawn figure', () => {
    expect(d().amount).toBe(BALANCE)
    expect(d().amountLabel).toBe('Amount withdrawn')
    expect(buildContractInteraction(d()).total).toEqual(['1.25 USDC'])
  })

  /* There is no amount input on this form — the contract zeroes the whole
     balance (TrancheProtocol.sol:844-856). A user who reads this as a partial
     withdrawal would expect a remainder that will not exist. */
  it('says the withdrawal is all-or-nothing', () => {
    expect(paramText(d())).toMatch(/entire refund balance/i)
    expect(paramText(d())).toMatch(/[Pp]artial withdrawals are not supported/)
  })

  it('names the destination address', () => {
    expect(paramText(d({ recipient: OTHER }))).toContain(`Sent to: ${OTHER}`)
  })

  /* The UI hardcodes destinationDomain = 0, which this contract treats as the
     Arc path — a plain safeTransfer, no CCTP. In CCTP_DOMAINS, domain 0 is
     Ethereum Sepolia, so anything rendering this via getDomainName would name
     the wrong chain on a signing screen. */
  it('names Arc, never the CCTP domain-0 chain', () => {
    expect(paramText(d())).toContain('Sent on: Arc')
    expect(paramText(d())).not.toMatch(/Ethereum/i)
    expect(paramText(d())).not.toMatch(/Sepolia/i)
  })

  it('does not describe a same-chain transfer as a cross-chain delivery', () => {
    expect(paramText(d())).toMatch(/not a cross-chain delivery/)
  })

  /* Withdrawing elsewhere is a supported flow, so this is a statement of fact
     rather than a block — but it has to appear, because it is the difference
     between a routine withdrawal and sending everything to a typo. */
  it('flags a destination that is not the signing wallet', () => {
    expect(paramText(d({ recipient: OTHER }))).toContain('This is not the wallet you are signing with.')
  })

  it('stays quiet when withdrawing to the signing wallet', () => {
    expect(paramText(d())).not.toContain('This is not the wallet you are signing with.')
  })

  it('compares addresses case-insensitively, so checksummed input is not flagged', () => {
    const checksummed = '0x179CC4C8F23D257B7F4ACB785464025570E3AF86'
    expect(paramText(d({ recipient: checksummed })))
      .not.toContain('This is not the wallet you are signing with.')
  })

  it('omits the flag rather than crashing when the signer is unknown', () => {
    expect(() => d({ signer: undefined })).not.toThrow()
    expect(paramText(d({ signer: undefined, recipient: OTHER })))
      .not.toContain('This is not the wallet you are signing with.')
  })
})

describe('transferRefundCreditConfirm', () => {
  const d = (over = {}) =>
    transferRefundCreditConfirm({ balance: BALANCE, recipient: OTHER, ...over })

  /* The credit really does leave the caller, so the figure belongs on screen —
     it is what is at stake. What must not follow from it is the idea that USDC
     was paid out. */
  it('shows the credit at stake as a figure', () => {
    expect(d().amount).toBe(BALANCE)
    expect(d().amountLabel).toBe('Credit transferred')
    expect(buildContractInteraction(d()).total).toEqual(['1.25 USDC'])
  })

  /* The contract only re-keys refundBalances — "Does NOT transfer USDC"
     (TrancheProtocol.sol:887, 900-901). This is the single most important
     property of this descriptor: it must not read as a payout. */
  it('states outright that no USDC moves', () => {
    expect(paramText(d())).toContain('No USDC moves on this transaction — it re-keys who the credit belongs to.')
  })

  it('never claims anything was sent or paid', () => {
    const text = `${d().title}\n${d().subtitle}\n${paramText(d())}`
    expect(text).not.toMatch(/\bSent to:/)
    expect(text).not.toMatch(/\bPaid to:/)
    expect(text).not.toMatch(/\bwithdrawn\b/i)
  })

  it('names the new owner and says they are the one who withdraws', () => {
    expect(paramText(d())).toContain(`New owner: ${OTHER}`)
    expect(paramText(d())).toMatch(/new owner withdraws it from their own wallet/i)
  })

  it('says the caller cannot reverse it', () => {
    expect(d().subtitle).toMatch(/cannot reverse this yourself/i)
  })
})

/* Whatever else changes, these two must stay tellable apart on the screen
   itself — same contract, same full-balance figure, opposite effects. */
describe('the two refund descriptors are not interchangeable', () => {
  const w = withdrawRefundConfirm({ balance: BALANCE, recipient: OTHER, signer: SIGNER })
  const t = transferRefundCreditConfirm({ balance: BALANCE, recipient: OTHER })

  it('differ in title, subtitle and function name', () => {
    expect(w.title).not.toBe(t.title)
    expect(w.subtitle).not.toBe(t.subtitle)
    expect(w.functionName).toBe('withdrawRefund')
    expect(t.functionName).toBe('transferRefundCredit')
  })

  it('only the withdrawal claims the money is sent', () => {
    expect(paramText(w)).toMatch(/Sent (to|on):/)
    expect(paramText(t)).not.toMatch(/Sent (to|on):/)
  })

  it('only the credit transfer denies that USDC moves', () => {
    expect(paramText(t)).toMatch(/No USDC moves/)
    expect(paramText(w)).not.toMatch(/No USDC moves/)
  })
})
