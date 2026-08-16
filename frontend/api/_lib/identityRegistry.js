// Canonical Tranche identity records for Circle User-Controlled Wallets.
//
// The Circle user id is the authentication subject. Email is deliberately not
// present here: the optional Resend-backed directory is an address alias, not
// an identity registry. Wallet fields are written from Circle responses only.

import { kv } from './redis.js'

export const IDENTITY_MODES = Object.freeze({
  SHADOW: 'shadow',
  DUAL_WRITE: 'dual-write',
  STRICT: 'strict'
})

export const IDENTITY_STATUS = Object.freeze({
  ACTIVE: 'active',
  DISABLED: 'disabled'
})

export class IdentityRegistryError extends Error {
  constructor(message, status = 503, code = 'TRANCHE_IDENTITY_UNAVAILABLE') {
    super(message)
    this.status = status
    this.code = code
  }
}

const identityKey = (circleUserId) => `tranche:identity:${circleUserId}`

function required(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new IdentityRegistryError(`Canonical identity ${field} is missing.`, 502)
  }
  return value.trim()
}

export function getIdentityMode(value = process.env.TRANCHE_IDENTITY_MODE) {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (Object.values(IDENTITY_MODES).includes(mode)) return mode
  // Migration must remain non-blocking until coverage is explicitly verified.
  return IDENTITY_MODES.DUAL_WRITE
}

export async function readTrancheIdentity(circleUserId) {
  const id = required(circleUserId, 'Circle user ID')
  const record = await kv.get(identityKey(id))
  if (!record) return null
  if (record.circleUserId !== id) {
    throw new IdentityRegistryError(
      'The canonical identity registry record is invalid.',
      503,
      'TRANCHE_IDENTITY_INVALID'
    )
  }
  return record
}

function sameWallet(identity, wallet) {
  return identity?.walletId === wallet?.walletId &&
    typeof identity?.walletAddress === 'string' &&
    identity.walletAddress.toLowerCase() === String(wallet?.walletAddress || '').toLowerCase() &&
    identity.blockchain === wallet?.blockchain &&
    identity.accountType === wallet?.accountType
}

export function identityMatchesWallet(identity, { circleUserId, wallet }) {
  return !!identity &&
    identity.circleUserId === circleUserId &&
    identity.status === IDENTITY_STATUS.ACTIVE &&
    sameWallet(identity, wallet)
}

/**
 * Register the Circle subject and the exact Circle wallet it owns.
 *
 * Registration is idempotent for the same canonical identity. Wallet fields
 * are immutable: a later login cannot silently move a Circle user to another
 * wallet or chain.
 */
export async function registerTrancheIdentity({
  circleUserId,
  walletId,
  walletAddress,
  blockchain,
  accountType,
  status = IDENTITY_STATUS.ACTIVE
}, { now = Date.now(), source = 'signup' } = {}) {
  const identity = {
    circleUserId: required(circleUserId, 'Circle user ID'),
    walletId: required(walletId, 'wallet ID'),
    walletAddress: required(walletAddress, 'wallet address'),
    blockchain: required(blockchain, 'blockchain'),
    accountType: required(accountType, 'account type'),
    status: required(status, 'status'),
  }
  const existing = await readTrancheIdentity(identity.circleUserId)

  if (existing) {
    if (!sameWallet(existing, identity) || existing.status !== identity.status) {
      throw new IdentityRegistryError(
        'This Circle wallet does not match its canonical Tranche identity.',
        409,
        'TRANCHE_IDENTITY_CONFLICT'
      )
    }
    return existing
  }

  const record = {
    version: 1,
    ...identity,
    source: required(source, 'source'),
    createdAt: now,
    updatedAt: now
  }
  await kv.set(identityKey(record.circleUserId), record)
  return record
}

// Existing server sessions were minted only after Circle user/wallet
// validation. They are therefore the safest migration source available to a
// stateless serverless deployment. Backfill is intentionally idempotent and
// never changes an existing record.
export async function backfillIdentityFromSession(session) {
  if (!session?.circleUserId || !session?.walletId || !session?.walletAddress) return null
  return registerTrancheIdentity({
    circleUserId: session.circleUserId,
    walletId: session.walletId,
    walletAddress: session.walletAddress,
    blockchain: session.blockchain,
    accountType: session.accountType
  }, { source: 'session-backfill' })
}

export function identityStorageKeyForTest(circleUserId) {
  return identityKey(circleUserId)
}
