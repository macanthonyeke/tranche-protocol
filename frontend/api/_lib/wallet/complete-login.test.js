// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const store = vi.hoisted(() => new Map())
const circleMock = vi.hoisted(() => ({
  getUserStatus: vi.fn(),
  listWallets: vi.fn()
}))

vi.mock('../redis.js', () => ({
  kv: {
    get: async (key) => (store.has(key) ? structuredClone(store.get(key)) : null),
    set: async (key, value) => { store.set(key, structuredClone(value)); return 'OK' },
    del: async (key) => { store.delete(key); return 1 }
  }
}))

vi.mock('../circle.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCircleClient: () => circleMock,
  getArcWallet: async (userToken) => {
    const response = await circleMock.listWallets({ userToken, blockchain: 'ARC-TESTNET' })
    const wallet = (response?.data?.wallets ?? []).find((item) =>
      item.state === 'LIVE' && item.address && item.blockchain === 'ARC-TESTNET' && item.accountType === 'SCA'
    )
    return wallet ? {
      id: wallet.id,
      address: wallet.address,
      blockchain: wallet.blockchain,
      accountType: wallet.accountType
    } : null
  }
}))

const handler = (await import('./complete-login.js')).default
const { putOtpSession, takeOtpSession } = await import('../emailWallets.js')

function invoke(body) {
  const res = {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this }
  }
  return handler({ method: 'POST', body }, res).then(() => res)
}

beforeEach(() => {
  store.clear()
  circleMock.getUserStatus.mockReset()
  circleMock.listWallets.mockReset()
  circleMock.getUserStatus.mockResolvedValue({ data: { id: 'circle-user-1' } })
  circleMock.listWallets.mockResolvedValue({
    data: { wallets: [{
      id: 'wallet-1',
      address: '0x1111111111111111111111111111111111111111',
      blockchain: 'ARC-TESTNET',
      accountType: 'SCA',
      state: 'LIVE'
    }] }
  })
  vi.stubEnv('TRANCHE_IDENTITY_MODE', 'dual-write')
})

afterEach(() => vi.unstubAllEnvs())

describe('POST /api/wallet/complete-login', () => {
  it('validates Circle identity and mints one sanitized Tranche session', async () => {
    await putOtpSession('attempt-1', { email: 'alice@example.com', deviceId: 'device-1', intent: 'signup' })

    const res = await invoke({ sessionId: 'attempt-1', userToken: 'circle-token' })

    expect(res.statusCode).toBe(200)
    expect(res.payload.session).toMatchObject({
      authType: 'circle-sca',
      walletId: 'wallet-1',
      walletAddress: '0x1111111111111111111111111111111111111111',
      accountType: 'SCA'
    })
    expect(res.payload.next).toBe('onboarding')
    expect(res.payload.session).not.toHaveProperty('circleUserId')
    expect(res.headers['Set-Cookie']).toContain('tranche_session=')
    expect(await takeOtpSession('attempt-1')).toBeNull()
  })

  it('does not call Resend or bind the OTP email', async () => {
    await putOtpSession('attempt-1', { email: 'alice@example.com', deviceId: 'device-1', intent: 'signup' })

    const res = await invoke({ sessionId: 'attempt-1', userToken: 'circle-token' })

    expect(res.statusCode).toBe(200)
    expect(JSON.stringify(res.payload)).not.toContain('alice@example.com')
  })

  it('restores the attempt when Circle wallet indexing is still pending', async () => {
    await putOtpSession('attempt-1', { email: 'alice@example.com', deviceId: 'device-1', intent: 'signup' })
    circleMock.listWallets.mockResolvedValue({ data: { wallets: [] } })

    const res = await invoke({ sessionId: 'attempt-1', userToken: 'circle-token' })

    expect(res.statusCode).toBe(409)
    expect(await takeOtpSession('attempt-1')).toMatchObject({ email: 'alice@example.com' })
  })

  it('rejects a Circle token that has no verified user', async () => {
    await putOtpSession('attempt-1', { email: 'alice@example.com', deviceId: 'device-1', intent: 'signup' })
    circleMock.getUserStatus.mockResolvedValue({ data: {} })

    const res = await invoke({ sessionId: 'attempt-1', userToken: 'circle-token' })

    expect(res.statusCode).toBe(401)
    expect(res.headers['Set-Cookie']).toBeUndefined()
    expect(await takeOtpSession('attempt-1')).toBeNull()
  })

  it('does not allow an attempt to be replayed', async () => {
    await putOtpSession('attempt-1', { email: 'alice@example.com', deviceId: 'device-1', intent: 'signup' })

    expect((await invoke({ sessionId: 'attempt-1', userToken: 'circle-token' })).statusCode).toBe(200)
    expect((await invoke({ sessionId: 'attempt-1', userToken: 'circle-token' })).statusCode).toBe(410)
  })

  it('signs in an existing canonical identity without initializing a wallet', async () => {
    const { registerTrancheIdentity } = await import('../identityRegistry.js')
    await registerTrancheIdentity({
      circleUserId: 'circle-user-1',
      walletId: 'wallet-1',
      walletAddress: '0x1111111111111111111111111111111111111111',
      blockchain: 'ARC-TESTNET',
      accountType: 'SCA'
    })
    await putOtpSession('signin-attempt', {
      email: 'alice@example.com', deviceId: 'device-1', intent: 'signin'
    })

    const res = await invoke({ sessionId: 'signin-attempt', userToken: 'circle-token' })

    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({ next: 'app', session: { walletId: 'wallet-1' } })
    expect(res.headers['Set-Cookie']).toContain('tranche_session=')
  })

  it('returns the safe post-auth not-found response in strict mode', async () => {
    vi.stubEnv('TRANCHE_IDENTITY_MODE', 'strict')
    await putOtpSession('signin-attempt', {
      email: 'alice@example.com', deviceId: 'device-1', intent: 'signin'
    })

    const res = await invoke({ sessionId: 'signin-attempt', userToken: 'circle-token' })

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ code: 'TRANCHE_ACCOUNT_NOT_FOUND', next: 'signup' })
    expect(res.headers['Set-Cookie']).toBeUndefined()
  })

  it('dual-writes a validated legacy wallet during migration', async () => {
    const { readTrancheIdentity } = await import('../identityRegistry.js')
    await putOtpSession('signin-attempt', {
      email: 'alice@example.com', deviceId: 'device-1', intent: 'signin'
    })

    const res = await invoke({ sessionId: 'signin-attempt', userToken: 'circle-token' })

    expect(res.statusCode).toBe(200)
    expect(res.payload.next).toBe('app')
    expect(await readTrancheIdentity('circle-user-1')).toMatchObject({
      walletId: 'wallet-1', source: 'legacy-signin', status: 'active'
    })
  })

  it('does not create a session for signin when Circle has no live Arc SCA wallet', async () => {
    circleMock.listWallets.mockResolvedValue({ data: { wallets: [] } })
    await putOtpSession('signin-attempt', {
      email: 'alice@example.com', deviceId: 'device-1', intent: 'signin'
    })

    const res = await invoke({ sessionId: 'signin-attempt', userToken: 'circle-token' })

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ code: 'TRANCHE_ACCOUNT_NOT_FOUND', next: 'signup' })
    expect(res.headers['Set-Cookie']).toBeUndefined()
  })
})
