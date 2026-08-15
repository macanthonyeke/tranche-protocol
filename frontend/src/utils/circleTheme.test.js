import { describe, it, expect, vi } from 'vitest'
import {
  TRANCHE_THEME, TRANCHE_FONT,
  applyTrancheTheme, buildContractInteraction, applyConfirmLocalization
} from './circleTheme.js'

describe('Circle widget theme', () => {
  it('uses Tranche clay for the primary action', () => {
    expect(TRANCHE_THEME.mainBtnBg).toBe('#c84e25')
  })

  // Explicitly against the design system: one saturated colour, no gradients.
  // The SDK supports titleGradients, so this has to be a deliberate absence.
  it('sets no gradient of any kind', () => {
    expect('titleGradients' in TRANCHE_THEME).toBe(false)
    expect(JSON.stringify(TRANCHE_THEME).toLowerCase()).not.toContain('gradient')
  })

  it('is all plain hex — the SDK does not accept oklch or CSS vars', () => {
    for (const [k, v] of Object.entries(TRANCHE_THEME)) {
      if (typeof v !== 'string') continue
      expect(v, k).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  // Reuses the stylesheet index.html already loads; nothing is re-hosted.
  it('points the font at a stable absolute production URL Circle can fetch', () => {
    expect(TRANCHE_FONT.name).toBe('Switzer')
    // Absolute: the widget iframe is on pw-auth.circle.com, so a relative
    // path would resolve against Circle's origin.
    expect(TRANCHE_FONT.url.startsWith('https://')).toBe(true)
    // Production domain, not a preview host that disappears when the
    // deployment is cleaned up and would leave the widget silently unstyled.
    expect(new URL(TRANCHE_FONT.url).hostname).toBe('trancheprotocol.xyz')
    expect(TRANCHE_FONT.url).not.toMatch(/vercel\.app/)
    expect(TRANCHE_FONT.url).toContain('/fonts/tranche-fonts.css')
  })

})

describe('applyTrancheTheme', () => {
  it('calls the setters the installed SDK actually exposes', () => {
    const calls = []
    const sdk = {
      setThemeColor: (v) => calls.push(['setThemeColor', v]),
      setResources: (v) => calls.push(['setResources', v])
    }
    applyTrancheTheme(sdk)

    expect(calls.map((c) => c[0])).toEqual(['setThemeColor', 'setResources'])
    expect(calls[0][1]).toBe(TRANCHE_THEME)
    expect(calls[1][1].fontFamily).toBe(TRANCHE_FONT)
  })

  /* Security-questions config is deliberately absent — see the long note in
     circleTheme.js. The screen it configures is unreachable for email-auth
     users, and its copy had gone stale (it referenced a PIN these wallets do
     not have). Asserted rather than merely deleted, so quietly re-adding the
     call trips a test and sends whoever did it to that note first. */
  it('configures no security questions at all', () => {
    const setCustomSecurityQuestions = vi.fn()
    applyTrancheTheme({
      setThemeColor() {}, setResources() {}, setCustomSecurityQuestions
    })
    expect(setCustomSecurityQuestions).not.toHaveBeenCalled()
  })

  // Theming is cosmetic; an SDK bump that renames a setter must not be able to
  // stop anyone signing in.
  it('never throws when a setter is missing or fails', () => {
    expect(() => applyTrancheTheme({})).not.toThrow()
    expect(() => applyTrancheTheme({
      setThemeColor() { throw new Error('gone') },
      setResources() { throw new Error('gone') }
    })).not.toThrow()
  })
})

describe('buildContractInteraction', () => {
  const DEPOSIT = {
    title: 'Lock funds into escrow',
    subtitle: 'Step 2 of 2.',
    amount: 1234560000n,
    amountLabel: 'Total locked',
    contractName: 'Tranche Protocol Escrow',
    contractAddress: '0x6bf5e723b5a542b8d49bedab7c8eb2791af00d3d',
    functionName: 'deposit',
    parameters: ['Milestones: 3']
  }

  // The whole point of the round: Total was blank because Circle cannot read
  // pre-encoded calldata, so the figure has to come from us.
  it('fills the total with a real formatted USDC amount', () => {
    const ci = buildContractInteraction(DEPOSIT)
    expect(ci.mainCurrency).toEqual({ amount: '1,234.56', symbol: 'USDC' })
    expect(ci.total).toEqual(['1,234.56 USDC'])
    expect(ci.totalLabel).toBe('Total locked')
  })

  it('names the contract in words and keeps its address', () => {
    const ci = buildContractInteraction(DEPOSIT)
    expect(ci.contractInfo).toEqual(['Tranche Protocol Escrow', DEPOSIT.contractAddress])
  })

  it('exposes the real function and args under details', () => {
    const ci = buildContractInteraction(DEPOSIT)
    expect(ci.dataDetails.abiInfo.functionName).toBe('deposit')
    expect(ci.dataDetails.abiInfo.parameters).toEqual(['Milestones: 3'])
  })

  // A currency symbol with no figure beside it reads as a label attached to
  // nothing, so the pair is all-or-nothing.
  it('omits mainCurrency and total entirely when there is no amount', () => {
    const ci = buildContractInteraction({ title: 'Mark delivered', functionName: 'claimDelivery' })
    expect('mainCurrency' in ci).toBe(false)
    expect('total' in ci).toBe(false)
    expect('totalLabel' in ci).toBe(false)
  })

  // Zero is an amount. `if (confirm.amount)` here would drop it.
  it('treats a zero amount as an amount', () => {
    expect(buildContractInteraction({ amount: 0n }).total).toEqual(['0.00 USDC'])
  })

  it('reads the immutable canonical descriptor without changing it', () => {
    const descriptor = Object.freeze({
      ...DEPOSIT,
      parameters: Object.freeze([...DEPOSIT.parameters])
    })
    const before = JSON.stringify({
      title: descriptor.title,
      functionName: descriptor.functionName,
      parameters: descriptor.parameters
    })
    buildContractInteraction(descriptor)
    expect(JSON.stringify({
      title: descriptor.title,
      functionName: descriptor.functionName,
      parameters: descriptor.parameters
    })).toBe(before)
  })

  it('falls back to branded generic copy with no descriptor at all', () => {
    const ci = buildContractInteraction(undefined)
    expect(ci.title).not.toMatch(/contract interaction/i)
    expect(ci.contractInfo).toEqual(['Tranche Protocol'])
    expect('mainCurrency' in ci).toBe(false)
  })
})

describe('applyConfirmLocalization', () => {
  /* The SDK instance is a singleton and its setters just overwrite fields, so
     a call that skipped setLocalizations would leave the PREVIOUS
     transaction's amount on this transaction's signing screen. Stale is worse
     than blank — this must write on every call, descriptor or not. */
  it('always writes, so no amount can survive into the next transaction', () => {
    const calls = []
    const sdk = { setLocalizations: (v) => calls.push(v) }

    applyConfirmLocalization(sdk, { amount: 250000000n, amountLabel: 'Total locked' })
    applyConfirmLocalization(sdk, undefined)

    expect(calls).toHaveLength(2)
    expect(calls[0].contractInteraction.total).toEqual(['250.00 USDC'])
    expect('total' in calls[1].contractInteraction).toBe(false)
  })

  it('never throws when the setter is missing or fails', () => {
    expect(() => applyConfirmLocalization({}, { amount: 1n })).not.toThrow()
    expect(() => applyConfirmLocalization({
      setLocalizations() { throw new Error('gone') }
    }, { amount: 1n })).not.toThrow()
  })
})
