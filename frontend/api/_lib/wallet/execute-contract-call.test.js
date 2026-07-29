// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const circleMock = vi.hoisted(() => ({
  createUserTransactionContractExecutionChallenge: vi.fn()
}))

vi.mock('../circle.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCircleClient: () => circleMock
}))

const handler = (await import('./execute-contract-call.js')).default

function invoke(body, method = 'POST') {
  const res = {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v },
    status(c) { this.statusCode = c; return this },
    json(p) { this.payload = p; return this }
  }
  return handler({ method, body }, res).then(() => res)
}

const VALID = {
  userToken: 'tok',
  walletId: 'wallet-1',
  contractAddress: '0xCONTRACT',
  callData: '0xdeadbeef'
}

beforeEach(() => {
  circleMock.createUserTransactionContractExecutionChallenge.mockReset()
  circleMock.createUserTransactionContractExecutionChallenge.mockResolvedValue({
    data: { challengeId: 'chal-1' }
  })
})

describe('POST /api/wallet/execute-contract-call', () => {
  it('forwards calldata to Circle unmodified and returns the challenge', async () => {
    const res = await invoke(VALID)

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ challengeId: 'chal-1' })

    const sent = circleMock.createUserTransactionContractExecutionChallenge.mock.calls[0][0]
    // Byte-for-byte: this calldata was encoded by viem from the same ABI and
    // args the wagmi path uses, so an SCA user's transaction is identical to
    // an EOA user's. Re-encoding anywhere in between is the bug this guards.
    expect(sent.callData).toBe('0xdeadbeef')
    expect(sent.contractAddress).toBe('0xCONTRACT')
    expect(sent.walletId).toBe('wallet-1')
    expect(sent.userToken).toBe('tok')
  })

  it('never sends abi fields alongside calldata', async () => {
    await invoke({ ...VALID, abiFunctionSignature: 'deposit(uint256)', abiParameters: ['1'] })

    const sent = circleMock.createUserTransactionContractExecutionChallenge.mock.calls[0][0]
    // Circle rejects the pair outright, and silently preferring the ABI form
    // would re-encode arguments Circle's JSON types cannot represent
    // faithfully (bytes32 mintRecipients, uint256 beyond 2^53).
    expect(sent.callData).toBe('0xdeadbeef')
    expect(sent).not.toHaveProperty('abiFunctionSignature')
    expect(sent).not.toHaveProperty('abiParameters')
  })

  it('always attaches a fee configuration', async () => {
    await invoke(VALID)
    const sent = circleMock.createUserTransactionContractExecutionChallenge.mock.calls[0][0]
    expect(sent.fee).toEqual({ type: 'level', config: { feeLevel: 'MEDIUM' } })
  })

  it('accepts the abi form when no calldata is given', async () => {
    await invoke({
      userToken: 'tok',
      walletId: 'wallet-1',
      contractAddress: '0xCONTRACT',
      abiFunctionSignature: 'pause()',
      abiParameters: []
    })

    const sent = circleMock.createUserTransactionContractExecutionChallenge.mock.calls[0][0]
    expect(sent.abiFunctionSignature).toBe('pause()')
    expect(sent).not.toHaveProperty('callData')
  })

  it('rejects malformed calldata rather than passing it through', async () => {
    for (const bad of ['deadbeef', '0xabc', '0xzz']) {
      const res = await invoke({ ...VALID, callData: bad })
      expect(res.statusCode).toBe(400)
    }
    expect(circleMock.createUserTransactionContractExecutionChallenge).not.toHaveBeenCalled()
  })

  it('rejects a request carrying neither calldata nor an abi signature', async () => {
    const { callData, ...withoutCallData } = VALID
    const res = await invoke(withoutCallData)
    expect(res.statusCode).toBe(400)
  })

  it('requires userToken, walletId and contractAddress', async () => {
    for (const field of ['userToken', 'walletId', 'contractAddress']) {
      const body = { ...VALID }
      delete body[field]
      expect((await invoke(body)).statusCode).toBe(400)
    }
  })

  it('surfaces a missing challenge as an error rather than a success', async () => {
    circleMock.createUserTransactionContractExecutionChallenge.mockResolvedValue({ data: {} })
    const res = await invoke(VALID)
    expect(res.statusCode).toBe(502)
  })

  it('rejects non-POST', async () => {
    const res = await invoke({}, 'GET')
    expect(res.statusCode).toBe(405)
  })
})
