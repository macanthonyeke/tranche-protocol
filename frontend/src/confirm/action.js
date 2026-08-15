import { isAddress, keccak256, toBytes, encodeFunctionData } from 'viem'

// Keep the action module independent of wagmi's browser connector setup. This
// is the chain every existing Circle SCA write targets; useTx still imports
// the full wagmi chain for EOA switching.
const ARC_TESTNET_ID = 5042002
const ARC_TESTNET_NAME = 'Arc Testnet'

/** Error raised before a Circle challenge can be created. */
export class InvalidTransactionActionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'InvalidTransactionActionError'
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/* Clone before freezing. Freezing a caller-owned request in place would make
   the confirmation boundary surprising to every existing EOA caller. The
   production requests are JSON-shaped plus bigint values, so preserving
   those primitives is enough and also makes the clone deterministic. */
function clone(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) throw new InvalidTransactionActionError('Circle action contains a cyclic value.')
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new InvalidTransactionActionError('Circle action contains an unsupported value.')
  }

  seen.add(value)
  const result = Array.isArray(value)
    ? value.map((entry) => clone(entry, seen))
    : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry, seen)]))
  seen.delete(value)
  return result
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

/* A small canonical serializer. JSON.stringify cannot represent bigint and
   object insertion order must not change an action digest. The resulting
   bytes cover both the exact request and the exact calldata sent to Circle. */
export function stableStringify(value) {
  if (value === null) return 'null'
  if (value === undefined) return '"$undefined"'
  if (typeof value === 'bigint') return `{"$bigint":"${value.toString()}"}`
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InvalidTransactionActionError('Circle action contains a non-finite number.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  throw new InvalidTransactionActionError('Circle action contains an unsupported value.')
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidTransactionActionError(`Circle action is missing ${label}.`)
  }
  return value
}

function validateDescriptor(descriptor, request) {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new InvalidTransactionActionError('Circle transaction confirmation is unavailable.')
  }

  for (const field of ['title', 'subtitle', 'contractName', 'contractAddress', 'functionName']) {
    requireString(descriptor[field], `descriptor.${field}`)
  }
  if (!isAddress(descriptor.contractAddress)) {
    throw new InvalidTransactionActionError('Circle transaction confirmation has an invalid contract address.')
  }
  if (!Array.isArray(descriptor.parameters) || descriptor.parameters.some((item) => typeof item !== 'string')) {
    throw new InvalidTransactionActionError('Circle transaction confirmation has invalid parameters.')
  }
  if (descriptor.amount !== undefined &&
    !((typeof descriptor.amount === 'bigint') ||
      (typeof descriptor.amount === 'number' && Number.isFinite(descriptor.amount)))) {
    throw new InvalidTransactionActionError('Circle transaction confirmation has an invalid amount.')
  }
  if (descriptor.amountLabel !== undefined) requireString(descriptor.amountLabel, 'descriptor.amountLabel')
  if (descriptor.contractAddress.toLowerCase() !== request.address.toLowerCase()) {
    throw new InvalidTransactionActionError('Circle descriptor contract does not match the transaction request.')
  }
  if (descriptor.functionName !== request.functionName) {
    throw new InvalidTransactionActionError('Circle descriptor function does not match the transaction request.')
  }
}

function validateRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new InvalidTransactionActionError('Circle transaction request is missing.')
  }
  if (!isAddress(request.address)) {
    throw new InvalidTransactionActionError('Circle transaction request has an invalid contract address.')
  }
  if (!Array.isArray(request.abi) || request.abi.length === 0) {
    throw new InvalidTransactionActionError('Circle transaction request is missing an ABI.')
  }
  requireString(request.functionName, 'request.functionName')
  if (!Array.isArray(request.args)) {
    throw new InvalidTransactionActionError('Circle transaction request is missing arguments.')
  }
}

/**
 * Build the one object that both the Tranche review and Circle submission use.
 * The caller's request/descriptor are cloned, frozen recursively, and never
 * reconstructed after this function returns.
 */
export function createTransactionAction({ request, descriptor, walletAddress = null, walletId = null } = {}) {
  validateRequest(request)
  validateDescriptor(descriptor, request)
  if (walletAddress !== null && walletAddress !== undefined && !isAddress(walletAddress)) {
    throw new InvalidTransactionActionError('Circle action has an invalid wallet address.')
  }
  if (walletId !== null && walletId !== undefined &&
    (typeof walletId !== 'string' || walletId.trim() === '')) {
    throw new InvalidTransactionActionError('Circle action has an invalid wallet identifier.')
  }

  let callData
  try {
    callData = encodeFunctionData({
      abi: request.abi,
      functionName: request.functionName,
      args: request.args
    })
  } catch (error) {
    throw new InvalidTransactionActionError(`Circle transaction calldata is invalid: ${error.message}`)
  }

  const frozenRequest = clone(request)
  const frozenDescriptor = clone({
    ...descriptor,
    chain: { id: ARC_TESTNET_ID, name: ARC_TESTNET_NAME }
  })
  const digestPayload = {
    chainId: ARC_TESTNET_ID,
    request: frozenRequest,
    callData
  }
  const digest = keccak256(toBytes(stableStringify(digestPayload)))

  return deepFreeze({
    version: 1,
    digest,
    chain: { id: ARC_TESTNET_ID, name: ARC_TESTNET_NAME },
    walletAddress: walletAddress ?? null,
    walletId: walletId ?? null,
    request: frozenRequest,
    callData,
    descriptor: frozenDescriptor
  })
}

export function isTransactionAction(value) {
  return !!value && Object.isFrozen(value) &&
    typeof value.digest === 'string' &&
    Object.isFrozen(value.request) &&
    Object.isFrozen(value.descriptor) &&
    value.chain?.id === ARC_TESTNET_ID
}
