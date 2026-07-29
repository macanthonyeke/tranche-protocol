// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory stand-in for Vercel KV. Hoisted because vi.mock's factory runs
// before the module body.
const store = vi.hoisted(() => new Map())

vi.mock('./redis.js', () => ({
  kv: {
    get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : null),
    set: async (k, v) => { store.set(k, structuredClone(v)) },
    del: async (k) => { store.delete(k) }
  }
}))

const {
  normalizeEmail,
  putOtpSession,
  takeOtpSession,
  readBinding,
  writeBinding,
  EmailWalletError
} = await import('./emailWallets.js')

beforeEach(() => store.clear())

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com')
  })

  it('rejects malformed input', () => {
    for (const bad of ['', '   ', 'no-at-sign', 'a@b', 'a b@c.com', null, undefined, 42, {}]) {
      expect(normalizeEmail(bad)).toBeNull()
    }
  })

  it('rejects absurdly long addresses', () => {
    expect(normalizeEmail(`${'a'.repeat(250)}@example.com`)).toBeNull()
  })

  // Guards a deliberate decision, not an oversight: folding plus-tags or
  // gmail dots would merge two addresses a user may intend to keep apart,
  // silently routing one person's escrow payments to another's wallet.
  it('does NOT fold plus-tags or dots into a different address', () => {
    expect(normalizeEmail('alice+work@example.com')).toBe('alice+work@example.com')
    expect(normalizeEmail('al.ice@example.com')).toBe('al.ice@example.com')
  })
})

describe('OTP sessions', () => {
  it('round-trips the email the server sent the code to', async () => {
    await putOtpSession('sess-1', { email: 'alice@example.com', deviceId: 'dev-1' })
    const session = await takeOtpSession('sess-1')
    expect(session.email).toBe('alice@example.com')
    expect(session.deviceId).toBe('dev-1')
  })

  // Single-use is what stops one OTP send from seeding more than one binding.
  it('is single-use — a replayed sessionId gets nothing', async () => {
    await putOtpSession('sess-1', { email: 'alice@example.com', deviceId: 'dev-1' })
    expect(await takeOtpSession('sess-1')).not.toBeNull()
    expect(await takeOtpSession('sess-1')).toBeNull()
  })

  it('returns null for an unknown session', async () => {
    expect(await takeOtpSession('never-existed')).toBeNull()
  })
})

describe('writeBinding', () => {
  it('records the address for a new email', async () => {
    await writeBinding('alice@example.com', { address: '0xAAA', userId: 'user-a' })
    expect((await readBinding('alice@example.com')).address).toBe('0xAAA')
  })

  // The core takeover defence: once an email belongs to a Circle user, a
  // different user can never repoint it at their own wallet, so an
  // established freelancer's incoming escrows cannot be diverted.
  it('refuses to move an existing binding to a different Circle user', async () => {
    await writeBinding('alice@example.com', { address: '0xAAA', userId: 'user-a' })

    await expect(
      writeBinding('alice@example.com', { address: '0xBAD', userId: 'attacker' })
    ).rejects.toBeInstanceOf(EmailWalletError)

    // and the original binding is untouched
    expect((await readBinding('alice@example.com')).address).toBe('0xAAA')
  })

  it('lets the same user re-register idempotently, preserving boundAt', async () => {
    const first = await writeBinding('alice@example.com', { address: '0xAAA', userId: 'user-a' })
    await new Promise((r) => setTimeout(r, 2))
    const second = await writeBinding('alice@example.com', { address: '0xAAA', userId: 'user-a' })
    expect(second.boundAt).toBe(first.boundAt)
  })

  it('lets the same user update their own address, keeping the original boundAt', async () => {
    const first = await writeBinding('alice@example.com', { address: '0xAAA', userId: 'user-a' })
    const moved = await writeBinding('alice@example.com', { address: '0xNEW', userId: 'user-a' })
    expect(moved.address).toBe('0xNEW')
    expect(moved.boundAt).toBe(first.boundAt)
  })

  it('keeps separate emails independent', async () => {
    await writeBinding('alice@example.com', { address: '0xAAA', userId: 'user-a' })
    await writeBinding('bob@example.com', { address: '0xBBB', userId: 'user-b' })
    expect((await readBinding('alice@example.com')).address).toBe('0xAAA')
    expect((await readBinding('bob@example.com')).address).toBe('0xBBB')
  })

  it('reports an unbound email as a miss', async () => {
    expect(await readBinding('nobody@example.com')).toBeNull()
  })
})
