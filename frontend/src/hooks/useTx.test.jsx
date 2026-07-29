// Dispatch tests for the one write path both wallet types share.
//
// The value here is proving that the SAME call — tx.run(escrowWrite(fn, args)),
// exactly as the ~25 untouched call sites make it — reaches the correct
// signing mechanism for whichever way the user signed in, and that neither
// path leaks into the other. That is the property that makes "payer and
// freelancer independently pick either wallet type" true.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const authMock = vi.hoisted(() => ({ current: null }))
const writeContractAsync = vi.hoisted(() => vi.fn())
const switchChainAsync = vi.hoisted(() => vi.fn())
const accountMock = vi.hoisted(() => ({ current: { chainId: 5042002 } }))

// Partial mock: config/wagmi.js runs createConfig at import time (useTx pulls
// it in via config/contract.js), so the real module still has to be there.
vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal()),
  useWriteContract: () => ({ writeContractAsync }),
  useSwitchChain: () => ({ switchChainAsync }),
  useAccount: () => accountMock.current,
  // Receipt never resolves during these tests; we're asserting how a hash is
  // obtained, not what happens after one exists.
  useWaitForTransactionReceipt: () => ({ data: undefined, isError: false, error: null })
}))

vi.mock('./useAuth.jsx', () => ({ useAuth: () => authMock.current }))

vi.mock('./useToast.jsx', () => ({
  txToast: () => ({ update: vi.fn(), success: vi.fn(), error: vi.fn() })
}))

const { useTx, escrowWrite } = await import('./useTx.js')

const ARGS = escrowWrite('claimDelivery', [1n, 0n])

beforeEach(() => {
  writeContractAsync.mockReset()
  switchChainAsync.mockReset()
  accountMock.current = { chainId: 5042002 }
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => vi.unstubAllGlobals())

function asEoa() {
  authMock.current = { isSca: false, executeContractCall: vi.fn() }
  return authMock.current
}

function asSca({ challengeId = 'chal-1' } = {}) {
  authMock.current = {
    isSca: true,
    executeContractCall: vi.fn().mockResolvedValue({ challengeId, userToken: 'tok' })
  }
  return authMock.current
}

describe('useTx — EOA (connected wallet)', () => {
  it('signs through wagmi and never calls the Circle route', async () => {
    const auth = asEoa()
    writeContractAsync.mockResolvedValue('0xEOAHASH')

    const { result } = renderHook(() => useTx())
    let hash
    await act(async () => { hash = await result.current.run(ARGS) })

    expect(hash).toBe('0xEOAHASH')
    expect(writeContractAsync).toHaveBeenCalledWith(ARGS)
    expect(auth.executeContractCall).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('still prompts an Arc network switch when the wallet is elsewhere', async () => {
    asEoa()
    accountMock.current = { chainId: 1 }
    writeContractAsync.mockResolvedValue('0xEOAHASH')

    const { result } = renderHook(() => useTx())
    await act(async () => { await result.current.run(ARGS) })

    expect(switchChainAsync).toHaveBeenCalledWith({ chainId: 5042002 })
  })
})

describe('useTx — Circle SCA (email sign-in)', () => {
  it('goes through Circle and never touches wagmi writeContract', async () => {
    const auth = asSca()
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ txHash: '0xSCAHASH', done: true, failed: false })
    })

    const { result } = renderHook(() => useTx())
    let hash
    await act(async () => { hash = await result.current.run(ARGS) })

    expect(hash).toBe('0xSCAHASH')
    expect(auth.executeContractCall).toHaveBeenCalledWith(ARGS)
    expect(writeContractAsync).not.toHaveBeenCalled()
  })

  // An SCA user has no injected connector, so useAccount().chainId is
  // undefined for them. Running the switch would prompt a wallet that isn't
  // there and fail every write — hence the SCA branch sits ahead of it.
  it('never attempts a network switch, even with no chainId', async () => {
    asSca()
    accountMock.current = { chainId: undefined }
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ txHash: '0xSCAHASH', done: true, failed: false })
    })

    const { result } = renderHook(() => useTx())
    await act(async () => { await result.current.run(ARGS) })

    expect(switchChainAsync).not.toHaveBeenCalled()
  })

  it('polls until Circle reports a hash', async () => {
    asSca()
    globalThis.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ txHash: null, done: false, failed: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ txHash: '0xLATE', done: true, failed: false }) })

    const { result } = renderHook(() => useTx())
    let hash
    await act(async () => { hash = await result.current.run(ARGS) })

    expect(hash).toBe('0xLATE')
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('surfaces a Circle-reported failure instead of hanging', async () => {
    asSca()
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ txHash: null, done: true, failed: true, errorReason: 'INSUFFICIENT_FUNDS' })
    })

    const { result } = renderHook(() => useTx())
    await act(async () => {
      await expect(result.current.run(ARGS)).rejects.toThrow('INSUFFICIENT_FUNDS')
    })
    await waitFor(() => expect(result.current.status).toBe('error'))
  })

  it('fails clearly when the Circle session has gone', async () => {
    authMock.current = { isSca: true, executeContractCall: vi.fn().mockResolvedValue(null) }

    const { result } = renderHook(() => useTx())
    await act(async () => {
      await expect(result.current.run(ARGS)).rejects.toThrow(/sign in again/i)
    })
  })
})
