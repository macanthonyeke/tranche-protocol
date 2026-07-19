// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import handler from './unpin-invoice.js'
import { issueUnpinToken } from './_lib/unpinToken.js'

function fakeRes() {
  const res = { statusCode: 200 }
  res.status = (c) => { res.statusCode = c; return res }
  res.setHeader = (k, v) => { res[`header:${k}`] = v }
  res.json = (obj) => { res.body = obj }
  return res
}

function fakeReq(body) {
  return { method: 'POST', body }
}

let server, port, received

beforeEach(async () => {
  process.env.PINATA_JWT = 'test-jwt'
  process.env.UNPIN_TOKEN_SECRET = 'test-unpin-secret'
  received = null
  server = http.createServer((req, res) => {
    received = { method: req.method, url: req.url, headers: req.headers }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{}')
  })
  await new Promise((resolve) => server.listen(0, resolve))
  port = server.address().port

  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', (url, opts) =>
    String(url).includes('pinata.cloud') ? realFetch(`http://127.0.0.1:${port}${new URL(url).pathname}`, opts) : realFetch(url, opts)
  )
})

afterEach(async () => {
  delete process.env.PINATA_JWT
  delete process.env.UNPIN_TOKEN_SECRET
  vi.unstubAllGlobals()
  await new Promise((resolve) => server.close(resolve))
})

describe('POST /api/unpin-invoice', () => {
  it('rejects non-POST methods', async () => {
    const req = fakeReq({})
    req.method = 'GET'
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(405)
  })

  it('rejects a missing ipfsUri', async () => {
    const res = fakeRes()
    await handler(fakeReq({ token: issueUnpinToken('bafyX') }), res)

    expect(res.statusCode).toBe(400)
  })

  it('rejects a non-ipfs:// value', async () => {
    const res = fakeRes()
    await handler(fakeReq({ ipfsUri: 'https://example.com/evil', token: 'whatever' }), res)

    expect(res.statusCode).toBe(400)
  })

  it('succeeds with a valid, matching token — extracts the CID and calls Pinata\'s unpin endpoint for it', async () => {
    const token = issueUnpinToken('bafyABANDONEDCID')
    const res = fakeRes()

    await handler(fakeReq({ ipfsUri: 'ipfs://bafyABANDONEDCID', token }), res)

    expect(res.statusCode).toBe(200)
    expect(received.method).toBe('DELETE')
    expect(received.url).toBe('/pinning/unpin/bafyABANDONEDCID')
  })

  it('rejects a missing token — nothing is unpinned', async () => {
    const res = fakeRes()
    await handler(fakeReq({ ipfsUri: 'ipfs://bafyABANDONEDCID' }), res)

    expect(res.statusCode).toBe(400)
    expect(received).toBeNull() // Pinata was never called
  })

  it('rejects a wrong/garbage token — nothing is unpinned', async () => {
    const res = fakeRes()
    await handler(fakeReq({ ipfsUri: 'ipfs://bafyABANDONEDCID', token: 'not-a-real-token' }), res)

    expect(res.statusCode).toBe(403)
    expect(received).toBeNull()
  })

  it('rejects an expired token — nothing is unpinned', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const token = issueUnpinToken('bafyABANDONEDCID')
    vi.setSystemTime(new Date('2026-01-01T00:20:00Z')) // past the 15-min TTL

    const res = fakeRes()
    await handler(fakeReq({ ipfsUri: 'ipfs://bafyABANDONEDCID', token }), res)
    vi.useRealTimers()

    expect(res.statusCode).toBe(403)
    expect(received).toBeNull()
  })

  it('a token issued for one CID cannot be used to unpin a different CID', async () => {
    const tokenForDraftA = issueUnpinToken('bafyDRAFTA')
    const res = fakeRes()

    // Attacker/mistaken client tries to unpin a DIFFERENT, real CID using a
    // token that was genuinely issued — just not for this one.
    await handler(fakeReq({ ipfsUri: 'ipfs://bafyDRAFTB', token: tokenForDraftA }), res)

    expect(res.statusCode).toBe(403)
    expect(received).toBeNull() // Pinata was never called — bafyDRAFTB was never touched
  })

  it('surfaces a Pinata failure as a 502, not a 500', async () => {
    server.removeAllListeners('request')
    server.on('request', (req, res) => { req.resume(); res.writeHead(404); res.end('not found') })
    const token = issueUnpinToken('bafyMISSING')

    const res = fakeRes()
    await handler(fakeReq({ ipfsUri: 'ipfs://bafyMISSING', token }), res)

    expect(res.statusCode).toBe(502)
  })
})
