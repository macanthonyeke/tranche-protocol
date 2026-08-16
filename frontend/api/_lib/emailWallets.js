// Upstash Redis store backing the email -> Arc address directory that
// CreateEscrow's "pay this freelancer by email" lookup reads.
//
// WHY A STORE AT ALL: Circle's User-Controlled Wallets API has no email index.
// Users created through the email-OTP flow get a Circle-generated userId, and
// no server-side call maps an email to a userId or a userToken back to an
// email (EmailLoginResult is {userToken, encryptionKey, refreshToken}; the
// user objects returned by getUser / getUserStatus carry no email field). So
// if the app wants to answer "what address does alice@example.com receive
// at?", it has to have recorded that itself.
//
// WHY REDIS AND NOT SQLITE: these are Vercel serverless functions with no
// durable local disk. bot/'s better-sqlite3 is a separate long-running
// process with no shared filesystem — the same constraint that forced the
// stateless designs in unpinToken.js and invoiceCrypto.js. Upstash (see
// _lib/redis.js) is the first actual persistence reachable from this side of
// the app.
//
// THREAT MODEL — read this before changing writeBinding():
//
// The dangerous mistake is letting a caller assert both halves of the pair.
// If register accepted {email, address} from the client, anyone could bind a
// freelancer's email to their own address and silently redirect every future
// escrow addressed to that person. So:
//
//   - the email used for a directory claim is explicitly requested and then
//     independently verified by Resend;
//   - the address is only ever read from the authenticated server session,
//     never from a directory-claim request body;
//   - a binding is pinned to the Circle userId that created it, and a
//     different userId can never overwrite it (see writeBinding).
//
// FIRST-BINDING RISK — now closed, see _lib/emailVerification.js. Circle's
// OTP proves inbox control to Circle, but no Circle call reveals which email
// a userToken belongs to, so on its own it could not rule out an attacker
// opening an OTP session for a stranger's address, never reading it, and
// presenting their own userToken. A first binding is therefore no longer
// written by the login flow at all: it is held pending until the person returns
// a code Tranche generates and mails itself over Resend — a separate delivery
// path from Circle's SMTP, so the proof is genuinely independent. Only
// wallet/verify-email.js writes a new binding.
//
// The three guarantees above still carry the returning-user case, where no
// re-verification is demanded: writeBinding's userId pin is what makes
// skipping it safe.

import { kv } from './redis.js'

export class EmailWalletError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

// Deliberately conservative: trim + lowercase only. No gmail-style dot or
// plus-tag folding — treating alice+work@ and alice@ as the same person would
// merge two identities the user may well intend to keep separate, and
// silently redirecting one's payments to the other is exactly the failure
// this module exists to prevent.
export function normalizeEmail(email) {
  if (typeof email !== 'string') return null
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || trimmed.length > 254) return null
  // Intentionally loose: a single @ with non-empty, whitespace-free sides.
  // Real validation is "Circle delivered an OTP to it", not a regex.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
  return trimmed
}

const bindingKey = (email) => `wallet:email:${email}`
const sessionKey = (sessionId) => `wallet:otp:${sessionId}`

// Long enough to read an email and finish wallet setup, short enough that an
// abandoned session isn't sitting around claimable.
const SESSION_TTL_SECONDS = 15 * 60

/**
 * Record which email an OTP was sent to for the login attempt. Returns the
 * opaque id the client echoes back.
 * @param {string} sessionId
 * @param {{ email: string, deviceId: string }} data
 */
export async function putOtpSession(sessionId, { email, deviceId }) {
  await kv.set(
    sessionKey(sessionId),
    { email, deviceId, createdAt: Date.now() },
    { ex: SESSION_TTL_SECONDS }
  )
}

/**
 * Read an OTP login attempt without consuming it. This is only for the
 * post-OTP wallet-initialization step; complete-login remains the sole
 * consumer that turns the attempt into an authenticated app session.
 */
export async function peekOtpSession(sessionId) {
  return kv.get(sessionKey(sessionId))
}

/**
 * Consume an OTP session. Single-use: the record is deleted as it's read, so
 * one OTP send can never seed more than one binding.
 * @param {string} sessionId
 * @returns {Promise<{ email: string, deviceId: string } | null>}
 */
export async function takeOtpSession(sessionId) {
  const key = sessionKey(sessionId)
  const session = await kv.get(key)
  if (!session) return null
  await kv.del(key)
  return session
}

/**
 * Put a consumed session back, for the one case that is a retryable race
 * rather than a completed attempt: Circle has accepted the wallet-creation
 * challenge but has not finished indexing the wallet, so complete-login.js has
 * nothing to bind yet and asks the client to try again shortly.
 *
 * Without this, take-then-fail left the session gone, and the retry that the
 * client was explicitly told to make hit "session expired" instead — turning
 * a two-second indexing delay into a full restart of sign-in.
 *
 * Restores the ORIGINAL expiry rather than a fresh 15 minutes, so repeatedly
 * provoking this path cannot hold a session open indefinitely.
 *
 * @param {string} sessionId
 * @param {{ email: string, deviceId: string, createdAt: number }} session as returned by takeOtpSession
 */
export async function restoreOtpSession(sessionId, session) {
  const elapsed = Math.floor((Date.now() - (session.createdAt ?? Date.now())) / 1000)
  const remaining = SESSION_TTL_SECONDS - elapsed
  // Already past its window: leave it consumed rather than resurrecting it.
  if (remaining <= 0) return
  await kv.set(sessionKey(sessionId), session, { ex: remaining })
}

/**
 * @param {string} email already normalized
 * @returns {Promise<{ address: string, userId: string, boundAt: number } | null>}
 */
export async function readBinding(email) {
  return (await kv.get(bindingKey(email))) ?? null
}

/**
 * Bind an email to the Arc address Circle reports for `userId`.
 *
 * Refuses to move an existing binding to a different Circle user. Re-running
 * it for the same user is fine and idempotent (a user who re-onboards on a
 * new device keeps the same Circle userId, and their address is stable).
 *
 * @param {string} email already normalized
 * @param {{ address: string, userId: string }} binding
 * @returns {Promise<{ address: string, userId: string, boundAt: number }>} the binding now in force
 */
export async function writeBinding(email, { address, userId }) {
  const existing = await readBinding(email)
  if (existing && existing.userId !== userId) {
    throw new EmailWalletError(
      'This email is already linked to a different wallet.',
      409
    )
  }
  // Same user, same address: nothing to write. Keeps the original boundAt,
  // which is the useful timestamp (when this person first proved the email).
  if (existing && existing.address === address) return existing

  const binding = { address, userId, boundAt: existing?.boundAt ?? Date.now() }
  await kv.set(bindingKey(email), binding)
  return binding
}
