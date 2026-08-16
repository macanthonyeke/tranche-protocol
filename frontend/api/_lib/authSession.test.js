// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const store = vi.hoisted(() => new Map())

vi.mock('./redis.js', () => ({
  kv: {
    get: async (key) => (store.has(key) ? structuredClone(store.get(key)) : null),
    set: async (key, value) => { store.set(key, structuredClone(value)); return 'OK' },
    del: async (key) => { store.delete(key); return 1 }
  }
}))

const {
  createAuthSession,
  assertSameOrigin,
  getAuthSession,
  publicAuthSession,
  revokeAuthSession,
  setAuthCookie
} = await import('./authSession.js')

function response() {
  return { headers: {}, setHeader(key, value) { this.headers[key] = value } }
}

function request(cookie = '') {
  return { headers: { cookie } }
}

const IDENTITY = {
  circleUserId: 'circle-user-1',
  walletId: 'wallet-1',
  walletAddress: '0x1111111111111111111111111111111111111111',
  blockchain: 'ARC-TESTNET',
  accountType: 'SCA'
}

beforeEach(() => {
  store.clear()
  vi.stubEnv('NODE_ENV', 'development')
})

afterEach(() => vi.unstubAllEnvs())

describe('cookie-backed auth sessions', () => {
  it('stores only a hashed cookie token and returns sanitized identity', async () => {
    const { token, record } = await createAuthSession(IDENTITY, { now: 1_000 })

    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect([...store.keys()][0]).toMatch(/^auth:session:[a-f0-9]{64}$/)
    expect([...store.values()][0]).not.toHaveProperty('token')
    expect(publicAuthSession(record)).toEqual(expect.objectContaining({
      walletId: IDENTITY.walletId,
      walletAddress: IDENTITY.walletAddress,
      accountType: 'SCA'
    }))
    expect(publicAuthSession(record)).not.toHaveProperty('circleUserId')
  })

  it('reads and touches a live session from the request cookie', async () => {
    const { token } = await createAuthSession(IDENTITY, { now: 1_000 })

    const session = await getAuthSession(request(`tranche_session=${token}`), { now: 2_000 })

    expect(session).toMatchObject({ circleUserId: 'circle-user-1', lastSeenAt: 2_000 })
  })

  it('expires an inactive session and removes it', async () => {
    const { token } = await createAuthSession(IDENTITY, { now: 1_000 })

    expect(await getAuthSession(request(`tranche_session=${token}`), {
      now: 1_000 + 7 * 24 * 60 * 60 * 1000 + 1
    })).toBeNull()
    expect(store).toHaveLength(0)
  })

  it('sets an HttpOnly same-site cookie and clears it on revoke', async () => {
    const res = response()
    setAuthCookie(res, 'opaque-token', 60)
    expect(res.headers['Set-Cookie']).toContain('tranche_session=opaque-token')
    expect(res.headers['Set-Cookie']).toContain('HttpOnly')
    expect(res.headers['Set-Cookie']).toContain('SameSite=Lax')

    const { token } = await createAuthSession(IDENTITY)
    const logoutRes = response()
    await revokeAuthSession(request(`tranche_session=${token}`), logoutRes)
    expect(logoutRes.headers['Set-Cookie']).toContain('Max-Age=0')
    expect(store).toHaveLength(0)
  })

  it('rejects a cross-origin state-changing request', () => {
    expect(() => assertSameOrigin({
      headers: { origin: 'https://evil.example', host: 'tranche.example' },
      method: 'POST'
    })).toThrow(/origin/i)
  })
})
