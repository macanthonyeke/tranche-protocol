// @vitest-environment node
// The whole point of an SSRF guard is that it can't be validated against a
// fake local target — a local server IS exactly what it's designed to
// reject. These two need a real, stable public endpoint; skip locally if
// you're offline.
import { describe, it, expect } from 'vitest'
import { fetchUrlSafely, SsrfError } from './ssrf.js'

describe('fetchUrlSafely — real public fetch (network-dependent)', () => {
  it('successfully fetches a real public host', { timeout: 10_000, retry: 2 }, async () => {
    // observed one transient Cloudflare rate-limit blip while building this
    const { bytes, contentType } = await fetchUrlSafely('http://example.com/', { timeoutMs: 8000 })
    expect(bytes.length).toBeGreaterThan(0)
    expect(contentType).toBeTruthy()
  })

  it('rejects content that exceeds the byte cap instead of buffering it unbounded', { timeout: 10_000, retry: 2 }, async () => {
    await expect(fetchUrlSafely('http://example.com/', { timeoutMs: 8000, maxBytes: 50 })).rejects.toThrow(SsrfError)
  })
})
