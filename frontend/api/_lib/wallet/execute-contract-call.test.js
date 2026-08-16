// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const circleMock = vi.hoisted(() => ({
  createUserTransactionContractExecutionChallenge: vi.fn(),
  getUserStatus: vi.fn()
}))
const store = vi.hoisted(() => new Map())

vi.mock('../redis.js', () => ({
  kv: {
    get: async (key) => (store.has(key) ? structuredClone(store.get(key)) : null),
    set: async (key, value) => { store.set(key, structuredClone(value)); return 'OK' },
    del: async (key) => { store.delete(key); return 1 }
  }
}))

vi.mock('../circle.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCircleClient: () => circleMock
}))

const handler = (await import('./execute-contract-call.js')).default
const { createAuthSession } = await import('../authSession.js')

let cookie

function invoke(body, method = 'POST') {
  const res = {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v },
    status(c) { this.statusCode = c; return this },
    json(p) { this.payload = p; return this }
  }
  return handler({ method, headers: { cookie }, body }, res).then(() => res)
}

const VALID = {
  userToken: 'tok',
  walletId: 'attacker-supplied-wallet-is-ignored',
  contractAddress: '0xCONTRACT',
  callData: '0xdeadbeef'
}

beforeEach(() => {
  store.clear()
  circleMock.getUserStatus.mockReset()
  circleMock.getUserStatus.mockResolvedValue({ data: { id: 'circle-user-1' } })
  circleMock.createUserTransactionContractExecutionChallenge.mockReset()
  circleMock.createUserTransactionContractExecutionChallenge.mockResolvedValue({
    data: { challengeId: 'chal-1' }
  })
  return createAuthSession({
    circleUserId: 'circle-user-1',
    walletId: 'wallet-1',
    walletAddress: '0x1111111111111111111111111111111111111111',
    blockchain: 'ARC-TESTNET',
    accountType: 'SCA'
  }).then(({ token }) => { cookie = `tranche_session=${token}` })
})

describe('POST /api/wallet/execute-contract-call', () => {
  it('requires the server session and forwards calldata with the session wallet', async () => {
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

  it('requires userToken and contractAddress, while ignoring a client wallet ID', async () => {
    for (const field of ['userToken', 'contractAddress']) {
      const body = { ...VALID }
      delete body[field]
      expect((await invoke(body)).statusCode).toBe(400)
    }
    expect((await invoke({ ...VALID, walletId: '' })).statusCode).toBe(200)
  })

  it('rejects a missing server session before creating a Circle challenge', async () => {
    const saved = cookie
    cookie = ''
    const res = await invoke(VALID)
    cookie = saved

    expect(res.statusCode).toBe(401)
    expect(circleMock.createUserTransactionContractExecutionChallenge).not.toHaveBeenCalled()
  })

  it('rejects a Circle token belonging to a different session user', async () => {
    circleMock.getUserStatus.mockResolvedValue({ data: { id: 'different-user' } })

    const res = await invoke(VALID)

    expect(res.statusCode).toBe(401)
    expect(circleMock.createUserTransactionContractExecutionChallenge).not.toHaveBeenCalled()
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
