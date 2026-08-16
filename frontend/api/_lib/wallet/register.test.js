// @vitest-environment node

import { describe, it, expect, vi } from 'vitest'

const handler = (await import('./register.js')).default

function invoke(body = {}) {
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

describe('POST /api/wallet/register', () => {
  it('is retired and cannot trigger Circle, Redis, or Resend work', async () => {
    const res = await invoke({ sessionId: 'old', userToken: 'old-token' })

    expect(res.statusCode).toBe(410)
    expect(res.payload).toEqual({
      error: 'This sign-in route has been retired. Please sign in again.'
    })
  })

  it('rejects non-POST requests', async () => {
    const res = {
      statusCode: null,
      payload: null,
      setHeader() {},
      status(code) { this.statusCode = code; return this },
      json(payload) { this.payload = payload; return this }
    }
    await handler({ method: 'GET', body: {} }, res)
    expect(res.statusCode).toBe(405)
  })
})
