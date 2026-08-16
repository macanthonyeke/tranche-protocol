// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => new Map())
const circleMock = vi.hoisted(() => ({
  createDeviceTokenForEmailLogin: vi.fn()
}))

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

const handler = (await import('./email-token.js')).default

function invoke(body) {
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

beforeEach(() => {
  store.clear()
  circleMock.createDeviceTokenForEmailLogin.mockReset()
  circleMock.createDeviceTokenForEmailLogin.mockResolvedValue({ data: {
    deviceToken: 'device-token', deviceEncryptionKey: 'device-key', otpToken: 'otp-token'
  } })
})

describe('POST /api/wallet/email-token', () => {
  it('stores signup intent server-side with the short-lived OTP attempt', async () => {
    const res = await invoke({ deviceId: 'device-1', email: 'Alice@example.com', intent: 'signup' })

    expect(res.statusCode).toBe(200)
    expect(res.payload).not.toHaveProperty('intent')
    expect([...store.values()]).toContainEqual(expect.objectContaining({
      email: 'alice@example.com', deviceId: 'device-1', intent: 'signup'
    }))
  })

  it('rejects an invalid intent before asking Circle to send a code', async () => {
    const res = await invoke({ deviceId: 'device-1', email: 'alice@example.com', intent: 'create' })

    expect(res.statusCode).toBe(400)
    expect(res.payload.error).toMatch(/login intent/i)
    expect(circleMock.createDeviceTokenForEmailLogin).not.toHaveBeenCalled()
    expect(store).toHaveLength(0)
  })
})
