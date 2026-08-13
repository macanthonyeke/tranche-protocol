import { encodeFunctionData, decodeEventLog, slice, toEventSelector } from 'viem'
import { ARC_DOMAIN } from '../config/chains.js'
import { bytes32ToAddress } from './encode.js'
import { ESCROW_ABI, CONTRACT_ADDRESS } from '../config/contract.js'

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
//
// Round 29: namespaced by CONTRACT_ADDRESS, not just escrowId+milestoneIndex.
// Without this, a coherent-looking record left over from a PREVIOUS
// deployment (redeploys are routine in this repo — see CLAUDE.md's
// deployment history) would collide on the same key under a new contract
// whose escrow #7 milestone #1 is a completely unrelated escrow, and
// readCctpTrack's shape/coherence checks alone can't tell the difference —
// a garbage-but-well-shaped record would wrongly suppress
// FallbackCrossChainDelivery's receipt-reverifying fallback path.
// CONTRACT_ADDRESS alone is sufficient here, not CONTRACT_ADDRESS+chain: it
// is a single build-time env value (config/wagmi.js) — exactly one
// deployment is ever active per running app instance, and a redeploy always
// changes it, so it already uniquely identifies "this build's own contract"
// without a separate domain/chain component. The wallet's own connected
// chain is orthogonal — this key is about which TrancheProtocol instance
// the record belongs to, not which chain the signer happens to be on.
export const cctpTrackKey = (escrowId, milestoneIndex) =>
  `cctp-track-${CONTRACT_ADDRESS.toLowerCase()}-${escrowId}-${milestoneIndex}`

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
  // Round 30 (fixing the Round 29 review's Medium finding: "sourceTxHash
  // checked at the wrong response level"). Confirmed against Circle's real
  // GET /v2/messages API reference: sourceTxHash is a REQUIRED, non-nullable
  // field on the response ENVELOPE — "the source burn transaction hash,
  // shared by all messages in the response" — never duplicated on each
  // individual message object. Round 29's per-message filter below was
  // built against a shape that doesn't exist in a real response, so its
  // `typeof m.sourceTxHash !== 'string'` branch always took the permissive
  // "keep" path in production and never actually verified anything — the
  // exact substitution it was meant to catch (equal cardinality, wrong
  // membership) would have sailed through untouched. The real check has to
  // run once, against the envelope, before `messages` is trusted at all.
  //
  // An absent envelope field (should be unreachable per Circle's schema,
  // which marks it required) is treated as nothing to check — the same
  // permissive-when-structurally-absent convention already used elsewhere
  // in this codebase (irisMessageMatchesFingerprint's `fingerprint == null`,
  // useCctpDelivery's `expectedOrdinals == null`). A PRESENT mismatch
  // throws rather than silently returning [] — an empty array already means
  // something specific in this function ("not yet indexed", the 404 branch
  // above), and a wrong-transaction envelope is a categorically different,
  // more anomalous condition that deserves its own signal rather than
  // looking identical to "still indexing". useCctpDelivery's poll() already
  // catches any thrown error here, sets phase 'unavailable', and keeps
  // polling on the next tick — the same fail-closed, keep-retrying behavior
  // a mismatch here should get.
  if (typeof json?.sourceTxHash === 'string' && json.sourceTxHash.toLowerCase() !== txHash.toLowerCase()) {
    throw new Error('Iris response envelope sourceTxHash does not match the requested transaction')
  }

  const messages = json?.messages || []
  // Round 29: kept as a harmless, no-cost defensive extra, NOT the real
  // check (see the envelope-level check above, which is). Per Circle's real
  // schema confirmed above, individual messages never actually carry their
  // own sourceTxHash — so against a genuine response this filter's
  // `typeof m.sourceTxHash !== 'string'` branch always takes the "keep"
  // path and this loop is a no-op today. Left in only in case Circle ever
  // adds the field at this level too.
  return messages.filter(
    (m) => typeof m.sourceTxHash !== 'string' || m.sourceTxHash.toLowerCase() === txHash.toLowerCase()
  )
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

/* Round 25. Decodes the `messageSender` field out of a raw CCTP message
   BODY — the address that called depositForBurn (or, per Circle's own CCTP
   V2 technical guide's naming, depositForBurnWithCaller/
   depositForBurnWithHook family) on the source domain. Verified against
   Circle's documented V2 message format
   (developers.circle.com/cctp/references/technical-guide): the top-level
   message header's `messageBody` field starts at absolute byte offset 148;
   BurnMessageV2's own `messageSender` field sits at relative offset 100
   within that body (absolute 248), a 32-byte word — confirmed identically
   via two independent fetches of Circle's docs. TrancheProtocol.sol calls
   tokenMessenger.depositForBurnWithHook(...) directly from _approveAndBurn
   — no intermediary contract — so for every burn THIS contract makes,
   msg.sender to TokenMessenger (and therefore messageSender in the
   resulting message) is always this contract's own address.

   Round 26: this field ALONE is forgeable and must never be trusted in
   isolation — see verifiedOwnCctpMessage's own doc comment for the full
   authenticity chain this is now only one link of. */
export function messageSenderOf(message) {
  return bytes32ToAddress(slice(message, 248, 280))
}

/* Round 29. Three more fields off the same raw message, all from the
   IMMUTABLE half of CCTP V2's layout — none of nonce (header, byte 12-44),
   finalityThresholdExecuted (header, byte 144-148), feeExecuted (body,
   relative offset 164/absolute 312) or expirationBlock (body, relative
   offset 196/absolute 344), the four fields Round 27's own doc comment
   established DO mutate between the source-side log and Iris's attested
   response. Offsets confirmed against the same Circle V2 technical guide
   layout messageSenderOf and messageHeaderSenderOf already verify against:
   header's destinationDomain is a 4-byte uint32 at absolute offset 8 (right
   after the 4-byte version and 4-byte sourceDomain); BurnMessageV2's body
   starts at absolute 148, so burnToken (32 bytes), mintRecipient (32
   bytes), and amount (32 bytes) sit at 152, 184, and 216 respectively —
   immediately before messageSender's own already-verified 248 offset,
   which anchors this math to a value already confirmed correct. */
function destinationDomainOf(message) {
  return readUint32(message, 8)
}

function burnTokenOf(message) {
  return bytes32ToAddress(slice(message, 152, 184))
}

function mintRecipientOf(message) {
  return bytes32ToAddress(slice(message, 184, 216))
}

function amountOf(message) {
  return BigInt(slice(message, 216, 248))
}

/* Round 29 (fixing the Round 29 review's Medium finding: "equal cardinality
   doesn't prove equal membership"). Ordinal position alone (Round 27) proves
   WHERE a message sits in Iris's response, not that its CONTENT is
   genuinely this milestone's own real burn — an Iris bug, or a same-length
   response that reorders same-transaction messages, could still misattribute
   at the selected ordinal. This is real identity verification, not a return
   to Round 26's mistake: Round 26 compared the whole raw message against
   Iris's `message` field and always failed, because CCTP V2 mutates several
   fields between burn and attestation. This instead fingerprints ONLY the
   fields confirmed immutable (see the four decode helpers above) — a value
   that stays byte-identical between the source-side log and Iris's own
   attested response for the SAME real message, so genuine equality is
   actually achievable here, unlike Round 26's attempt.
   Stored as plain JSON-safe values (lowercased address strings, amount as a
   decimal string — BigInt doesn't survive JSON.stringify) since this feeds
   directly into the persisted cctpTrack record. */
export function cctpMessageFingerprint(message) {
  return {
    destinationDomain: destinationDomainOf(message),
    burnToken: burnTokenOf(message).toLowerCase(),
    mintRecipient: mintRecipientOf(message).toLowerCase(),
    amount: amountOf(message).toString(),
    messageSender: messageSenderOf(message).toLowerCase()
  }
}

/* Round 29. Checks a fingerprint (from cctpMessageFingerprint, above)
   against the Iris entry selected by ordinal.

   Round 30 (fixing the Round 29 review's Medium finding: "fingerprint check
   depends on a nullable Iris field"). The original design compared against
   irisMessage.decodedMessage.decodedMessageBody — but Circle's real schema
   marks BOTH decodedMessage and decodedMessageBody explicitly nullable
   (decodedMessage is null "if decoding fails" on Circle's side;
   decodedMessageBody nullable the same way inside it), confirmed against
   Circle's own GET /v2/messages API reference, not just the migration
   guide's one non-null example. A genuine, fully real, correctly-attested,
   terminal-state message could have Iris's own convenience decode come back
   empty for reasons entirely outside this app's control — the old
   `if (!decoded || !body) return false` treated that as a hard identity
   mismatch, permanently misclassifying an honest message.

   Fixed by never depending on Iris's decoded convenience object at all:
   this derives the Iris-side fingerprint directly from irisMessage.message
   (the raw hex bytes Iris returns) using cctpMessageFingerprint — the EXACT
   SAME byte-offset parser already used for the receipt-side fingerprint —
   instead of trusting a second, independently-nullable representation of
   the same data. Symmetric parsing on both sides is strictly more robust
   than comparing two different shapes, not just an equally-valid
   alternative.

   Per Circle's schema, `message` itself reads literally "0x" until an
   attestation exists — a raw message that is missing or "0x" is a
   genuinely different situation from a content mismatch: there is nothing
   to compare yet, not a failed comparison. That's treated as "nothing to
   check against" (matches, permissively) here, the same as `fingerprint ==
   null` below — useCctpDelivery's own attestation gate, which runs
   immediately after this check, is what correctly keeps polling for this
   exact pre-attestation state (`m.attestation && m.attestation !==
   'PENDING'`), so there is no need for this function to also detect it.
   A non-"0x" message that fails to parse as valid CCTP V2 bytes (malformed,
   truncated) is a different, more anomalous case and fails closed (treated
   as a mismatch) rather than being let through.

   `fingerprint == null` is treated as "nothing to check against" (matches),
   not a failure — the same permissive default useCctpDelivery already uses
   for expectedOrdinals == null, since every real call site provides both
   together. */
export function irisMessageMatchesFingerprint(irisMessage, fingerprint) {
  if (fingerprint == null) return true
  const message = irisMessage?.message
  if (typeof message !== 'string' || message === '0x') return true
  let actual
  try {
    actual = cctpMessageFingerprint(message)
  } catch {
    return false
  }
  return (
    actual.destinationDomain === fingerprint.destinationDomain &&
    actual.burnToken === fingerprint.burnToken &&
    actual.mintRecipient === fingerprint.mintRecipient &&
    actual.amount === fingerprint.amount &&
    actual.messageSender === fingerprint.messageSender
  )
}

// Round 26. Arc's own (source-side) MessageTransmitterV2 — the contract
// that actually emits MessageSent. Live-verified (Round 22): decoded a
// real Arc-testnet depositForBurnWithHook receipt and found this event at
// this exact address.
export const MESSAGE_TRANSMITTER_V2_ARC = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'

// Round 26. Arc's TokenMessengerV2 proxy — verified against
// deploy/deploy.js:37 (the literal constructor argument every deploy
// passes as _tokenMessenger) and CLAUDE.md, not just documentation: this
// is the exact address TrancheProtocol.sol's own `tokenMessenger` state
// variable holds on the live contract. Verified against Circle's real V2
// source (MessageTransmitterV2.sol, TokenMessengerV2.sol on GitHub, not
// just the docs table): MessageTransmitterV2.sendMessage stamps the
// message header's `sender` field from its own msg.sender
// (`_messageSender = msg.sender.toBytes32()`), and TokenMessengerV2's
// _depositForBurn calls that sendMessage directly with no intermediary —
// so for a burn TokenMessengerV2 itself initiated, this is what the
// header's sender field holds.
export const TOKEN_MESSENGER_V2_ARC = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'

// CCTP V2's version tag, on both the top-level header and BurnMessageV2's
// own body (verified against Circle's docs: V1 uses 0 for the same field).
const CCTP_V2_VERSION = 1

function readUint32(message, byteOffset) {
  return Number(BigInt(slice(message, byteOffset, byteOffset + 4)))
}

// Round 26. The top-level message header's own `sender` field — offset 44,
// 32 bytes — "Address of MessageTransmitterV2 caller on source domain" per
// Circle's V2 technical guide. A DIFFERENT field from messageSenderOf's
// body-level messageSender (which identifies who called TokenMessengerV2);
// this one identifies who called MessageTransmitterV2 directly. V1's
// header layout is not a subset of V2's — V1's own sender field sits at
// byte 20, not 44 — confirming these offsets are only valid once the
// version field (see messageHeaderVersionOf) has actually been checked.
export function messageHeaderSenderOf(message) {
  return bytes32ToAddress(slice(message, 44, 76))
}

export function messageHeaderVersionOf(message) {
  return readUint32(message, 0)
}

// BurnMessageV2's OWN internal version field, at relative offset 0 within
// the body (absolute 148, since messageBody starts there).
export function messageBodyVersionOf(message) {
  return readUint32(message, 148)
}

/* Round 26. The full authenticity chain for one MessageSent log — closing
   the gap Round 25's messageSenderOf-only check left open (finding 1) and
   generalized so every call site can share it (finding 3), not just
   FallbackCrossChainDelivery.

   MessageTransmitterV2.sendMessage is a public, permissionless function
   that accepts an ARBITRARY messageBody and faithfully stamps the header's
   own sender field from its real msg.sender — so anyone can call the REAL
   MessageTransmitterV2 directly and get a real MessageSent event back
   whose header.sender is honestly THEIR OWN address (never
   TokenMessengerV2's), with a messageBody of their own choosing (including
   one that plants an arbitrary address, e.g. this app's CONTRACT_ADDRESS,
   at the body's messageSender offset). None of that requires ever calling
   TokenMessengerV2 or burning anything.

   Four checks, all required, none sufficient alone:
     1. log.address must be Arc's REAL MessageTransmitterV2
        (MESSAGE_TRANSMITTER_V2_ARC). Without this, nothing below means
        anything at all — a self-deployed decoy contract can emit the
        exact same MessageSent(bytes) topic with FULLY attacker-chosen
        bytes, including a forged header.sender that would otherwise pass
        check 2. Only the real contract's own sendMessage() has any
        genuine relationship between msg.sender and the header it emits.
     2. The message's own header.sender (see messageHeaderSenderOf) must be
        Arc's real TokenMessengerV2 (TOKEN_MESSENGER_V2_ARC). This is what
        proves TokenMessengerV2 itself — not some other permissionless
        caller of the real MessageTransmitterV2 — constructed this
        specific message, which is the only thing that makes check 3
        trustworthy.
     3. The body's messageSender (messageSenderOf) must equal `ownAddress`
        — the actual identity callers care about, honestly stamped by
        TokenMessengerV2's own _depositForBurn from ITS real msg.sender,
        given check 2 already holds.
     4. Both the header's and the body's own version fields must read as
        CCTP V2 before ANY of the above offsets are trusted — V1's layout
        is a different shape entirely (its header sender sits at byte 20,
        not 44; its body has no messageSender field at byte 248 at all),
        so skipping this could silently misread unrelated bytes as a
        "sender" that happens to match by coincidence.
   Returns the raw, verified `message` hex string on success (finding 2
   needs the actual identity to match against Iris, not just a boolean) or
   null. */
export function verifiedOwnCctpMessage(log, ownAddress) {
  if (log.address?.toLowerCase() !== MESSAGE_TRANSMITTER_V2_ARC.toLowerCase()) return null
  try {
    const dec = decodeEventLog({ abi: MESSAGE_SENT_ABI, data: log.data, topics: log.topics })
    if (dec.eventName !== 'MessageSent') return null
    const message = dec.args.message
    if (messageHeaderVersionOf(message) !== CCTP_V2_VERSION) return null
    if (messageBodyVersionOf(message) !== CCTP_V2_VERSION) return null
    if (messageHeaderSenderOf(message).toLowerCase() !== TOKEN_MESSENGER_V2_ARC.toLowerCase()) return null
    if (messageSenderOf(message).toLowerCase() !== ownAddress.toLowerCase()) return null
    return message
  } catch {
    return null
  }
}

/* Round 25 / Round 26. Answers "did a CCTP message genuinely THIS
   contract's own burn get created in this receipt" — deliberately scoped
   and authenticity-verified (see verifiedOwnCctpMessage above for the
   full chain), unlike Round 22's original design (matching on the
   MessageSent event signature alone, unscoped by address — robust to a
   future MessageTransmitterV2 redeploy, correct against accidental topic0
   collision, but not a defense against DELIBERATE forgery). Every call
   site handling a receipt that could contain another party's activity
   needs this: FallbackCrossChainDelivery (release() is permissionless)
   and, per Round 26 finding 3, the three original write sites too —
   Circle-managed wallets are ERC-4337 smart accounts, and a bundler's
   handleOps can pack a foreign UserOperation's logs into the SAME receipt
   this device's own submission produced. Returns the actual verified
   messages (finding 2), not just a count — a bare count let a foreign,
   log-index-adjacent message pass a messages.length-based guard
   undetected once identity wasn't checked. */
export function receiptEmittedOwnCctpMessage(receipt, ownAddress) {
  const messages = receipt.logs
    .map((log) => verifiedOwnCctpMessage(log, ownAddress))
    .filter((message) => message != null)
  return { emitted: messages.length > 0, count: messages.length, messages }
}

/* Round 24 Phase A. The four terminal, escrowId+milestoneIndex-carrying
   events that can each be preceded by a CCTP burn in the SAME top-level
   call — TrancheProtocol.sol verified directly, not assumed:
     approveRelease        -> MilestoneApproved       (:647/:649)
     release                -> MilestoneReleased       (:682/:684)
     resolveDispute          -> DisputeResolved         (via _executePartialRelease, :516/:518)
     mutualSettle (matched)  -> MutualSettlementExecuted (via _executePartialRelease, :556/:557)
   In every one of the four, the burn (if any) happens strictly BEFORE the
   terminal event — CEI ordering, confirmed at each call site and in
   _executeCCTPReleaseAmount/_executePartialRelease underneath, and nothing
   is emitted by any of them AFTER their own terminal event (_checkEscrowCompletion
   emits nothing). resolveDisputeByTimeout never burns at all (Arc-only
   credit, DisputeTimedOutSettled excluded from CCTP_TERMINAL_EVENTS below).
   Re-verified exhaustively against every _approveAndBurn/
   _executeCCTPReleaseAmount call site in TrancheProtocol.sol: these four
   plus withdrawRefund (:877) are the only five burn-capable paths that
   exist — see CCTP_BOUNDARY_ONLY_EVENTS below for why withdrawRefund needs
   separate handling rather than joining this list.

   EVM logs within one transaction are strictly ordered by real execution
   order: one external call runs to completion (emitting every one of its
   own logs) before the next begins, true regardless of whether a batching
   / multicall contract composed several release()-family calls (release()
   is fully permissionless) into one transaction, OR whether an ERC-4337
   bundler's handleOps packed several UserOperations into one transaction
   (Round 26 finding 3 — each UserOp's own execution, including every log
   it emits, still completes before the next one begins; the same
   invariant, one extra call-frame). That makes each milestone's own
   terminal event a hard boundary, not a heuristic: the MessageSent logs
   that genuinely belong to THIS milestone are exactly those strictly after
   the nearest PRECEDING terminal event (any milestone) and up to and
   including this milestone's own terminal event.

   This boundary set only answers "which of THIS CONTRACT's own calls" —
   see receiptEmittedOwnCctpMessage above for the separate, orthogonal
   question of whether a MessageSent log in the scoped range is even from
   this contract's own burn at all (a batch could contain a foreign
   TrancheProtocol instance's, or a direct Circle depositForBurn call's,
   burn with no recognized boundary around it).

   Round 26: relocated here from EscrowDetail.jsx (Round 24) so
   ArbiterPanel.jsx's DisputeBlock can import it too, alongside
   EscrowDetail.jsx's own write sites and FallbackCrossChainDelivery —
   EscrowDetail.jsx already imports FROM ArbiterPanel.jsx (timeoutSettlementConfirm),
   so the reverse import would have been circular. */
const CCTP_TERMINAL_EVENTS = ['MilestoneApproved', 'MilestoneReleased', 'DisputeResolved', 'MutualSettlementExecuted']

/* Round 25. withdrawRefund's RefundWithdrawn(address indexed depositor,
   uint256 amount) — verified against ITrancheProtocol.sol — carries no
   escrowId or milestoneIndex at all (a refund is wallet-balance-level, not
   tied to any single milestone), so it can never be a valid MATCH target
   for the (escrowId, milestoneIndex) lookup below, unlike
   CCTP_TERMINAL_EVENTS. It still needs to DELIMIT ranges: withdrawRefund's
   own tx hash never reaches FallbackCrossChainDelivery as an entry point
   (Milestone.releaseTx is stamped only by the 5 release-type handlers,
   confirmed in CLAUDE.md — RefundWithdrawn isn't one), but its logs can
   still appear INSIDE a batched receipt entered via a different
   milestone's own terminal event. Without a boundary here, a batched
   withdrawRefund burn immediately before an unrelated Arc-only milestone
   release would fall inside that milestone's computed range with nothing
   to stop it. Pushed into the same `boundaries` array as
   CCTP_TERMINAL_EVENTS but with escrowId/milestoneIndex left null — since
   neither can ever equal a real BigInt target, the existing `.find()`
   match logic below naturally never selects it as anyone's own terminal
   event, while the range computation (which only reads logIndex) still
   uses it correctly. */
const CCTP_BOUNDARY_ONLY_EVENTS = ['RefundWithdrawn']

/* Exported for direct testing. Returns the [start, end] log-index range
   (start exclusive, end inclusive) this milestone's own logs occupy within
   `receipt`, or null if this milestone's own terminal event isn't found —
   defensive only, since the subgraph can only have stamped this txHash as
   THIS milestone's releaseTx by having decoded one of CCTP_TERMINAL_EVENTS
   for this exact (escrowId, milestoneIndex) out of this exact receipt. */
export function milestoneCctpLogRange(receipt, escrowId, milestoneIndex) {
  const targetEscrowId = BigInt(escrowId)
  const targetMilestoneIndex = BigInt(milestoneIndex)
  const boundaries = []

  for (const log of receipt.logs) {
    if (log.address?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue
    try {
      const dec = decodeEventLog({ abi: ESCROW_ABI, data: log.data, topics: log.topics })
      if (CCTP_TERMINAL_EVENTS.includes(dec.eventName)) {
        boundaries.push({ logIndex: log.logIndex, escrowId: dec.args.escrowId, milestoneIndex: dec.args.milestoneIndex })
      } else if (CCTP_BOUNDARY_ONLY_EVENTS.includes(dec.eventName)) {
        boundaries.push({ logIndex: log.logIndex, escrowId: null, milestoneIndex: null })
      }
    } catch {}
  }

  const match = boundaries.find(
    (b) => b.escrowId === targetEscrowId && b.milestoneIndex === targetMilestoneIndex
  )
  if (!match) return null

  const start = boundaries
    .filter((b) => b.logIndex < match.logIndex)
    .reduce((max, b) => Math.max(max, b.logIndex), -1)

  return { start, end: match.logIndex }
}

/* Round 24 Phase A / Round 25 / Round 26. The milestone-scoped, authenticity-
   verified counterpart to receiptEmittedCctpMessage — used by every call
   site that can receive a receipt containing another party's activity: the
   three original write sites (Round 26 finding 3 — Circle-managed wallets
   are ERC-4337 smart accounts, and a bundler's handleOps can pack a
   foreign UserOperation's logs into even this device's own receipt) and
   FallbackCrossChainDelivery (release() is permissionless). Scopes the
   receipt to just this milestone's own log range (milestoneCctpLogRange)
   AND to messages that pass the full authenticity chain
   (receiptEmittedOwnCctpMessage / verifiedOwnCctpMessage) before running
   the shared MessageSent count. No match found (should be unreachable in
   practice — see milestoneCctpLogRange's own doc comment) fails the same
   way as "genuinely no CCTP message": nothing reliable to attribute either
   way, so there is no meaningful difference in what the UI should show.

   Round 27 (fixing the Round 26 review's High finding). CCTP V2 mutates
   several message fields between burn-time (this source receipt) and
   attestation (Iris's response) — nonce (header, byte 12-44) is assigned
   off-chain by Circle, finalityThresholdExecuted (header, byte 144-148) and
   feeExecuted (body) are filled in once attested, expirationBlock can
   change too. Content equality between the raw source-side message and
   Iris's own `message` field therefore never holds for a real message —
   confirmed live: a genuine Arc-testnet burn's source-side log and Iris's
   returned message for the SAME delivery differ in exactly these fields,
   nowhere else (verified byte-by-byte against a real captured Iris
   response, not assumed). Round 26's `messages` (raw hex, still returned
   below for callers that want the actual bytes) can therefore never be
   used to find this milestone's own entries in Iris's response — every
   real poll had `messages.length === 0` and the tracker never resolved.

   Fixed by ordinal position instead of content: Circle's own GET
   /v2/messages API reference states "Each message for a given transaction
   hash is ordered by ascending log index" — so this milestone's own
   verified message(s) can be identified by WHERE they sit (0-indexed)
   among every real MessageTransmitterV2-emitted MessageSent log in the
   WHOLE receipt (realMessageTransmitterLogIndexesAsc below), not just this
   milestone's own scoped range — Iris's response covers the whole
   transaction, so the ordinal has to be counted against the same universe
   Iris counts against, confirmed by fetching Circle's own API reference
   directly (not assumed from the migration guide's shorter example).

   The ordinal universe is deliberately NOT authenticity-filtered.
   MessageTransmitterV2.sendMessage is public and permissionless (see
   verifiedOwnCctpMessage's own doc comment), so a forged message — real
   contract, wrong header.sender, the exact finding 1 attack — still gets a
   real MessageSent log at the real contract address and still consumes a
   real ordinal slot in Iris's response, even though this app's own
   authenticity chain correctly rejects it as not-ours. Excluding it from
   the count here would shift every ordinal after it by one and
   misattribute a later real message to the wrong slot. Trust that a given
   ordinal is genuinely THIS milestone's own still comes entirely from
   verifiedOwnCctpMessage's four-check chain, run first to find OUR OWN
   scoped logs; the ordinal count is a separate question answered against
   the unfiltered universe.

   `ordinals` are this milestone's own verified messages' 0-indexed
   positions in that universe (usually one entry; more for a mixed split
   settling several legs in one call). `totalMessages` is the universe's
   own size — useCctpDelivery needs it to gate on Iris having indexed EVERY
   real message in the transaction before trusting any ordinal-based
   selection (see its own doc comment for why a still-partial response
   can't be trusted to be a stable prefix of the final ordering). */
const MESSAGE_SENT_TOPIC0 = toEventSelector('MessageSent(bytes)')

export function realMessageTransmitterLogIndexesAsc(logs) {
  return logs
    .filter((log) =>
      log.address?.toLowerCase() === MESSAGE_TRANSMITTER_V2_ARC.toLowerCase() &&
      log.topics?.[0] === MESSAGE_SENT_TOPIC0
    )
    .map((log) => log.logIndex)
    .sort((a, b) => a - b)
}

export function receiptEmittedCctpMessageForMilestone(receipt, escrowId, milestoneIndex) {
  const range = milestoneCctpLogRange(receipt, escrowId, milestoneIndex)
  if (!range) return { emitted: false, count: 0, messages: [], ordinals: [], totalMessages: 0, fingerprints: [] }
  const scopedLogs = receipt.logs.filter((log) => log.logIndex > range.start && log.logIndex <= range.end)
  const result = receiptEmittedOwnCctpMessage({ ...receipt, logs: scopedLogs }, CONTRACT_ADDRESS)
  const universe = realMessageTransmitterLogIndexesAsc(receipt.logs)
  const ordinals = scopedLogs
    .filter((log) => verifiedOwnCctpMessage(log, CONTRACT_ADDRESS) != null)
    .map((log) => universe.indexOf(log.logIndex))
    .filter((ord) => ord !== -1)
  // Round 29: fingerprints built from result.messages — the SAME verified
  // raw message bytes ordinals is derived from (both iterate scopedLogs
  // filtered by the identical verifiedOwnCctpMessage != null predicate, in
  // the same order), so fingerprints[i] genuinely corresponds to ordinals[i].
  const fingerprints = result.messages.map(cctpMessageFingerprint)
  return { ...result, ordinals, totalMessages: universe.length, fingerprints }
}
