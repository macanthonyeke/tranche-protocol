// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => new Map())

vi.mock('./redis.js', () => ({
  kv: {
    get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : null),
    set: async (k, v) => { store.set(k, structuredClone(v)) },
    del: async (k) => { store.delete(k) }
  }
}))

const {
  createVerification,
  confirmVerification,
  peekVerification,
  rotateVerificationCode,
  VerificationError
} = await import('./emailVerification.js')

const BINDING = { email: 'alice@example.com', address: '0xALICE', userId: 'user-a' }

beforeEach(() => store.clear())

describe('createVerification', () => {
  it('issues a 6-digit code and returns the binding on confirm', async () => {
    const { verificationId, code } = await createVerification(BINDING)

    expect(code).toMatch(/^\d{6}$/)
    expect(await confirmVerification(verificationId, code)).toEqual(BINDING)
  })

  // A KV snapshot must not hand an attacker live codes.
  it('never stores the code in the clear', async () => {
    const { code } = await createVerification(BINDING)
    const serialized = JSON.stringify([...store.values()])

    expect(serialized).not.toContain(code)
  })

  it('issues distinct codes and ids per request', async () => {
    const a = await createVerification(BINDING)
    const b = await createVerification(BINDING)
    expect(a.verificationId).not.toBe(b.verificationId)
  })

  it('peek exposes the pending binding but no code material', async () => {
    const { verificationId } = await createVerification(BINDING)
    expect(await peekVerification(verificationId)).toEqual(BINDING)
  })
})

describe('confirmVerification', () => {
  it('rejects a wrong code', async () => {
    const { verificationId, code } = await createVerification(BINDING)
    const wrong = code === '000000' ? '111111' : '000000'

    await expect(confirmVerification(verificationId, wrong)).rejects.toBeInstanceOf(VerificationError)
  })

  it('is single-use — the code cannot be replayed', async () => {
    const { verificationId, code } = await createVerification(BINDING)

    await confirmVerification(verificationId, code)
    await expect(confirmVerification(verificationId, code)).rejects.toMatchObject({ status: 410 })
  })

  it('rejects an unknown verificationId', async () => {
    await expect(confirmVerification('nope', '000000')).rejects.toMatchObject({ status: 410 })
  })

  // Brute force is bounded by destroying the record, not by slowing it down.
  it('burns the record after 5 wrong attempts', async () => {
    const { verificationId, code } = await createVerification(BINDING)
    const wrong = code === '000000' ? '111111' : '000000'

    for (let i = 0; i < 4; i++) {
      await expect(confirmVerification(verificationId, wrong)).rejects.toMatchObject({ status: 401 })
    }
    // 5th failure destroys it
    await expect(confirmVerification(verificationId, wrong)).rejects.toMatchObject({ status: 429 })

    // and even the CORRECT code is now worthless
    await expect(confirmVerification(verificationId, code)).rejects.toMatchObject({ status: 410 })
  })

  it('treats empty/missing input as a failed attempt, not a match', async () => {
    const { verificationId } = await createVerification(BINDING)
    for (const bad of ['', null, undefined]) {
      await expect(confirmVerification(verificationId, bad)).rejects.toBeInstanceOf(VerificationError)
    }
  })
})

describe('rotateVerificationCode', () => {
  it('invalidates the previous code and issues a working one', async () => {
    const { verificationId, code: first } = await createVerification(BINDING)
    const { code: second, email } = await rotateVerificationCode(verificationId)

    expect(email).toBe('alice@example.com')
    expect(second).toMatch(/^\d{6}$/)

    await expect(confirmVerification(verificationId, first)).rejects.toMatchObject({ status: 401 })
    expect(await confirmVerification(verificationId, second)).toEqual(BINDING)
  })

  it('keeps the pending binding untouched', async () => {
    const { verificationId } = await createVerification(BINDING)
    await rotateVerificationCode(verificationId)
    expect(await peekVerification(verificationId)).toEqual(BINDING)
  })

  // A resend issues a fresh code, NOT a fresh attempt budget. Resetting
  // `attempts` here made the 5-guess cap meaningless: guess five, resend,
  // repeat, and the full 10^6 space is walkable with no limit.
  it('carries the attempt count across a resend', async () => {
    const { verificationId, code } = await createVerification(BINDING)
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 4; i++) {
      await expect(confirmVerification(verificationId, wrong)).rejects.toMatchObject({ status: 401 })
    }

    await rotateVerificationCode(verificationId)

    // 5th cumulative wrong guess still burns the record, resend notwithstanding.
    await expect(confirmVerification(verificationId, wrong)).rejects.toMatchObject({ status: 429 })
  })

  // The whole attack, end to end. Note the inner loop stops at FOUR guesses,
  // one short of the burn, and then resends — that is the actual exploit,
  // and a version of this test that guessed five would destroy the record in
  // the first round and never exercise a resend at all (it would then pass
  // even with the budget-reset bug present, which is exactly what happened
  // the first time this was written).
  it('cannot be farmed for unlimited guesses by cycling resends', async () => {
    const { verificationId } = await createVerification(BINDING)
    const wrong = '000000'

    let guesses = 0
    let stopped = false
    for (let round = 0; round < 20 && !stopped; round++) {
      for (let i = 0; i < 4; i++) {
        try {
          await confirmVerification(verificationId, wrong)
        } catch (err) {
          guesses++
          if (err.status === 429 || err.status === 410) { stopped = true; break }
        }
      }
      if (stopped) break
      try {
        await rotateVerificationCode(verificationId)
      } catch {
        stopped = true
      }
    }

    expect(stopped).toBe(true)
    // Bounded by MAX_ATTEMPTS across the whole verification, not per code.
    expect(guesses).toBeLessThanOrEqual(5)
  })

  // Asserting the property rather than a status code: exhausting the budget
  // destroys the record outright (confirmVerification deletes it), so a
  // resend finds nothing to revive. rotateVerificationCode also refuses a
  // maxed-out record defensively, which is unreachable today but keeps the
  // guarantee intact if that delete is ever softened.
  it('cannot be revived by requesting a new code once the budget is spent', async () => {
    const { verificationId, code } = await createVerification(BINDING)
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) {
      await confirmVerification(verificationId, wrong).catch(() => {})
    }

    expect(await peekVerification(verificationId)).toBeNull()
    await expect(rotateVerificationCode(verificationId)).rejects.toBeInstanceOf(VerificationError)
    // and the pending binding is unreachable for good
    await expect(confirmVerification(verificationId, code)).rejects.toMatchObject({ status: 410 })
  })

  // Independent of the guessing cap: this endpoint mails an address chosen by
  // whoever started the flow, so uncapped resends are a way to have Tranche
  // repeatedly mail a stranger.
  it('caps how many codes one verification can send', async () => {
    const { verificationId } = await createVerification(BINDING)

    for (let i = 0; i < 5; i++) {
      await expect(rotateVerificationCode(verificationId)).resolves.toBeTruthy()
    }
    await expect(rotateVerificationCode(verificationId)).rejects.toMatchObject({ status: 429 })
  })

  it('still issues a working code on a legitimate resend', async () => {
    const { verificationId, code: first } = await createVerification(BINDING)
    const { code: second } = await rotateVerificationCode(verificationId)

    await expect(confirmVerification(verificationId, first)).rejects.toMatchObject({ status: 401 })
    expect(await confirmVerification(verificationId, second)).toEqual(BINDING)
  })

  it('rejects rotating an unknown verification', async () => {
    await expect(rotateVerificationCode('nope')).rejects.toMatchObject({ status: 410 })
  })
})
