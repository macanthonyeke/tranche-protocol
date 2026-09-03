// @vitest-environment node

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildCanaryPlan,
  decodeCanaryBatch,
  encodeExecuteBatch,
  runCanaryPreflight,
  validateCanaryPlan,
  CANARY_AMOUNT,
  CANARY_DESTINATION_DOMAIN,
  CANARY_INVOICE_DATA,
  CANARY_INVOICE_HASH,
  CANARY_INVOICE_URI,
  CANARY_REF_ID,
  CANARY_REVIEW_WINDOW,
  GAS_RESERVE_ERC20_6,
  GAS_RESERVE_NATIVE_18,
  SUPPORTED_SCA_CORES,
  USDC_ADDRESS
} from './canary.js'

const WALLET = '0x1111111111111111111111111111111111111111'
const TRANCHE = '0x6bf5e723b5a542b8d49bedab7c8eb2791af00d3d'
const NOW = 1_780_000_000

function fakePublicClient({ balance = 2_000_000n, native = 200_000_000_000_000_000n, allowance = 0n } = {}) {
  return {
    getCode: vi.fn().mockResolvedValue('0x6001600155'),
    getStorageAt: vi.fn().mockResolvedValue(`0x${'00'.repeat(32)}`),
    getBalance: vi.fn().mockResolvedValue(native),
    getTransactionReceipt: vi.fn().mockRejectedValue(new Error('not available in unit test')),
    readContract: vi.fn(({ functionName }) => {
      if (functionName === 'decimals') return Promise.resolve(6)
      if (functionName === 'balanceOf') return Promise.resolve(balance)
      if (functionName === 'allowance') return Promise.resolve(allowance)
      throw new Error(`unexpected read ${functionName}`)
    })
  }
}

function fakeCircle({ scaCore = 'circle_6900_singleowner_v3', accountType = 'SCA' } = {}) {
  const wallet = { id: 'wallet-canary-1', address: WALLET, blockchain: 'ARC-TESTNET', state: 'LIVE', accountType, scaCore }
  return {
    wallet,
    listWallets: vi.fn(async (input) => {
      if (!input.scaCore) return { data: { wallets: [wallet] } }
      return { data: { wallets: input.scaCore === scaCore ? [wallet] : [] } }
    }),
    estimateContractExecutionFee: vi.fn().mockResolvedValue({
      data: {
        medium: { gasLimit: '500000', networkFee: '1000000000000000' },
        callGasLimit: '400000',
        verificationGasLimit: '100000',
        preVerificationGas: '50000'
      }
    })
  }
}

beforeEach(() => {
  vi.stubEnv('VITE_CONTRACT_ADDRESS', TRANCHE)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('UCW canary calldata', () => {
  it('encodes exactly two ordered calls: exact approve, then exact deposit', () => {
    const plan = buildCanaryPlan(WALLET, { now: NOW, idempotencyKey: '00000000-0000-4000-8000-000000000001', contractAddress: TRANCHE })
    const validation = validateCanaryPlan(plan, WALLET, TRANCHE)
    const decoded = decodeCanaryBatch(plan.callData)

    expect(validation.pass).toBe(true)
    expect(decoded.functionName).toBe('executeBatch')
    expect(decoded.calls).toHaveLength(2)
    expect(decoded.calls[0].functionName).toBe('approve')
    expect(decoded.calls[0].target.toLowerCase()).toBe(USDC_ADDRESS.toLowerCase())
    expect(decoded.calls[0].args[0].toLowerCase()).toBe(TRANCHE.toLowerCase())
    expect(decoded.calls[0].args[1]).toBe(CANARY_AMOUNT.toString())
    expect(decoded.calls[1].functionName).toBe('deposit')
    expect(decoded.calls[1].target.toLowerCase()).toBe(TRANCHE.toLowerCase())
    expect(decoded.calls[1].args[0]).toBe(WALLET)
    expect(decoded.calls[1].args[1]).toBe(WALLET)
    expect(decoded.calls[1].args[2]).toBe(CANARY_AMOUNT.toString())
    expect(decoded.calls[1].args[3]).toBe(String(CANARY_DESTINATION_DOMAIN))
    expect(decoded.calls[1].args[4]).toBe(`0x${WALLET.slice(2).padStart(64, '0')}`)
    expect(decoded.calls[1].args[5]).toBe(CANARY_REVIEW_WINDOW.toString())
    expect(decoded.calls[1].args[6]).toBe(CANARY_INVOICE_HASH)
    expect(decoded.calls[1].args[7]).toBe(CANARY_INVOICE_URI)
    expect(decoded.calls[1].args[8]).toEqual([CANARY_AMOUNT.toString()])
    expect(decoded.calls[1].args[9]).toBe(String(NOW + 7 * 24 * 60 * 60))
    expect(decoded.calls[1].args[10]).toEqual([])
    expect(decoded.calls[1].args[11]).toBe(CANARY_INVOICE_DATA)
    expect(plan.refId).toBe(CANARY_REF_ID)
    expect(plan.actionDigest).toMatch(/^0x[0-9a-f]{64}$/)
    expect(plan.payload).not.toHaveProperty('policyId')
  })

  it('fails validation when the exact approval amount is changed', () => {
    const plan = buildCanaryPlan(WALLET, { now: NOW, contractAddress: TRANCHE })
    const alteredApprovalData = `${plan.innerCalls[0].data.slice(0, -64)}${'0'.repeat(59)}f4241`
    const altered = {
      ...plan,
      callData: encodeExecuteBatch([
        { ...plan.innerCalls[0], data: alteredApprovalData },
        plan.innerCalls[1]
      ])
    }
    const validation = validateCanaryPlan(altered, WALLET, TRANCHE)
    expect(validation.pass).toBe(false)
    expect(validation.checks.find((check) => check.id === 'approval-amount-exact').pass).toBe(false)
  })
})

describe('UCW canary identity and read-only gates', () => {
  it('requires an exact supported scaCore match from the public wallet filter', async () => {
    const circle = fakeCircle({ scaCore: 'circle_6900_singleowner_v3' })
    const report = await runCanaryPreflight({ circle, publicClient: fakePublicClient(), userToken: 'opaque', now: NOW })

    expect(report.wallet.accountType).toBe('SCA')
    expect(report.wallet.scaCore).toBe('circle_6900_singleowner_v3')
    expect(circle.listWallets).toHaveBeenCalledWith(expect.objectContaining({ scaCore: 'circle_6900_singleowner_v3' }))
    expect(circle.estimateContractExecutionFee).toHaveBeenCalledWith(expect.objectContaining({
      contractAddress: WALLET,
      callData: report.payload.callData,
      amount: '0',
      source: { walletId: 'wallet-canary-1' }
    }))
    expect(report.payload.walletId).toBe('wallet-canary-1')
    expect(report.gasStation.feeEstimate.feeLevels.medium.gasLimit).toBe('500000')
    expect(report.status).toBe('NOT EXECUTED')
    expect(report.gates.find((gate) => gate.id === 'payload-encoding').pass).toBe(true)
  })

  it('fails closed when scaCore metadata is missing from all public filters', async () => {
    const circle = fakeCircle({ scaCore: null })
    const report = await runCanaryPreflight({ circle, publicClient: fakePublicClient(), userToken: 'opaque', now: NOW })

    expect(report.wallet.scaCore).toBeNull()
    expect(report.payload).toBeNull()
    expect(report.gates.find((gate) => gate.id === 'wallet-sca-core').pass).toBe(false)
    expect(report.pass).toBe(false)
  })

  it('fails closed when Circle reports an unsupported scaCore', async () => {
    const circle = fakeCircle({ scaCore: 'circle_future_core' })
    const report = await runCanaryPreflight({ circle, publicClient: fakePublicClient(), userToken: 'opaque', now: NOW })

    expect(report.wallet.scaCore).toBeNull()
    expect(report.gates.find((gate) => gate.id === 'wallet-sca-core').detail).toMatch(/unsupported|missing/i)
    expect(SUPPORTED_SCA_CORES).not.toContain('circle_future_core')
  })

  it('does not treat the generic legacy 4337 core as SingleOwnerMSCA-compatible', async () => {
    const circle = fakeCircle({ scaCore: 'circle_4337_v1' })
    const report = await runCanaryPreflight({ circle, publicClient: fakePublicClient(), userToken: 'opaque', now: NOW })

    expect(report.wallet.scaCore).toBeNull()
    expect(report.payload).toBeNull()
    expect(SUPPORTED_SCA_CORES).not.toContain('circle_4337_v1')
  })

  it('requires both the ERC-20 principal reserve and native 18-decimal gas reserve', async () => {
    const circle = fakeCircle()
    const report = await runCanaryPreflight({
      circle,
      publicClient: fakePublicClient({ balance: CANARY_AMOUNT + GAS_RESERVE_ERC20_6 - 1n, native: GAS_RESERVE_NATIVE_18 - 1n }),
      userToken: 'opaque',
      now: NOW
    })

    expect(report.gates.find((gate) => gate.id === 'erc20-principal-and-buffer').pass).toBe(false)
    expect(report.gates.find((gate) => gate.id === 'native-gas-reserve').pass).toBe(false)
  })
})
