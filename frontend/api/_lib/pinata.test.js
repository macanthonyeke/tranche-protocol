// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { pinBytesToIPFS, PinataError } from './pinata.js'

let server
let port
let received

beforeEach(async () => {
  received = null
  server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      received = { headers: req.headers, body: Buffer.concat(chunks) }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ IpfsHash: 'bafyMOCKCID', PinSize: received.body.length }))
    })
  })
  await new Promise((resolve) => server.listen(0, resolve))
  port = server.address().port
})

afterEach(async () => {
  delete process.env.PINATA_JWT
  vi.unstubAllGlobals()
  await new Promise((resolve) => server.close(resolve))
})

function pointFetchAtMockServer() {
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', (url, opts) => realFetch(`http://127.0.0.1:${port}/`, opts))
}

// Extracts exactly the "file" field's payload bytes from a multipart body,
// so the test below can assert byte-for-byte equality with the original
// buffer — a substring/`.includes()` check would still pass if bytes were
// appended or prepended around the real content, which is the actual
// mistake this caught while writing this suite.
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

describe('pinBytesToIPFS', () => {
  it('refuses to pin without PINATA_JWT configured, without making a network call', async () => {
    delete process.env.PINATA_JWT
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(pinBytesToIPFS(Buffer.from('hi'))).rejects.toThrow(PinataError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends the exact bytes and filename unmodified, and returns the parsed CID/ipfsUri/size', async () => {
    process.env.PINATA_JWT = 'test-jwt'
    pointFetchAtMockServer()
    const fileBytes = Buffer.from('%PDF-1.4 fake invoice bytes')

    const result = await pinBytesToIPFS(fileBytes, { filename: 'my invoice.pdf', contentType: 'application/pdf' })

    expect(result).toEqual({ cid: 'bafyMOCKCID', ipfsUri: 'ipfs://bafyMOCKCID', size: fileBytes.length })
    expect(received.headers['authorization']).toBe('Bearer test-jwt')
    expect(received.body.toString('latin1')).toContain('my invoice.pdf')

    const filePart = extractMultipartFilePart(received.body, received.headers['content-type'])
    expect(filePart).not.toBeNull()
    expect(filePart.equals(fileBytes)).toBe(true) // byte-exact, not just "contains"
  })

  it('surfaces a non-OK Pinata response as a PinataError with the response detail', async () => {
    process.env.PINATA_JWT = 'test-jwt'
    server.removeAllListeners('request')
    server.on('request', (req, res) => { req.resume(); res.writeHead(401); res.end('unauthorized') })
    pointFetchAtMockServer()

    await expect(pinBytesToIPFS(Buffer.from('x'))).rejects.toThrow(/401.*unauthorized/is)
  })

  it('wraps an unreadable (non-JSON) Pinata response as a clean PinataError', async () => {
    process.env.PINATA_JWT = 'test-jwt'
    server.removeAllListeners('request')
    server.on('request', (req, res) => { req.resume(); res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>not json</html>') })
    pointFetchAtMockServer()

    await expect(pinBytesToIPFS(Buffer.from('x'))).rejects.toThrow(PinataError)
  })

  it('wraps a network-level failure (fetch rejects) as a clean PinataError', async () => {
    process.env.PINATA_JWT = 'test-jwt'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    await expect(pinBytesToIPFS(Buffer.from('x'))).rejects.toThrow(PinataError)
  })
})
