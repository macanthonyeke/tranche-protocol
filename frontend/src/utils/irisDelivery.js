import { encodeFunctionData } from 'viem'
import { ARC_DOMAIN } from '../config/chains.js'

const IRIS_BASE = import.meta.env.VITE_IRIS_API_BASE || 'https://iris-api-sandbox.circle.com'

const RECEIVE_MESSAGE_ABI = [
  {
    name: 'receiveMessage',
    type: 'function',
    inputs: [
      { name: 'message',     type: 'bytes' },
      { name: 'attestation', type: 'bytes' }
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable'
  }
]

// localStorage key for a single cross-chain release tx.
export const cctpTrackKey = (escrowId, milestoneIndex) =>
  `cctp-track-${escrowId}-${milestoneIndex}`

// Fetch all CCTP messages emitted in a source transaction.
// Returns [] if not yet indexed (404 → empty, not an error).
//
// Round 21 Phase A: GET /v2/messages/{txHash} (no domain, no query param) was
// never a valid request shape — verified live against Circle's sandbox,
// which responds 400 "params.srcDomainId: Too big... query: At least one of
// transactionHash or nonce must be provided" for exactly this URL. The real
// endpoint is GET /v2/messages/{sourceDomainId}?transactionHash={txHash} —
// confirmed against real captured responses for actual Arc-testnet burns,
// including a genuine depositForBurnWithHook call (hookData decodes to
// "cctp-forward", the same hook this contract uses). Every tracked burn in
// this app originates from Arc, so sourceDomain defaults to ARC_DOMAIN.
export async function fetchIrisMessages(txHash, sourceDomain = ARC_DOMAIN) {
  const res = await fetch(`${IRIS_BASE}/v2/messages/${sourceDomain}?transactionHash=${txHash}`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`Iris HTTP ${res.status}`)
  const json = await res.json()
  return json?.messages || []
}

// Encode `receiveMessage(message, attestation)` calldata for the destination
// chain's MessageTransmitterV2. Both args are raw hex strings from the Iris response.
export function encodeReceiveMessage(message, attestation) {
  return encodeFunctionData({
    abi: RECEIVE_MESSAGE_ABI,
    functionName: 'receiveMessage',
    args: [message, attestation]
  })
}
