// @vitest-environment node
//
// The catch-all is now the single entry point for every /api/wallet/* call,
// so a mistake here takes down all eleven routes at once rather than one.
// Lives under _lib/ so it doesn't itself count against Vercel's function cap
// — see the header of api/wallet/[...route].js.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub every handler: this tests dispatch, not the routes themselves, and
// keeps Circle/Redis out of it entirely.
const calls = vi.hoisted(() => [])
const stub = (name) => vi.fn(async (req, res) => {
  calls.push(name)
  res.status(200).json({ handled: name })
})
const handlers = vi.hoisted(() => ({}))

for (const name of [
  'balances', 'email-resend', 'email-token', 'execute-contract-call',
  'initialize', 'list', 'register', 'resend-verification',
  'resolve-email', 'tx-status', 'verify-email'
]) {
  vi.doMock(`./${name}.js`, () => ({ default: (handlers[name] ??= stub(name)) }))
}

const dispatcher = (await import('../../wallet/[...route].js')).default

function invoke(route, method = 'POST') {
  const res = {
    statusCode: null,
    payload: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this },
    json(p) { this.payload = p; return this }
  }
  return dispatcher({ method, query: { route }, body: {} }, res).then(() => res)
}

beforeEach(() => { calls.length = 0 })

describe('/api/wallet/[...route] dispatch', () => {
  // The consolidation must be invisible from outside: every URL the frontend
  // already calls has to keep resolving to the handler it always did.
  it.each([
    'balances', 'email-resend', 'email-token', 'execute-contract-call',
    'initialize', 'list', 'register', 'resend-verification',
    'resolve-email', 'tx-status', 'verify-email'
  ])('routes %s to its handler', async (name) => {
    const res = await invoke([name])
    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ handled: name })
    expect(calls).toEqual([name])
  })

  it('accepts the segment as a bare string as well as an array', async () => {
    const res = await invoke('register')
    expect(res.payload).toEqual({ handled: 'register' })
  })

  it('404s an unknown route without invoking any handler', async () => {
    const res = await invoke(['nope'])
    expect(res.statusCode).toBe(404)
    expect(calls).toEqual([])
  })

  // A nested path must miss outright rather than matching on its first
  // segment — otherwise /api/wallet/register/anything would quietly register.
  it('404s a nested path instead of matching its first segment', async () => {
    const res = await invoke(['register', 'extra'])
    expect(res.statusCode).toBe(404)
    expect(calls).toEqual([])
  })

  it('404s an empty route', async () => {
    expect((await invoke(undefined)).statusCode).toBe(404)
    expect((await invoke([])).statusCode).toBe(404)
    expect(calls).toEqual([])
  })

  // A bare ROUTES[name] lookup would resolve these to Object.prototype
  // members and then try to call one as a request handler.
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'does not resolve inherited property %s as a handler',
    async (name) => {
      const res = await invoke([name])
      expect(res.statusCode).toBe(404)
      expect(calls).toEqual([])
    }
  )
})
