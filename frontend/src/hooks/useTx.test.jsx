import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const authMock = vi.hoisted(() => ({ current: null }))
const writeContractAsync = vi.hoisted(() => vi.fn())
const switchChainAsync = vi.hoisted(() => vi.fn())
const accountMock = vi.hoisted(() => ({ current: { chainId: 5042002 } }))

vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal()),
  useWriteContract: () => ({ writeContractAsync }),
  useSwitchChain: () => ({ switchChainAsync }),
  useAccount: () => accountMock.current,
  useWaitForTransactionReceipt: () => ({ data: undefined, isError: false, error: null })
}))

vi.mock('./useAuth.jsx', () => ({ useAuth: () => authMock.current }))
vi.mock('./useToast.jsx', () => ({
  txToast: () => ({ update: vi.fn(), success: vi.fn(), error: vi.fn() })
}))

const { useTx, escrowWrite } = await import('./useTx.js')
const { CONTRACT_ADDRESS } = await import('../config/contract.js')
const {
  useTransactionConfirm,
  __resetConfirmationForTests
} = await import('./useTransactionConfirm.js')

const REQUEST = escrowWrite('claimDelivery', [1n, 0n])
const DESCRIPTOR = {
  title: 'Claim delivery',
  subtitle: 'Claims the milestone.',
  contractName: 'Tranche Protocol Escrow',
  contractAddress: CONTRACT_ADDRESS,
  functionName: 'claimDelivery',
  parameters: ['Escrow #1', 'Milestone 1']
}
const ACTION_INPUT = { request: REQUEST, descriptor: DESCRIPTOR }

beforeEach(() => {
  writeContractAsync.mockReset()
  switchChainAsync.mockReset()
  accountMock.current = { chainId: 5042002 }
  globalThis.fetch = vi.fn()
  vi.stubEnv('VITE_UCW_CONFIRM_MODE', 'circle')
  __resetConfirmationForTests()
})

afterEach(() => {
  __resetConfirmationForTests()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function asEoa() {
  authMock.current = { isSca: false, address: '0x1111111111111111111111111111111111111111', executeContractCall: vi.fn() }
  return authMock.current
}

function asSca({ challengeId = 'chal-1' } = {}) {
  authMock.current = {
    isSca: true,
    address: '0x1111111111111111111111111111111111111111',
    walletId: 'wallet-1',
    executeContractCall: vi.fn().mockResolvedValue({ challengeId, userToken: 'test-token' })
  }
  return authMock.current
}

function hashResponse(hash = '0xSCAHASH') {
  globalThis.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ txHash: hash, done: true, failed: false })
  })
}

describe('useTx — EOA (connected wallet)', () => {
  it('keeps the raw request on wagmi and never calls the Circle path', async () => {
    const auth = asEoa()
    writeContractAsync.mockResolvedValue('0xEOAHASH')

    const { result } = renderHook(() => useTx())
    let hash
    await act(async () => { hash = await result.current.run(ACTION_INPUT) })

    expect(hash).toBe('0xEOAHASH')
    expect(writeContractAsync).toHaveBeenCalledWith(REQUEST)
    expect(auth.executeContractCall).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('still prompts an Arc network switch when the wallet is elsewhere', async () => {
    asEoa()
    accountMock.current = { chainId: 1 }
    writeContractAsync.mockResolvedValue('0xEOAHASH')

    const { result } = renderHook(() => useTx())
    await act(async () => { await result.current.run(ACTION_INPUT) })

    expect(switchChainAsync).toHaveBeenCalledWith({ chainId: 5042002 })
  })
})

describe('useTx — Circle SCA (email sign-in)', () => {
  it('creates one frozen action and reaches Circle only in the default circle mode', async () => {
    const auth = asSca()
    hashResponse()

    const { result } = renderHook(() => useTx())
    let hash
    await act(async () => { hash = await result.current.run(ACTION_INPUT) })

    expect(hash).toBe('0xSCAHASH')
    expect(auth.executeContractCall).toHaveBeenCalledTimes(1)
    const [action, options] = auth.executeContractCall.mock.calls[0]
    expect(Object.isFrozen(action)).toBe(true)
    expect(Object.isFrozen(action.request)).toBe(true)
    expect(action.request).toEqual(REQUEST)
    expect(action.descriptor).toEqual(expect.objectContaining(DESCRIPTOR))
    expect(options.lease.actionDigest).toBe(action.digest)
    expect(writeContractAsync).not.toHaveBeenCalled()
  })

  it('does not create a challenge when the descriptor is missing', async () => {
    const auth = asSca()
    const { result } = renderHook(() => useTx())

    await act(async () => {
      await expect(result.current.run(REQUEST)).rejects.toThrow(/confirmation is unavailable/i)
    })
    expect(auth.executeContractCall).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('shows no API activity before compare continuation, then preserves the Circle path', async () => {
    vi.stubEnv('VITE_UCW_CONFIRM_MODE', 'compare')
    const auth = asSca()
    hashResponse('0xCOMPARE')
    const { result } = renderHook(() => useTx())
    const { result: coordinator } = renderHook(() => useTransactionConfirm())

    let pending
    act(() => { pending = result.current.run(ACTION_INPUT) })
    expect(auth.executeContractCall).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()

    act(() => { coordinator.current.continueConfirmation() })
    await expect(pending).resolves.toBe('0xCOMPARE')
    expect(auth.executeContractCall).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('never attempts a network switch, even with no chainId', async () => {
    asSca()
    accountMock.current = { chainId: undefined }
    hashResponse()

    const { result } = renderHook(() => useTx())
    await act(async () => { await result.current.run(ACTION_INPUT) })

    expect(switchChainAsync).not.toHaveBeenCalled()
  })

  it('polls until Circle reports a hash', async () => {
    asSca()
    globalThis.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ txHash: null, done: false, failed: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ txHash: '0xLATE', done: true, failed: false }) })

    const { result } = renderHook(() => useTx())
    let hash
    await act(async () => { hash = await result.current.run(ACTION_INPUT) })

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
      await expect(result.current.run(ACTION_INPUT)).rejects.toThrow('INSUFFICIENT_FUNDS')
    })
    await waitFor(() => expect(result.current.status).toBe('error'))
  })

  it('fails clearly when the Circle session has gone', async () => {
    authMock.current = {
      isSca: true,
      address: '0x1111111111111111111111111111111111111111',
      walletId: 'wallet-1',
      executeContractCall: vi.fn().mockResolvedValue(null)
    }

    const { result } = renderHook(() => useTx())
    await act(async () => {
      await expect(result.current.run(ACTION_INPUT)).rejects.toThrow(/sign in again/i)
    })
  })
})
