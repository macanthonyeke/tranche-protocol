// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => new Map())

vi.mock('../redis.js', () => ({
  kv: {
    get: async (key) => (store.has(key) ? structuredClone(store.get(key)) : null),
    set: async (key, value) => { store.set(key, structuredClone(value)); return 'OK' },
    del: async (key) => { store.delete(key); return 1 }
  }
}))

const { createAuthSession } = await import('../authSession.js')
const handler = (await import('./session.js')).default

function invoke(cookie = '', method = 'GET') {
  const res = {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this }
  }
  return handler({ method, headers: { cookie } }, res).then(() => res)
}

beforeEach(() => store.clear())

describe('GET /api/wallet/session', () => {
  it('returns unauthenticated without a cookie', async () => {
    const res = await invoke()
    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ authenticated: false, session: null })
  })

  it('returns only the sanitized session identity', async () => {
    const { token } = await createAuthSession({
      circleUserId: 'circle-user-1',
      walletId: 'wallet-1',
      walletAddress: '0x1111111111111111111111111111111111111111',
      blockchain: 'ARC-TESTNET',
      accountType: 'SCA'
    })

    const res = await invoke(`tranche_session=${token}`)

    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({ authenticated: true, session: { walletId: 'wallet-1' } })
    expect(res.payload.session).not.toHaveProperty('circleUserId')
  })

  it('rejects non-GET methods', async () => {
    expect((await invoke('', 'POST')).statusCode).toBe(405)
  })
})
