// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getEscrowInvoiceData } from './subgraph.js'

afterEach(() => {
  delete process.env.VITE_GOLDSKY_ENDPOINT
  vi.unstubAllGlobals()
})

describe('getEscrowInvoiceData', () => {
  it('throws without VITE_GOLDSKY_ENDPOINT configured, without making a network call', async () => {
    // vitest/Vite auto-loads frontend/.env, which sets this for real in dev
    // — delete explicitly rather than relying on it being unset by default.
    delete process.env.VITE_GOLDSKY_ENDPOINT
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(getEscrowInvoiceData('5')).rejects.toThrow(/VITE_GOLDSKY_ENDPOINT/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('queries by id (as a decimal string) and returns invoiceData', async () => {
    process.env.VITE_GOLDSKY_ENDPOINT = 'https://example.com/subgraph'
    let capturedBody
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      capturedBody = JSON.parse(opts.body)
      return new Response(JSON.stringify({ data: { escrow: { invoiceData: 'ipfs://bafyENVELOPE' } } }), { status: 200 })
    }))

    const result = await getEscrowInvoiceData(5)

    expect(capturedBody.variables).toEqual({ id: '5' })
    expect(result).toBe('ipfs://bafyENVELOPE')
  })

  it('returns null when the escrow does not exist in the subgraph', async () => {
    process.env.VITE_GOLDSKY_ENDPOINT = 'https://example.com/subgraph'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { escrow: null } }), { status: 200 })))

    expect(await getEscrowInvoiceData('999999')).toBeNull()
  })

  it('throws on a non-OK HTTP response', async () => {
    process.env.VITE_GOLDSKY_ENDPOINT = 'https://example.com/subgraph'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))

    await expect(getEscrowInvoiceData('5')).rejects.toThrow(/status 500/)
  })

  it('throws on GraphQL errors in an otherwise-200 response body', async () => {
    process.env.VITE_GOLDSKY_ENDPOINT = 'https://example.com/subgraph'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: 'boom' }] }), { status: 200 })))

    await expect(getEscrowInvoiceData('5')).rejects.toThrow(/boom/)
  })

  it('wraps a network-level failure (fetch rejects) as a clear error', async () => {
    process.env.VITE_GOLDSKY_ENDPOINT = 'https://example.com/subgraph'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    await expect(getEscrowInvoiceData('5')).rejects.toThrow(/Could not reach the subgraph/)
  })
})
