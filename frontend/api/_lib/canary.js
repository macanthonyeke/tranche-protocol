// Read-only Phase 2 UCW batch-canary harness.
//
// This module deliberately contains no Circle challenge or transaction
// submission call. It resolves the authenticated user's canonical Circle
// wallet, reads Arc state, and builds the exact calldata that a later,
// separately approved canary could submit.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import {
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  keccak256,
  toBytes
} from 'viem'

import { ARC_BLOCKCHAIN } from './circle.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TRANCHE_ABI_PATH = path.resolve(__dirname, '../../src/abi/TrancheProtocol.json')

export const CANARY_AMOUNT = 1_000_000n
export const ERC20_DECIMALS = 6
export const ARC_NATIVE_DECIMALS = 18
export const CANARY_REVIEW_WINDOW = 86_400n
export const CANARY_DESTINATION_DOMAIN = 26
export const CANARY_REF_ID = 'phase2-ucw-atomic-batch-canary-v1'
export const CANARY_INVOICE_SEED = 'tranche-ucw-atomic-batch-canary-v1'
export const CANARY_INVOICE_HASH = keccak256(toBytes(CANARY_INVOICE_SEED))
export const CANARY_INVOICE_URI = 'canary://tranche-ucw-batch-v1'
export const CANARY_INVOICE_DATA = 'canary'

// Explicit fallback reserve. It remains mandatory until sponsorship is
// proven for this exact UCW self-targeted executeBatch path.
export const GAS_RESERVE_NATIVE_18 = 100_000_000_000_000_000n // 0.10 native USDC
export const GAS_RESERVE_ERC20_6 = 100_000n // 0.10 ERC-20 USDC

export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000'
export const GAS_STATION_PAYMASTER = '0x7ceA357B5AC0639F89f9e378a1f03Aa5005C0a25'
export const PHASE1_TX_HASH = '0xe86f75a6e6c5d10cbce616787f714d1be65e5bacbc7cb11de7814852ef0cb245'
export const USER_OPERATION_EVENT_TOPIC = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f'
export const EIP1967_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'

export const SUPPORTED_SCA_CORES = [
  // These are the Circle SDK's explicitly named SingleOwnerMSCA cores. The
  // older circle_4337_v1 value is intentionally excluded: this harness does
  // not infer executeBatch compatibility from an address or generic SCA type.
  'circle_6900_singleowner_v1',
  'circle_6900_singleowner_v2',
  'circle_6900_singleowner_v3'
]

const SINGLE_OWNER_MSCA_ABI = [
  {
    type: 'function',
    name: 'executeBatch',
    stateMutability: 'payable',
    inputs: [{
      name: 'calls',
      type: 'tuple[]',
      components: [
        { name: 'target', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' }
      ]
    }],
    outputs: [{ name: 'returnData', type: 'bytes[]' }]
  }
]

const USDC_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }]
  }
]

const TRANCHE_ABI = JSON.parse(fs.readFileSync(TRANCHE_ABI_PATH, 'utf8'))
const DEPOSIT_ABI = TRANCHE_ABI.filter((item) => item.type === 'function' && item.name === 'deposit')

export const SINGLE_OWNER_MSCA_EXECUTE_BATCH_ABI = SINGLE_OWNER_MSCA_ABI

function configuredContractAddress() {
  const address = process.env.VITE_CONTRACT_ADDRESS
  if (!isAddress(address || '')) {
    throw new Error('VITE_CONTRACT_ADDRESS is not configured on the server.')
  }
  return getAddress(address)
}

export function isCanaryEnabled(env = process.env) {
  return env.NODE_ENV !== 'production' && env.UCW_CANARY_ENABLED === 'true'
}

function requireAddress(address, label) {
  if (!isAddress(address || '')) throw new Error(`${label} is not a valid address.`)
  return getAddress(address)
}

function requireCanonicalIdentity(identity) {
  if (!identity || typeof identity !== 'object') {
    throw new Error('Authenticated Tranche identity is required.')
  }
  for (const field of ['circleUserId', 'walletId', 'blockchain', 'accountType']) {
    if (typeof identity[field] !== 'string' || !identity[field].trim()) {
      throw new Error(`Authenticated Tranche identity ${field} is missing.`)
    }
  }
  return {
    circleUserId: identity.circleUserId.trim(),
    walletId: identity.walletId.trim(),
    walletAddress: requireAddress(identity.walletAddress, 'authenticated wallet address'),
    blockchain: identity.blockchain.trim(),
    accountType: identity.accountType.trim()
  }
}

function walletMatchesCanonicalIdentity(wallet, identity, address) {
  return wallet.id === identity.walletId &&
    address.toLowerCase() === identity.walletAddress.toLowerCase() &&
    wallet.blockchain === identity.blockchain &&
    wallet.accountType === identity.accountType
}

function hexWord(data, index) {
  const start = 2 + index * 64
  return data.slice(start, start + 64)
}

function asString(value) {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(asString)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, asString(item)]))
  }
  return value
}

function normalizeCall(call) {
  return {
    target: getAddress(call.target ?? call[0]),
    value: BigInt(call.value ?? call[1]),
    data: call.data ?? call[2]
  }
}

export function buildCanaryTerms(walletAddress, { now = Math.floor(Date.now() / 1000) } = {}) {
  const address = requireAddress(walletAddress, 'wallet address')
  const timestamp = Number(now)
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('now must be a positive Unix timestamp.')

  return {
    recipient: address,
    refundTo: address,
    totalAmount: CANARY_AMOUNT,
    destinationDomain: CANARY_DESTINATION_DOMAIN,
    mintRecipient: `0x${address.slice(2).padStart(64, '0')}`,
    reviewWindow: CANARY_REVIEW_WINDOW,
    invoiceHash: CANARY_INVOICE_HASH,
    invoiceURI: CANARY_INVOICE_URI,
    milestoneAmounts: [CANARY_AMOUNT],
    deadline: BigInt(timestamp + 7 * 24 * 60 * 60),
    splits: [],
    invoiceData: CANARY_INVOICE_DATA
  }
}

export function buildCanaryPlan(walletAddress, {
  now = Math.floor(Date.now() / 1000),
  idempotencyKey = randomUUID(),
  contractAddress = configuredContractAddress()
} = {}) {
  const outerTarget = requireAddress(walletAddress, 'wallet address')
  const tranche = requireAddress(contractAddress, 'Tranche contract address')
  const terms = buildCanaryTerms(outerTarget, { now })

  const approveData = encodeFunctionData({
    abi: USDC_ABI,
    functionName: 'approve',
    args: [tranche, CANARY_AMOUNT]
  })
  const depositData = encodeFunctionData({
    abi: DEPOSIT_ABI,
    functionName: 'deposit',
    args: [
      terms.recipient,
      terms.refundTo,
      terms.totalAmount,
      terms.destinationDomain,
      terms.mintRecipient,
      terms.reviewWindow,
      terms.invoiceHash,
      terms.invoiceURI,
      terms.milestoneAmounts,
      terms.deadline,
      terms.splits,
      terms.invoiceData
    ]
  })

  const innerCalls = [
    { target: getAddress(USDC_ADDRESS), value: 0n, data: approveData },
    { target: tranche, value: 0n, data: depositData }
  ]
  const callData = encodeExecuteBatch(innerCalls)

  return {
    refId: CANARY_REF_ID,
    proposedIdempotencyKey: idempotencyKey,
    outerTarget,
    contractAddress: tranche,
    actionDigest: keccak256(callData),
    callData,
    terms,
    innerCalls,
    payload: {
      walletId: null,
      contractAddress: outerTarget,
      refId: CANARY_REF_ID,
      idempotencyKey,
      callData,
      amount: '0',
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } }
    }
  }
}

export function encodeExecuteBatch(innerCalls) {
  return encodeFunctionData({
    abi: SINGLE_OWNER_MSCA_ABI,
    functionName: 'executeBatch',
    args: [innerCalls]
  })
}

export function decodeCanaryBatch(callData) {
  const outer = decodeFunctionData({ abi: SINGLE_OWNER_MSCA_ABI, data: callData })
  if (outer.functionName !== 'executeBatch') throw new Error('Expected executeBatch calldata.')

  const calls = (outer.args?.[0] ?? []).map(normalizeCall)
  const decodedCalls = calls.map((call) => {
    let decoded = null
    try {
      decoded = decodeFunctionData({ abi: USDC_ABI, data: call.data })
    } catch {
      try {
        decoded = decodeFunctionData({ abi: DEPOSIT_ABI, data: call.data })
      } catch {
        // Preserve the raw inner call for the failed gate; do not guess its ABI.
      }
    }
    return {
      target: call.target,
      value: call.value.toString(),
      data: call.data,
      functionName: decoded?.functionName ?? null,
      args: decoded ? asString(decoded.args) : null
    }
  })

  return {
    functionName: outer.functionName,
    calls: decodedCalls
  }
}

export function validateCanaryPlan(plan, walletAddress, contractAddress = configuredContractAddress()) {
  const wallet = requireAddress(walletAddress, 'wallet address')
  const tranche = requireAddress(contractAddress, 'Tranche contract address')
  const decoded = decodeCanaryBatch(plan.callData)
  const calls = decoded.calls
  const approveArgs = calls[0]?.args ?? []
  const depositArgs = calls[1]?.args ?? []

  const checks = [
    { id: 'outer-function', pass: decoded.functionName === 'executeBatch', detail: decoded.functionName },
    { id: 'two-inner-calls', pass: calls.length === 2, detail: `${calls.length} call(s)` },
    { id: 'approval-first', pass: calls[0]?.functionName === 'approve', detail: calls[0]?.functionName ?? 'missing' },
    { id: 'approval-target', pass: calls[0]?.target?.toLowerCase() === USDC_ADDRESS.toLowerCase(), detail: calls[0]?.target ?? 'missing' },
    { id: 'approval-value-zero', pass: calls[0]?.value === '0', detail: calls[0]?.value ?? 'missing' },
    { id: 'approval-spender-exact', pass: approveArgs[0]?.toLowerCase() === tranche.toLowerCase(), detail: approveArgs[0] ?? 'missing' },
    { id: 'approval-amount-exact', pass: approveArgs[1] === CANARY_AMOUNT.toString(), detail: approveArgs[1] ?? 'missing' },
    { id: 'deposit-second', pass: calls[1]?.functionName === 'deposit', detail: calls[1]?.functionName ?? 'missing' },
    { id: 'deposit-target', pass: calls[1]?.target?.toLowerCase() === tranche.toLowerCase(), detail: calls[1]?.target ?? 'missing' },
    { id: 'deposit-value-zero', pass: calls[1]?.value === '0', detail: calls[1]?.value ?? 'missing' },
    { id: 'deposit-recipient-exact', pass: depositArgs[0]?.toLowerCase() === wallet.toLowerCase(), detail: depositArgs[0] ?? 'missing' },
    { id: 'deposit-refund-exact', pass: depositArgs[1]?.toLowerCase() === wallet.toLowerCase(), detail: depositArgs[1] ?? 'missing' },
    { id: 'deposit-amount-exact', pass: depositArgs[2] === CANARY_AMOUNT.toString(), detail: depositArgs[2] ?? 'missing' },
    { id: 'deposit-domain-exact', pass: depositArgs[3] === String(CANARY_DESTINATION_DOMAIN), detail: depositArgs[3] ?? 'missing' },
    { id: 'deposit-mint-recipient-exact', pass: depositArgs[4]?.toLowerCase() === `0x${wallet.slice(2).padStart(64, '0')}`.toLowerCase(), detail: depositArgs[4] ?? 'missing' },
    { id: 'deposit-review-window-exact', pass: depositArgs[5] === CANARY_REVIEW_WINDOW.toString(), detail: depositArgs[5] ?? 'missing' },
    { id: 'deposit-invoice-hash-exact', pass: depositArgs[6]?.toLowerCase() === CANARY_INVOICE_HASH.toLowerCase(), detail: depositArgs[6] ?? 'missing' },
    { id: 'deposit-invoice-uri-exact', pass: depositArgs[7] === CANARY_INVOICE_URI, detail: depositArgs[7] ?? 'missing' },
    { id: 'deposit-milestones-exact', pass: JSON.stringify(depositArgs[8]) === JSON.stringify([CANARY_AMOUNT.toString()]), detail: depositArgs[8] ?? 'missing' },
    { id: 'deposit-deadline-exact', pass: depositArgs[9] === plan.terms?.deadline?.toString(), detail: depositArgs[9] ?? 'missing' },
    { id: 'deposit-splits-empty', pass: JSON.stringify(depositArgs[10]) === '[]', detail: depositArgs[10] ?? 'missing' },
    { id: 'deposit-invoice-data-exact', pass: depositArgs[11] === CANARY_INVOICE_DATA, detail: depositArgs[11] ?? 'missing' }
  ]

  return { pass: checks.every((check) => check.pass), checks, decoded }
}

export function createCanaryPublicClient() {
  const rpc = process.env.VITE_ARC_RPC_URL_ALCHEMY || 'https://rpc.testnet.arc.network'
  return createPublicClient({ transport: http(rpc) })
}

function readUint256(data, index) {
  const word = hexWord(data, index)
  return word ? BigInt(`0x${word}`) : null
}

export function decodeUserOperationEvents(receipt, { sender } = {}) {
  const expectedSender = sender?.toLowerCase()
  return (receipt?.logs ?? [])
    .filter((log) => log.topics?.[0]?.toLowerCase() === USER_OPERATION_EVENT_TOPIC.toLowerCase())
    .map((log) => ({
      userOpHash: log.topics[1],
      sender: `0x${log.topics[2]?.slice(-40)}`,
      paymaster: `0x${log.topics[3]?.slice(-40)}`,
      success: readUint256(log.data, 1) === 1n,
      actualGasCostNative18: readUint256(log.data, 2)?.toString() ?? null,
      actualGasUsed: readUint256(log.data, 3)?.toString() ?? null
    }))
    .filter((event) => !expectedSender || event.sender.toLowerCase() === expectedSender)
}

function passGate(id, label, pass, detail, critical = true) {
  return { id, label, pass: !!pass, detail: String(detail), critical }
}

function formatUsdc6(value) {
  const whole = value / 1_000_000n
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

function formatNative18(value) {
  const whole = value / 1_000_000_000_000_000_000n
  const fraction = (value % 1_000_000_000_000_000_000n).toString().padStart(18, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

async function readPriorGasStationEvidence(publicClient) {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: PHASE1_TX_HASH })
    const events = decodeUserOperationEvents(receipt)
    const sponsored = events.find((event) => event.paymaster.toLowerCase() === GAS_STATION_PAYMASTER.toLowerCase())
    return {
      available: true,
      txHash: PHASE1_TX_HASH,
      receiptStatus: receipt.status,
      userOperationCount: events.length,
      circlePaymasterMatched: !!sponsored,
      paymasterAddress: sponsored?.paymaster ?? null,
      actualGasCostNative18: sponsored?.actualGasCostNative18 ?? null,
      actualGasCostNativeUsdc: sponsored?.actualGasCostNative18
        ? formatNative18(BigInt(sponsored.actualGasCostNative18))
        : null
    }
  } catch {
    return {
      available: false,
      txHash: PHASE1_TX_HASH,
      receiptStatus: null,
      userOperationCount: null,
      circlePaymasterMatched: false,
      paymasterAddress: null,
      actualGasCostNative18: null,
      actualGasCostNativeUsdc: null
    }
  }
}

async function estimateContractExecutionFee(circle, userToken, walletId, contractAddress, callData) {
  try {
    const response = await circle.estimateContractExecutionFee({
      userToken,
      contractAddress,
      callData,
      amount: '0',
      source: { walletId }
    })
    const fee = response?.data ?? response ?? {}
    const level = (value) => value ? {
      gasLimit: value.gasLimit ?? null,
      gasPrice: value.gasPrice ?? null,
      maxFee: value.maxFee ?? null,
      priorityFee: value.priorityFee ?? null,
      baseFee: value.baseFee ?? null,
      networkFee: value.networkFee ?? null,
      networkFeeRaw: value.networkFeeRaw ?? null,
      l1Fee: value.l1Fee ?? null
    } : null
    const medium = level(fee.medium)
    return {
      available: true,
      feeLevel: 'MEDIUM',
      gasLimit: medium?.gasLimit ?? fee.gasLimit ?? null,
      networkFeeNative18: medium?.networkFee ?? fee.networkFee ?? null,
      feeLevels: {
        low: level(fee.low),
        medium,
        high: level(fee.high)
      },
      erc4337: {
        callGasLimit: fee.callGasLimit ?? null,
        verificationGasLimit: fee.verificationGasLimit ?? null,
        preVerificationGas: fee.preVerificationGas ?? null
      }
    }
  } catch (err) {
    return {
      available: false,
      gasLimit: null,
      networkFeeNative18: null,
      feeLevel: 'MEDIUM',
      feeLevels: null,
      erc4337: null,
      errorCode: err?.response?.data?.code ?? err?.code ?? null
    }
  }
}

async function resolveCanonicalWallet(circle, userToken) {
  const response = await circle.listWallets({ userToken, blockchain: ARC_BLOCKCHAIN })
  const wallets = response?.data?.wallets ?? []
  const live = wallets.filter((wallet) => wallet.state === 'LIVE' && wallet.address)
  if (live.length !== 1) {
    throw new Error(live.length === 0
      ? 'No live Arc wallet was found for this UCW session.'
      : 'More than one live Arc wallet was found; the canary requires one disposable wallet.')
  }
  return live[0]
}

async function resolveScaCore(circle, userToken, walletId, reportedScaCore) {
  if (reportedScaCore && !SUPPORTED_SCA_CORES.includes(reportedScaCore)) return null
  const matches = []
  await Promise.all(SUPPORTED_SCA_CORES.map(async (scaCore) => {
    try {
      const response = await circle.listWallets({ userToken, blockchain: ARC_BLOCKCHAIN, scaCore })
      const wallets = response?.data?.wallets ?? []
      if (wallets.some((wallet) => wallet.id === walletId)) matches.push(scaCore)
    } catch {
      // A failed public filter is not evidence of support. Fail closed below.
    }
  }))
  matches.sort()
  if (reportedScaCore && matches.length === 1 && matches[0] !== reportedScaCore) return null
  return matches.length === 1 ? matches[0] : null
}

function implementationFromStorage(value) {
  if (!value || /^0x0+$/.test(value)) return null
  return `0x${value.slice(-40)}`
}

export async function runCanaryPreflight({
  circle,
  publicClient = createCanaryPublicClient(),
  userToken,
  expectedIdentity,
  now = Math.floor(Date.now() / 1000),
  idempotencyKey = randomUUID()
}) {
  const identity = requireCanonicalIdentity(expectedIdentity)
  const wallet = await resolveCanonicalWallet(circle, userToken)
  const address = requireAddress(wallet.address, 'Circle wallet address')
  if (!walletMatchesCanonicalIdentity(wallet, identity, address)) {
    throw new Error('Circle wallet does not match the authenticated Tranche session.')
  }
  const contractAddress = configuredContractAddress()
  const scaCore = await resolveScaCore(circle, userToken, wallet.id, wallet.scaCore)
  const plan = scaCore ? buildCanaryPlan(address, { now, idempotencyKey, contractAddress }) : null

  const [code, implementationStorage, usdcDecimals, usdcBalance, nativeBalance, allowance, priorGasStation, gasEstimate] = await Promise.all([
    publicClient.getCode({ address }),
    publicClient.getStorageAt({ address, slot: EIP1967_IMPLEMENTATION_SLOT }),
    publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: 'decimals' }),
    publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: 'balanceOf', args: [address] }),
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: 'allowance', args: [address, contractAddress] }),
    readPriorGasStationEvidence(publicClient),
    plan ? estimateContractExecutionFee(circle, userToken, wallet.id, address, plan.callData) : Promise.resolve({ available: false, errorCode: 'SCA_CORE_UNRESOLVED' })
  ])

  const accountType = wallet.accountType ?? null
  const implementationAddress = implementationFromStorage(implementationStorage)
  const decoded = plan ? decodeCanaryBatch(plan.callData) : null
  const planValidation = plan ? validateCanaryPlan(plan, address, contractAddress) : { pass: false, checks: [], decoded: null }
  // The Phase 1 paymaster event proves only the old compare-mode path. It is
  // deliberately not evidence for this UCW self-targeted executeBatch path.
  const sponsorshipProven = false
  const requiredErc20 = CANARY_AMOUNT + GAS_RESERVE_ERC20_6

  const gates = [
    passGate('wallet-live', 'Circle wallet is LIVE', wallet.state === 'LIVE', wallet.state ?? 'missing'),
    passGate('wallet-account-type', 'Circle account type is SCA', accountType === 'SCA', accountType ?? 'missing'),
    passGate('wallet-sca-core', 'Circle scaCore is exactly one supported core', !!scaCore, scaCore ?? 'missing or unsupported'),
    passGate('wallet-code', 'SCA address has deployed code', !!code && code !== '0x', code ? `${code.slice(0, 12)}…` : 'no code'),
    passGate('usdc-decimals', 'ERC-20 USDC uses 6 decimals', Number(usdcDecimals) === ERC20_DECIMALS, String(usdcDecimals)),
    passGate('native-decimals', 'Arc native gas accounting uses 18 decimals', ARC_NATIVE_DECIMALS === 18, String(ARC_NATIVE_DECIMALS)),
    passGate('erc20-principal-and-buffer', 'ERC-20 balance covers 1 USDC plus explicit fallback reserve', BigInt(usdcBalance) >= requiredErc20, `${usdcBalance.toString()} >= ${requiredErc20.toString()} base units`),
    passGate('native-gas-reserve', 'Native Arc balance covers explicit fallback reserve', BigInt(nativeBalance) >= GAS_RESERVE_NATIVE_18, `${nativeBalance.toString()} >= ${GAS_RESERVE_NATIVE_18.toString()} native units`),
    passGate('allowance-zero', 'Current allowance to Tranche is zero', BigInt(allowance) === 0n, `${allowance.toString()} base units`),
    passGate('gas-station-exact-path', 'Gas Station sponsorship is proven for this exact UCW executeBatch path', sponsorshipProven, 'unconfirmed until this canary produces matching paymaster evidence', false),
    passGate('gas-estimate', 'Public Circle fee estimate is available for the exact self-target payload', !!gasEstimate.available, gasEstimate.available ? (gasEstimate.networkFeeNative18 ?? 'available') : `unavailable${gasEstimate.errorCode ? ` (${gasEstimate.errorCode})` : ''}`, false),
    passGate('payload-encoding', 'Exact two-call payload passes canonical validation', !!planValidation.pass, planValidation.pass ? 'approve then deposit' : 'missing or invalid scaCore prevents payload validation')
  ]

  return {
    status: 'NOT EXECUTED',
    generatedAt: new Date().toISOString(),
    identity: {
      source: 'authenticated Tranche session',
      circleUserId: identity.circleUserId,
      walletId: identity.walletId,
      walletAddress: identity.walletAddress,
      blockchain: identity.blockchain,
      accountType: identity.accountType,
      matchesSession: true
    },
    wallet: {
      id: wallet.id,
      address,
      blockchain: wallet.blockchain ?? ARC_BLOCKCHAIN,
      state: wallet.state ?? null,
      accountType,
      scaCore,
      implementationAddress
    },
    balances: {
      erc20: {
        tokenAddress: USDC_ADDRESS,
        decimals: ERC20_DECIMALS,
        balanceBaseUnits: BigInt(usdcBalance).toString(),
        balanceUsdc: formatUsdc6(BigInt(usdcBalance)),
        requiredBaseUnits: requiredErc20.toString()
      },
      native: {
        decimals: ARC_NATIVE_DECIMALS,
        balanceNative18: BigInt(nativeBalance).toString(),
        balanceUsdc: formatNative18(BigInt(nativeBalance)),
        requiredNative18: GAS_RESERVE_NATIVE_18.toString()
      },
      allowanceToTrancheBaseUnits: BigInt(allowance).toString()
    },
    gasStation: {
      gasPayer: 'unconfirmed',
      fallbackGasPayer: 'disposable SCA native Arc USDC',
      documentedArcTestnetSCA: true,
      exactPath: 'unproven',
      paymasterAddress: GAS_STATION_PAYMASTER,
      priorPhase1Evidence: priorGasStation,
      feeEstimate: gasEstimate
    },
    payload: plan ? {
      ...plan.payload,
      walletId: wallet.id,
      contractAddress: address,
      actionDigest: plan.actionDigest
    } : null,
    terms: plan ? asString(plan.terms) : null,
    innerCalls: plan ? plan.innerCalls.map((call) => ({ ...call, value: call.value.toString() })) : [],
    decodedExecuteBatch: decoded ? asString(decoded) : null,
    actionDigest: plan?.actionDigest ?? null,
    refId: CANARY_REF_ID,
    proposedIdempotencyKey: idempotencyKey,
    gates,
    // Keep the report reviewable, but never label it ready while any gate is
    // unresolved. In particular, exact-path sponsorship remains unproven until
    // an approved disposable-wallet canary produces matching paymaster evidence.
    pass: gates.every((gate) => gate.pass)
  }
}
