// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))

const { lookup } = await import('node:dns/promises')
const { fetchUrlSafely, SsrfError } = await import('./ssrf.js')

beforeEach(() => {
  lookup.mockReset()
})

describe('fetchUrlSafely — DNS resolution (mocked, no network)', () => {
  it('blocks the whole request if ANY resolved address is private, even when a public one is listed first', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 }, // public
      { address: '10.0.0.1', family: 4 } // private — must still block
    ])

    await expect(fetchUrlSafely('http://multi-a-record.example.test/')).rejects.toThrow(SsrfError)
    expect(lookup).toHaveBeenCalledWith('multi-a-record.example.test', { all: true, verbatim: true })
  })

  it('allows a hostname through the DNS/IP guard when every resolved address is public', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

    // We can't complete a real connection to a fake hostname, but the
    // specific failure reason distinguishes "the guard blocked it" from
    // "the guard let it through and something else failed downstream". A
    // guard rejection always says "private or reserved address"; connecting
    // to a real public IP on a port nothing listens on fails for an
    // unrelated reason (refused/timeout), proving the multi-address check
    // isn't over-blocking legitimate all-public resolutions.
    await expect(
      fetchUrlSafely('http://multi-a-record.example.test:1/', { timeoutMs: 800 })
    ).rejects.not.toThrow(/private or reserved address/)
  })

  it('wraps a DNS resolution failure as a clean SsrfError instead of a raw Node error', async () => {
    lookup.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }))

    await expect(fetchUrlSafely('http://does-not-resolve.example.test/')).rejects.toThrow(SsrfError)
  })

  it('rejects when DNS resolves to zero addresses', async () => {
    lookup.mockResolvedValue([])

    await expect(fetchUrlSafely('http://no-records.example.test/')).rejects.toThrow(SsrfError)
  })
})
