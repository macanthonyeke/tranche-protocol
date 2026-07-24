// Stateless capability token authorizing the unpinning of one specific CID.
//
// unpin-invoice.js's earlier version was unauthenticated on the theory that
// CID possession already implies read access to the content, so exposing
// unpin too was "no worse." That reasoning was wrong: read and delete are
// different permissions. Since Tranche is the sole host of these files, an
// unauthenticated unpin-by-CID endpoint would let any third party who
// obtains or guesses a CID permanently destroy someone else's real,
// possibly-disputed private escrow's document — exactly the link-rot
// problem the invoice-permanence work (PR #13) exists to prevent.
//
// There's no database reachable from these Vercel serverless functions to
// track "who pinned this CID and when" (the only better-sqlite3 in this
// repo is bot/'s, a separate long-running process with no shared
// filesystem — same constraint that shaped INVOICE_KEY_SECRET's stateless
// design). So instead of a server-side token->CID table, the token IS the
// state: it's a short-lived, HMAC-signed credential binding one specific
// CID to an expiry, issued at pin time and verified — never stored — at
// unpin time. Forging one without UNPIN_TOKEN_SECRET is infeasible;
// presenting a real token issued for a different CID fails verification
// because the CID is part of what's signed.
//
// A separate secret from INVOICE_KEY_SECRET on purpose — this token
// authorizes destructive action on Tranche's own storage, a different
// capability than deriving a read-only decryption key, and a leak of one
// shouldn't compromise the other.

import { createHmac, timingSafeEqual } from 'node:crypto'

const TTL_MS = 15 * 60 * 1000 // long enough to cover a draft session's mode-switch, short enough to bound exposure

function hmac(secret, data) {
  return createHmac('sha256', secret).update(data).digest('hex')
}

// Module-scope, not per-request: a warm serverless instance calls
// requireSecret() on every pin/unpin, and a misconfigured deployment would
// otherwise flood logs with the same line forever. One warning per instance
// lifetime is enough for someone to notice the safety net is off.
let warnedMissingSecret = false

function requireSecret() {
  const secret = process.env.UNPIN_TOKEN_SECRET
  if (!secret) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true
      console.warn(
        'UNPIN_TOKEN_SECRET is not set — pinning will still succeed, but unpinning ' +
        '(cleanup of abandoned draft attachments) is silently disabled until this is configured.'
      )
    }
    throw new Error('UNPIN_TOKEN_SECRET is not configured on the server.')
  }
  return secret
}

/**
 * @param {string} cid
 * @returns {string} opaque token, valid for TTL_MS and only for this cid
 */
export function issueUnpinToken(cid) {
  const secret = requireSecret()
  const expiresAt = Date.now() + TTL_MS
  const payload = `${cid}.${expiresAt}`
  return Buffer.from(`${payload}.${hmac(secret, payload)}`).toString('base64url')
}

/**
 * @param {string} cid
 * @param {string} token
 * @returns {boolean} true only if token was issued for exactly this cid and hasn't expired
 */
export function verifyUnpinToken(cid, token) {
  let secret
  try {
    secret = requireSecret()
  } catch {
    return false
  }
  if (typeof token !== 'string' || !token) return false

  let decoded
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    return false
  }
  const parts = decoded.split('.')
  if (parts.length !== 3) return false
  const [tokenCid, expiresAtStr, sig] = parts

  if (tokenCid !== cid) return false

  const expiresAt = Number(expiresAtStr)
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false

  const expectedSig = hmac(secret, `${tokenCid}.${expiresAtStr}`)
  const a = Buffer.from(sig, 'utf8')
  const b = Buffer.from(expectedSig, 'utf8')
  // Constant-time comparison, and only once lengths already match (
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false).
  return a.length === b.length && timingSafeEqual(a, b)
}
