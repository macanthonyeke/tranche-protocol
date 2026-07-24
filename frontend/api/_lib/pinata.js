// Thin wrapper around Pinata's pinning REST API. The caller is responsible
// for producing the exact bytes to pin (fetched via ssrf.js, or an uploaded
// file) — this module only talks to Pinata.

const PINATA_PIN_FILE_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS'
const PINATA_UNPIN_URL = (cid) => `https://api.pinata.cloud/pinning/unpin/${cid}`

export class PinataError extends Error {}

/**
 * Pin raw bytes to IPFS via Pinata.
 * @param {Buffer} bytes
 * @param {{ filename?: string, contentType?: string }} [opts]
 * @returns {Promise<{ cid: string, ipfsUri: string, size: number }>}
 */
export async function pinBytesToIPFS(bytes, { filename = 'invoice', contentType = 'application/octet-stream' } = {}) {
  const jwt = process.env.PINATA_JWT
  if (!jwt) throw new PinataError('Pinning is not configured on the server.')

  const form = new FormData()
  form.append('file', new Blob([bytes], { type: contentType }), filename)
  // CIDv1 (base32) — the modern default and what ipfs:// resolvers expect.
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }))

  let res
  try {
    res = await fetch(PINATA_PIN_FILE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: form
    })
  } catch (err) {
    throw new PinataError(`Could not reach the pinning service: ${err.message}`)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new PinataError(`Pinning failed (${res.status}): ${detail.slice(0, 300)}`)
  }

  let data
  try {
    data = await res.json()
  } catch {
    throw new PinataError('Pinning service returned an unreadable response.')
  }

  const cid = data?.IpfsHash
  if (!cid) throw new PinataError('Pinning service returned an unexpected response.')

  return { cid, ipfsUri: `ipfs://${cid}`, size: bytes.length }
}

/**
 * Unpin a CID from our Pinata account. This only stops US hosting it — it
 * cannot delete the content from IPFS globally (any node that already
 * fetched or pinned it independently keeps serving it), and by the time a
 * caller has a CID at all, IPFS's content-addressing means they could
 * already fetch the bytes directly. Best-effort cleanup, not a deletion
 * guarantee. Currently only called for a plaintext attachment pinned
 * client-side during Create Escrow and then abandoned (e.g. switching to
 * private mode) before any deposit() ever referenced it on-chain.
 * @param {string} cid
 */
export async function unpinFromIPFS(cid) {
  const jwt = process.env.PINATA_JWT
  if (!jwt) throw new PinataError('Pinning is not configured on the server.')

  let res
  try {
    res = await fetch(PINATA_UNPIN_URL(cid), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwt}` }
    })
  } catch (err) {
    throw new PinataError(`Could not reach the pinning service: ${err.message}`)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new PinataError(`Unpinning failed (${res.status}): ${detail.slice(0, 300)}`)
  }
}
