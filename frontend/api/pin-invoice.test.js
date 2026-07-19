// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import http from 'node:http'
import { keccak256, toHex } from 'viem'
import handler from './pin-invoice.js'
import { deriveInvoiceKey, deriveAttachmentKey, decryptEnvelope, decryptBytes } from './_lib/invoiceCrypto.js'
import { verifyUnpinToken } from './_lib/unpinToken.js'

function fakeReq(bodyBytes, headers) {
  const req = Readable.from([bodyBytes])
  req.method = 'POST'
  req.headers = headers
  return req
}

function fakeRes() {
  const res = { statusCode: 200 }
  res.status = (c) => { res.statusCode = c; return res }
  res.setHeader = (k, v) => { res[`header:${k}`] = v }
  res.json = (obj) => { res.body = obj }
  return res
}

function sha256Hex(bytes) {
  return '0x' + createHash('sha256').update(bytes).digest('hex')
}

// Same technique as pinata.test.js: extract exactly the "file" field's bytes
// from the multipart body the route sent to Pinata, for byte-exact checks.
function extractMultipartFilePart(body, contentTypeHeader) {
  const boundary = contentTypeHeader.match(/boundary=(.+)$/)[1]
  const marker = Buffer.from(`--${boundary}`)
  let start = body.indexOf(marker)
  while (start !== -1) {
    const next = body.indexOf(marker, start + marker.length)
    if (next === -1) break
    const part = body.subarray(start + marker.length, next)
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd !== -1 && part.subarray(0, headerEnd).toString('utf8').includes('name="file"')) {
      let content = part.subarray(headerEnd + 4)
      if (content.subarray(-2).toString() === '\r\n') content = content.subarray(0, -2)
      return content
    }
    start = next
  }
  return null
}

let server, port, receivedByMockPinata

beforeEach(async () => {
  process.env.PINATA_JWT = 'test-jwt'
  process.env.INVOICE_KEY_SECRET = 'test-secret'
  process.env.UNPIN_TOKEN_SECRET = 'test-unpin-secret'
  receivedByMockPinata = null
  server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      receivedByMockPinata = { headers: req.headers, body: Buffer.concat(chunks) }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ IpfsHash: 'bafyMOCKED' }))
    })
  })
  await new Promise((resolve) => server.listen(0, resolve))
  port = server.address().port

  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', (url, opts) => {
    // Only redirect the outbound Pinata call; real fetches for the
    // URL-fetch-and-pin scenario go through ssrf.js's own http/https
    // modules, not global fetch, so they're unaffected by this stub.
    if (String(url).includes('pinata.cloud')) return realFetch(`http://127.0.0.1:${port}/`, opts)
    return realFetch(url, opts)
  })
})

afterEach(async () => {
  delete process.env.PINATA_JWT
  delete process.env.INVOICE_KEY_SECRET
  delete process.env.UNPIN_TOKEN_SECRET
  vi.unstubAllGlobals()
  await new Promise((resolve) => server.close(resolve))
})

describe('POST /api/pin-invoice', () => {
  it('rejects non-POST methods', async () => {
    const req = fakeReq(Buffer.alloc(0), {})
    req.method = 'GET'
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(405)
  })

  it('uploads a file, pins the exact bytes, and returns a hash that matches those bytes', async () => {
    const fileBytes = Buffer.from('%PDF-1.4 fake invoice bytes')
    const req = fakeReq(fileBytes, { 'content-type': 'application/pdf', 'x-filename': encodeURIComponent('my invoice.pdf') })
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.ipfsUri).toBe('ipfs://bafyMOCKED')
    expect(res.body.size).toBe(fileBytes.length)
    expect(res.body.sha256).toBe(sha256Hex(fileBytes))

    const pinnedFilePart = extractMultipartFilePart(receivedByMockPinata.body, receivedByMockPinata.headers['content-type'])
    expect(pinnedFilePart.equals(fileBytes)).toBe(true) // what got pinned is byte-identical to what was uploaded

    // A public pin also gets an unpin capability, scoped to exactly this CID
    // (bafyMOCKED — see unpin-invoice.js / setPrivateMode's cleanup path).
    expect(typeof res.body.unpinToken).toBe('string')
    expect(verifyUnpinToken('bafyMOCKED', res.body.unpinToken)).toBe(true)
    expect(verifyUnpinToken('bafySOMEOTHERCID', res.body.unpinToken)).toBe(false)
  })

  it('fetches a URL server-side, pins the exact fetched bytes, and returns a matching hash', { timeout: 10_000, retry: 2 }, async () => {
    const req = fakeReq(Buffer.from(JSON.stringify({ url: 'http://example.com/' })), { 'content-type': 'application/json' })
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.ipfsUri).toBe('ipfs://bafyMOCKED')

    const pinnedFilePart = extractMultipartFilePart(receivedByMockPinata.body, receivedByMockPinata.headers['content-type'])
    // Self-consistent regardless of example.com's actual current content:
    // the hash returned to the caller must match the bytes that were
    // actually pinned, not some other fetch of the same URL.
    expect(res.body.sha256).toBe(sha256Hex(pinnedFilePart))
  })

  it('rejects an oversized upload with a clear, specific message instead of a generic platform error', async () => {
    const oversized = Buffer.alloc(4 * 1024 * 1024 + 100, 1)
    const req = fakeReq(oversized, { 'content-type': 'application/octet-stream' })
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(413)
    expect(res.body.error).toMatch(/too large.*compress or split.*4MB/i)
  })

  it('accepts an upload just under the size cap', async () => {
    const underCap = Buffer.alloc(4 * 1024 * 1024 - 1000, 1)
    const req = fakeReq(underCap, { 'content-type': 'application/octet-stream' })
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
  })

  it('surfaces an SSRF-blocked URL as a 400 with the guard message, not a 500', async () => {
    const req = fakeReq(Buffer.from(JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/' })), { 'content-type': 'application/json' })
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/private or reserved address/i)
  })

  it('rejects a JSON body with no url', async () => {
    const req = fakeReq(Buffer.from(JSON.stringify({})), { 'content-type': 'application/json' })
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/provide a "url"/i)
  })

  it('rejects an empty upload', async () => {
    const req = fakeReq(Buffer.alloc(0), { 'content-type': 'application/octet-stream' })
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/no file was provided/i)
  })
})

describe('POST /api/pin-invoice — private mode (encrypted envelope)', () => {
  it('encrypts the invoice JSON, pins ciphertext (not plaintext), and the pinned blob decrypts back to the exact original bytes', async () => {
    const invoiceJson = JSON.stringify({ version: 1, invoiceNumber: 'INV-PRIVATE-1', notes: 'sensitive terms' })
    const invoiceHash = keccak256(toHex(invoiceJson))
    const req = fakeReq(Buffer.from(JSON.stringify({ invoiceJson, invoiceHash })), { 'content-type': 'application/json' })
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.ipfsUri).toBe('ipfs://bafyMOCKED')

    const pinnedBlob = extractMultipartFilePart(receivedByMockPinata.body, receivedByMockPinata.headers['content-type'])
    // What Pinata received is ciphertext, not the plaintext invoice.
    expect(pinnedBlob.includes(Buffer.from('INV-PRIVATE-1'))).toBe(false)

    const key = deriveInvoiceKey(invoiceHash)
    const { plaintext: decrypted, attachmentSalt } = decryptEnvelope(pinnedBlob, key)
    expect(decrypted.toString('utf8')).toBe(invoiceJson)
    expect(attachmentSalt).toBeNull() // no attachmentSalt was sent
  })

  it('rejects an invoiceHash that does not match the provided invoiceJson, instead of silently pinning an unrecoverable envelope', async () => {
    const invoiceJson = JSON.stringify({ version: 1, invoiceNumber: 'INV-PRIVATE-2' })
    const wrongHash = keccak256(toHex('something else entirely'))
    const req = fakeReq(Buffer.from(JSON.stringify({ invoiceJson, invoiceHash: wrongHash })), { 'content-type': 'application/json' })
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/invoiceHash does not match/i)
    expect(receivedByMockPinata).toBeNull() // never reached Pinata
  })

  it('rejects invoiceJson with no invoiceHash', async () => {
    const req = fakeReq(Buffer.from(JSON.stringify({ invoiceJson: '{}' })), { 'content-type': 'application/json' })
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/invoiceHash is required/i)
  })

  it('fails clearly when INVOICE_KEY_SECRET is not configured', async () => {
    delete process.env.INVOICE_KEY_SECRET
    const invoiceJson = JSON.stringify({ version: 1 })
    const invoiceHash = keccak256(toHex(invoiceJson))
    const req = fakeReq(Buffer.from(JSON.stringify({ invoiceJson, invoiceHash })), { 'content-type': 'application/json' })
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(500)
  })

  it('embeds a client-supplied attachmentSalt in the envelope header, extractable and usable to derive the attachment key', async () => {
    const invoiceJson = JSON.stringify({ version: 1, invoiceNumber: 'INV-PRIVATE-3', attachments: [{ uri: 'ipfs://bafyATTACHMENT' }] })
    const invoiceHash = keccak256(toHex(invoiceJson))
    const attachmentSalt = '0x' + 'ab'.repeat(16)
    const req = fakeReq(
      Buffer.from(JSON.stringify({ invoiceJson, invoiceHash, attachmentSalt })),
      { 'content-type': 'application/json' }
    )
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    const pinnedBlob = extractMultipartFilePart(receivedByMockPinata.body, receivedByMockPinata.headers['content-type'])
    const key = deriveInvoiceKey(invoiceHash)
    const { plaintext: decrypted, attachmentSalt: extractedSalt } = decryptEnvelope(pinnedBlob, key)

    expect(decrypted.toString('utf8')).toBe(invoiceJson)
    expect(`0x${extractedSalt.toString('hex')}`).toBe(attachmentSalt)
    // The exact key request-invoice-key.js would derive from this salt.
    expect(deriveAttachmentKey(extractedSalt).equals(deriveAttachmentKey(attachmentSalt))).toBe(true)
  })

  it('rejects a malformed attachmentSalt', async () => {
    const invoiceJson = JSON.stringify({ version: 1 })
    const invoiceHash = keccak256(toHex(invoiceJson))
    const req = fakeReq(
      Buffer.from(JSON.stringify({ invoiceJson, invoiceHash, attachmentSalt: 'not-hex' })),
      { 'content-type': 'application/json' }
    )
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/16-byte hex/i)
  })
})

describe('POST /api/pin-invoice — private mode (encrypted attachment)', () => {
  it('encrypts an uploaded file (X-Private header), pins ciphertext, and returns a plaintext sha256 + usable salt', async () => {
    const fileBytes = Buffer.from('%PDF-1.4 fake private attachment bytes')
    const req = fakeReq(fileBytes, {
      'content-type': 'application/pdf',
      'x-filename': encodeURIComponent('secret.pdf'),
      'x-private': 'true'
    })
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.sha256).toBe(sha256Hex(fileBytes)) // hash of PLAINTEXT, unchanged contract
    expect(res.body.mime).toBe('application/pdf')
    expect(typeof res.body.salt).toBe('string')

    const pinnedBlob = extractMultipartFilePart(receivedByMockPinata.body, receivedByMockPinata.headers['content-type'])
    expect(pinnedBlob.includes(fileBytes)).toBe(false) // ciphertext, not plaintext, reached Pinata

    const key = deriveAttachmentKey(res.body.salt)
    const decrypted = decryptBytes(pinnedBlob, key)
    expect(decrypted.equals(fileBytes)).toBe(true)
  })

  it('sha256 is computed on the plaintext BEFORE encryption, not on the ciphertext that actually gets pinned', async () => {
    // Dedicated, narrow proof of the invariant — would fail immediately if
    // the implementation were ever reordered to hash after encrypting.
    const fileBytes = Buffer.from('the exact bytes attachments[0].sha256 must commit to')
    const req = fakeReq(fileBytes, {
      'content-type': 'application/octet-stream',
      'x-filename': encodeURIComponent('doc'),
      'x-private': 'true'
    })
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.sha256).toBe(sha256Hex(fileBytes))

    const pinnedCiphertext = extractMultipartFilePart(receivedByMockPinata.body, receivedByMockPinata.headers['content-type'])
    // The returned hash must NOT match what was actually pinned — proof
    // it's the plaintext's hash, not the ciphertext's.
    expect(res.body.sha256).not.toBe(sha256Hex(pinnedCiphertext))
  })

  it('encrypts a fetched URL (private:true), pins ciphertext, and returns a plaintext sha256', { timeout: 10_000, retry: 2 }, async () => {
    const req = fakeReq(
      Buffer.from(JSON.stringify({ url: 'http://example.com/', private: true })),
      { 'content-type': 'application/json' }
    )
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(typeof res.body.salt).toBe('string')

    const pinnedBlob = extractMultipartFilePart(receivedByMockPinata.body, receivedByMockPinata.headers['content-type'])
    const key = deriveAttachmentKey(res.body.salt)
    const decrypted = decryptBytes(pinnedBlob, key)
    expect(res.body.sha256).toBe(sha256Hex(decrypted)) // sha256 matches the DECRYPTED (plaintext) bytes
  })

  it('a public (non-private) upload is unaffected — still pins plaintext, exact pre-existing behavior', async () => {
    const fileBytes = Buffer.from('%PDF-1.4 public attachment')
    const req = fakeReq(fileBytes, { 'content-type': 'application/pdf', 'x-filename': encodeURIComponent('public.pdf') })
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.salt).toBeUndefined()
    const pinnedFilePart = extractMultipartFilePart(receivedByMockPinata.body, receivedByMockPinata.headers['content-type'])
    expect(pinnedFilePart.equals(fileBytes)).toBe(true) // still plaintext
  })
})

describe('POST /api/pin-invoice — full private-mode round trip (attachment + envelope)', () => {
  it('attachment pin -> invoiceHash over the final envelope -> envelope pin (embedding the salt) -> viewing-side decrypt of both', async () => {
    // 1. Attachment first — its ciphertext URI has to exist before the
    // envelope that references it can be hashed.
    const attachmentBytes = Buffer.from('%PDF-1.4 the real contract')
    const attachmentReq = fakeReq(attachmentBytes, {
      'content-type': 'application/pdf',
      'x-filename': encodeURIComponent('contract.pdf'),
      'x-private': 'true'
    })
    const attachmentRes = fakeRes()
    await handler(attachmentReq, attachmentRes)
    expect(attachmentRes.statusCode).toBe(200)
    const { ipfsUri: attachmentUri, sha256: attachmentSha256, salt: attachmentSalt, mime } = attachmentRes.body
    // receivedByMockPinata gets overwritten by the next handler() call
    // below, so snapshot the attachment's ciphertext blob now.
    const attachmentCiphertext = extractMultipartFilePart(receivedByMockPinata.body, receivedByMockPinata.headers['content-type'])

    // 2. Fold the attachment's ciphertext URI into the envelope, hash the
    // now-final envelope.
    const invoiceObject = {
      version: 1,
      invoiceNumber: 'INV-FULL-ROUNDTRIP',
      attachments: [{ uri: attachmentUri, sha256: attachmentSha256, mime }]
    }
    const invoiceJson = JSON.stringify(invoiceObject)
    const invoiceHash = keccak256(toHex(invoiceJson))

    // 3. Pin the envelope, embedding the attachment's salt in its header.
    const envelopeReq = fakeReq(
      Buffer.from(JSON.stringify({ invoiceJson, invoiceHash, attachmentSalt })),
      { 'content-type': 'application/json' }
    )
    const envelopeRes = fakeRes()
    await handler(envelopeReq, envelopeRes)
    expect(envelopeRes.statusCode).toBe(200)

    // 4. Viewing side: fetch (here, read directly from the mock Pinata
    // capture) the envelope blob, decrypt it with the invoiceHash-derived
    // key, extract the attachment salt from its header, derive the
    // attachment key, decrypt the attachment, and confirm everything
    // matches what was pinned.
    const envelopeBlob = extractMultipartFilePart(receivedByMockPinata.body, receivedByMockPinata.headers['content-type'])
    const envelopeKey = deriveInvoiceKey(invoiceHash)
    const { plaintext: decryptedEnvelope, attachmentSalt: saltFromEnvelope } = decryptEnvelope(envelopeBlob, envelopeKey)
    expect(decryptedEnvelope.toString('utf8')).toBe(invoiceJson)
    expect(`0x${saltFromEnvelope.toString('hex')}`).toBe(attachmentSalt)

    // 5. Decrypt the attachment itself using ONLY what a viewer would have:
    // the salt read out of the (now-decrypted) envelope — never the
    // original attachmentSalt variable directly — proving the salt really
    // did survive the envelope round trip intact.
    const attachmentKey = deriveAttachmentKey(saltFromEnvelope)
    const decryptedAttachment = decryptBytes(attachmentCiphertext, attachmentKey)
    expect(decryptedAttachment.equals(attachmentBytes)).toBe(true)
    expect(attachmentSha256).toBe(sha256Hex(attachmentBytes))
  })
})
