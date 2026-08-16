// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => new Map())
const circleMock = vi.hoisted(() => ({
  getUserStatus: vi.fn(),
  listWallets: vi.fn(),
  getWalletTokenBalance: vi.fn(),
  getUserChallenge: vi.fn(),
  getTransaction: vi.fn()
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
  getCircleClient: () => circleMock
}))

const listHandler = (await import('./list.js')).default
const balancesHandler = (await import('./balances.js')).default
const txStatusHandler = (await import('./tx-status.js')).default
const { createAuthSession } = await import('../authSession.js')

let cookie

function invoke(handler, body, cookieOverride = cookie) {
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

beforeEach(async () => {
  store.clear()
  circleMock.getUserStatus.mockReset()
  circleMock.getUserStatus.mockResolvedValue({ data: { id: 'circle-user-1' } })
  circleMock.listWallets.mockReset()
  circleMock.listWallets.mockResolvedValue({ data: { wallets: [
    { id: 'wallet-1', address: '0x1111111111111111111111111111111111111111', state: 'LIVE', blockchain: 'ARC-TESTNET', accountType: 'SCA' },
    { id: 'wallet-2', address: '0x2222222222222222222222222222222222222222', state: 'LIVE', blockchain: 'ARC-TESTNET', accountType: 'SCA' }
  ] } })
  circleMock.getWalletTokenBalance.mockReset()
  circleMock.getWalletTokenBalance.mockResolvedValue({ data: { tokenBalances: [] } })
  circleMock.getUserChallenge.mockReset()
  circleMock.getUserChallenge.mockResolvedValue({ data: { challenge: { correlationIds: [] } } })
  const { token } = await createAuthSession({
    circleUserId: 'circle-user-1',
    walletId: 'wallet-1',
    walletAddress: '0x1111111111111111111111111111111111111111',
    blockchain: 'ARC-TESTNET',
    accountType: 'SCA'
  })
  cookie = `tranche_session=${token}`
})

describe('sensitive UCW routes', () => {
  it('rejects list, balances, and tx status without the server session', async () => {
    for (const [handler, body] of [
      [listHandler, { userToken: 'circle-token' }],
      [balancesHandler, { userToken: 'circle-token', walletId: 'attacker-wallet' }],
      [txStatusHandler, { userToken: 'circle-token', challengeId: 'challenge-1' }]
    ]) {
      const res = await invoke(handler, body, '')
      expect(res.statusCode).toBe(401)
    }
    expect(circleMock.getUserStatus).not.toHaveBeenCalled()
  })

  it('filters list results to the session wallet', async () => {
    const res = await invoke(listHandler, { userToken: 'circle-token' })

    expect(res.statusCode).toBe(200)
    expect(res.payload.wallets).toHaveLength(1)
    expect(res.payload.wallets[0].id).toBe('wallet-1')
  })

  it('uses the session wallet ID for balances', async () => {
    const res = await invoke(balancesHandler, { userToken: 'circle-token', walletId: 'attacker-wallet' })

    expect(res.statusCode).toBe(200)
    expect(circleMock.getWalletTokenBalance).toHaveBeenCalledWith({
      userToken: 'circle-token', walletId: 'wallet-1'
    })
  })

  it('binds transaction status lookup to the verified Circle user', async () => {
    const res = await invoke(txStatusHandler, { userToken: 'circle-token', challengeId: 'challenge-1' })

    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({ state: 'PENDING', done: false })
    expect(circleMock.getUserChallenge).toHaveBeenCalledWith({
      userToken: 'circle-token', challengeId: 'challenge-1'
    })
  })
})
