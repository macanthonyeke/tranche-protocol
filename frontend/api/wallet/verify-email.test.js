// @vitest-environment node
//
// verify-email.js is the only route that writes a brand-new binding, so these
// tests pin down that the code is genuinely required and that holding a
// verificationId confers no ability to choose what gets written.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => new Map())

vi.mock('../_lib/redis.js', () => ({
  kv: {
    get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : null),
    set: async (k, v) => { store.set(k, structuredClone(v)) },
    del: async (k) => { store.delete(k) }
  }
}))

const handler = (await import('./verify-email.js')).default
const { createVerification } = await import('../_lib/emailVerification.js')
const { readBinding, writeBinding } = await import('../_lib/emailWallets.js')

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

const BINDING = { email: 'alice@example.com', address: '0xALICE', userId: 'user-a' }

beforeEach(() => store.clear())

describe('POST /api/wallet/verify-email', () => {
  it('writes the binding once the correct code is supplied', async () => {
    const { verificationId, code } = await createVerification(BINDING)

    const res = await invoke({ verificationId, code })

    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({ email: 'alice@example.com', address: '0xALICE', verified: true })
    expect((await readBinding('alice@example.com')).address).toBe('0xALICE')
  })

  it('writes nothing when the code is wrong', async () => {
    const { verificationId, code } = await createVerification(BINDING)
    const wrong = code === '000000' ? '111111' : '000000'

    const res = await invoke({ verificationId, code: wrong })

    expect(res.statusCode).toBe(401)
    expect(await readBinding('alice@example.com')).toBeNull()
  })

  // Holding a verificationId must not let a caller redirect the binding: the
  // email and address both come out of the pending record.
  it('ignores email and address supplied in the request body', async () => {
    const { verificationId, code } = await createVerification(BINDING)

    const res = await invoke({
      verificationId,
      code,
      email: 'victim@example.com',
      address: '0xATTACKER'
    })

    expect(res.payload).toMatchObject({ email: 'alice@example.com', address: '0xALICE' })
    expect(await readBinding('victim@example.com')).toBeNull()
    expect((await readBinding('alice@example.com')).address).toBe('0xALICE')
  })

  it('cannot be replayed to rewrite the binding', async () => {
    const { verificationId, code } = await createVerification(BINDING)

    expect((await invoke({ verificationId, code })).statusCode).toBe(200)
    expect((await invoke({ verificationId, code })).statusCode).toBe(410)
  })

  it('tolerates a pasted code with stray whitespace', async () => {
    const { verificationId, code } = await createVerification(BINDING)
    expect((await invoke({ verificationId, code: `  ${code} ` })).statusCode).toBe(200)
  })

  // Even a correct code must not move an email that belongs to another
  // Circle user — verification and the userId pin are independent defences.
  it('still refuses to repoint an email owned by a different Circle user', async () => {
    await writeBinding('alice@example.com', { address: '0xALICE', userId: 'user-a' })
    const { verificationId, code } = await createVerification({
      email: 'alice@example.com',
      address: '0xATTACKER',
      userId: 'attacker'
    })

    const res = await invoke({ verificationId, code })

    expect(res.statusCode).toBe(409)
    expect((await readBinding('alice@example.com')).address).toBe('0xALICE')
  })

  it('requires a verificationId', async () => {
    expect((await invoke({ code: '000000' })).statusCode).toBe(400)
  })

  it('rejects an unknown verificationId', async () => {
    expect((await invoke({ verificationId: 'nope', code: '000000' })).statusCode).toBe(410)
  })

  it('rejects non-POST', async () => {
    expect((await invoke({}, 'GET')).statusCode).toBe(405)
  })
})
