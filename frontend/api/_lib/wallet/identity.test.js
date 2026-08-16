// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => new Map())
const circleMock = vi.hoisted(() => ({ getUserStatus: vi.fn() }))

vi.mock('../redis.js', () => ({
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

const { createAuthSession } = await import('../authSession.js')
const { requireCircleIdentity } = await import('./identity.js')

let req

beforeEach(async () => {
  store.clear()
  circleMock.getUserStatus.mockReset()
  circleMock.getUserStatus.mockResolvedValue({ data: { id: 'circle-user-1' } })
  const { token } = await createAuthSession({
    circleUserId: 'circle-user-1',
    walletId: 'wallet-1',
    walletAddress: '0x1111111111111111111111111111111111111111',
    blockchain: 'ARC-TESTNET',
    accountType: 'SCA'
  })
  req = { headers: { cookie: `tranche_session=${token}` } }
})

describe('requireCircleIdentity', () => {
  it('uses the cookie session wallet and ignores client wallet fields', async () => {
    const auth = await requireCircleIdentity(req, {
      userToken: 'circle-token',
      walletId: 'attacker-wallet',
      address: '0x2222222222222222222222222222222222222222'
    })

    expect(auth.wallet).toEqual({
      id: 'wallet-1',
      address: '0x1111111111111111111111111111111111111111'
    })
  })

  it('rejects missing cookies before calling Circle', async () => {
    await expect(requireCircleIdentity({ headers: {} }, { userToken: 'circle-token' }))
      .rejects.toMatchObject({ status: 401 })
    expect(circleMock.getUserStatus).not.toHaveBeenCalled()
  })

  it('rejects a token whose Circle user differs from the cookie session', async () => {
    circleMock.getUserStatus.mockResolvedValue({ data: { id: 'other-user' } })

    await expect(requireCircleIdentity(req, { userToken: 'circle-token' }))
      .rejects.toMatchObject({ status: 401 })
  })
})
