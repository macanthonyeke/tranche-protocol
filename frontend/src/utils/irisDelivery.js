import { encodeFunctionData } from 'viem'

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
export async function fetchIrisMessages(txHash) {
  const res = await fetch(`${IRIS_BASE}/v2/messages/${txHash}`)
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
