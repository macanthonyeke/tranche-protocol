// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const store = vi.hoisted(() => new Map())

vi.mock('./redis.js', () => ({
  kv: {
    get: async (key) => (store.has(key) ? structuredClone(store.get(key)) : null),
    set: async (key, value) => { store.set(key, structuredClone(value)); return 'OK' },
    del: async (key) => { store.delete(key); return 1 }
  }
}))

const {
  IDENTITY_MODES,
  IDENTITY_STATUS,
  getIdentityMode,
  readTrancheIdentity,
  registerTrancheIdentity,
  backfillIdentityFromSession,
  identityMatchesWallet,
  identityStorageKeyForTest,
  IdentityRegistryError
} = await import('./identityRegistry.js')

const IDENTITY = {
  circleUserId: 'circle-user-1',
  walletId: 'wallet-1',
  walletAddress: '0x1111111111111111111111111111111111111111',
  blockchain: 'ARC-TESTNET',
  accountType: 'SCA'
}

beforeEach(() => {
  store.clear()
  vi.unstubAllEnvs()
})

afterEach(() => vi.unstubAllEnvs())

describe('canonical Tranche identity registry', () => {
  it('stores the Circle subject and immutable wallet fields', async () => {
    const record = await registerTrancheIdentity(IDENTITY, { now: 1_000, source: 'signup' })

    expect(record).toMatchObject({
      version: 1,
      ...IDENTITY,
      status: IDENTITY_STATUS.ACTIVE,
      source: 'signup',
      createdAt: 1_000,
      updatedAt: 1_000
    })
    expect(await readTrancheIdentity(IDENTITY.circleUserId)).toEqual(record)
    expect(store.get(identityStorageKeyForTest(IDENTITY.circleUserId))).toEqual(record)
  })

  it('is idempotent for the same wallet and rejects a wallet change', async () => {
    const first = await registerTrancheIdentity(IDENTITY, { now: 1_000 })
    const second = await registerTrancheIdentity(IDENTITY, { now: 2_000 })
    expect(second).toEqual(first)

    await expect(registerTrancheIdentity({
      ...IDENTITY,
      walletId: 'wallet-attacker',
      walletAddress: '0x2222222222222222222222222222222222222222'
    })).rejects.toMatchObject({
      status: 409,
      code: 'TRANCHE_IDENTITY_CONFLICT'
    })
    await expect(registerTrancheIdentity({ ...IDENTITY, walletId: 'wallet-attacker' }))
      .rejects.toBeInstanceOf(IdentityRegistryError)
  })

  it('matches only an active canonical identity and its exact wallet tuple', async () => {
    const record = await registerTrancheIdentity(IDENTITY)
    expect(identityMatchesWallet(record, { circleUserId: IDENTITY.circleUserId, wallet: IDENTITY })).toBe(true)
    expect(identityMatchesWallet(record, {
      circleUserId: IDENTITY.circleUserId,
      wallet: { ...IDENTITY, walletAddress: IDENTITY.walletAddress.toUpperCase() }
    })).toBe(true)
    expect(identityMatchesWallet(record, {
      circleUserId: 'other-user', wallet: IDENTITY
    })).toBe(false)
    expect(identityMatchesWallet(record, {
      circleUserId: IDENTITY.circleUserId,
      wallet: { ...IDENTITY, accountType: 'EOA' }
    })).toBe(false)
  })

  it('backfills a valid existing server session without changing it later', async () => {
    const record = await backfillIdentityFromSession({
      ...IDENTITY,
      issuedAt: 1_000,
      lastSeenAt: 1_000
    })
    expect(record.source).toBe('session-backfill')
    expect(await backfillIdentityFromSession({
      ...IDENTITY,
      issuedAt: 2_000,
      lastSeenAt: 2_000
    })).toEqual(record)
  })

  it('defaults to migration-safe dual-write and recognizes strict mode', () => {
    expect(getIdentityMode('unknown')).toBe(IDENTITY_MODES.DUAL_WRITE)
    expect(getIdentityMode()).toBe(IDENTITY_MODES.DUAL_WRITE)
    expect(getIdentityMode('strict')).toBe(IDENTITY_MODES.STRICT)
    expect(getIdentityMode('shadow')).toBe(IDENTITY_MODES.SHADOW)
  })
})
