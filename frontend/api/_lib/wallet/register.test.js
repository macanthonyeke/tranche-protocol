// @vitest-environment node
//
// register.js is where an email becomes payable, so these tests exist to pin
// down that neither half of the pair can be dictated by the caller.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => new Map())
const circleMock = vi.hoisted(() => ({
  getUserStatus: vi.fn(),
  listWallets: vi.fn()
}))
const sentMail = vi.hoisted(() => [])

vi.mock('../resend.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendEmail: async (msg) => { sentMail.push(msg) }
}))

vi.mock('../redis.js', () => ({
  kv: {
    get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : null),
    set: async (k, v) => { store.set(k, structuredClone(v)) },
    del: async (k) => { store.delete(k) }
  }
}))

vi.mock('../circle.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getCircleClient: () => circleMock,
    getArcWallet: async (userToken) => {
      const res = await circleMock.listWallets({ userToken })
      const w = (res?.data?.wallets ?? []).find((x) => x.state === 'LIVE' && x.address)
      return w ? { id: w.id, address: w.address } : null
    }
  }
})

const handler = (await import('./register.js')).default
const { putOtpSession, readBinding, writeBinding } = await import('../emailWallets.js')

function invoke(body) {
  const res = {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v },
    status(c) { this.statusCode = c; return this },
    json(p) { this.payload = p; return this }
  }
  return handler({ method: 'POST', body }, res).then(() => res)
}

function walletsFor(address) {
  return { data: { wallets: [{ id: 'wallet-1', address, state: 'LIVE' }] } }
}

beforeEach(() => {
  store.clear()
  sentMail.length = 0
  circleMock.getUserStatus.mockReset()
  circleMock.listWallets.mockReset()
})

/** Arrange a valid first-time registration and run it. */
async function registerFirstTime({ email = 'alice@example.com', address = '0xALICE', userId = 'user-a' } = {}) {
  await putOtpSession('sess-1', { email, deviceId: 'dev-1' })
  circleMock.getUserStatus.mockResolvedValue({ data: { id: userId } })
  circleMock.listWallets.mockResolvedValue(walletsFor(address))
  return invoke({ sessionId: 'sess-1', userToken: 'tok-a' })
}

describe('POST /api/wallet/register — first time on an email', () => {
  // THE core guarantee. Circle's OTP alone is not enough to make an email
  // payable, because nothing in Circle's API tells us which email a userToken
  // belongs to. Nothing may reach the directory until Tranche's own code
  // comes back.
  it('does NOT write a binding — it only opens a verification', async () => {
    const res = await registerFirstTime()

    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({ verificationRequired: true, email: 'alice@example.com' })
    expect(res.payload.verificationId).toEqual(expect.any(String))
    // The address is withheld too — there is nothing to look up yet.
    expect(res.payload.address).toBeUndefined()
    expect(await readBinding('alice@example.com')).toBeNull()
  })

  it('mails the code to the session email, not to anything the caller sent', async () => {
    await putOtpSession('sess-1', { email: 'alice@example.com', deviceId: 'dev-1' })
    circleMock.getUserStatus.mockResolvedValue({ data: { id: 'user-a' } })
    circleMock.listWallets.mockResolvedValue(walletsFor('0xALICE'))

    await invoke({ sessionId: 'sess-1', userToken: 'tok-a', email: 'victim@example.com' })

    expect(sentMail).toHaveLength(1)
    expect(sentMail[0].to).toBe('alice@example.com')
  })

  it('never returns the code to the caller', async () => {
    const res = await registerFirstTime()
    const code = sentMail[0].subject.match(/(\d{6})/)[1]

    expect(JSON.stringify(res.payload)).not.toContain(code)
  })

  // Likewise for the address: only Circle decides where this user gets paid.
  it('ignores an address supplied in the request body', async () => {
    await putOtpSession('sess-1', { email: 'alice@example.com', deviceId: 'dev-1' })
    circleMock.getUserStatus.mockResolvedValue({ data: { id: 'user-a' } })
    circleMock.listWallets.mockResolvedValue(walletsFor('0xALICE'))

    const res = await invoke({ sessionId: 'sess-1', userToken: 'tok-a', address: '0xATTACKER' })

    const { peekVerification } = await import('../emailVerification.js')
    expect((await peekVerification(res.payload.verificationId)).address).toBe('0xALICE')
  })
})

describe('POST /api/wallet/register — returning user', () => {
  // Already proved this email once; re-verifying on every new device would be
  // friction for no gain, and writeBinding's userId pin keeps it safe.
  it('re-binds without demanding verification again', async () => {
    await writeBinding('alice@example.com', { address: '0xALICE', userId: 'user-a' })

    const res = await registerFirstTime()

    expect(res.payload).toMatchObject({
      verificationRequired: false,
      address: '0xALICE'
    })
    expect(sentMail).toHaveLength(0)
  })

  // An attacker holding a stale sessionId for someone else's email must not
  // be able to point it at their own wallet — this is the path that skips
  // verification, so the pin has to hold it.
  it('refuses to repoint an email already bound to another Circle user', async () => {
    await writeBinding('alice@example.com', { address: '0xALICE', userId: 'user-a' })
    await putOtpSession('sess-evil', { email: 'alice@example.com', deviceId: 'dev-9' })
    circleMock.getUserStatus.mockResolvedValue({ data: { id: 'attacker' } })
    circleMock.listWallets.mockResolvedValue(walletsFor('0xATTACKER'))

    const res = await invoke({ sessionId: 'sess-evil', userToken: 'tok-evil' })

    expect(res.statusCode).toBe(409)
    expect((await readBinding('alice@example.com')).address).toBe('0xALICE')
    expect(sentMail).toHaveLength(0)
  })
})

describe('POST /api/wallet/register — session handling', () => {
  it('consumes the session so it cannot be replayed', async () => {
    await putOtpSession('sess-1', { email: 'alice@example.com', deviceId: 'dev-1' })
    circleMock.getUserStatus.mockResolvedValue({ data: { id: 'user-a' } })
    circleMock.listWallets.mockResolvedValue(walletsFor('0xALICE'))

    expect((await invoke({ sessionId: 'sess-1', userToken: 'tok-a' })).statusCode).toBe(200)
    expect((await invoke({ sessionId: 'sess-1', userToken: 'tok-a' })).statusCode).toBe(410)
  })

  it('rejects an unknown or expired session', async () => {
    const res = await invoke({ sessionId: 'nope', userToken: 'tok-a' })
    expect(res.statusCode).toBe(410)
  })

  it('rejects a userToken Circle will not vouch for, and sends no mail', async () => {
    await putOtpSession('sess-1', { email: 'alice@example.com', deviceId: 'dev-1' })
    circleMock.getUserStatus.mockResolvedValue({ data: {} })

    const res = await invoke({ sessionId: 'sess-1', userToken: 'bogus' })

    expect(res.statusCode).toBe(401)
    expect(await readBinding('alice@example.com')).toBeNull()
    expect(sentMail).toHaveLength(0)
  })

  // The 409 tells the client to call again, so the session it needs to do
  // that has to survive. Leaving it consumed turned a normal indexing delay
  // into "sign-in expired" on the very retry we asked for.
  it('keeps the session usable across the retry it asks for', async () => {
    await putOtpSession('sess-1', { email: 'alice@example.com', deviceId: 'dev-1', createdAt: Date.now() })
    circleMock.getUserStatus.mockResolvedValue({ data: { id: 'user-a' } })
    // First call: Circle hasn't indexed the wallet yet.
    circleMock.listWallets.mockResolvedValueOnce({ data: { wallets: [] } })

    expect((await invoke({ sessionId: 'sess-1', userToken: 'tok-a' })).statusCode).toBe(409)

    // Second call: it has. The same sessionId must still work.
    circleMock.listWallets.mockResolvedValue(walletsFor('0xALICE'))
    const retry = await invoke({ sessionId: 'sess-1', userToken: 'tok-a' })

    expect(retry.statusCode).toBe(200)
    expect(retry.payload).toMatchObject({ email: 'alice@example.com', verificationRequired: true })
  })

  // Only the transient race is forgiven. A userToken Circle won't vouch for
  // is a verdict, and must still burn the session.
  it('does NOT restore the session when the userToken is rejected', async () => {
    await putOtpSession('sess-1', { email: 'alice@example.com', deviceId: 'dev-1', createdAt: Date.now() })
    circleMock.getUserStatus.mockResolvedValue({ data: {} })

    expect((await invoke({ sessionId: 'sess-1', userToken: 'bogus' })).statusCode).toBe(401)
    // Session is gone: a second attempt finds nothing.
    expect((await invoke({ sessionId: 'sess-1', userToken: 'bogus' })).statusCode).toBe(410)
  })

  it('asks the caller to retry while the wallet is still being created', async () => {
    await putOtpSession('sess-1', { email: 'alice@example.com', deviceId: 'dev-1' })
    circleMock.getUserStatus.mockResolvedValue({ data: { id: 'user-a' } })
    circleMock.listWallets.mockResolvedValue({ data: { wallets: [] } })

    const res = await invoke({ sessionId: 'sess-1', userToken: 'tok-a' })
    expect(res.statusCode).toBe(409)
  })

  // A FROZEN wallet cannot receive, so treating it as onboarded would hand
  // out an address that silently fails.
  it('does not treat a FROZEN wallet as onboarded', async () => {
    await putOtpSession('sess-1', { email: 'alice@example.com', deviceId: 'dev-1' })
    circleMock.getUserStatus.mockResolvedValue({ data: { id: 'user-a' } })
    circleMock.listWallets.mockResolvedValue({
      data: { wallets: [{ id: 'w1', address: '0xFROZEN', state: 'FROZEN' }] }
    })

    expect((await invoke({ sessionId: 'sess-1', userToken: 'tok-a' })).statusCode).toBe(409)
  })

  it('rejects non-POST', async () => {
    const res = { statusCode: null, payload: null, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this }, json(p) { this.payload = p; return this } }
    await handler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(405)
  })
})
