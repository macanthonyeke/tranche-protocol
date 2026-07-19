// POST /api/pin-invoice — accepts either a raw file upload (any non-JSON
// Content-Type, filename in the X-Filename header) or a JSON body of
// { url } to fetch server-side. Either way: pin the exact resulting bytes to
// IPFS, hash those same bytes with SHA-256 (matching the existing
// attachment.sha256 sub-field format used by CreateEscrow/InvoiceCard — this
// is unrelated to the on-chain invoiceHash, which stays a client-side
// keccak256 over the full invoice JSON envelope), and return both.
//
// Vercel's Node runtime auto-parses `req.body` only for JSON/urlencoded/text
// Content-Types; anything else (including our raw file uploads) arrives as
// an unconsumed stream, which is what lets us enforce our own byte cap while
// reading it instead of buffering an arbitrary amount up front.
//
// Private mode (X-Private: true header on a raw upload, or {url, private:
// true} in JSON) encrypts the attachment instead of pinning it in plaintext
// — see pinPrivateAttachment below. There's also a JSON {invoiceJson,
// invoiceHash} mode, unrelated to attachments, that encrypts the invoice
// envelope itself — see pinPrivateInvoiceEnvelope.

import { createHash } from 'node:crypto'
import { keccak256, toHex } from 'viem'
import { fetchUrlSafely, SsrfError } from './_lib/ssrf.js'
import { pinBytesToIPFS, PinataError } from './_lib/pinata.js'
import {
  deriveInvoiceKey, encryptEnvelope, deriveAttachmentKey, generateAttachmentSalt, encryptBytes, InvoiceCryptoError
} from './_lib/invoiceCrypto.js'
import { issueUnpinToken } from './_lib/unpinToken.js'

// Kept under Vercel's fixed 4.5MB serverless function request-body limit, so
// our own clear error fires first instead of the platform's generic 413.
const MAX_BYTES = 4 * 1024 * 1024
const TIMEOUT_MS = 10_000
const FILE_TOO_LARGE_MESSAGE =
  `File is too large. Please compress or split it and try again (limit ${MAX_BYTES / 1024 / 1024}MB).`

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

function sha256Hex(bytes) {
  return '0x' + createHash('sha256').update(bytes).digest('hex')
}

async function readRawBody(req, maxBytes, tooLargeMessage) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) {
      throw new RequestError(tooLargeMessage, 413)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const raw = await readRawBody(req, 1024 * 1024, 'Request body is too large.')
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw new RequestError('That request body is not valid JSON.')
  }
}

function safeDecode(value, fallback) {
  if (!value) return fallback
  try {
    return decodeURIComponent(value)
  } catch {
    return fallback
  }
}

// Private-mode invoice envelope: encrypt the exact invoiceJson the client
// computed invoiceHash from (see frontend/src/utils/invoiceHash.js), then pin
// the ciphertext instead of plaintext. invoiceHash is recomputed here from
// the received invoiceJson and checked against the client-supplied value —
// not to pick one over the other, but to fail loudly at pin time if the two
// ever diverge. A mismatch here means the escrow this pin is for would carry
// an on-chain invoiceHash that request-invoice-key.js can never reproduce a
// matching key from, permanently stranding the ciphertext.
//
// attachmentSalt (hex, optional) is the salt pinPrivateAttachment generated
// when the escrow's attachment was pinned moments earlier in the same
// onDeposit() call — embedded verbatim in the envelope's public header (see
// envelopeBlob.js) so a viewer can read it before decrypting anything.
async function pinPrivateInvoiceEnvelope({ invoiceJson, invoiceHash, attachmentSalt }) {
  const recomputed = keccak256(toHex(invoiceJson))
  if (recomputed.toLowerCase() !== String(invoiceHash).toLowerCase()) {
    throw new RequestError('invoiceHash does not match the provided invoice JSON.')
  }
  let saltBuffer
  if (attachmentSalt !== undefined && attachmentSalt !== null) {
    if (typeof attachmentSalt !== 'string' || !/^(0x)?[0-9a-fA-F]{32}$/.test(attachmentSalt)) {
      throw new RequestError('attachmentSalt must be a 16-byte hex string.')
    }
    saltBuffer = Buffer.from(attachmentSalt.replace(/^0x/, ''), 'hex')
  }
  const key = deriveInvoiceKey(invoiceHash)
  const blob = encryptEnvelope(invoiceJson, key, { attachmentSalt: saltBuffer })
  const { ipfsUri } = await pinBytesToIPFS(blob, { filename: 'invoice.enc', contentType: 'application/octet-stream' })
  return { ipfsUri }
}

// Private-mode attachment: sha256 is computed on the ORIGINAL plaintext
// bytes — unchanged from the public-mode contract, since that's what
// attachments[].sha256 inside the invoice envelope commits to, and what
// gets checked against the DECRYPTED bytes on the viewing side. The bytes
// themselves are then encrypted under a fresh, randomly-salted key before
// pinning, so what Pinata/IPFS actually stores is ciphertext (pinned with a
// generic content-type — the real one is returned here so the caller can
// carry it inside the encrypted envelope instead, since the gateway will
// only ever report "application/octet-stream" for the ciphertext itself).
// The salt returned here isn't a secret — it only needs to survive long
// enough to be embedded in the envelope pinned right after (see
// pinPrivateInvoiceEnvelope above).
async function pinPrivateAttachment(bytes, { filename, mime }) {
  const sha256 = sha256Hex(bytes)
  const salt = generateAttachmentSalt()
  const key = deriveAttachmentKey(salt)
  const blob = encryptBytes(bytes, key)
  const { ipfsUri } = await pinBytesToIPFS(blob, { filename: `${filename}.enc`, contentType: 'application/octet-stream' })
  return { ipfsUri, sha256, salt: `0x${salt.toString('hex')}`, mime }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  try {
    const contentType = req.headers['content-type'] || ''
    let bytes, filename, mime, isPrivate

    if (contentType.startsWith('application/json')) {
      const body = await readJsonBody(req)

      if (typeof body?.invoiceJson === 'string') {
        if (typeof body?.invoiceHash !== 'string' || !body.invoiceHash) {
          throw new RequestError('invoiceHash is required alongside invoiceJson.')
        }
        const result = await pinPrivateInvoiceEnvelope({
          invoiceJson: body.invoiceJson,
          invoiceHash: body.invoiceHash,
          attachmentSalt: body.attachmentSalt
        })
        res.status(200).json(result)
        return
      }

      const url = typeof body?.url === 'string' ? body.url.trim() : ''
      if (!url) throw new RequestError('Provide a "url" to fetch, or upload a file directly.')
      isPrivate = body?.private === true

      const fetched = await fetchUrlSafely(url, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS })
      bytes = fetched.bytes
      mime = fetched.contentType || 'application/octet-stream'
      let pathname = 'invoice'
      try {
        pathname = new URL(url).pathname.split('/').filter(Boolean).pop() || 'invoice'
      } catch {}
      filename = safeDecode(pathname, 'invoice')
    } else {
      bytes = await readRawBody(req, MAX_BYTES, FILE_TOO_LARGE_MESSAGE)
      mime = contentType || 'application/octet-stream'
      filename = safeDecode(req.headers['x-filename'], 'invoice')
      isPrivate = req.headers['x-private'] === 'true'
    }

    if (!bytes || bytes.length === 0) {
      throw new RequestError('No file was provided.')
    }

    if (isPrivate) {
      const result = await pinPrivateAttachment(bytes, { filename, mime })
      res.status(200).json(result)
      return
    }

    const sha256 = sha256Hex(bytes)
    const { cid, ipfsUri } = await pinBytesToIPFS(bytes, { filename, contentType: mime })

    // Only the plaintext-public pin path ever needs to be unpinnable — see
    // CreateEscrow.jsx's setPrivateMode, the only caller of
    // /api/unpin-invoice, which only ever targets a plaintext attachment
    // orphaned by switching mode before deposit(). Issuing this
    // unconditionally on every public pin is cheap and harmless for callers
    // that never end up needing it — see unpinToken.js for what it is and
    // why it exists instead of server-side storage. Best-effort: the pin
    // itself must not fail just because UNPIN_TOKEN_SECRET isn't set —
    // that would only ever make later cleanup impossible, never the pin.
    let unpinToken
    try {
      unpinToken = issueUnpinToken(cid)
    } catch (err) {
      console.error('issueUnpinToken failed (pin still succeeds, cleanup will not be possible):', err)
    }

    res.status(200).json({ ipfsUri, sha256, size: bytes.length, unpinToken })
  } catch (err) {
    if (err instanceof RequestError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    if (err instanceof SsrfError) {
      res.status(400).json({ error: err.message })
      return
    }
    if (err instanceof PinataError) {
      res.status(502).json({ error: err.message })
      return
    }
    if (err instanceof InvoiceCryptoError) {
      res.status(500).json({ error: err.message })
      return
    }
    console.error('pin-invoice failed:', err)
    res.status(500).json({ error: 'Something went wrong while pinning the invoice. Please try again.' })
  }
}
