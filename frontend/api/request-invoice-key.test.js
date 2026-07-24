// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import handler from './request-invoice-key.js'
import { getEscrowDetailFor } from './_lib/chain.js'
import { deriveInvoiceKey, deriveAttachmentKey } from './_lib/invoiceCrypto.js'
import { resolveAttachmentSalt } from './_lib/resolveAttachmentSalt.js'

vi.mock('./_lib/chain.js', () => ({ getEscrowDetailFor: vi.fn() }))
// The endpoint now ALWAYS attempts to independently source the attachment
// salt (see request-invoice-key.js's file header) — mocked here so tests
// stay hermetic instead of hitting the real subgraph/IPFS on every request.
// Defaults to "no attachment"; individual tests override with
// mockResolvedValueOnce / mockRejectedValueOnce as needed.
vi.mock('./_lib/resolveAttachmentSalt.js', () => ({ resolveAttachmentSalt: vi.fn() }))

const RECIPIENT = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const ARBITER = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const STRANGER = privateKeyToAccount(`0x${'33'.repeat(32)}`)
const PAYER = privateKeyToAccount(`0x${'44'.repeat(32)}`)
const INVOICE_HASH = `0x${'ab'.repeat(32)}`
// Distinct from every account above — used as the depositor in tests that
// don't care who the depositor is, so it can never accidentally satisfy the
// depositor branch of authorizeInvoiceKeyAccess.
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`

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

function mockDetail({ recipient, depositor = ZERO_ADDRESS, isArbiter, milestoneStates }) {
  getEscrowDetailFor.mockResolvedValue({
    escrow: { recipient, depositor, invoiceHash: INVOICE_HASH },
    isArbiter,
    milestones: milestoneStates.map((state) => ({ state }))
  })
}

async function signChallenge(account, escrowId, timestamp = Date.now()) {
  const message = `Access invoice for escrow ${escrowId} at ${timestamp}`
  const signature = await account.signMessage({ message })
  return { message, signature }
}

beforeEach(() => {
  process.env.INVOICE_KEY_SECRET = 'test-secret'
  vi.clearAllMocks()
  resolveAttachmentSalt.mockResolvedValue(null) // default: this escrow has no attachment
})

afterEach(() => {
  delete process.env.INVOICE_KEY_SECRET
})

describe('POST /api/request-invoice-key', () => {
  it('rejects non-POST methods', async () => {
    const req = fakeReq({})
    req.method = 'GET'
    const res = fakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(405)
  })

  it('authorizes the recipient regardless of milestone state', async () => {
    mockDetail({ recipient: RECIPIENT.address, isArbiter: false, milestoneStates: [0, 3] })
    const { message, signature } = await signChallenge(RECIPIENT, 5)
    const res = fakeRes()

    await handler(fakeReq({ escrowId: '5', walletAddress: RECIPIENT.address, signature, message }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.key).toBe(`0x${deriveInvoiceKey(INVOICE_HASH).toString('hex')}`)
  })

  it('authorizes the depositor (payer) regardless of milestone state', async () => {
    mockDetail({ recipient: RECIPIENT.address, depositor: PAYER.address, isArbiter: false, milestoneStates: [0, 3] })
    const { message, signature } = await signChallenge(PAYER, 5)
    const res = fakeRes()

    await handler(fakeReq({ escrowId: '5', walletAddress: PAYER.address, signature, message }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.key).toBe(`0x${deriveInvoiceKey(INVOICE_HASH).toString('hex')}`)
  })

  it('authorizes the arbiter only while a milestone is DISPUTED', async () => {
    mockDetail({ recipient: RECIPIENT.address, isArbiter: true, milestoneStates: [0, 2] }) // 2 = DISPUTED
    const { message, signature } = await signChallenge(ARBITER, 5)
    const res = fakeRes()

    await handler(fakeReq({ escrowId: '5', walletAddress: ARBITER.address, signature, message }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.key).toBe(`0x${deriveInvoiceKey(INVOICE_HASH).toString('hex')}`)
  })

  it('rejects the arbiter when no milestone is DISPUTED', async () => {
    mockDetail({ recipient: RECIPIENT.address, isArbiter: true, milestoneStates: [0, 3] })
    const { message, signature } = await signChallenge(ARBITER, 5)
    const res = fakeRes()

    await handler(fakeReq({ escrowId: '5', walletAddress: ARBITER.address, signature, message }), res)

    expect(res.statusCode).toBe(403)
  })

  it('rejects a wallet that is neither the recipient nor the arbiter', async () => {
    mockDetail({ recipient: RECIPIENT.address, isArbiter: false, milestoneStates: [2] })
    const { message, signature } = await signChallenge(STRANGER, 5)
    const res = fakeRes()

    await handler(fakeReq({ escrowId: '5', walletAddress: STRANGER.address, signature, message }), res)

    expect(res.statusCode).toBe(403)
  })

  it('rejects a wrong signer — signature does not recover to the claimed walletAddress', async () => {
    mockDetail({ recipient: RECIPIENT.address, isArbiter: false, milestoneStates: [] })
    // STRANGER signs, but the request claims to be RECIPIENT.
    const { message, signature } = await signChallenge(STRANGER, 5)
    const res = fakeRes()

    await handler(fakeReq({ escrowId: '5', walletAddress: RECIPIENT.address, signature, message }), res)

    expect(res.statusCode).toBe(401)
  })

  it('rejects an expired timestamp', async () => {
    mockDetail({ recipient: RECIPIENT.address, isArbiter: false, milestoneStates: [] })
    const staleTimestamp = Date.now() - 3 * 60 * 1000
    const { message, signature } = await signChallenge(RECIPIENT, 5, staleTimestamp)
    const res = fakeRes()

    await handler(fakeReq({ escrowId: '5', walletAddress: RECIPIENT.address, signature, message }), res)

    expect(res.statusCode).toBe(401)
    expect(res.body.error).toMatch(/expired/i)
  })

  it('rejects a timestamp signed too far in the future', async () => {
    mockDetail({ recipient: RECIPIENT.address, isArbiter: false, milestoneStates: [] })
    const futureTimestamp = Date.now() + 3 * 60 * 1000
    const { message, signature } = await signChallenge(RECIPIENT, 5, futureTimestamp)
    const res = fakeRes()

    await handler(fakeReq({ escrowId: '5', walletAddress: RECIPIENT.address, signature, message }), res)

    expect(res.statusCode).toBe(401)
  })

  // No server-side nonce store exists — see _lib/invoiceCrypto.js's file
  // header: this design is deliberately stateless (no invoice_keys table,
  // nothing persisted between requests). "Replay protection" here is the
  // timestamp window: a captured message+signature pair stops working once
  // it ages past MAX_CLOCK_SKEW_MS, verified by resubmitting the identical
  // already-stale payload and confirming it's still rejected. A replay
  // attempted *within* the freshness window is not distinguishable from a
  // legitimate retry without persisted state, which this design trades away.
  it('rejects a replayed request built from an already-expired signed payload', async () => {
    mockDetail({ recipient: RECIPIENT.address, isArbiter: false, milestoneStates: [] })
    const oldTimestamp = Date.now() - 5 * 60 * 1000
    const { message, signature } = await signChallenge(RECIPIENT, 5, oldTimestamp)
    const payload = { escrowId: '5', walletAddress: RECIPIENT.address, signature, message }

    const first = fakeRes()
    await handler(fakeReq(payload), first)
    expect(first.statusCode).toBe(401)

    const replay = fakeRes()
    await handler(fakeReq(payload), replay)
    expect(replay.statusCode).toBe(401)
  })

  it('rejects when the top-level escrowId does not match the escrowId signed in the message', async () => {
    mockDetail({ recipient: RECIPIENT.address, isArbiter: false, milestoneStates: [] })
    const { message, signature } = await signChallenge(RECIPIENT, 5)
    const res = fakeRes()

    await handler(fakeReq({ escrowId: '6', walletAddress: RECIPIENT.address, signature, message }), res)

    expect(res.statusCode).toBe(400)
  })

  it('rejects a malformed message that does not match the challenge format', async () => {
    const res = fakeRes()
    await handler(fakeReq({
      escrowId: '5',
      walletAddress: RECIPIENT.address,
      signature: '0xdeadbeef',
      message: 'not the expected format'
    }), res)

    expect(res.statusCode).toBe(400)
  })

  it('returns an attachmentKey alongside key when this escrow has an attachment, derived from the SERVER-sourced salt', async () => {
    mockDetail({ recipient: RECIPIENT.address, isArbiter: false, milestoneStates: [] })
    const realSaltForThisEscrow = `0x${'ef'.repeat(16)}`
    resolveAttachmentSalt.mockResolvedValue(Buffer.from('ef'.repeat(16), 'hex'))
    const { message, signature } = await signChallenge(RECIPIENT, 5)
    const res = fakeRes()

    await handler(fakeReq({ escrowId: '5', walletAddress: RECIPIENT.address, signature, message }), res)

    expect(resolveAttachmentSalt).toHaveBeenCalledWith('5')
    expect(res.statusCode).toBe(200)
    expect(res.body.key).toBe(`0x${deriveInvoiceKey(INVOICE_HASH).toString('hex')}`)
    expect(res.body.attachmentKey).toBe(`0x${deriveAttachmentKey(realSaltForThisEscrow).toString('hex')}`)
  })

  it('omits attachmentKey when this escrow has no attachment (resolveAttachmentSalt resolves null)', async () => {
    mockDetail({ recipient: RECIPIENT.address, isArbiter: false, milestoneStates: [] })
    resolveAttachmentSalt.mockResolvedValue(null)
    const { message, signature } = await signChallenge(RECIPIENT, 5)
    const res = fakeRes()

    await handler(fakeReq({ escrowId: '5', walletAddress: RECIPIENT.address, signature, message }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.attachmentKey).toBeUndefined()
  })

  // The vulnerability this replaces: an earlier version accepted a
  // client-supplied attachmentSalt and derived+returned whatever key that
  // salt produced, with no check that the salt actually belonged to the
  // authorized escrow. A caller legitimately authorized for their OWN
  // escrow could submit a salt copied from a DIFFERENT escrow's public
  // envelope (salts aren't secret) and receive that other escrow's real
  // attachment key. Fixed by never reading attachmentSalt from the request
  // at all — the salt always comes from resolveAttachmentSalt(escrowId),
  // which independently looks up THIS escrow's own envelope.
  it('a client-submitted attachmentSalt (e.g. copied from a different escrow) is completely ignored', async () => {
    mockDetail({ recipient: RECIPIENT.address, isArbiter: false, milestoneStates: [] })
    // What the server independently finds for escrow 5 — NOT what's sent below.
    const realSaltForEscrow5 = Buffer.from('11'.repeat(16), 'hex')
    resolveAttachmentSalt.mockResolvedValue(realSaltForEscrow5)
    const { message, signature } = await signChallenge(RECIPIENT, 5)
    // A real salt, but scavenged from escrow 999's public envelope — an
    // attacker's best-case attempt to redirect the derivation.
    const saltFromAnotherEscrow = `0x${'99'.repeat(16)}`
    const res = fakeRes()

    await handler(fakeReq({
      escrowId: '5', walletAddress: RECIPIENT.address, signature, message,
      attachmentSalt: saltFromAnotherEscrow
    }), res)

    expect(res.statusCode).toBe(200)
    // The response must derive from escrow 5's REAL salt, never the
    // attacker-supplied one.
    expect(res.body.attachmentKey).toBe(`0x${deriveAttachmentKey(realSaltForEscrow5).toString('hex')}`)
    expect(res.body.attachmentKey).not.toBe(`0x${deriveAttachmentKey(saltFromAnotherEscrow).toString('hex')}`)
  })

  it('fails closed — no attachmentKey, not a hard error — when resolveAttachmentSalt itself fails (subgraph/IPFS unreachable)', async () => {
    mockDetail({ recipient: RECIPIENT.address, isArbiter: false, milestoneStates: [] })
    resolveAttachmentSalt.mockRejectedValue(new Error('Could not reach the subgraph: fetch failed'))
    const { message, signature } = await signChallenge(RECIPIENT, 5)
    const res = fakeRes()

    await handler(fakeReq({ escrowId: '5', walletAddress: RECIPIENT.address, signature, message }), res)

    // The envelope key request itself still succeeds...
    expect(res.statusCode).toBe(200)
    expect(res.body.key).toBe(`0x${deriveInvoiceKey(INVOICE_HASH).toString('hex')}`)
    // ...but no attachmentKey is ever fabricated from a failed lookup.
    expect(res.body.attachmentKey).toBeUndefined()
  })

  it('still rejects an unauthorized wallet regardless of what resolveAttachmentSalt would have returned', async () => {
    mockDetail({ recipient: RECIPIENT.address, isArbiter: false, milestoneStates: [] })
    resolveAttachmentSalt.mockResolvedValue(Buffer.from('cd'.repeat(16), 'hex'))
    const { message, signature } = await signChallenge(STRANGER, 5)
    const res = fakeRes()

    await handler(fakeReq({ escrowId: '5', walletAddress: STRANGER.address, signature, message }), res)

    expect(res.statusCode).toBe(403)
    expect(res.body.attachmentKey).toBeUndefined()
    expect(resolveAttachmentSalt).not.toHaveBeenCalled() // never reached — authorization fails first
  })
})
