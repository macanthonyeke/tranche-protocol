// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => new Map())
const sentMail = vi.hoisted(() => [])

vi.mock('../redis.js', () => ({
  RedisError: class RedisError extends Error {},
  kv: {
    get: async (key) => (store.has(key) ? structuredClone(store.get(key)) : null),
    set: async (key, value) => { store.set(key, structuredClone(value)); return 'OK' },
    del: async (key) => { store.delete(key); return 1 }
  }
}))

vi.mock('../resend.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendEmail: async (message) => { sentMail.push(message) }
}))

const handler = (await import('./directory-claim.js')).default
const resendHandler = (await import('./resend-verification.js')).default
const { createAuthSession } = await import('../authSession.js')
const { readBinding } = await import('../emailWallets.js')
const { peekVerification } = await import('../emailVerification.js')

let cookie

function invoke(body, cookieOverride = cookie) {
  const res = {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this }
  }
  return handler({ method: 'POST', headers: { cookie: cookieOverride }, body }, res).then(() => res)
}

function invokeResend(body, cookieOverride = cookie) {
  const res = {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this }
  }
  return resendHandler({ method: 'POST', headers: { cookie: cookieOverride }, body }, res).then(() => res)
}

beforeEach(async () => {
  store.clear()
  sentMail.length = 0
  const { token } = await createAuthSession({
    circleUserId: 'circle-user-1',
    walletId: 'wallet-1',
    walletAddress: '0x1111111111111111111111111111111111111111',
    blockchain: 'ARC-TESTNET',
    accountType: 'SCA'
  })
  cookie = `tranche_session=${token}`
})

describe('POST /api/wallet/directory-claim', () => {
  it('sends Resend only after an explicit authenticated claim', async () => {
    const res = await invoke({ email: 'Alice@example.com' })

    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({
      email: 'alice@example.com',
      verificationRequired: true
    })
    expect(sentMail).toHaveLength(1)
    expect(sentMail[0].to).toBe('alice@example.com')
    expect(await readBinding('alice@example.com')).toBeNull()
    expect(await peekVerification(res.payload.verificationId)).toMatchObject({
      email: 'alice@example.com',
      address: '0x1111111111111111111111111111111111111111',
      userId: 'circle-user-1'
    })
  })

  it('rejects a claim without the server session', async () => {
    const res = await invoke({ email: 'alice@example.com' }, '')

    expect(res.statusCode).toBe(401)
    expect(sentMail).toHaveLength(0)
  })

  it('does not accept a client-supplied wallet identity', async () => {
    const res = await invoke({
      email: 'alice@example.com',
      address: '0xATTACKER',
      userId: 'attacker'
    })

    const pending = await peekVerification(res.payload.verificationId)
    expect(pending).toMatchObject({
      address: '0x1111111111111111111111111111111111111111',
      userId: 'circle-user-1'
    })
  })

  it('keeps resend inside the authenticated directory flow', async () => {
    const claim = await invoke({ email: 'alice@example.com' })
    const res = await invokeResend({ verificationId: claim.payload.verificationId })

    expect(res.statusCode).toBe(200)
    expect(sentMail).toHaveLength(2)
    expect((await invokeResend({ verificationId: claim.payload.verificationId }, '')).statusCode).toBe(401)
  })
})
