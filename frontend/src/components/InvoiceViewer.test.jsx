import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import InvoiceViewer from './InvoiceViewer.jsx'
import { toGatewayUrl } from '../utils/ipfsGateway.js'

const CID = 'bafyMOCKCID123'
// Derived from the real toGatewayUrl rather than a hardcoded literal, so this
// suite doesn't silently drift/fail if VITE_PINATA_GATEWAY is ever set.
const GATEWAY_URL = toGatewayUrl(`ipfs://${CID}`)
const FILE_BYTES = new TextEncoder().encode('hello invoice world').buffer

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return '0x' + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Mirrors the real Fetch API's single-use body stream: calling arrayBuffer()
// twice throws, same as a real Response would. This makes the mock itself
// enforce "one fetch, bytes read once" rather than only the call-count
// assertion below — either regression fails the suite.
function makeResponse({ ok = true, status = 200, contentType = 'application/octet-stream', bytes = FILE_BYTES } = {}) {
  let consumed = false
  return {
    ok,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: () => {
      if (consumed) throw new Error('body stream already read')
      consumed = true
      return Promise.resolve(bytes)
    }
  }
}

describe('InvoiceViewer', () => {
  let realHash

  beforeEach(async () => {
    realHash = await sha256Hex(FILE_BYTES)
    URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows a loading state while the fetch is in flight', async () => {
    let resolveFetch
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { resolveFetch = r })))

    render(<InvoiceViewer open onClose={() => {}} attachment={{ uri: `ipfs://${CID}`, sha256: realHash }} />)

    expect(screen.getByText(/loading and verifying/i)).toBeInTheDocument()
    resolveFetch(makeResponse({ contentType: 'image/png' }))
    await waitFor(() => expect(screen.getByText(/file verified/i)).toBeInTheDocument())
  })

  it('shows a verified badge and renders an image preview when the hash matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ contentType: 'image/png' })))

    render(<InvoiceViewer open onClose={() => {}} attachment={{ uri: `ipfs://${CID}`, sha256: realHash }} />)

    await waitFor(() => expect(screen.getByText(/file verified — sha-256 matches/i)).toBeInTheDocument())
    expect(screen.getByAltText(/invoice attachment preview/i).tagName).toBe('IMG')
  })

  it('shows a mismatch badge but still renders the preview when the hash does not match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ contentType: 'image/png' })))
    const wrongHash = '0x' + 'ab'.repeat(32)

    render(<InvoiceViewer open onClose={() => {}} attachment={{ uri: `ipfs://${CID}`, sha256: wrongHash }} />)

    await waitFor(() => expect(screen.getByText(/does not match the commitment/i)).toBeInTheDocument())
    // Still shown, not hidden — the user should be able to judge for themselves.
    expect(screen.getByAltText(/invoice attachment preview/i)).toBeInTheDocument()
  })

  it('falls back to an external-open card for unsupported content types, with no verify badge when there is no hash to check', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ contentType: 'text/plain' })))

    render(<InvoiceViewer open onClose={() => {}} attachment={{ uri: `ipfs://${CID}` }} />)

    await waitFor(() => expect(screen.getByText(/preview not available for this file type/i)).toBeInTheDocument())
    expect(screen.queryByText(/file verified/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/does not match/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open in a new tab/i })).toHaveAttribute('href', GATEWAY_URL)
  })

  it('shows a clear error state with a working fallback link when the fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')))

    render(<InvoiceViewer open onClose={() => {}} attachment={{ uri: `ipfs://${CID}`, sha256: realHash }} />)

    await waitFor(() => expect(screen.getByText(/could not load this file/i)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /open in a new tab/i })).toHaveAttribute('href', GATEWAY_URL)
  })

  it('shows the error state for a non-OK HTTP status too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ ok: false, status: 404 })))

    render(<InvoiceViewer open onClose={() => {}} attachment={{ uri: `ipfs://${CID}` }} />)

    await waitFor(() => expect(screen.getByText(/could not load this file/i)).toBeInTheDocument())
  })

  it('derives both the hash check and the preview from a single fetch — protects against a future refactor splitting them into two', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ contentType: 'image/png' }))
    vi.stubGlobal('fetch', fetchMock)

    render(<InvoiceViewer open onClose={() => {}} attachment={{ uri: `ipfs://${CID}`, sha256: realHash }} />)

    await waitFor(() => expect(screen.getByText(/file verified/i)).toBeInTheDocument())
    expect(screen.getByAltText(/invoice attachment preview/i)).toBeInTheDocument()
    // Both the hash badge above and the preview below came from this one call.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(GATEWAY_URL)
  })

  it('does not fetch at all when the modal is not open', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<InvoiceViewer open={false} onClose={() => {}} attachment={{ uri: `ipfs://${CID}`, sha256: realHash }} />)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Three attachmentKeyStatus states a private-mode caller can be in, plus a
  // regression test locking in the specific failure the 'failed' state must
  // never reproduce (a false hash-mismatch reading, or a dead gateway link
  // pointing at ciphertext).
  describe('attachmentKeyStatus', () => {
    it('idle (attachmentKeyStatus "none", no decryptKey): unchanged from the pre-encryption behavior', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ contentType: 'image/png' })))

      render(
        <InvoiceViewer
          open
          onClose={() => {}}
          attachment={{ uri: `ipfs://${CID}`, sha256: realHash }}
          attachmentKeyStatus="none"
        />
      )

      await waitFor(() => expect(screen.getByText(/file verified — sha-256 matches/i)).toBeInTheDocument())
      expect(screen.getByAltText(/invoice attachment preview/i)).toBeInTheDocument()
    })

    it('key-fetch-failed: shows an honest retry message, never fetches, and offers no gateway link', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      render(
        <InvoiceViewer
          open
          onClose={() => {}}
          attachment={{ uri: `ipfs://${CID}`, sha256: realHash }}
          decryptKey={null}
          attachmentKeyStatus="failed"
        />
      )

      await waitFor(() =>
        expect(screen.getByText(/could not retrieve the decryption key for this attachment/i)).toBeInTheDocument()
      )
      expect(fetchMock).not.toHaveBeenCalled()
      expect(screen.queryByRole('link', { name: /open in a new tab/i })).not.toBeInTheDocument()
    })

    it('regression: key-fetch-failed never renders the hash-mismatch UI or a gateway link', async () => {
      // Same wrong-length/wrong-hash setup as the mismatch test above — if the
      // 'failed' short-circuit in InvoiceViewer's effect ever regresses back
      // to falling through to the normal fetch path, this attachment's sha256
      // deliberately does not match FILE_BYTES, so a regression would surface
      // as the "does not match the commitment" text this test forbids.
      const fetchMock = vi.fn().mockResolvedValue(makeResponse({ contentType: 'image/png' }))
      vi.stubGlobal('fetch', fetchMock)
      const wrongHash = '0x' + 'ab'.repeat(32)

      render(
        <InvoiceViewer
          open
          onClose={() => {}}
          attachment={{ uri: `ipfs://${CID}`, sha256: wrongHash }}
          decryptKey={null}
          attachmentKeyStatus="failed"
        />
      )

      await waitFor(() =>
        expect(screen.getByText(/could not retrieve the decryption key for this attachment/i)).toBeInTheDocument()
      )
      expect(fetchMock).not.toHaveBeenCalled()
      expect(screen.queryByText(/does not match the commitment/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /open in a new tab/i })).not.toBeInTheDocument()
    })

    it('decrypted-success: decrypts real ciphertext, verifies against the plaintext hash, and renders the preview', async () => {
      const cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
      const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', cryptoKey))
      const keyHex = '0x' + Array.from(rawKey).map((b) => b.toString(16).padStart(2, '0')).join('')

      const plaintext = new TextEncoder().encode('a real invoice attachment')
      const plaintextHash = await sha256Hex(plaintext.buffer)
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plaintext))
      const envelope = new Uint8Array(iv.length + ciphertext.length)
      envelope.set(iv, 0)
      envelope.set(ciphertext, iv.length)

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ bytes: envelope.buffer })))

      render(
        <InvoiceViewer
          open
          onClose={() => {}}
          attachment={{ uri: `ipfs://${CID}`, sha256: plaintextHash, mime: 'image/png' }}
          decryptKey={keyHex}
          attachmentKeyStatus="available"
        />
      )

      await waitFor(() => expect(screen.getByText(/file verified — sha-256 matches/i)).toBeInTheDocument())
      expect(screen.getByAltText(/invoice attachment preview/i)).toBeInTheDocument()
      expect(screen.queryByText(/could not retrieve the decryption key/i)).not.toBeInTheDocument()
    })
  })
})
