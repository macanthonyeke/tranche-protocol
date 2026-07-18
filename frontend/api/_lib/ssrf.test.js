// @vitest-environment node
// Scheme/credential guards and private-IP-literal blocks — all short-circuit
// before any DNS lookup, so these are fully offline and deterministic. DNS-
// mocked and real-network cases live in ssrf.dns.test.js / ssrf.network.test.js
// respectively, since a single file can't both mock node:dns/promises and
// rely on its real behavior.
import { describe, it, expect } from 'vitest'
import { fetchUrlSafely, SsrfError } from './ssrf.js'

describe('fetchUrlSafely — scheme and credential guards', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(fetchUrlSafely('ftp://example.com/file')).rejects.toThrow(SsrfError)
  })

  it('rejects garbage input that is not a URL at all', async () => {
    await expect(fetchUrlSafely('not a url')).rejects.toThrow(SsrfError)
  })

  it('rejects URLs with embedded credentials', async () => {
    await expect(fetchUrlSafely('http://user:pass@example.com/')).rejects.toThrow(SsrfError)
  })
})

describe('fetchUrlSafely — private/reserved IP literal guards', () => {
  const cases = [
    ['IPv4 loopback', 'http://127.0.0.1:9999/x'],
    ['IPv4 link-local (cloud metadata)', 'http://169.254.169.254/latest/meta-data/'],
    ['IPv4 RFC1918 10/8', 'http://10.0.0.5/'],
    ['IPv4 RFC1918 192.168/16', 'http://192.168.1.1/'],
    ['IPv4 RFC1918 172.16/12', 'http://172.16.5.5/'],
    ['IPv6 loopback literal', 'http://[::1]/'],
    ['IPv6 link-local literal', 'http://[fe80::1]/'],
    ['IPv6 unique-local literal', 'http://[fd00::1]/']
  ]

  it.each(cases)('blocks %s', async (_label, url) => {
    await expect(fetchUrlSafely(url)).rejects.toThrow(SsrfError)
  })

  it('blocks an IPv4-mapped IPv6 address unwrapping to a private IPv4 target', async () => {
    // Regression check: this unwrap-and-recheck path exists specifically
    // because adding ::ffff:0:0/96 straight to the same net.BlockList as the
    // plain IPv4 subnets was found (empirically, while building this) to
    // collide and block *every* IPv4 address instead of just mapped ones.
    // If the unwrap logic regresses back to that approach, or is removed,
    // this is the case that would silently stop protecting mapped addresses.
    await expect(fetchUrlSafely('http://[::ffff:127.0.0.1]/')).rejects.toThrow(SsrfError)
  })
})
