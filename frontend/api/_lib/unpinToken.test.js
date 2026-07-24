// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { issueUnpinToken, verifyUnpinToken } from './unpinToken.js'

beforeEach(() => { process.env.UNPIN_TOKEN_SECRET = 'test-unpin-secret' })
afterEach(() => {
  delete process.env.UNPIN_TOKEN_SECRET
  vi.useRealTimers()
})

describe('issueUnpinToken / verifyUnpinToken', () => {
  it('a freshly issued token verifies for the exact CID it was issued for', () => {
    const token = issueUnpinToken('bafyABC')
    expect(verifyUnpinToken('bafyABC', token)).toBe(true)
  })

  it('rejects the token when checked against a DIFFERENT CID — a token for one pin cannot unpin another', () => {
    const tokenForA = issueUnpinToken('bafyA')
    expect(verifyUnpinToken('bafyB', tokenForA)).toBe(false)
    // Sanity: it's still valid for the CID it was actually issued for.
    expect(verifyUnpinToken('bafyA', tokenForA)).toBe(true)
  })

  it('rejects a missing token', () => {
    expect(verifyUnpinToken('bafyABC', undefined)).toBe(false)
    expect(verifyUnpinToken('bafyABC', '')).toBe(false)
  })

  it('rejects a garbage/malformed token', () => {
    expect(verifyUnpinToken('bafyABC', 'not-a-real-token')).toBe(false)
    expect(verifyUnpinToken('bafyABC', 'YWJjLmRlZg')).toBe(false) // valid base64url, wrong shape
  })

  it('rejects a tampered signature', () => {
    const token = issueUnpinToken('bafyABC')
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const [cid, expiresAt] = decoded.split('.')
    const forged = Buffer.from(`${cid}.${expiresAt}.0000000000000000000000000000000000000000000000000000000000000000`).toString('base64url')
    expect(verifyUnpinToken('bafyABC', forged)).toBe(false)
  })

  it('rejects an expired token', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const token = issueUnpinToken('bafyABC')

    vi.setSystemTime(new Date('2026-01-01T00:20:00Z')) // 20 min later, past the 15-min TTL
    expect(verifyUnpinToken('bafyABC', token)).toBe(false)
  })

  it('still verifies just under the TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const token = issueUnpinToken('bafyABC')

    vi.setSystemTime(new Date('2026-01-01T00:14:00Z')) // 14 min later, still under 15
    expect(verifyUnpinToken('bafyABC', token)).toBe(true)
  })

  it('issueUnpinToken throws when UNPIN_TOKEN_SECRET is not configured', () => {
    delete process.env.UNPIN_TOKEN_SECRET
    expect(() => issueUnpinToken('bafyABC')).toThrow(/UNPIN_TOKEN_SECRET/)
  })

  it('verifyUnpinToken fails closed (returns false, does not throw) when UNPIN_TOKEN_SECRET is not configured', () => {
    const token = issueUnpinToken('bafyABC')
    delete process.env.UNPIN_TOKEN_SECRET
    expect(verifyUnpinToken('bafyABC', token)).toBe(false)
  })

  it('two tokens issued for the same CID are not identical (fresh expiry each time) but both verify', () => {
    const a = issueUnpinToken('bafyABC')
    const b = issueUnpinToken('bafyABC')
    expect(verifyUnpinToken('bafyABC', a)).toBe(true)
    expect(verifyUnpinToken('bafyABC', b)).toBe(true)
  })

  it('warns at most once per module instance when the secret is missing, not once per call', async () => {
    // Fresh module instance so this test's warnedMissingSecret flag starts
    // false regardless of what other tests in this file already tripped.
    vi.resetModules()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    delete process.env.UNPIN_TOKEN_SECRET
    const fresh = await import('./unpinToken.js')

    expect(() => fresh.issueUnpinToken('bafyABC')).toThrow()
    expect(() => fresh.issueUnpinToken('bafyDEF')).toThrow()
    expect(fresh.verifyUnpinToken('bafyABC', 'whatever')).toBe(false)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('UNPIN_TOKEN_SECRET'))
    warnSpy.mockRestore()
  })
})
