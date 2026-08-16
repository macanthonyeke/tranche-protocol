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
const handler = (await import('./logout.js')).default

function invoke(cookie = '') {
  const res = {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this }
  }
  return handler({ method: 'POST', headers: { cookie }, body: {} }, res).then(() => res)
}

beforeEach(() => store.clear())

describe('POST /api/wallet/logout', () => {
  it('revokes the server session and expires the cookie', async () => {
    const { token } = await createAuthSession({
      circleUserId: 'circle-user-1',
      walletId: 'wallet-1',
      walletAddress: '0x1111111111111111111111111111111111111111',
      blockchain: 'ARC-TESTNET',
      accountType: 'SCA'
    })

    const res = await invoke(`tranche_session=${token}`)

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ loggedOut: true })
    expect(res.headers['Set-Cookie']).toContain('Max-Age=0')
    expect(store).toHaveLength(0)
  })
})
