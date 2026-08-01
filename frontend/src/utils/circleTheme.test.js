import { describe, it, expect } from 'vitest'
import { TRANCHE_THEME, TRANCHE_FONT, SECURITY_CONFIRM_ITEMS, applyTrancheTheme } from './circleTheme.js'

describe('Circle widget theme', () => {
  it('uses Tranche clay for the primary action', () => {
    expect(TRANCHE_THEME.mainBtnBg).toBe('#c4622d')
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
  it('points the font at the existing Switzer CDN stylesheet', () => {
    expect(TRANCHE_FONT.name).toBe('Switzer')
    expect(TRANCHE_FONT.url).toContain('api.fontshare.com')
    expect(TRANCHE_FONT.url).toContain('switzer')
  })

  it('replaces the disclaimer with plain factual copy', () => {
    expect(SECURITY_CONFIRM_ITEMS.length).toBeGreaterThan(0)
    const joined = SECURITY_CONFIRM_ITEMS.join(' ')
    expect(joined).toContain('Tranche cannot see your answers')
    // No marketing register: no exclamation, no superlatives.
    expect(joined).not.toMatch(/!|seamless|effortless|secure your future|peace of mind/i)
  })
})

describe('applyTrancheTheme', () => {
  it('calls the setters the installed SDK actually exposes', () => {
    const calls = []
    const sdk = {
      setThemeColor: (v) => calls.push(['setThemeColor', v]),
      setResources: (v) => calls.push(['setResources', v]),
      // securityConfirmItems is the THIRD argument of this method in 1.1.11 —
      // there is no standalone setter for it.
      setCustomSecurityQuestions: (q, n, items) => calls.push(['setCustomSecurityQuestions', q, n, items])
    }
    applyTrancheTheme(sdk)

    expect(calls.map((c) => c[0])).toEqual(['setThemeColor', 'setResources', 'setCustomSecurityQuestions'])
    expect(calls[0][1]).toBe(TRANCHE_THEME)
    expect(calls[1][1].fontFamily).toBe(TRANCHE_FONT)
    expect(calls[2][1]).toBeNull()          // keep Circle's default questions
    expect(calls[2][3]).toBe(SECURITY_CONFIRM_ITEMS)
  })

  // Theming is cosmetic; an SDK bump that renames a setter must not be able to
  // stop anyone signing in.
  it('never throws when a setter is missing or fails', () => {
    expect(() => applyTrancheTheme({})).not.toThrow()
    expect(() => applyTrancheTheme({
      setThemeColor() { throw new Error('gone') },
      setResources() { throw new Error('gone') },
      setCustomSecurityQuestions() { throw new Error('gone') }
    })).not.toThrow()
  })
})
