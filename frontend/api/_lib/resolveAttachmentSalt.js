// Independently sources the real attachmentSalt for an escrow — never from
// client input. See request-invoice-key.js's file header for why: a
// client-supplied salt can't be trusted to actually belong to the escrow
// being authorized against. attachmentSalt isn't secret (it lives in the
// public, unencrypted header of every private escrow's envelope blob — see
// envelopeBlob.js), and every private escrow's envelope URI is public too
// (invoiceData is emitted unconditionally via InvoiceSnapshotted). So
// nothing stops a caller who's legitimately authorized for THEIR OWN
// unrelated escrow from submitting a salt copied from a DIFFERENT escrow's
// public envelope and walking away with that escrow's real attachment key.
// The only correct fix is for the server to determine the salt itself, from
// the escrow it already verified the caller is authorized for.

import { getEscrowInvoiceData } from './subgraph.js'
import { parseEnvelopeSalt } from './invoiceCrypto.js'

const GATEWAY_HOST = process.env.VITE_PINATA_GATEWAY || 'moccasin-impressed-gibbon-651.mypinata.cloud'

function toGatewayUrl(ipfsUri) {
  return `https://${GATEWAY_HOST}/ipfs/${ipfsUri.slice('ipfs://'.length)}`
}

/**
 * @param {number|string} escrowId
 * @returns {Promise<Buffer|null>} null if this escrow has no attachment
 *   (public mode, private mode with nothing attached, or not yet indexed)
 */
export async function resolveAttachmentSalt(escrowId) {
  const invoiceData = await getEscrowInvoiceData(escrowId)
  if (typeof invoiceData !== 'string' || !invoiceData.startsWith('ipfs://')) return null

  const res = await fetch(toGatewayUrl(invoiceData))
  if (!res.ok) throw new Error(`Could not fetch the envelope to source its attachment salt (status ${res.status}).`)
  const blob = new Uint8Array(await res.arrayBuffer())
  return parseEnvelopeSalt(blob)
}
