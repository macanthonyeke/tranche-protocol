// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => new Map())
const writes = vi.hoisted(() => [])

vi.mock('../redis.js', () => ({
  kv: {
    get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : null),
    set: async (k, v) => { writes.push(k); store.set(k, structuredClone(v)) },
    del: async (k) => { store.delete(k) }
  }
}))

const handler = (await import('./resolve-email.js')).default
const { writeBinding } = await import('../emailWallets.js')

function invoke(body, method = 'POST') {
  const res = {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v },
    status(c) { this.statusCode = c; return this },
    json(p) { this.payload = p; return this }
  }
  return handler({ method, body }, res).then(() => res)
}

beforeEach(() => {
  store.clear()
  writes.length = 0
})

describe('POST /api/wallet/resolve-email', () => {
  it('returns the address for an onboarded freelancer', async () => {
    await writeBinding('alice@example.com', { address: '0xALICE', userId: 'user-a' })
    writes.length = 0

    const res = await invoke({ email: 'alice@example.com' })

    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({ onboarded: true, address: '0xALICE' })
  })

  it('matches regardless of casing or surrounding whitespace', async () => {
    await writeBinding('alice@example.com', { address: '0xALICE', userId: 'user-a' })

    const res = await invoke({ email: '  ALICE@Example.com  ' })

    expect(res.payload).toMatchObject({ onboarded: true, address: '0xALICE' })
  })

  it('reports not-onboarded for an unknown email instead of erroring', async () => {
    const res = await invoke({ email: 'nobody@example.com' })

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ onboarded: false, address: null })
  })

  // The endpoint must never provision anything on a stranger's behalf: an
  // escrow can only name an address whose owner completed their own sign-in.
  it('never writes — a miss does not create a placeholder binding', async () => {
    await invoke({ email: 'nobody@example.com' })

    expect(writes).toEqual([])
    expect(store.size).toBe(0)
  })

  it('rejects a malformed email', async () => {
    for (const bad of ['not-an-email', '', '   ', undefined]) {
      const res = await invoke({ email: bad })
      expect(res.statusCode).toBe(400)
    }
  })

  it('rejects non-POST', async () => {
    const res = await invoke({}, 'GET')
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('POST')
  })
})
