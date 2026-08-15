import { describe, it, expect } from 'vitest'
import { createTransactionAction, InvalidTransactionActionError } from './action.js'
import { getConfirmMode } from './mode.js'

const ADDRESS = '0x2222222222222222222222222222222222222222'
const request = {
  address: ADDRESS,
  abi: [{
    type: 'function', name: 'pause', stateMutability: 'nonpayable', inputs: [], outputs: []
  }],
  functionName: 'pause',
  args: []
}
const descriptor = {
  title: 'Pause deposits',
  subtitle: 'Stops new deposits.',
  contractName: 'Tranche Protocol Escrow',
  contractAddress: ADDRESS,
  functionName: 'pause',
  parameters: ['Protocol-wide']
}

describe('UCW confirmation mode', () => {
  it('allows only circle and compare, with native and unknown values failing closed', () => {
    expect(getConfirmMode('circle')).toBe('circle')
    expect(getConfirmMode('compare')).toBe('compare')
    expect(getConfirmMode('native')).toBe('circle')
    expect(getConfirmMode('anything-else')).toBe('circle')
  })
})

describe('canonical Circle transaction action', () => {
  it('deep-freezes the request, descriptor, chain, and action', () => {
    const action = createTransactionAction({ request, descriptor })
    expect(Object.isFrozen(action)).toBe(true)
    expect(Object.isFrozen(action.request)).toBe(true)
    expect(Object.isFrozen(action.request.abi[0])).toBe(true)
    expect(Object.isFrozen(action.descriptor)).toBe(true)
    expect(Object.isFrozen(action.descriptor.parameters)).toBe(true)
    expect(Object.isFrozen(action.chain)).toBe(true)
    expect(action.callData).toMatch(/^0x8456cb59$/)
    expect(() => action.request.args.push(1n)).toThrow(TypeError)
    expect(() => { action.descriptor.title = 'Changed' }).toThrow(TypeError)
  })

  it('does not allow caller mutation to change the reviewed request or digest', () => {
    const callerRequest = { ...request, args: [] }
    const callerDescriptor = { ...descriptor, parameters: ['Before'] }
    const action = createTransactionAction({ request: callerRequest, descriptor: callerDescriptor })
    const digest = action.digest
    callerRequest.args.push(1n)
    callerDescriptor.parameters[0] = 'After'
    expect(action.request.args).toEqual([])
    expect(action.descriptor.parameters).toEqual(['Before'])
    expect(action.digest).toBe(digest)
  })

  it('fails closed for a missing or mismatched descriptor before any challenge boundary', () => {
    expect(() => createTransactionAction({ request, descriptor: null }))
      .toThrow(InvalidTransactionActionError)
    expect(() => createTransactionAction({
      request,
      descriptor: { ...descriptor, functionName: 'unpause' }
    })).toThrow(/does not match/i)
  })
})
