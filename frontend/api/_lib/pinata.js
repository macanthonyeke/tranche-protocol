// Thin wrapper around Pinata's pinning REST API. The caller is responsible
// for producing the exact bytes to pin (fetched via ssrf.js, or an uploaded
// file) — this module only talks to Pinata.

const PINATA_PIN_FILE_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS'

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
