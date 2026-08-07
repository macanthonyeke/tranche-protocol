// Session-lifetime tests for the Circle (email/UCW) half of useAuth.
//
// What matters here is the two-gate restore rule: a stored session is only
// resumed while it is inside BOTH the token's own life (SESSION_TTL_MS, 13
// days against Circle's measured 14) and the inactivity ceiling
// (INACTIVITY_CEILING_MS, 7 days). There is no refresh path, so every failure
// of either gate has to land the user back at a full OTP round trip — these
// tests are what stop that rule quietly loosening.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const accountMock = vi.hoisted(() => ({ current: { address: undefined, isConnected: false } }))
const disconnect = vi.hoisted(() => vi.fn())

// Full mock, not partial: useAuth.jsx imports 'wagmi' directly and never
// touches config/wagmi.js, so there is no createConfig side effect to preserve.
vi.mock('wagmi', () => ({
  useAccount: () => accountMock.current,
  useDisconnect: () => ({ disconnect })
}))

// Only reached by the executeContractCall test below; the restore tests never
// construct an SDK.
const executeSpy = vi.hoisted(() => vi.fn())
vi.mock('@circle-fin/w3s-pw-web-sdk', () => ({
  W3SSdk: class {
    getDeviceId() { return Promise.resolve('device-1') }
    setAuthentication() {}
    setLocalizations() {}
    setThemeColor() {}
    setResources() {}
    setCustomSecurityQuestions() {}
    execute(challengeId, onCompleted) {
      executeSpy(challengeId)
      onCompleted?.(undefined, { status: 'COMPLETE' })
    }
  }
}))

const { AuthProvider, useAuth } = await import('./useAuth.jsx')

const STORAGE_KEY = 'tranche.circleSession'
const ACTIVITY_KEY = 'tranche.circleActivity'
const DAY = 24 * 60 * 60 * 1000

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>

/** Seed a stored Circle session. Ages are in days ago. */
function seed({ issuedDaysAgo, activityDaysAgo }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    userToken: 'tok-1',
    encryptionKey: 'key-1',
    address: '0x1111111111111111111111111111111111111111',
    walletId: 'wallet-1',
    email: 'freelancer@example.com',
    issuedAt: Date.now() - issuedDaysAgo * DAY
  }))
  if (activityDaysAgo !== undefined) {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify({
      lastActivityAt: Date.now() - activityDaysAgo * DAY
    }))
  }
}

beforeEach(() => {
  localStorage.clear()
  disconnect.mockReset()
  executeSpy.mockReset()
  accountMock.current = { address: undefined, isConnected: false }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('session restore — the two gates', () => {
  it('resumes a session inside both the TTL and the ceiling', () => {
    seed({ issuedDaysAgo: 2, activityDaysAgo: 1 })

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isConnected).toBe(true)
    expect(result.current.walletType).toBe('circle-sca')
    expect(result.current.isSca).toBe(true)
    expect(result.current.email).toBe('freelancer@example.com')
  })

  // The ceiling is the boundary that actually bites: it is shorter than the
  // TTL, so in normal use it is what ends a session first.
  it('forces re-auth after the ceiling lapses, even well inside the TTL', () => {
    seed({ issuedDaysAgo: 10, activityDaysAgo: 8 })

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isConnected).toBe(false)
    expect(result.current.walletType).toBe(null)
    expect(result.current.address).toBeUndefined()
  })

  /* Continuous use past 13 days. The ceiling being shorter should make this
     unreachable in practice, but "unreachable" is an argument, not a
     guarantee — if the ceiling is ever lengthened past the TTL this is the
     only gate left, and Circle stops accepting the token at 14 days whatever
     we think. Tested directly rather than assumed away. */
  it('forces re-auth once the TTL lapses, however recent the activity', () => {
    seed({ issuedDaysAgo: 14, activityDaysAgo: 0 })

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isConnected).toBe(false)
    expect(result.current.walletType).toBe(null)
  })

  /* Deliberately discriminating: issuedAt is recent, only the ACTIVITY STAMP is
     stale. If readActivityAt ever silently returned null — wrong key, changed
     payload shape — the ceiling would fall back to issuedAt and this session
     would wrongly resume. The 10-days-issued case above cannot catch that,
     since its issuedAt is past the ceiling too. */
  it('reads the stored stamp, not just issuedAt, when deciding the ceiling', () => {
    seed({ issuedDaysAgo: 2, activityDaysAgo: 8 })

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isConnected).toBe(false)
  })

  /* A missing activity stamp falls back to issuedAt. This is the property that
     stops the fallback being a bypass: deleting the activity key must not
     revive a session, and measuring from issuedAt can only ever shorten the
     window. */
  it('measures the ceiling from issuedAt when no activity stamp exists', () => {
    seed({ issuedDaysAgo: 8 })   // no activity key at all

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isConnected).toBe(false)
  })

  it('still resumes a stamp-less session that is recent by issuedAt', () => {
    seed({ issuedDaysAgo: 2 })

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isConnected).toBe(true)
  })

  // Opening the app on a live session is itself activity — otherwise a user
  // who visits every few days without transacting would still be cut off at
  // seven days from their last write.
  it('stamps activity on app open with a restored session', async () => {
    seed({ issuedDaysAgo: 3, activityDaysAgo: 3 })

    renderHook(() => useAuth(), { wrapper })

    await waitFor(() => {
      const stamped = JSON.parse(localStorage.getItem(ACTIVITY_KEY)).lastActivityAt
      expect(Date.now() - stamped).toBeLessThan(5000)
    })
  })

  it('stamps nothing when there was no session to restore', () => {
    renderHook(() => useAuth(), { wrapper })
    expect(localStorage.getItem(ACTIVITY_KEY)).toBeNull()
  })
})

describe('activity on real use', () => {
  /* The stamp has to land on an approved transaction, or an active user gets
     logged out mid-project by the very ceiling meant to be generous to them. */
  it('stamps activity after a contract call is approved', async () => {
    vi.stubEnv('VITE_CIRCLE_APP_ID', 'app-1')
    seed({ issuedDaysAgo: 3, activityDaysAgo: 6 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ challengeId: 'chal-1' })
    }))

    const { result } = renderHook(() => useAuth(), { wrapper })
    // The app-open stamp fires first; take it out of the picture so what this
    // asserts is unambiguously the executeContractCall stamp.
    await waitFor(() => expect(localStorage.getItem(ACTIVITY_KEY)).not.toBeNull())
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify({ lastActivityAt: Date.now() - 6 * DAY }))

    await act(async () => {
      await result.current.executeContractCall({
        address: '0x2222222222222222222222222222222222222222',
        abi: [{ type: 'function', name: 'pause', inputs: [], outputs: [] }],
        functionName: 'pause',
        args: []
      })
    })

    expect(executeSpy).toHaveBeenCalledWith('chal-1')
    const stamped = JSON.parse(localStorage.getItem(ACTIVITY_KEY)).lastActivityAt
    expect(Date.now() - stamped).toBeLessThan(5000)
  })
})

describe('signOut', () => {
  // Logout has to be terminal. A session cleared while its activity stamp
  // survives is a half-state, and the stamp is exactly what the next restore
  // would consult.
  it('clears the session and the activity stamp together', async () => {
    seed({ issuedDaysAgo: 1, activityDaysAgo: 0 })

    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current.isConnected).toBe(true)

    await act(async () => { result.current.signOut() })

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(ACTIVITY_KEY)).toBeNull()
    expect(result.current.isConnected).toBe(false)
    expect(result.current.walletType).toBe(null)
  })

  it('disconnects an EOA on the way out', async () => {
    accountMock.current = { address: '0x3333333333333333333333333333333333333333', isConnected: true }

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => { result.current.signOut() })

    expect(disconnect).toHaveBeenCalled()
  })
})
