import { encodeFunctionData, decodeEventLog, slice } from 'viem'
import { ARC_DOMAIN } from '../config/chains.js'
import { bytes32ToAddress } from './encode.js'

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

// Round 22 Phase B: useCctpDelivery polls this every 15s (POLL_MS) on a
// fixed interval regardless of whether the previous call has resolved yet,
// and Codex directly observed real calls sometimes taking over a minute
// from their environment — several polling ticks' worth. Unlike
// fetchForwardFee's FEE_QUOTE_TIMEOUT_MS (8s), this isn't gating a
// pre-signature UI where a slow response blocks the user from signing; it's
// a background status poll, so there's no tight UX budget to protect. The
// risk here is the opposite one: a timeout too close to the fee endpoint's
// 8s would abort genuinely slow-but-succeeding responses routinely, given
// they're observed running past a minute. 90s gives real responses ample
// margin above the observed worst case while still bounding a truly-dead
// request so it can't hold the in-flight guard below open forever.
const IRIS_MESSAGES_TIMEOUT_MS = 90_000

// In-flight guard, keyed by the exact request identity (sourceDomain +
// txHash). Without this, a slow response (see above) doesn't stop the next
// 15s timer tick from firing a second, overlapping request for the SAME
// tracked tx — a poll for one escrow's tx never blocks a concurrent poll
// for a different one, only a re-poll of itself while still pending.
const inFlightRequests = new Map()

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
export function fetchIrisMessages(txHash, sourceDomain = ARC_DOMAIN) {
  const key = `${sourceDomain}:${txHash}`
  const existing = inFlightRequests.get(key)
  if (existing) return existing

  const request = fetchIrisMessagesNow(txHash, sourceDomain).finally(() => {
    inFlightRequests.delete(key)
  })
  inFlightRequests.set(key, request)
  return request
}

async function fetchIrisMessagesNow(txHash, sourceDomain) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), IRIS_MESSAGES_TIMEOUT_MS)
  let json
  try {
    const res = await fetch(
      `${IRIS_BASE}/v2/messages/${sourceDomain}?transactionHash=${txHash}`,
      { signal: controller.signal }
    )
    if (res.status === 404) return []
    if (!res.ok) throw new Error(`Iris HTTP ${res.status}`)
    json = await res.json()
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Iris delivery status request timed out. Please try again.')
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
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

// Circle's MessageTransmitterV2 event, emitted whenever a CCTP message is
// actually created — a single non-indexed `bytes` parameter, nothing else.
// Signature and shape verified live: decoded a real Arc-testnet
// depositForBurnWithHook receipt (hookData "cctp-forward") and found this
// event at address 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275 — Arc's own
// (source-side) MessageTransmitterV2, a DIFFERENT contract than both
// TokenMessenger (which emits DepositForBurn, not this) and the
// destination-side MESSAGE_TRANSMITTER_V2 addresses in config/chains.js
// (used for self-relay `receiveMessage` on the OTHER end). The topic0 was
// independently confirmed to equal keccak256("MessageSent(bytes)").
const MESSAGE_SENT_ABI = [
  {
    name: 'MessageSent',
    type: 'event',
    inputs: [{ name: 'message', type: 'bytes', indexed: false }],
    anonymous: false
  }
]

/* Round 22 Phase A. Ground truth for "did a CCTP message actually get
   created", the question none of claimDelivery succeeding, refundAfterDeadline
   succeeding, or MutualSettlementExecuted firing actually answers —
   claimDelivery and refundAfterDeadline never touch CCTP at all regardless of
   the escrow's configured domain, and a mutualSettle/resolveDispute call can
   execute while every leg still rounds to zero or diverts to an Arc credit,
   emitting no CCTP message despite genuinely executing.

   Decodes EVERY log in the confirmed receipt against MESSAGE_SENT_ABI rather
   than filtering by a hardcoded contract address first — deliberately, since
   a same-contract-address filter (the pattern mutualSettlementExecuted uses
   for this contract's OWN events) doesn't apply to an event a DIFFERENT
   contract emits, and MessageSent's topic0 is Circle's own canonical event
   signature hash, unique enough that a false match from an unrelated log is
   not a realistic risk — this also means it keeps working if Circle ever
   redeploys the MessageTransmitterV2 proxy to a new address, the same
   caution CLAUDE.md already documents for the TokenMessenger proxy.

   A single call can emit MORE than one MessageSent — a mixed split can burn
   several legs to different chains in one transaction (bounded by
   MAX_SPLITS = 10) — so this returns the real count alongside the boolean,
   for callers to persist as the expected message count (see
   useCctpDelivery's own comment for why that matters). */
export function receiptEmittedCctpMessage(receipt) {
  let count = 0
  for (const log of receipt.logs) {
    try {
      const dec = decodeEventLog({ abi: MESSAGE_SENT_ABI, data: log.data, topics: log.topics })
      if (dec.eventName === 'MessageSent') count++
    } catch {}
  }
  return { emitted: count > 0, count }
}

/* Round 25. Decodes the `messageSender` field out of a raw CCTP message —
   the address that called depositForBurn (or, per Circle's own CCTP V2
   technical guide's naming, depositForBurnWithCaller/depositForBurnWithHook
   family) on the source domain. Verified against Circle's documented V2
   message format (developers.circle.com/cctp/references/technical-guide):
   the top-level message header's `messageBody` field starts at absolute
   byte offset 148; BurnMessageV2's own `messageSender` field sits at
   relative offset 100 within that body (absolute 248), a 32-byte word —
   confirmed identically via two independent fetches of Circle's docs.
   TrancheProtocol.sol calls tokenMessenger.depositForBurnWithHook(...)
   directly from _approveAndBurn — no intermediary contract — so for every
   burn THIS contract makes, msg.sender to TokenMessenger (and therefore
   messageSender in the resulting message) is always this contract's own
   address. */
export function messageSenderOf(message) {
  return bytes32ToAddress(slice(message, 248, 280))
}

/* Round 25. receiptEmittedCctpMessage answers "did a CCTP message get
   created anywhere in this receipt" — deliberately unscoped by contract
   address (see that function's own doc comment: robust to a future
   MessageTransmitterV2 redeploy). Correct for the three original write
   sites (MilestoneAction/DisputeBlock/SettlementPanel): each receipt there
   is this device's own tx.run(escrowWrite(...)) call — a single top-level
   call to OUR contract's own function, so nothing else could have burned
   inside it. NOT correct for FallbackCrossChainDelivery: release() is
   fully permissionless, so a batching/multicall contract can compose
   several calls — potentially to a DIFFERENT TrancheProtocol instance, or
   a direct Circle depositForBurn call entirely outside this app — into one
   transaction sharing a tx hash this app's own indexer may still see.
   milestoneCctpLogRange's log-index boundaries (EscrowDetail.jsx) only
   answer "which of THIS contract's own calls", never "is this message even
   from this contract's burn at all" — a foreign burn with no recognized
   boundary around it would fall inside whatever range it happens to land
   in. This is the second, orthogonal filter: only count a MessageSent
   log whose OWN decoded messageSender is this contract's address. */
export function receiptEmittedOwnCctpMessage(receipt, ownAddress) {
  const own = ownAddress.toLowerCase()
  const ownLogs = receipt.logs.filter((log) => {
    try {
      const dec = decodeEventLog({ abi: MESSAGE_SENT_ABI, data: log.data, topics: log.topics })
      return dec.eventName === 'MessageSent' && messageSenderOf(dec.args.message).toLowerCase() === own
    } catch {
      return false
    }
  })
  return receiptEmittedCctpMessage({ ...receipt, logs: ownLogs })
}
