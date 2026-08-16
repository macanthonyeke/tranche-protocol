// @vitest-environment node
//
// The catch-all is now the single entry point for every /api/wallet/* call,
// so a mistake here takes down the wallet routes at once rather than one.
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
  'balances', 'complete-login', 'directory-claim', 'email-resend', 'email-token', 'execute-contract-call',
  'initialize', 'list', 'logout', 'register', 'resend-verification',
  'resolve-email', 'session', 'tx-status', 'verify-email'
]) {
  vi.doMock(`./${name}.js`, () => ({ default: (handlers[name] ??= stub(name)) }))
}

const dispatcher = (await import('../../wallet/[...route].js')).default

function invoke(route, method = 'POST', url = undefined) {
  const res = {
    statusCode: null,
    payload: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this },
    json(p) { this.payload = p; return this }
  }
  return dispatcher({ method, url, query: { route }, body: {} }, res).then(() => res)
}

/* Invoke with a fully custom req, for shapes the helpers above can't express. */
function dispatcherWith({ url, query, method = 'POST' }) {
  const res = {
    statusCode: null,
    payload: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this },
    json(p) { this.payload = p; return this }
  }
  return dispatcher({ method, url, query, body: {} }, res).then(() => res)
}

/* Invoke by URL alone, with no dynamic param at all. */
function invokeByUrl(url, method = 'POST') {
  const res = {
    statusCode: null,
    payload: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this },
    json(p) { this.payload = p; return this }
  }
  return dispatcher({ method, url, query: {}, body: {} }, res).then(() => res)
}

beforeEach(() => { calls.length = 0 })

describe('/api/wallet/[...route] dispatch', () => {
  // The consolidation must be invisible from outside: every URL the frontend
  // already calls has to keep resolving to the handler it always did.
  it.each([
    'balances', 'complete-login', 'directory-claim', 'email-resend', 'email-token', 'execute-contract-call',
    'initialize', 'list', 'logout', 'register', 'resend-verification',
    'resolve-email', 'session', 'tx-status', 'verify-email'
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

  /* These encode the failure that took every wallet endpoint down in
     production while this suite stayed green.

     The dispatcher originally read only req.query.route and assumed it would
     be ['email-token'] or 'email-token'. The tests asserted exactly that
     shape, so they agreed with the bug. In the real deployment the value
     arrived differently and every route answered 404 {"error":"Not found."}.

     Resolution is now driven by the request path, which is identical in every
     environment, with the dynamic param as a fallback. Each case below is a
     shape that previously 404'd. */
  describe('resolves regardless of how the platform shapes the dynamic param', () => {
    it('resolves from the URL when no param is supplied at all', async () => {
      const res = await invokeByUrl('/api/wallet/email-token')
      expect(res.payload).toEqual({ handled: 'email-token' })
    })

    it('resolves from the URL when the param is named unexpectedly', async () => {
      const res = await dispatcherWith({ url: '/api/wallet/email-token', query: { '...route': 'email-token' } })
      expect(res.payload).toEqual({ handled: 'email-token' })
    })

    // These two resolve off the URL, not off the param. The param is useless
    // in both cases ('wallet/email-token' matches no key) and is deliberately
    // no longer rescued by taking its last segment — see the alias tests below.
    it('resolves from the URL when the param includes the parent segment', async () => {
      const res = await invoke(['wallet', 'email-token'], 'POST', '/api/wallet/email-token')
      expect(res.payload).toEqual({ handled: 'email-token' })
    })

    it('resolves from the URL when the param is a full path string', async () => {
      const res = await invoke('wallet/email-token', 'POST', '/api/wallet/email-token')
      expect(res.payload).toEqual({ handled: 'email-token' })
    })

    it('resolves when the param carries a leading slash', async () => {
      const res = await invoke('/email-token', 'POST', '/api/wallet/email-token')
      expect(res.payload).toEqual({ handled: 'email-token' })
    })

    it('ignores a querystring on the URL', async () => {
      const res = await invokeByUrl('/api/wallet/email-token?utm=x')
      expect(res.payload).toEqual({ handled: 'email-token' })
    })

    it('falls back to the param when the URL is the unexpanded file path', async () => {
      const res = await invoke('email-token', 'POST', '/api/wallet/[...route]')
      expect(res.payload).toEqual({ handled: 'email-token' })
    })

    it('resolves a percent-encoded path', async () => {
      const res = await invokeByUrl('/api/wallet/email%2Dtoken')
      expect(res.payload).toEqual({ handled: 'email-token' })
    })

    // Every wallet endpoint, by URL alone — the consolidation must not have
    // left any single route behind, which is how this surfaced.
    it.each([
      'balances', 'complete-login', 'directory-claim', 'email-resend', 'email-token', 'execute-contract-call',
      'initialize', 'list', 'logout', 'register', 'resend-verification',
      'resolve-email', 'session', 'tx-status', 'verify-email'
    ])('resolves %s from the URL alone', async (name) => {
      const res = await invokeByUrl(`/api/wallet/${name}`)
      expect(res.payload).toEqual({ handled: name })
    })
  })

  /* A route name is matched whole, never by trailing segment.
     A "last segment wins" fallback briefly existed to rescue a param that
     included the parent segment. URL resolution covers every real case, so it
     bought nothing and silently made /api/wallet/anything/register an alias
     for register. These pin the aliases as gone. */
  describe('does not alias a route onto a trailing segment', () => {
    it.each([
      ['/api/wallet/anything/register', ['anything', 'register']],
      ['/api/wallet/x/y/verify-email', ['x', 'y', 'verify-email']]
    ])('404s %s', async (url, route) => {
      const res = await invoke(route, 'POST', url)
      expect(res.statusCode).toBe(404)
      expect(calls).toEqual([])
    })

    it.each([
      ['array param', ['wallet', 'register']],
      ['string param', 'wallet/register']
    ])('404s a %s whose tail is a real route, with no URL to fall back on', async (_label, route) => {
      const res = await invoke(route)
      expect(res.statusCode).toBe(404)
      expect(calls).toEqual([])
    })
  })

  it('reports what it received when nothing matches', async () => {
    const res = await invokeByUrl('/api/wallet/does-not-exist')
    expect(res.statusCode).toBe(404)
    expect(res.payload.received.url).toBe('/api/wallet/does-not-exist')
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
