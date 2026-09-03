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
const { readBinding, readDirectoryPreference, writeBinding } = await import('../emailWallets.js')
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
  it('refreshes the authenticated binding state without sending email', async () => {
    await writeBinding('alice@example.com', {
      address: '0x1111111111111111111111111111111111111111',
      userId: 'circle-user-1'
    })

    const res = await invoke({ email: 'alice@example.com', action: 'status' })

    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({ email: 'alice@example.com', verified: true, choice: 'verified' })
    expect(sentMail).toHaveLength(0)
  })

  it('reports an unverified state when the binding is absent or belongs elsewhere', async () => {
    await writeBinding('elsewhere@example.com', {
      address: '0x2222222222222222222222222222222222222222',
      userId: 'different-user'
    })

    const res = await invoke({ email: 'alice@example.com', action: 'status' })
    const other = await invoke({ email: 'elsewhere@example.com', action: 'status' })

    expect(res.payload).toEqual({ email: 'alice@example.com', verified: false, choice: 'undecided' })
    expect(other.payload).toEqual({ email: 'elsewhere@example.com', verified: false, choice: 'undecided' })
    expect(sentMail).toHaveLength(0)
  })

  it('removes only the binding owned by the authenticated session', async () => {
    await writeBinding('alice@example.com', {
      address: '0x1111111111111111111111111111111111111111',
      userId: 'circle-user-1'
    })

    const res = await invoke({
      email: 'alice@example.com',
      action: 'remove',
      address: '0xATTACKER',
      userId: 'attacker'
    })

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({
      email: 'alice@example.com', removed: true, verified: false, choice: 'removed'
    })
    expect(await readBinding('alice@example.com')).toBeNull()
    expect(sentMail).toHaveLength(0)
  })

  it('persists Skip for now without mutating an email binding', async () => {
    const before = await readBinding('alice@example.com')

    const res = await invoke({ email: 'alice@example.com', action: 'skip' })

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ email: 'alice@example.com', verified: false, choice: 'skipped' })
    expect(await readBinding('alice@example.com')).toEqual(before)
    expect(await readDirectoryPreference('circle-user-1')).toMatchObject({ choice: 'skipped' })
    expect(sentMail).toHaveLength(0)

    // The preference is keyed by the canonical Circle identity, so the next
    // authenticated status read sees the same choice without another mutation.
    const refreshed = await invoke({ email: 'alice@example.com', action: 'status' })
    expect(refreshed.payload).toMatchObject({ verified: false, choice: 'skipped' })
  })

  it('rejects removal of a binding owned by a different session', async () => {
    await writeBinding('alice@example.com', {
      address: '0x2222222222222222222222222222222222222222',
      userId: 'different-user'
    })

    const res = await invoke({ email: 'alice@example.com', action: 'remove' })

    expect(res.statusCode).toBe(403)
    expect(await readBinding('alice@example.com')).toMatchObject({ userId: 'different-user' })
  })

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
