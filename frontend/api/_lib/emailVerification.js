// Tranche's own proof that a person controls the email they're about to be
// paid at — held independently of Circle.
//
// WHY THIS EXISTS: Circle's OTP proves inbox control to CIRCLE, but Circle
// exposes no way for us to learn which email a userToken belongs to
// (EmailLoginResult is {userToken, encryptionKey, refreshToken}; no server
// call maps a token back to an address). That left one hole in the binding
// model in emailWallets.js: the FIRST binding for a never-registered email.
// Anyone can ask us to send a Circle OTP to any address, so an attacker could
// open a session for a stranger's email, never read that code, and present
// their own userToken — and the server had no way to tell that apart from a
// genuine completion.
//
// A code we generate and send ourselves closes it. The attacker cannot read
// the victim's inbox, so they cannot produce this code, and no binding is
// written until they do. It matters that this mail goes out over OUR provider
// (Resend) rather than the SMTP configured in Circle Console: a proof is only
// independent if it doesn't share a delivery path with the thing it checks.
//
// The pending record carries the email, address and userId that were already
// derived server-side at register time, so confirming a code can only ever
// commit those exact values — the confirm step cannot introduce new ones.
//
// Codes are stored as sha256(verificationId:code), not in the clear. The
// verificationId is a random UUID and acts as a per-record salt, so a leaked
// KV snapshot yields no usable codes and no rainbow-table shortcut. That's
// enough here without minting another long-lived secret like
// INVOICE_KEY_SECRET: these codes die in 15 minutes, and anyone who can read
// KV can already read the bindings themselves.

import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { kv } from './redis.js'

export const CODE_TTL_MINUTES = 15
const CODE_TTL_SECONDS = CODE_TTL_MINUTES * 60

// Six digits is the ceiling on usability for a code someone retypes from
// their phone. Brute force is handled by the attempt cap below, not by
// length: 5 tries against 10^6 is a 1-in-200,000 shot, and the record is
// destroyed after that rather than merely rate-limited.
//
// CUMULATIVE ACROSS RESENDS — do not reset this in rotateVerificationCode.
// An earlier version did, which quietly made the cap worthless: guess five
// times, request a new code, and the budget was back. A script could cycle
// guess-5/resend and walk the entire 10^6 space with no limit at all. A
// resend issues a fresh code, never a fresh budget.
const MAX_ATTEMPTS = 5

// Independently caps how many codes one verification can send. Cumulative
// attempts already close the guessing hole, but nothing else bounds the
// mail: this endpoint targets an address chosen by whoever started the flow,
// so uncapped resends are a way to have Tranche repeatedly mail a stranger,
// and to burn Resend quota doing it.
const MAX_RESENDS = 5

export class VerificationError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const key = (id) => `wallet:verify:${id}`

function hashCode(verificationId, code) {
  return createHash('sha256').update(`${verificationId}:${code}`).digest('hex')
}

function generateCode() {
  // randomInt, not Math.random: this is a credential.
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/* Seconds left on the original 15-minute window. Every rewrite of a record
   passes this rather than CODE_TTL_SECONDS, so neither a wrong guess nor a
   resend can extend how long a pending binding stays claimable. */
function remainingTtlSeconds(record) {
  const elapsed = Math.floor((Date.now() - record.createdAt) / 1000)
  return Math.max(1, CODE_TTL_SECONDS - elapsed)
}

/**
 * Open a pending verification for a binding that is NOT yet written.
 *
 * @param {{ email: string, address: string, userId: string }} binding server-derived, never client input
 * @returns {Promise<{ verificationId: string, code: string }>} code is returned
 *   only so the caller can mail it — it is never stored in the clear and never
 *   sent to the browser.
 */
export async function createVerification({ email, address, userId }) {
  const verificationId = randomUUID()
  const code = generateCode()

  await kv.set(
    key(verificationId),
    {
      email,
      address,
      userId,
      codeHash: hashCode(verificationId, code),
      attempts: 0,
      resends: 0,
      createdAt: Date.now()
    },
    { ex: CODE_TTL_SECONDS }
  )

  return { verificationId, code }
}

/** @returns {Promise<{ email: string, address: string, userId: string } | null>} */
export async function peekVerification(verificationId) {
  const record = await kv.get(key(verificationId))
  if (!record) return null
  return { email: record.email, address: record.address, userId: record.userId }
}

/**
 * Check a submitted code. On success the record is consumed and the caller
 * receives the binding it was holding; the caller is what writes it.
 *
 * @returns {Promise<{ email: string, address: string, userId: string }>}
 */
export async function confirmVerification(verificationId, submittedCode) {
  const record = await kv.get(key(verificationId))
  if (!record) {
    throw new VerificationError('That code has expired. Please request a new one.', 410)
  }

  const expected = Buffer.from(record.codeHash, 'utf8')
  const actual = Buffer.from(hashCode(verificationId, String(submittedCode ?? '')), 'utf8')
  // timingSafeEqual throws on length mismatch, so only compare once lengths
  // agree — both are fixed-length sha256 hex here, but the guard keeps that
  // from becoming a latent crash if the hash ever changes.
  const ok = expected.length === actual.length && timingSafeEqual(expected, actual)

  if (!ok) {
    const attempts = (record.attempts ?? 0) + 1
    if (attempts >= MAX_ATTEMPTS) {
      // Burn it rather than leaving a weakened code alive to be ground down.
      await kv.del(key(verificationId))
      throw new VerificationError('Too many incorrect attempts. Please request a new code.', 429)
    }
    // Preserve the original TTL — a wrong guess must not extend the window.
    await kv.set(key(verificationId), { ...record, attempts }, { ex: remainingTtlSeconds(record) })
    throw new VerificationError('That code is not correct.', 401)
  }

  await kv.del(key(verificationId))
  return { email: record.email, address: record.address, userId: record.userId }
}

/**
 * Replace the code on an open verification, keeping the same binding.
 *
 * Issues a fresh credential but NOT a fresh attempt budget: `attempts`
 * carries over untouched, so the MAX_ATTEMPTS cap bounds guesses across the
 * whole life of the verification rather than per-code. See the comment on
 * MAX_ATTEMPTS for what resetting it cost.
 *
 * @returns {Promise<{ email: string, code: string }>}
 */
export async function rotateVerificationCode(verificationId) {
  const record = await kv.get(key(verificationId))
  if (!record) {
    throw new VerificationError('That request has expired. Please sign in again.', 410)
  }

  // A verification already out of guesses must not be revivable by asking for
  // another code — otherwise the burn in confirmVerification is just a pause.
  if ((record.attempts ?? 0) >= MAX_ATTEMPTS) {
    await kv.del(key(verificationId))
    throw new VerificationError('Too many incorrect attempts. Please sign in again.', 429)
  }

  const resends = (record.resends ?? 0) + 1
  if (resends > MAX_RESENDS) {
    throw new VerificationError('Too many codes requested. Please sign in again.', 429)
  }

  const code = generateCode()
  await kv.set(
    key(verificationId),
    {
      ...record,
      codeHash: hashCode(verificationId, code),
      resends,
      // attempts deliberately NOT reset — see above.
      // createdAt is not advanced either: the 15-minute window belongs to the
      // verification, not to the newest code, so resending cannot be used to
      // hold a pending binding open indefinitely.
      createdAt: record.createdAt
    },
    { ex: remainingTtlSeconds(record) }
  )
  return { email: record.email, code }
}
