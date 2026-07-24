// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveAttachmentSalt } from './resolveAttachmentSalt.js'
import { getEscrowInvoiceData } from './subgraph.js'
import { packEnvelopeBlob } from '../../src/utils/envelopeBlob.js'

vi.mock('./subgraph.js', () => ({ getEscrowInvoiceData: vi.fn() }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('resolveAttachmentSalt', () => {
  it('returns null when the escrow has no invoiceData at all', async () => {
    getEscrowInvoiceData.mockResolvedValue(null)

    expect(await resolveAttachmentSalt('5')).toBeNull()
  })

  it('returns null when invoiceData is plaintext JSON (public mode), not an ipfs:// pointer', async () => {
    getEscrowInvoiceData.mockResolvedValue('{"version":1,"invoiceNumber":"INV-1"}')

    expect(await resolveAttachmentSalt('5')).toBeNull()
  })

  it("returns null when the escrow's own envelope has no embedded attachment salt", async () => {
    getEscrowInvoiceData.mockResolvedValue('ipfs://bafyENVELOPE')
    const blob = packEnvelopeBlob({ iv: new Uint8Array(12), ciphertextAndTag: new Uint8Array(20) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(blob, { status: 200 })))

    expect(await resolveAttachmentSalt('5')).toBeNull()
  })

  it("extracts the real attachment salt from the escrow's own envelope", async () => {
    getEscrowInvoiceData.mockResolvedValue('ipfs://bafyENVELOPE')
    const salt = new Uint8Array(16).fill(7)
    const blob = packEnvelopeBlob({ iv: new Uint8Array(12), ciphertextAndTag: new Uint8Array(20), attachmentSalt: salt })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(blob, { status: 200 })))

    const result = await resolveAttachmentSalt('5')

    expect(Buffer.from(result).equals(Buffer.from(salt))).toBe(true)
  })

  it('fetches the CID this specific escrow points to via the gateway', async () => {
    getEscrowInvoiceData.mockResolvedValue('ipfs://bafyXYZ')
    const blob = packEnvelopeBlob({ iv: new Uint8Array(12), ciphertextAndTag: new Uint8Array(20) })
    const fetchSpy = vi.fn(async () => new Response(blob, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    await resolveAttachmentSalt('5')

    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/ipfs/bafyXYZ'))
  })

  it('throws if the envelope blob cannot be fetched', async () => {
    getEscrowInvoiceData.mockResolvedValue('ipfs://bafyENVELOPE')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))

    await expect(resolveAttachmentSalt('5')).rejects.toThrow(/status 404/)
  })

  it('propagates a subgraph-lookup failure (fail closed is the caller\'s responsibility)', async () => {
    getEscrowInvoiceData.mockRejectedValue(new Error('Could not reach the subgraph: fetch failed'))

    await expect(resolveAttachmentSalt('5')).rejects.toThrow(/Could not reach the subgraph/)
  })
})
