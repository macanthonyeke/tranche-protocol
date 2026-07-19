// POST /api/request-invoice-key — signature-gated access to a private
// escrow's invoice decryption key (and, optionally, its attachment key).
// Caller proves control of a wallet by signing a short-lived challenge
// message; if that wallet is the escrow's recipient or depositor (always),
// or the arbiter while the escrow has an open dispute, the
// deterministically-derived envelope key (see _lib/invoiceCrypto.js) is
// returned.
//
// If the request also includes attachmentSalt — the client reads this out
// of the envelope's own ciphertext header (envelopeBlob.js) once it's
// fetched the envelope blob, before requesting any key — the attachment key
// is derived and returned in the same response. Same authorization check,
// no extra chain read: this is what lets one signature unlock both the
// envelope and its attachment instead of requiring a second signed request
// once the attachment's existence is discovered.
//
// No key is ever generated here and nothing is ever stored — see
// _lib/invoiceCrypto.js's file header for the derivation design and its
// accepted tradeoffs.

import { isAddress, recoverMessageAddress } from 'viem'
import { getEscrowDetailFor } from './_lib/chain.js'
import { deriveInvoiceKey, deriveAttachmentKey, InvoiceCryptoError } from './_lib/invoiceCrypto.js'
import { authorizeInvoiceKeyAccess } from './_lib/invoiceKeyAuth.js'

// Both directions bounded: a message timestamped in the future would
// otherwise let someone "bank" a valid signature for a chosen later window.
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000

// "Access invoice for escrow {escrowId} at {timestamp}" — timestamp is a
// Unix-ms epoch, generated fresh by the client for every request.
const MESSAGE_RE = /^Access invoice for escrow (\d+) at (\d+)$/

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const { escrowId, walletAddress, signature, message, attachmentSalt } = body

    if (escrowId === undefined || escrowId === null || !/^\d+$/.test(String(escrowId))) {
      throw new RequestError('A valid escrowId is required.')
    }
    if (typeof walletAddress !== 'string' || !isAddress(walletAddress)) {
      throw new RequestError('A valid walletAddress is required.')
    }
    if (typeof signature !== 'string' || !signature.startsWith('0x')) {
      throw new RequestError('A valid signature is required.')
    }
    if (typeof message !== 'string') {
      throw new RequestError('A message is required.')
    }
    if (attachmentSalt !== undefined && (typeof attachmentSalt !== 'string' || !/^(0x)?[0-9a-fA-F]{32}$/.test(attachmentSalt))) {
      throw new RequestError('attachmentSalt must be a 16-byte hex string.')
    }

    const match = message.match(MESSAGE_RE)
    if (!match) throw new RequestError('Message does not match the expected challenge format.')
    const [, msgEscrowId, msgTimestamp] = match

    // The message (not the top-level escrowId field) is what's actually
    // signed. Requiring the two to agree stops a signature captured for one
    // escrow from being replayed against a different escrowId by simply
    // editing the request body around an unchanged, still-valid signature.
    if (msgEscrowId !== String(escrowId)) {
      throw new RequestError('escrowId does not match the signed message.')
    }

    const skewMs = Math.abs(Date.now() - Number(msgTimestamp))
    if (skewMs > MAX_CLOCK_SKEW_MS) {
      throw new RequestError('This request has expired. Please try again.', 401)
    }

    let recovered
    try {
      recovered = await recoverMessageAddress({ message, signature })
    } catch {
      throw new RequestError('Could not verify the signature.', 401)
    }
    if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new RequestError('Signature does not match walletAddress.', 401)
    }

    let detail
    try {
      detail = await getEscrowDetailFor(escrowId, walletAddress)
    } catch {
      throw new RequestError('Escrow not found.', 404)
    }

    const authorized = authorizeInvoiceKeyAccess({
      walletAddress,
      recipient: detail.escrow.recipient,
      depositor: detail.escrow.depositor,
      isArbiter: detail.isArbiter,
      milestoneStates: detail.milestones.map((m) => m.state)
    })
    if (!authorized) {
      throw new RequestError('Not authorized to read this invoice.', 403)
    }

    const key = deriveInvoiceKey(detail.escrow.invoiceHash)
    const responseBody = { key: `0x${key.toString('hex')}` }
    if (attachmentSalt) {
      const attachmentKey = deriveAttachmentKey(attachmentSalt)
      responseBody.attachmentKey = `0x${attachmentKey.toString('hex')}`
    }
    res.status(200).json(responseBody)
  } catch (err) {
    if (err instanceof RequestError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    if (err instanceof InvoiceCryptoError) {
      res.status(500).json({ error: err.message })
      return
    }
    console.error('request-invoice-key failed:', err)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
}
