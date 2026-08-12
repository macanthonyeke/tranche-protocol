import { describe, it, expect, vi, afterEach } from 'vitest'

/* fetchIrisMessages — Round 21 Phase A.

   GET /v2/messages/{txHash} (no domain path segment, no query param) was
   never a valid request against Circle's real Iris API — verified live
   against iris-api-sandbox.circle.com, which responds 400 for exactly this
   shape: "params.srcDomainId: Too big: expected int to be <9007199254740991,
   query: At least one of transactionHash or nonce must be provided". The
   real endpoint is GET /v2/messages/{sourceDomainId}?transactionHash={txHash}
   — confirmed against real captured responses for actual Arc-testnet burns.

   This means every cross-chain delivery-tracking request this app has ever
   made hit a 400, not the 404 the code specially treats as "not indexed
   yet" — so it always surfaced as `phase: 'unavailable'`, never correctly
   polling for real status. These tests pin the URL shape directly so this
   can't silently regress back to the never-real one. */
import { ARC_DOMAIN } from '../config/chains.js'

const { fetchIrisMessages } = await import('./irisDelivery.js')

afterEach(() => {
  vi.unstubAllGlobals()
})

const mockOk = (body) => ({ ok: true, status: 200, json: async () => body })

describe('fetchIrisMessages', () => {
  it('requests the sourceDomain as a path segment and the tx hash as a transactionHash query param', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(mockOk({ messages: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await fetchIrisMessages('0xabc123')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain(`/v2/messages/${ARC_DOMAIN}`)
    expect(url).toContain('transactionHash=0xabc123')
    // The bug this closes: the tx hash must never appear where the domain
    // path segment goes.
    expect(url).not.toContain(`/v2/messages/0xabc123`)
  })

  it('defaults sourceDomain to ARC_DOMAIN — every tracked burn in this app originates from Arc', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(mockOk({ messages: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await fetchIrisMessages('0xabc123')

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/v2/messages/26?')
  })

  it('accepts an explicit sourceDomain override', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(mockOk({ messages: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await fetchIrisMessages('0xabc123', 6)

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/v2/messages/6?')
  })

  it('returns [] on a 404 (not yet indexed), not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })))
    await expect(fetchIrisMessages('0xabc123')).resolves.toEqual([])
  })

  it('throws on a non-404 error status — a 400 must not be silently swallowed like a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 400 })))
    await expect(fetchIrisMessages('0xabc123')).rejects.toThrow('Iris HTTP 400')
  })

  it('returns the messages array from a real-shaped successful response', async () => {
    const realShapedMessage = {
      message: '0xmsg', attestation: '0xatt', status: 'complete',
      decodedMessage: { destinationDomain: '6' },
      forwardState: 'COMPLETE', forwardTxHash: '0xdesttx', forwardErrorCode: null
    }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockOk({ messages: [realShapedMessage], sourceTxHash: '0xabc123' }))))
    await expect(fetchIrisMessages('0xabc123')).resolves.toEqual([realShapedMessage])
  })
})
