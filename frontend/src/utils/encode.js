import { pad, keccak256, toBytes } from 'viem'

// CRITICAL: CCTP requires mintRecipient as bytes32 (left-padded address)
// Never pass a raw address — the burn succeeds but mint silently fails
export const encodeAsMintRecipient = (address) =>
  pad(address, { size: 32 })

// Plain-string twin of the on-chain `addressToBytes32` helper. Same byte layout
// as `encodeAsMintRecipient`, kept separate so call-sites that pass an EVM
// address (not a bytes32) read explicitly as such.
export const addressToBytes32 = (address) =>
  '0x' + address.slice(2).padStart(64, '0')

// Decode a bytes32 mint recipient back into a 20-byte EVM address. Used by the
// EscrowDetail page to display the current receiving address.
export const bytes32ToAddress = (b32) =>
  '0x' + b32.slice(-40)

export const hashDescription = (text) =>
  keccak256(toBytes(text))

// Hash raw file bytes (Uint8Array from file.arrayBuffer()).
export const hashBytes = (bytes) => keccak256(bytes)

export const daysToSeconds = (days) => days * 86400
export const hoursToSeconds = (hours) => hours * 3600

// Convert a string USDC amount ("123.45") to base units bigint
export const usdcToBaseUnits = (amount) => {
  if (!amount) return 0n
  const [whole, fracRaw = ''] = String(amount).split('.')
  const frac = (fracRaw + '000000').slice(0, 6)
  return BigInt(whole || '0') * 1_000_000n + BigInt(frac || '0')
}

export const isValidBytes32 = (s) =>
  typeof s === 'string' && /^0x[a-fA-F0-9]{64}$/.test(s)
