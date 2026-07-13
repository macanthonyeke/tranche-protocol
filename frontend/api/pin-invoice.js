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

import { createHash } from 'node:crypto'
import { fetchUrlSafely, SsrfError } from './_lib/ssrf.js'
import { pinBytesToIPFS, PinataError } from './_lib/pinata.js'

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  try {
    const contentType = req.headers['content-type'] || ''
    let bytes, filename, mime

    if (contentType.startsWith('application/json')) {
      const body = await readJsonBody(req)
      const url = typeof body?.url === 'string' ? body.url.trim() : ''
      if (!url) throw new RequestError('Provide a "url" to fetch, or upload a file directly.')

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
    }

    if (!bytes || bytes.length === 0) {
      throw new RequestError('No file was provided.')
    }

    const sha256 = sha256Hex(bytes)
    const { ipfsUri } = await pinBytesToIPFS(bytes, { filename, contentType: mime })

    res.status(200).json({ ipfsUri, sha256, size: bytes.length })
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
    console.error('pin-invoice failed:', err)
    res.status(500).json({ error: 'Something went wrong while pinning the invoice. Please try again.' })
  }
}
