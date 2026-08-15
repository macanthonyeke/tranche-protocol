import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, renderHook, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'

import {
  TransactionConfirmHost,
  TransactionConfirmNavigationGuard,
  useTransactionConfirm,
  __resetConfirmationForTests
} from './useTransactionConfirm.js'
import { createTransactionAction } from '../confirm/action.js'

const ADDRESS = '0x2222222222222222222222222222222222222222'
const REQUEST = {
  address: ADDRESS,
  abi: [{
    type: 'function', name: 'claimDelivery', stateMutability: 'nonpayable',
    inputs: [{ name: 'escrowId', type: 'uint256' }, { name: 'milestone', type: 'uint256' }],
    outputs: []
  }],
  functionName: 'claimDelivery',
  args: [1n, 0n]
}
const DESCRIPTOR = {
  title: 'Claim delivery',
  subtitle: 'Claims this milestone.',
  contractName: 'Tranche Protocol Escrow',
  contractAddress: ADDRESS,
  functionName: 'claimDelivery',
  parameters: ['Escrow #1', 'Milestone 1']
}
const ACTION = createTransactionAction({ request: REQUEST, descriptor: DESCRIPTOR })

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

afterEach(() => __resetConfirmationForTests())

describe('live Circle confirmation coordinator', () => {
  it('cancelling the Tranche review makes no executor/API call', async () => {
    const executor = vi.fn()
    const { result } = renderHook(() => useTransactionConfirm())
    let pending
    act(() => { pending = result.current.run(ACTION, executor, { mode: 'compare' }) })

    expect(executor).not.toHaveBeenCalled()
    act(() => { expect(result.current.cancelConfirmation()).toBe(true) })
    await expect(pending).rejects.toThrow('Transaction cancelled.')
    expect(executor).not.toHaveBeenCalled()
  })

  it('cancels a still-reviewing action when the route navigates', async () => {
    function NavigateAway() {
      const navigate = useNavigate()
      return <button type="button" onClick={() => navigate('/next')}>Navigate away</button>
    }

    const executor = vi.fn()
    const { result } = renderHook(() => useTransactionConfirm())
    render(
      <MemoryRouter initialEntries={['/current']}>
        <TransactionConfirmNavigationGuard />
        <NavigateAway />
      </MemoryRouter>
    )
    let pending
    act(() => { pending = result.current.run(ACTION, executor, { mode: 'compare' }) })

    fireEvent.click(screen.getByRole('button', { name: 'Navigate away' }))
    await expect(pending).rejects.toThrow('Transaction cancelled.')
    expect(executor).not.toHaveBeenCalled()
  })

  it('only exposes the final continuation button through the global host', async () => {
    const executor = vi.fn().mockResolvedValue('submitted')
    const { result } = renderHook(() => useTransactionConfirm())
    render(<TransactionConfirmHost />)

    let pending
    act(() => { pending = result.current.run(ACTION, executor, { mode: 'compare' }) })
    expect(screen.getByRole('button', { name: 'Continue to Circle confirmation' })).toBeTruthy()
    expect(executor).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Circle confirmation' }))
    await expect(pending).resolves.toBe('submitted')
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('rejects a double continuation and executes exactly once', async () => {
    const gate = deferred()
    const executor = vi.fn().mockReturnValue(gate.promise)
    const { result } = renderHook(() => useTransactionConfirm())
    let pending
    act(() => { pending = result.current.run(ACTION, executor, { mode: 'compare' }) })

    let first, second
    act(() => {
      first = result.current.continueConfirmation()
      second = result.current.continueConfirmation()
    })
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(executor).toHaveBeenCalledTimes(1)

    await act(async () => { gate.resolve('done'); await pending })
  })

  it('rejects a second Circle action across hook instances instead of queueing it', async () => {
    const gate = deferred()
    const firstExecutor = vi.fn().mockReturnValue(gate.promise)
    const secondExecutor = vi.fn()
    const { result: first } = renderHook(() => useTransactionConfirm())
    const { result: second } = renderHook(() => useTransactionConfirm())

    let firstPending, secondPending
    act(() => {
      firstPending = first.current.run(ACTION, firstExecutor, { mode: 'compare' })
      secondPending = second.current.run(ACTION, secondExecutor, { mode: 'compare' })
    })
    await expect(secondPending).rejects.toThrow('Another Circle transaction is already awaiting confirmation.')
    expect(secondExecutor).not.toHaveBeenCalled()

    act(() => { first.current.continueConfirmation() })
    await act(async () => { gate.resolve('done'); await firstPending })
  })

  it('keeps CreateEscrow approval and deposit as two explicit compare actions', async () => {
    const approveRequest = {
      ...REQUEST,
      functionName: 'approve',
      abi: [{
        type: 'function', name: 'approve', stateMutability: 'nonpayable',
        inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: []
      }],
      args: [ADDRESS, 250000000n]
    }
    const depositRequest = {
      ...REQUEST,
      functionName: 'deposit',
      abi: [{
        type: 'function', name: 'deposit', stateMutability: 'nonpayable',
        inputs: [{ name: 'recipient', type: 'address' }], outputs: []
      }],
      args: [ADDRESS]
    }
    const approve = createTransactionAction({
      request: approveRequest,
      descriptor: { ...DESCRIPTOR, title: 'Allow Tranche to move this USDC', functionName: 'approve', parameters: ['Amount: 250.00 USDC'] }
    })
    const deposit = createTransactionAction({
      request: depositRequest,
      descriptor: { ...DESCRIPTOR, title: 'Sign and lock', functionName: 'deposit', parameters: ['Escrow deposit'] }
    })
    const approveExecutor = vi.fn().mockResolvedValue('approval-hash')
    const depositExecutor = vi.fn().mockResolvedValue('deposit-hash')
    const { result } = renderHook(() => useTransactionConfirm())

    let approvalPending
    act(() => { approvalPending = result.current.run(approve, approveExecutor, { mode: 'compare' }) })
    expect(approveExecutor).not.toHaveBeenCalled()
    act(() => { result.current.continueConfirmation() })
    await expect(approvalPending).resolves.toBe('approval-hash')

    let depositPending
    act(() => { depositPending = result.current.run(deposit, depositExecutor, { mode: 'compare' }) })
    expect(depositExecutor).not.toHaveBeenCalled()
    act(() => { result.current.continueConfirmation() })
    await expect(depositPending).resolves.toBe('deposit-hash')
    expect(approveExecutor).toHaveBeenCalledTimes(1)
    expect(depositExecutor).toHaveBeenCalledTimes(1)
  })
})
