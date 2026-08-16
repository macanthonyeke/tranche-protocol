// Cookie-backed Tranche sessions for Circle UCW users.
//
// The browser still needs Circle's SDK credentials for hosted Circle dialogs;
// this cookie is the application's authenticated identity, not a replacement
// for those SDK credentials. Only a hash of the cookie is stored in Redis.

import { createHash, randomBytes } from 'node:crypto'
import { kv } from './redis.js'
import { backfillIdentityFromSession } from './identityRegistry.js'

export const AUTH_COOKIE_NAME = 'tranche_session'
export const SESSION_TTL_SECONDS = 13 * 24 * 60 * 60
export const INACTIVITY_TTL_SECONDS = 7 * 24 * 60 * 60

export class AuthSessionError extends Error {
  constructor(message, status = 401) {
    super(message)
    this.status = status
  }
}

const sessionKey = (token) => `auth:session:${createHash('sha256').update(token).digest('hex')}`

function nowMs() {
  return Date.now()
}

function requireIdentity(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AuthSessionError(`Authenticated Circle ${field} is missing.`, 502)
  }
  return value.trim()
}

export function parseCookieHeader(header) {
  if (typeof header !== 'string') return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === AUTH_COOKIE_NAME) {
      const value = rest.join('=').trim()
      return value || null
    }
  }
  return null
}

function requestCookie(req) {
  return parseCookieHeader(req?.headers?.cookie ?? req?.headers?.Cookie)
}

export function assertSameOrigin(req) {
  const origin = req?.headers?.origin ?? req?.headers?.Origin
  if (!origin) return
  const host = req?.headers?.host ?? req?.headers?.Host
  if (!host || origin === 'null') {
    throw new AuthSessionError('The request origin could not be verified.', 403)
  }
  try {
    if (new URL(origin).host !== host) {
      throw new AuthSessionError('The request origin could not be verified.', 403)
    }
  } catch (err) {
    if (err instanceof AuthSessionError) throw err
    throw new AuthSessionError('The request origin could not be verified.', 403)
  }
}

function cookieHeader(value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  if (!value || maxAge <= 0) {
    return `${AUTH_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; SameSite=Lax${secure}`
  }
  return `${AUTH_COOKIE_NAME}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`
}

export function setAuthCookie(res, token, maxAge = SESSION_TTL_SECONDS) {
  res.setHeader('Set-Cookie', cookieHeader(token, maxAge))
}

export function publicAuthSession(record) {
  if (!record) return null
  return {
    authType: record.authType,
    walletId: record.walletId,
    walletAddress: record.walletAddress,
    blockchain: record.blockchain,
    accountType: record.accountType,
    issuedAt: record.issuedAt,
    lastSeenAt: record.lastSeenAt,
    expiresAt: record.expiresAt
  }
}

export async function createAuthSession({ circleUserId, walletId, walletAddress, blockchain, accountType }, { now = nowMs() } = {}) {
  const record = {
    version: 1,
    authType: 'circle-sca',
    circleUserId: requireIdentity(circleUserId, 'user ID'),
    walletId: requireIdentity(walletId, 'wallet ID'),
    walletAddress: requireIdentity(walletAddress, 'wallet address'),
    blockchain: requireIdentity(blockchain, 'blockchain'),
    accountType: requireIdentity(accountType, 'account type'),
    issuedAt: now,
    lastSeenAt: now,
    expiresAt: now + SESSION_TTL_SECONDS * 1000
  }
  const token = randomBytes(32).toString('base64url')
  await kv.set(sessionKey(token), record, { ex: SESSION_TTL_SECONDS })
  return { token, record }
}

export async function getAuthSession(req, { touch = true, now = nowMs() } = {}) {
  const token = requestCookie(req)
  if (!token) return null

  const key = sessionKey(token)
  const record = await kv.get(key)
  if (!record) return null

  const expired = !Number.isFinite(record.expiresAt) || now >= record.expiresAt
  const inactive = !Number.isFinite(record.lastSeenAt) ||
    now - record.lastSeenAt > INACTIVITY_TTL_SECONDS * 1000
  if (expired || inactive) {
    await kv.del(key)
    return null
  }

  // Migration is best effort. A valid server session remains usable if a
  // registry write is temporarily unavailable; strict registry enforcement is
  // enabled separately only after coverage has been verified.
  try {
    await backfillIdentityFromSession(record)
  } catch {
    // Do not turn a migration write failure into an auth outage.
  }

  if (touch) {
    const touched = { ...record, lastSeenAt: now }
    const remaining = Math.max(1, Math.ceil((record.expiresAt - now) / 1000))
    await kv.set(key, touched, { ex: remaining })
    return touched
  }
  return record
}

export async function requireAuthSession(req, options) {
  if (req?.method === 'POST') assertSameOrigin(req)
  const session = await getAuthSession(req, options)
  if (!session) throw new AuthSessionError('A signed-in Circle wallet session is required.', 401)
  return session
}

export async function revokeAuthSession(req, res) {
  assertSameOrigin(req)
  const token = requestCookie(req)
  if (token) await kv.del(sessionKey(token))
  setAuthCookie(res, null, 0)
}
