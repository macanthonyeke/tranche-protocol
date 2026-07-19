// Frontend helper for the /api/pin-invoice serverless route. The server pins
// the exact bytes it receives (uploaded, or fetched from a URL) to IPFS and
// hashes those same bytes with SHA-256 — so the hash this returns is
// guaranteed to match what's actually pinned, not a separate local copy.

// Mirrors the server-side cap in api/pin-invoice.js — kept in sync manually
// since client and server code aren't bundled together. Checking client-side
// first gives instant feedback instead of a round trip just to hit the cap.
const MAX_BYTES = 4 * 1024 * 1024

async function parseError(res, fallback) {
  try {
    const data = await res.json()
    if (data?.error) return new Error(data.error)
  } catch {}
  return new Error(fallback)
}

/**
 * Upload a file to be pinned.
 * @param {File} file
 * @returns {Promise<{ ipfsUri: string, sha256: string, size: number }>}
 */
export async function pinFile(file) {
  if (!file) throw new Error('No file was selected.')
  if (file.size > MAX_BYTES) {
    throw new Error(`File is too large. Please compress or split it and try again (limit ${MAX_BYTES / 1024 / 1024}MB).`)
  }

  let res
  try {
    res = await fetch('/api/pin-invoice', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name || 'invoice')
      },
      body: file
    })
  } catch {
    throw new Error('Could not reach the pinning service. Check your connection and try again.')
  }

  if (!res.ok) throw await parseError(res, 'Could not pin the file. Please try again.')
  return res.json()
}

/**
 * Fetch a URL server-side and pin the exact bytes received.
 * @param {string} url
 * @returns {Promise<{ ipfsUri: string, sha256: string, size: number }>}
 */
export async function pinUrl(url) {
  const trimmed = (url || '').trim()
  if (!trimmed) throw new Error('Enter a URL to pin.')

  let res
  try {
    res = await fetch('/api/pin-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: trimmed })
    })
  } catch {
    throw new Error('Could not reach the pinning service. Check your connection and try again.')
  }

  if (!res.ok) throw await parseError(res, 'Could not pin that URL. Please try again.')
  return res.json()
}

/**
 * Encrypt and pin a private-mode invoice envelope. `invoiceHash` must be the
 * exact value computeInvoiceHash(invoiceJson) already produced for this
 * submission — see frontend/src/utils/invoiceHash.js's file header for why
 * this can never be recomputed independently. `attachmentSalt`, when this
 * escrow has a private-mode attachment, is the salt pinPrivateAttachmentFile
 * / pinPrivateAttachmentUrl already returned — it gets embedded in the
 * envelope's own header (see envelopeBlob.js) so a viewer can unlock both
 * with a single signed request.
 * @param {string} invoiceJson
 * @param {`0x${string}`} invoiceHash
 * @param {`0x${string}`} [attachmentSalt]
 * @returns {Promise<{ ipfsUri: string }>}
 */
export async function pinPrivateInvoice(invoiceJson, invoiceHash, attachmentSalt) {
  let res
  try {
    res = await fetch('/api/pin-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attachmentSalt ? { invoiceJson, invoiceHash, attachmentSalt } : { invoiceJson, invoiceHash })
    })
  } catch {
    throw new Error('Could not reach the pinning service. Check your connection and try again.')
  }

  if (!res.ok) throw await parseError(res, 'Could not encrypt and pin the invoice. Please try again.')
  return res.json()
}

/**
 * Encrypt and pin an uploaded file as a private-mode attachment. Unlike
 * pinFile, this never puts plaintext on IPFS — the server encrypts under a
 * fresh per-attachment key before pinning.
 * @param {File} file
 * @returns {Promise<{ ipfsUri: string, sha256: string, salt: `0x${string}`, mime: string }>}
 */
export async function pinPrivateAttachmentFile(file) {
  if (!file) throw new Error('No file was selected.')
  if (file.size > MAX_BYTES) {
    throw new Error(`File is too large. Please compress or split it and try again (limit ${MAX_BYTES / 1024 / 1024}MB).`)
  }

  let res
  try {
    res = await fetch('/api/pin-invoice', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name || 'invoice'),
        'X-Private': 'true'
      },
      body: file
    })
  } catch {
    throw new Error('Could not reach the pinning service. Check your connection and try again.')
  }

  if (!res.ok) throw await parseError(res, 'Could not encrypt and pin the file. Please try again.')
  return res.json()
}

/**
 * Fetch a URL server-side and pin the encrypted bytes as a private-mode
 * attachment. Unlike pinUrl, this never puts plaintext on IPFS.
 * @param {string} url
 * @returns {Promise<{ ipfsUri: string, sha256: string, salt: `0x${string}`, mime: string }>}
 */
export async function pinPrivateAttachmentUrl(url) {
  const trimmed = (url || '').trim()
  if (!trimmed) throw new Error('Enter a URL to pin.')

  let res
  try {
    res = await fetch('/api/pin-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: trimmed, private: true })
    })
  } catch {
    throw new Error('Could not reach the pinning service. Check your connection and try again.')
  }

  if (!res.ok) throw await parseError(res, 'Could not encrypt and pin that URL. Please try again.')
  return res.json()
}

/**
 * Best-effort cleanup for a plaintext attachment pinned by pinFile/pinUrl
 * and then abandoned before any deposit() referenced it on-chain. `token`
 * must be the unpinToken pinFile/pinUrl returned alongside this exact
 * ipfsUri — the endpoint rejects anything else (see
 * api/_lib/unpinToken.js). Callers should treat this as fire-and-forget:
 * never block a UI action on it, and a failure here is not worth surfacing
 * to the user (the attachment is already gone from their draft either way).
 * @param {string} ipfsUri
 * @param {string} [token]
 * @returns {Promise<void>}
 */
export async function unpinAttachment(ipfsUri, token) {
  if (!ipfsUri || !token) return
  try {
    await fetch('/api/unpin-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ipfsUri, token })
    })
  } catch {
    // Best-effort — see file header.
  }
}
