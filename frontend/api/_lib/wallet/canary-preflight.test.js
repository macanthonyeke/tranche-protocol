// @vitest-environment node

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const circleMock = vi.hoisted(() => ({
  listWallets: vi.fn(),
  estimateContractExecutionFee: vi.fn(),
  getUserStatus: vi.fn()
}))
const store = vi.hoisted(() => new Map())

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
  getCircleClient: () => circleMock
}))

const handler = (await import('./canary-preflight.js')).default
const { createAuthSession } = await import('../authSession.js')

let cookie

function invoke(body, method = 'POST') {
  const res = {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this }
  }
  return handler({ method, headers: { cookie }, body }, res).then(() => res)
}

beforeEach(async () => {
  store.clear()
  vi.stubEnv('UCW_CANARY_ENABLED', 'false')
  circleMock.getUserStatus.mockReset()
  circleMock.getUserStatus.mockResolvedValue({ data: { id: 'circle-user-1' } })
  circleMock.listWallets.mockReset()
  circleMock.estimateContractExecutionFee.mockReset()
  const { token } = await createAuthSession({
    circleUserId: 'circle-user-1',
    walletId: 'wallet-canary-1',
    walletAddress: '0x1111111111111111111111111111111111111111',
    blockchain: 'ARC-TESTNET',
    accountType: 'SCA'
  })
  cookie = `tranche_session=${token}`
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/wallet/canary-preflight', () => {
  it('is disabled unless the explicit server flag is enabled', async () => {
    const res = await invoke({ userToken: 'opaque' })

    expect(res.statusCode).toBe(404)
    expect(res.payload).toEqual({ error: 'Not found.' })
    expect(circleMock.listWallets).not.toHaveBeenCalled()
    expect(circleMock.estimateContractExecutionFee).not.toHaveBeenCalled()
  })

  it('requires a server session and token after the test flag is enabled', async () => {
    vi.stubEnv('UCW_CANARY_ENABLED', 'true')
    const res = await invoke({})

    expect(res.statusCode).toBe(400)
    expect(res.payload).toEqual({ error: 'userToken is required.' })
  })

  it('stays disabled in production even if the test flag is copied there', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('UCW_CANARY_ENABLED', 'true')
    const res = await invoke({ userToken: 'opaque' })

    expect(res.statusCode).toBe(404)
    expect(circleMock.listWallets).not.toHaveBeenCalled()
  })

  it('does not expose or create a Circle challenge', async () => {
    vi.stubEnv('UCW_CANARY_ENABLED', 'true')
    circleMock.listWallets.mockResolvedValue({ data: { wallets: [] } })

    const res = await invoke({ userToken: 'opaque' })

    expect(res.statusCode).toBe(502)
    expect(JSON.stringify(res.payload)).not.toContain('opaque')
    expect(circleMock).not.toHaveProperty('createUserTransactionContractExecutionChallenge')
  })
})
