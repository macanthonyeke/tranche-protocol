// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => new Map())
const circleMock = vi.hoisted(() => ({
  getUserStatus: vi.fn(),
  createUserPinWithWallets: vi.fn(),
  listWallets: vi.fn()
}))

vi.mock('../redis.js', () => ({
  RedisError: class RedisError extends Error {},
  kv: {
    get: async (key) => (store.has(key) ? structuredClone(store.get(key)) : null),
    set: async (key, value) => { store.set(key, structuredClone(value)); return 'OK' },
    del: async (key) => { store.delete(key); return 1 }
  }
}))

vi.mock('../circle.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCircleClient: () => circleMock,
  getArcWallet: async () => ({ id: 'wallet-1', address: '0x1111111111111111111111111111111111111111' })
}))

const handler = (await import('./initialize.js')).default
const { putOtpSession } = await import('../emailWallets.js')

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
  circleMock.getUserStatus.mockResolvedValue({ data: { id: 'circle-user-1' } })
  circleMock.createUserPinWithWallets.mockReset()
  circleMock.createUserPinWithWallets.mockResolvedValue({ data: { challengeId: 'init-1' } })
  circleMock.listWallets.mockReset()
})

describe('POST /api/wallet/initialize', () => {
  it('requires a live OTP attempt before provisioning', async () => {
    const res = await invoke({ sessionId: 'missing', userToken: 'circle-token' })

    expect(res.statusCode).toBe(410)
    expect(circleMock.getUserStatus).not.toHaveBeenCalled()
    expect(circleMock.createUserPinWithWallets).not.toHaveBeenCalled()
  })

  it('validates Circle identity and explicitly requests an SCA Arc wallet', async () => {
    await putOtpSession('attempt-1', { email: 'alice@example.com', deviceId: 'device-1', intent: 'signup' })

    const res = await invoke({ sessionId: 'attempt-1', userToken: 'circle-token' })

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ challengeId: 'init-1', alreadyInitialized: false })
    expect(circleMock.createUserPinWithWallets).toHaveBeenCalledWith({
      userToken: 'circle-token',
      blockchains: ['ARC-TESTNET'],
      accountType: 'SCA'
    })
  })

  it('cannot initialize a wallet from a signin attempt', async () => {
    await putOtpSession('attempt-1', { email: 'alice@example.com', deviceId: 'device-1', intent: 'signin' })

    const res = await invoke({ sessionId: 'attempt-1', userToken: 'circle-token' })

    expect(res.statusCode).toBe(403)
    expect(circleMock.getUserStatus).not.toHaveBeenCalled()
    expect(circleMock.createUserPinWithWallets).not.toHaveBeenCalled()
  })
})
