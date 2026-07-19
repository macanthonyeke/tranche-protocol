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
 * this can never be recomputed independently.
 * @param {string} invoiceJson
 * @param {`0x${string}`} invoiceHash
 * @returns {Promise<{ ipfsUri: string }>}
 */
export async function pinPrivateInvoice(invoiceJson, invoiceHash) {
  let res
  try {
    res = await fetch('/api/pin-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceJson, invoiceHash })
    })
  } catch {
    throw new Error('Could not reach the pinning service. Check your connection and try again.')
  }

  if (!res.ok) throw await parseError(res, 'Could not encrypt and pin the invoice. Please try again.')
  return res.json()
}
