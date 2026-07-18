// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import http from 'node:http'
import handler from './pin-invoice.js'

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
