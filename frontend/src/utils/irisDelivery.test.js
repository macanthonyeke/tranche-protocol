import { describe, it, expect, vi, afterEach } from 'vitest'

/* fetchIrisMessages — Round 21 Phase A.

   GET /v2/messages/{txHash} (no domain path segment, no query param) was
   never a valid request against Circle's real Iris API — verified live
   against iris-api-sandbox.circle.com, which responds 400 for exactly this
   shape: "params.srcDomainId: Too big: expected int to be <9007199254740991,
   query: At least one of transactionHash or nonce must be provided". The
   real endpoint is GET /v2/messages/{sourceDomainId}?transactionHash={txHash}
   — confirmed against real captured responses for actual Arc-testnet burns.

   This means every cross-chain delivery-tracking request this app has ever
   made hit a 400, not the 404 the code specially treats as "not indexed
   yet" — so it always surfaced as `phase: 'unavailable'`, never correctly
   polling for real status. These tests pin the URL shape directly so this
   can't silently regress back to the never-real one. */
import { encodeEventTopics, encodeAbiParameters } from 'viem'
import { ARC_DOMAIN } from '../config/chains.js'
import { ESCROW_ABI, CONTRACT_ADDRESS } from '../config/contract.js'

const {
  fetchIrisMessages,
  messageSenderOf,
  messageHeaderSenderOf,
  messageHeaderVersionOf,
  messageBodyVersionOf,
  verifiedOwnCctpMessage,
  receiptEmittedOwnCctpMessage,
  milestoneCctpLogRange,
  receiptEmittedCctpMessageForMilestone,
  realMessageTransmitterLogIndexesAsc,
  cctpMessageFingerprint,
  cctpMessageDestinationDomain,
  irisMessageMatchesFingerprint,
  MESSAGE_TRANSMITTER_V2_ARC,
  TOKEN_MESSENGER_V2_ARC
} = await import('./irisDelivery.js')

afterEach(() => {
  vi.unstubAllGlobals()
})

const mockOk = (body) => ({ ok: true, status: 200, json: async () => body })

// Round 31: sourceTxHash is now strictly format-validated against the same
// 32-byte-hash shape as a real tx hash (SOURCE_TX_HASH_RE in irisDelivery.js),
// so short placeholder strings like '0xabc123' can no longer stand in for a
// well-formed one anywhere the mock response needs to resolve successfully.
// Deterministically expands any short, readable seed into a full 66-char
// hex string (via char codes, so it's valid hex regardless of the seed's
// own letters) — keeps fixtures legible ('same', 'errors', ...) while
// satisfying the format check.
const hash = (seed) =>
  ('0x' + Array.from(seed).map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0')).slice(0, 66)

const TX = hash('abc123')

// Generic mock: echoes back whatever txHash was actually requested as the
// envelope's sourceTxHash, so dedup/guard tests that don't care about the
// response CONTENT (only about call counts/timing) still resolve
// successfully under the now-mandatory, format-checked sourceTxHash.
const echoFetch = () => vi.fn((url) => {
  const tx = new URL(url).searchParams.get('transactionHash')
  return Promise.resolve(mockOk({ messages: [], sourceTxHash: tx }))
})

describe('fetchIrisMessages', () => {
  it('requests the sourceDomain as a path segment and the tx hash as a transactionHash query param', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(mockOk({ messages: [], sourceTxHash: TX })))
    vi.stubGlobal('fetch', fetchMock)

    await fetchIrisMessages(TX)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain(`/v2/messages/${ARC_DOMAIN}`)
    expect(url).toContain(`transactionHash=${TX}`)
    // The bug this closes: the tx hash must never appear where the domain
    // path segment goes.
    expect(url).not.toContain(`/v2/messages/${TX}`)
  })

  it('defaults sourceDomain to ARC_DOMAIN — every tracked burn in this app originates from Arc', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(mockOk({ messages: [], sourceTxHash: TX })))
    vi.stubGlobal('fetch', fetchMock)

    await fetchIrisMessages(TX)

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/v2/messages/26?')
  })

  it('accepts an explicit sourceDomain override', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(mockOk({ messages: [], sourceTxHash: TX })))
    vi.stubGlobal('fetch', fetchMock)

    await fetchIrisMessages(TX, 6)

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/v2/messages/6?')
  })

  it('returns [] on a 404 (not yet indexed), not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })))
    await expect(fetchIrisMessages('0xabc123')).resolves.toEqual([])
  })

  it('throws on a non-404 error status — a 400 must not be silently swallowed like a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 400 })))
    await expect(fetchIrisMessages('0xabc123')).rejects.toThrow('Iris HTTP 400')
  })

  it('returns the messages array from a real-shaped successful response', async () => {
    const realShapedMessage = {
      message: '0xmsg', attestation: '0xatt', status: 'complete',
      decodedMessage: { destinationDomain: '6' },
      forwardState: 'COMPLETE', forwardTxHash: '0xdesttx', forwardErrorCode: null
    }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockOk({ messages: [realShapedMessage], sourceTxHash: TX }))))
    await expect(fetchIrisMessages(TX)).resolves.toEqual([realShapedMessage])
  })
})

/* fetchIrisMessages — envelope-level sourceTxHash check, Round 30 (fixing
   the Round 29 review's own Medium finding: "sourceTxHash checked at the
   wrong response level"). Confirmed against Circle's real GET /v2/messages
   API reference: sourceTxHash is a required, non-nullable field on the
   response ENVELOPE ("the source burn transaction hash, shared by all
   messages in the response"), never duplicated on each message object — so
   these fixtures put it only at that level, matching Circle's actual
   response shape rather than fabricating a per-message field that doesn't
   exist in reality (the mistake the Round 29 fixtures made). */
describe('fetchIrisMessages — envelope-level sourceTxHash check', () => {
  const own = (overrides = {}) => ({ message: '0xown', attestation: '0xatt', ...overrides })

  it('resolves normally when the envelope sourceTxHash matches the requested tx', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockOk({ messages: [own()], sourceTxHash: TX }))))
    await expect(fetchIrisMessages(TX)).resolves.toEqual([own()])
  })

  it('matches the envelope sourceTxHash case-insensitively', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockOk({ messages: [own()], sourceTxHash: '0x' + TX.slice(2).toUpperCase() }))))
    await expect(fetchIrisMessages(TX)).resolves.toEqual([own()])
  })

  // Round 31 (fixing the Round 30 review's Medium finding: "absence should
  // fail, not pass"). Was previously the mirror-image test — "resolves
  // normally when absent". Circle's real OpenAPI schema marks sourceTxHash
  // required and non-nullable on this envelope (confirmed live, see
  // irisDelivery.js's doc comment), so an absent field means the response
  // doesn't match the documented schema at all — anomalous, not a normal
  // compatibility case — and must fail closed rather than being treated the
  // same as this app's own genuinely-optional values.
  it('throws when the envelope has no sourceTxHash field at all — Circle marks the field required and non-nullable, so absence is anomalous rather than a permissive compatibility case', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockOk({ messages: [own()] }))))
    await expect(fetchIrisMessages(TX)).rejects.toThrow(/sourceTxHash/i)
  })

  it('throws when the envelope sourceTxHash is explicitly null', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockOk({ messages: [own()], sourceTxHash: null }))))
    await expect(fetchIrisMessages(TX)).rejects.toThrow(/sourceTxHash/i)
  })

  it('throws when the envelope sourceTxHash is the wrong type (not a string)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockOk({ messages: [own()], sourceTxHash: 12345 }))))
    await expect(fetchIrisMessages(TX)).rejects.toThrow(/sourceTxHash/i)
  })

  it('throws when the envelope sourceTxHash is a malformed shape — a string that is not a valid 32-byte hash, even though it happens to equal the requested tx hash by length coincidence', async () => {
    const notAHash = '0xnothex' // same general "0x..." shape, but not valid hex / not 32 bytes
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockOk({ messages: [own()], sourceTxHash: notAHash }))))
    await expect(fetchIrisMessages(notAHash)).rejects.toThrow(/sourceTxHash/i)
  })

  it('throws when the envelope sourceTxHash belongs to a DIFFERENT transaction, rather than silently returning the wrong transaction\'s messages', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockOk({ messages: [own()], sourceTxHash: TX }))))
    await expect(fetchIrisMessages(hash('different'))).rejects.toThrow(/sourceTxHash/i)
  })

  it('regression: right length, wrong transaction — a same-length response for an entirely different burn is rejected wholesale, not silently ordinal-selected as if it were this transaction\'s own verified set', async () => {
    // Two entries — the same count a caller expecting expectedTotalMessages
    // === 2 would require — but the whole envelope belongs to a different
    // tx. Without the envelope check, this would previously have passed the
    // completeness gate untouched and been ordinal-selected as this
    // milestone's own messages.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockOk({
      messages: [own({ message: '0xforeign1' }), own({ message: '0xforeign2' })],
      sourceTxHash: hash('notrequested')
    }))))
    await expect(fetchIrisMessages(TX)).rejects.toThrow(/sourceTxHash/i)
  })
})

/* fetchIrisMessages — per-message sourceTxHash field, Round 29/30. Kept only
   as coverage for the harmless defensive-extra filter still in
   fetchIrisMessagesNow — NOT the real check (see the envelope-level describe
   block above, which is). Per Circle's real schema, individual messages
   never actually carry their own sourceTxHash, so this filter is a no-op
   against any genuine response; these fixtures fabricate the field only to
   confirm the dead-but-harmless code path still behaves as written. */
describe('fetchIrisMessages — per-message sourceTxHash (defensive no-op)', () => {
  const own = (overrides = {}) => ({ message: '0xown', attestation: '0xatt', sourceTxHash: TX, ...overrides })

  it('keeps a message with no per-message sourceTxHash field at all — the normal case for a real response', async () => {
    const noField = { message: '0xown', attestation: '0xatt' }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockOk({ messages: [noField], sourceTxHash: TX }))))
    await expect(fetchIrisMessages(TX)).resolves.toEqual([noField])
  })

  it('would drop a message whose fabricated per-message sourceTxHash mismatches, if a response ever carried that field — envelope sourceTxHash still matches, so only the (dead-in-practice) per-message filter is exercised here', async () => {
    const foreign = own({ sourceTxHash: '0xdeadbeef', message: '0xforeign' })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockOk({ messages: [foreign], sourceTxHash: TX }))))
    await expect(fetchIrisMessages(TX)).resolves.toEqual([])
  })
})

/* fetchIrisMessages — timeout, Round 22 Phase B.

   Unlike fetchForwardFee (which gained a timeout in Round 21 Phase B), this
   endpoint previously had none at all — an unprotected await here never
   resolves and never rejects on a hang, same failure mode Round 21 Phase B
   closed for the fee quote. Codex's own live observation of real Iris calls
   sometimes taking over a minute is why this uses a longer budget (90s) than
   the fee endpoint's 8s — see fetchIrisMessages's own doc comment in
   irisDelivery.js for the full reasoning. This mock respects AbortSignal the
   way real fetch does, so it can only resolve this test if the timeout
   actually aborts it. */
describe('fetchIrisMessages — timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('throws a clean, catchable error once the request hangs past the timeout, rather than never resolving', async () => {
    vi.useFakeTimers()
    const hangingFetch = vi.fn((url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        reject(err)
      })
    }))
    vi.stubGlobal('fetch', hangingFetch)

    const resultPromise = fetchIrisMessages('0xhang1')
    let settled = false
    resultPromise.catch(() => {}).finally(() => { settled = true })

    // Well before the 90s timeout: still hanging.
    await vi.advanceTimersByTimeAsync(89_000)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1_001)
    await expect(resultPromise).rejects.toThrow(/timed out/i)
  })

  it('passes an AbortSignal to fetch so a real hang can actually be cancelled', () => {
    const fetchMock = vi.fn(() => Promise.resolve(mockOk({ messages: [], sourceTxHash: TX })))
    vi.stubGlobal('fetch', fetchMock)
    return fetchIrisMessages(TX).then(() => {
      const [, opts] = fetchMock.mock.calls[0]
      expect(opts.signal).toBeInstanceOf(AbortSignal)
    })
  })
})

/* fetchIrisMessages — in-flight guard, Round 22 Phase B.

   useCctpDelivery polls this on a fixed 15s interval regardless of whether
   the previous call has resolved yet. Given real calls can take over a
   minute (see the timeout tests above), an unguarded poll would let requests
   for the SAME tracked tx pile up across several ticks. Keyed by the exact
   request identity (sourceDomain + txHash), so a slow poll for one escrow's
   tx never blocks a concurrent poll for a genuinely different one — only a
   re-poll of itself while the first is still pending. */
describe('fetchIrisMessages — in-flight guard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reuses the in-flight request for the SAME txHash instead of issuing a second fetch', async () => {
    const txSame = hash('same')
    let resolveFetch
    const fetchMock = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))
    vi.stubGlobal('fetch', fetchMock)

    const p1 = fetchIrisMessages(txSame)
    const p2 = fetchIrisMessages(txSame)

    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch(mockOk({ messages: [{ message: '0xshared' }], sourceTxHash: txSame }))
    await expect(p1).resolves.toEqual([{ message: '0xshared' }])
    await expect(p2).resolves.toEqual([{ message: '0xshared' }])
  })

  it('does NOT dedup a concurrent request for a genuinely different txHash', async () => {
    const fetchMock = echoFetch()
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([fetchIrisMessages(hash('one')), fetchIrisMessages(hash('two'))])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT dedup requests for the same txHash on different sourceDomains', async () => {
    const fetchMock = echoFetch()
    vi.stubGlobal('fetch', fetchMock)

    const txSame = hash('sametx')
    await Promise.all([fetchIrisMessages(txSame, 26), fetchIrisMessages(txSame, 6)])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('allows a fresh request for the same txHash once the prior one has settled — the guard is not permanent', async () => {
    const fetchMock = echoFetch()
    vi.stubGlobal('fetch', fetchMock)

    const tx = hash('sequential')
    await fetchIrisMessages(tx)
    await fetchIrisMessages(tx)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('clears the in-flight slot even when the request throws, so the next poll is not permanently blocked', async () => {
    const tx = hash('errors')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500 })))
    await expect(fetchIrisMessages(tx)).rejects.toThrow('Iris HTTP 500')

    vi.stubGlobal('fetch', echoFetch())
    await expect(fetchIrisMessages(tx)).resolves.toEqual([])
  })
})

/* ============================================================================
   Round 26 shared fixtures.

   MESSAGE_SENT_ABI/buildCctpMessage/messageSentLog/escrowLog are used by
   every describe block below (messageHeaderSenderOf through
   receiptEmittedCctpMessageForMilestone) — one consolidated, fully-featured
   set of fixtures instead of the several inconsistent local ones earlier
   rounds accumulated.

   buildCctpMessage constructs a REAL, offset-correct 280-byte CCTP V2
   message — every field a genuine message would have up through
   messageSender (byte 280), not just the one field a given test cares
   about — so a fixture only passes a check if it would actually decode
   that way against the real byte layout. Defaults (headerVersion: 1,
   headerSender: TOKEN_MESSENGER_V2_ARC, bodyVersion: 1,
   bodySender: CONTRACT_ADDRESS) describe a fully genuine message; each
   describe block below overrides exactly the one field it's testing.
   Verified against Circle's own CCTP V2 technical guide
   (developers.circle.com/cctp/references/technical-guide), confirmed via
   two independent fetches, and against Circle's real V2 GitHub source
   (MessageTransmitterV2.sol, TokenMessengerV2.sol) for the semantic claims
   (header.sender = the real caller of sendMessage; TokenMessengerV2 calls
   sendMessage directly, no intermediary). ============================ */
const MESSAGE_SENT_ABI = [
  { name: 'MessageSent', type: 'event', inputs: [{ name: 'message', type: 'bytes', indexed: false }], anonymous: false }
]
const FOREIGN_ADDRESS = '0x1234567890123456789012345678901234567890'
const DECOY_CONTRACT = '0x9999999999999999999999999999999999999999'

const hexZeros = (byteLen) => '00'.repeat(byteLen)
const uint32Hex = (n) => n.toString(16).padStart(8, '0')
const uint256Hex = (n) => BigInt(n).toString(16).padStart(64, '0')
const addressWordHex = (addr) => addr.slice(2).toLowerCase().padStart(64, '0')
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Round 29: destinationDomain/burnToken/mintRecipient/amount now overridable
// (each defaulting to the same zero value every pre-Round-29 call site
// already implicitly relied on) so cctpMessageFingerprint's actual field
// extraction can be tested against non-default values, not just zeros.
// Round 31: extended past byte 280 (messageSender) to a genuinely complete
// CCTP V2 message — maxFee/feeExecuted/expirationBlock through byte 376,
// then hookData — after cctpMessageFingerprint gained a minimum-length
// floor (CCTP_V2_COMPLETE_MESSAGE_MIN_BYTES, irisDelivery.js) matching the
// real BurnMessageV2 fixed-field size. The old fixture stopped at exactly
// byte 280 — long enough for the fields the old code actually read, but
// shorter than any real message, so it was an unfair "truncated prefix"
// test rather than testing against a genuine message shape.
//
// Round 32 (fixing the Round 31 review's Medium finding: fixture accuracy
// part of "the complete message check doesn't validate the whole
// message"). hookData previously defaulted to the raw 12-byte ASCII
// "cctp-forward" string alone — but TrancheProtocol.sol:51 declares
// FORWARD_HOOK_DATA as `bytes32` (right-padded with zero bytes to 32), and
// :1371 passes it to depositForBurnWithHook via
// `abi.encodePacked(FORWARD_HOOK_DATA)`, which packs a bytes32 as the FULL,
// FIXED 32 bytes verbatim — never trimmed. A genuine message from this
// app's own burn is therefore always exactly 408 bytes (376 + 32), never
// 388 (376 + 12) the old fixture implied. Built the same programmatic way
// as every other field here (asciiHex + hexZeros), not hand-typed, to avoid
// a transcription error in a 64-hex-char literal.
const asciiHex = (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
const CCTP_FORWARD_HOOK_HEX = asciiHex('cctp-forward') + hexZeros(32 - 'cctp-forward'.length)

const buildCctpMessage = ({
  headerVersion = 1,
  headerSender = TOKEN_MESSENGER_V2_ARC,
  destinationDomain = 0,
  bodyVersion = 1,
  burnToken = ZERO_ADDRESS,
  mintRecipient = ZERO_ADDRESS,
  amount = 0n,
  bodySender = CONTRACT_ADDRESS,
  maxFee = 0n,
  feeExecuted = 0n,
  expirationBlock = 0n,
  hookData = CCTP_FORWARD_HOOK_HEX
} = {}) =>
  '0x' +
  uint32Hex(headerVersion) +          // version            0-4
  hexZeros(4) +                       // sourceDomain       4-8
  uint32Hex(destinationDomain) +      // destinationDomain  8-12
  hexZeros(32) +                      // nonce              12-44
  addressWordHex(headerSender) +      // sender             44-76
  hexZeros(32) +                      // recipient          76-108
  hexZeros(32) +                      // destinationCaller  108-140
  hexZeros(4) +                       // minFinalityThreshold      140-144
  hexZeros(4) +                       // finalityThresholdExecuted 144-148
  uint32Hex(bodyVersion) +            // body version       148-152
  addressWordHex(burnToken) +         // burnToken          152-184
  addressWordHex(mintRecipient) +     // mintRecipient       184-216
  uint256Hex(amount) +                // amount             216-248
  addressWordHex(bodySender) +        // messageSender      248-280
  uint256Hex(maxFee) +                // maxFee             280-312
  uint256Hex(feeExecuted) +           // feeExecuted        312-344
  uint256Hex(expirationBlock) +       // expirationBlock    344-376
  hookData                            // hookData           376+ (dynamic)

// Round 33: the expected cctpMessageFingerprint for a message built by
// buildCctpMessage above, mirroring the same overridable fields. Computed
// via the real cctpMessageFingerprint (not hand-assembled) — Round 33's
// redesign returns a single sanitized-message hash with no named fields,
// so there is nothing left to reconstruct field-by-field; this helper just
// saves callers from writing buildCctpMessage(...) + cctpMessageFingerprint(...)
// twice at every call site.
const fingerprintFor = (overrides = {}) => cctpMessageFingerprint(buildCctpMessage(overrides))

const messageSentLog = (logIndex, overrides = {}, address = MESSAGE_TRANSMITTER_V2_ARC) => ({
  address,
  logIndex,
  topics: encodeEventTopics({ abi: MESSAGE_SENT_ABI, eventName: 'MessageSent' }),
  data: encodeAbiParameters([{ type: 'bytes' }], [buildCctpMessage(overrides)])
})

const escrowLog = (logIndex, eventName, args, address = CONTRACT_ADDRESS) => {
  const abiItem = ESCROW_ABI.find((i) => i.type === 'event' && i.name === eventName)
  const topics = encodeEventTopics({ abi: ESCROW_ABI, eventName, args })
  const nonIndexed = abiItem.inputs.filter((i) => !i.indexed)
  const data = nonIndexed.length > 0
    ? encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name]))
    : '0x'
  return { address, logIndex, topics, data }
}

describe('messageHeaderVersionOf / messageBodyVersionOf', () => {
  it('reads the header version at byte offset 0', () => {
    expect(messageHeaderVersionOf(buildCctpMessage({ headerVersion: 1 }))).toBe(1)
    expect(messageHeaderVersionOf(buildCctpMessage({ headerVersion: 0 }))).toBe(0)
  })

  it('reads the body version at byte offset 148 — independent of the header version', () => {
    expect(messageBodyVersionOf(buildCctpMessage({ bodyVersion: 1 }))).toBe(1)
    expect(messageBodyVersionOf(buildCctpMessage({ bodyVersion: 0 }))).toBe(0)
  })
})

describe('messageHeaderSenderOf', () => {
  it('decodes the header sender word at byte offset 44-76 — a DIFFERENT field than the body messageSender at 248', () => {
    expect(messageHeaderSenderOf(buildCctpMessage({ headerSender: TOKEN_MESSENGER_V2_ARC })).toLowerCase())
      .toBe(TOKEN_MESSENGER_V2_ARC.toLowerCase())
  })

  it('decodes a foreign header sender correctly — not a fixed/hardcoded expectation', () => {
    expect(messageHeaderSenderOf(buildCctpMessage({ headerSender: FOREIGN_ADDRESS })).toLowerCase())
      .toBe(FOREIGN_ADDRESS.toLowerCase())
  })
})

/* messageSenderOf — Round 25, byte offset re-confirmed Round 26. */
describe('messageSenderOf', () => {
  it('decodes the real messageSender word at the documented byte offset (248-280)', () => {
    expect(messageSenderOf(buildCctpMessage({ bodySender: CONTRACT_ADDRESS })).toLowerCase()).toBe(CONTRACT_ADDRESS.toLowerCase())
  })

  it('decodes a different sender correctly — not a fixed/hardcoded expectation', () => {
    expect(messageSenderOf(buildCctpMessage({ bodySender: FOREIGN_ADDRESS })).toLowerCase()).toBe(FOREIGN_ADDRESS.toLowerCase())
  })
})

/* verifiedOwnCctpMessage — Round 26 finding 1.

   MessageTransmitterV2.sendMessage is public and permissionless and
   faithfully stamps the header's sender field from its real msg.sender —
   so anyone can call the REAL MessageTransmitterV2 directly with an
   ARBITRARY messageBody, getting back a genuine MessageSent event whose
   header.sender honestly identifies THEM (never TokenMessengerV2), with a
   messageBody of their own choosing — including one that plants
   CONTRACT_ADDRESS at the body's messageSender offset despite never
   calling TokenMessengerV2 or burning anything. Each test below flips
   exactly ONE of the four required checks away from genuine while keeping
   the other three valid, proving each is independently necessary — not
   just that the happy path works. */
describe('verifiedOwnCctpMessage', () => {
  it('returns the raw message for a fully genuine log', () => {
    const log = messageSentLog(0)
    expect(verifiedOwnCctpMessage(log, CONTRACT_ADDRESS)).toBe(buildCctpMessage())
  })

  it('rejects a log from ANY address other than the real MessageTransmitterV2 — a self-deployed decoy contract can emit an identical MessageSent(bytes) topic with fully attacker-crafted bytes, including a forged header.sender', () => {
    const log = messageSentLog(0, {}, DECOY_CONTRACT)
    expect(verifiedOwnCctpMessage(log, CONTRACT_ADDRESS)).toBeNull()
  })

  it('rejects a header version that is not CCTP V2 (e.g. 0, CCTP V1) even though every other field is genuine — V1s layout is a different shape entirely, so trusting these offsets first would misparse it', () => {
    const log = messageSentLog(0, { headerVersion: 0 })
    expect(verifiedOwnCctpMessage(log, CONTRACT_ADDRESS)).toBeNull()
  })

  it('rejects a body version that is not CCTP V2, even with a genuine header', () => {
    const log = messageSentLog(0, { bodyVersion: 0 })
    expect(verifiedOwnCctpMessage(log, CONTRACT_ADDRESS)).toBeNull()
  })

  it('finding 1s exact attack: rejects a message whose header.sender is NOT TokenMessengerV2, even though the body.messageSender is spoofed to equal ownAddress — this is the forged message an attacker gets from calling the REAL MessageTransmitterV2.sendMessage directly, bypassing TokenMessengerV2 entirely', () => {
    const log = messageSentLog(0, { headerSender: FOREIGN_ADDRESS, bodySender: CONTRACT_ADDRESS })
    expect(verifiedOwnCctpMessage(log, CONTRACT_ADDRESS)).toBeNull()
  })

  it('rejects a message whose body.messageSender is not the given ownAddress, even with a genuine TokenMessengerV2 header.sender', () => {
    const log = messageSentLog(0, { bodySender: FOREIGN_ADDRESS })
    expect(verifiedOwnCctpMessage(log, CONTRACT_ADDRESS)).toBeNull()
  })

  it('does not mistake a log from a different EVENT on the real MessageTransmitterV2 address, and does not crash on one', () => {
    const log = { address: MESSAGE_TRANSMITTER_V2_ARC, topics: ['0xdeadbeef'], data: '0x' }
    expect(verifiedOwnCctpMessage(log, CONTRACT_ADDRESS)).toBeNull()
  })
})

describe('receiptEmittedOwnCctpMessage', () => {
  it('counts a message whose full authenticity chain matches the given ownAddress', () => {
    const receipt = { logs: [messageSentLog(0)] }
    expect(receiptEmittedOwnCctpMessage(receipt, CONTRACT_ADDRESS)).toEqual({ emitted: true, count: 1, messages: [buildCctpMessage()] })
  })

  it('excludes a real, well-formed MessageSent log whose body messageSender is a DIFFERENT address', () => {
    const receipt = { logs: [messageSentLog(0, { bodySender: FOREIGN_ADDRESS })] }
    expect(receiptEmittedOwnCctpMessage(receipt, CONTRACT_ADDRESS)).toEqual({ emitted: false, count: 0, messages: [] })
  })

  it('finding 1: excludes a message forged via a direct MessageTransmitterV2.sendMessage call (real contract, wrong header.sender) even though the body.messageSender is spoofed correctly', () => {
    const receipt = { logs: [messageSentLog(0, { headerSender: FOREIGN_ADDRESS, bodySender: CONTRACT_ADDRESS })] }
    expect(receiptEmittedOwnCctpMessage(receipt, CONTRACT_ADDRESS)).toEqual({ emitted: false, count: 0, messages: [] })
  })

  it('finding 1: excludes a message emitted by a decoy contract impersonating MessageTransmitterV2, even with fully genuine-looking header AND body bytes', () => {
    const receipt = { logs: [messageSentLog(0, {}, DECOY_CONTRACT)] }
    expect(receiptEmittedOwnCctpMessage(receipt, CONTRACT_ADDRESS)).toEqual({ emitted: false, count: 0, messages: [] })
  })

  it('counts only the matching-sender messages out of a mix, and returns their real message bytes', () => {
    const receipt = {
      logs: [
        messageSentLog(0),
        messageSentLog(1, { bodySender: FOREIGN_ADDRESS }),
        messageSentLog(2)
      ]
    }
    const result = receiptEmittedOwnCctpMessage(receipt, CONTRACT_ADDRESS)
    expect(result.emitted).toBe(true)
    expect(result.count).toBe(2)
    expect(result.messages).toEqual([buildCctpMessage(), buildCctpMessage()])
  })

  it('is case-insensitive on the address comparison — an ownAddress argument in a different case than the decoded (lowercase) messageSender still matches', () => {
    const receipt = { logs: [messageSentLog(0)] }
    const shoutedOwnAddress = '0x' + CONTRACT_ADDRESS.slice(2).toUpperCase()
    expect(receiptEmittedOwnCctpMessage(receipt, shoutedOwnAddress)).toEqual({ emitted: true, count: 1, messages: [buildCctpMessage()] })
  })
})

/* milestoneCctpLogRange / receiptEmittedCctpMessageForMilestone — Round 24
   Phase A / Round 25 / Round 26.

   Round 26: relocated here from EscrowDetail.jsx so ArbiterPanel.jsx's
   DisputeBlock can import it too (EscrowDetail.jsx already imports FROM
   ArbiterPanel.jsx, so the reverse would have been circular) — see
   milestoneCctpLogRange's own doc comment in irisDelivery.js. */
describe('milestoneCctpLogRange', () => {
  it('finds the [start, end] range as [-1, ownLogIndex] for the FIRST call in a receipt', () => {
    const receipt = {
      logs: [
        messageSentLog(0),
        escrowLog(1, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })
      ]
    }
    expect(milestoneCctpLogRange(receipt, 7, 1)).toEqual({ start: -1, end: 1 })
  })

  it('finds the range as [previous milestone\'s boundary, own boundary] for a LATER call in a batched receipt', () => {
    const receipt = {
      logs: [
        messageSentLog(0),
        escrowLog(1, 'MilestoneReleased', { escrowId: 3n, milestoneIndex: 0n }),
        messageSentLog(2),
        escrowLog(3, 'DisputeResolved', { escrowId: 7n, milestoneIndex: 1n, recipientBps: 10000n, resolutionHash: '0x' + '00'.repeat(32), resolutionURI: 'ipfs://x' })
      ]
    }
    expect(milestoneCctpLogRange(receipt, 7, 1)).toEqual({ start: 1, end: 3 })
  })

  it('returns null when this milestone\'s own terminal event is not present at all', () => {
    const receipt = {
      logs: [
        messageSentLog(0),
        escrowLog(1, 'MilestoneReleased', { escrowId: 3n, milestoneIndex: 0n })
      ]
    }
    expect(milestoneCctpLogRange(receipt, 7, 1)).toBeNull()
  })

  it('distinguishes milestoneIndex within the SAME escrow — a boundary for a different milestone of the same escrow is not a match', () => {
    const receipt = {
      logs: [escrowLog(0, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 0n })]
    }
    expect(milestoneCctpLogRange(receipt, 7, 1)).toBeNull()
  })

  it('ignores DisputeTimedOutSettled as a boundary — it never precedes a CCTP burn (Arc-only credit), so it must not appear in CCTP_TERMINAL_EVENTS matching', () => {
    // If DisputeTimedOutSettled were (wrongly) treated as this milestone's
    // own match target, this would return a range instead of null.
    const receipt = {
      logs: [escrowLog(0, 'DisputeTimedOutSettled', { escrowId: 7n, milestoneIndex: 1n, defaultBps: 5000n })]
    }
    expect(milestoneCctpLogRange(receipt, 7, 1)).toBeNull()
  })

  it('orders by the real logIndex field, not array position — a receipt whose logs array is out of logIndex order still partitions correctly', () => {
    // Deliberately shuffled array order; logIndex is what must matter.
    const receipt = {
      logs: [
        escrowLog(3, 'DisputeResolved', { escrowId: 7n, milestoneIndex: 1n, recipientBps: 10000n, resolutionHash: '0x' + '00'.repeat(32), resolutionURI: 'ipfs://x' }),
        messageSentLog(0),
        messageSentLog(2),
        escrowLog(1, 'MilestoneReleased', { escrowId: 3n, milestoneIndex: 0n })
      ]
    }
    expect(milestoneCctpLogRange(receipt, 7, 1)).toEqual({ start: 1, end: 3 })
  })

  describe('Round 25: RefundWithdrawn as a boundary-only marker', () => {
    const refundWithdrawnLog = (logIndex) =>
      escrowLog(logIndex, 'RefundWithdrawn', { depositor: '0x179cc4c8f23d257b7f4acb785464025570e3af86', amount: 100_000_000n })

    it('delimits a later milestone\'s range from an earlier withdrawRefund call in the same batched receipt', () => {
      const receipt = {
        logs: [
          messageSentLog(0),          // withdrawRefund's own burn
          refundWithdrawnLog(1),
          messageSentLog(2),          // the target milestone's own burn
          escrowLog(3, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })
        ]
      }
      // Without RefundWithdrawn as a boundary this would resolve to
      // { start: -1, end: 3 }, wrongly including withdrawRefund's burn.
      expect(milestoneCctpLogRange(receipt, 7, 1)).toEqual({ start: 1, end: 3 })
    })

    it('is never itself a valid match target, even for a milestoneIndex-less lookup — RefundWithdrawn carries no escrowId/milestoneIndex at all', () => {
      const receipt = { logs: [refundWithdrawnLog(0)] }
      expect(milestoneCctpLogRange(receipt, 7, 1)).toBeNull()
    })
  })
})

describe('receiptEmittedCctpMessageForMilestone', () => {
  it('counts only the MessageSent logs within this milestone\'s own range, and returns their real message bytes plus their ordinal positions in the WHOLE receipt', () => {
    const receipt = {
      logs: [
        messageSentLog(0),
        escrowLog(1, 'MilestoneReleased', { escrowId: 3n, milestoneIndex: 0n }),
        messageSentLog(2),
        messageSentLog(3),
        escrowLog(4, 'MutualSettlementExecuted', { escrowId: 7n, milestoneIndex: 1n, bps: 6000n })
      ]
    }
    const forMilestone1 = receiptEmittedCctpMessageForMilestone(receipt, 7, 1)
    expect(forMilestone1.emitted).toBe(true)
    expect(forMilestone1.count).toBe(2)
    expect(forMilestone1.messages).toEqual([buildCctpMessage(), buildCctpMessage()])
    // Round 27: 3 real MessageSent logs total in the receipt (logIndex 0, 2,
    // 3) — this milestone's own two are the 2nd and 3rd (0-indexed: 1, 2),
    // since logIndex 0 belongs to escrow 3/milestone 0.
    expect(forMilestone1.ordinals).toEqual([1, 2])
    expect(forMilestone1.totalMessages).toBe(3)
    expect(forMilestone1.fingerprints).toEqual([fingerprintFor(), fingerprintFor()])

    const forMilestone0 = receiptEmittedCctpMessageForMilestone(receipt, 3, 0)
    expect(forMilestone0).toEqual({ emitted: true, count: 1, messages: [buildCctpMessage()], ordinals: [0], totalMessages: 3, fingerprints: [fingerprintFor()] })
  })

  it('returns emitted:false, count:0, messages:[], ordinals:[], totalMessages:0, fingerprints:[] when no terminal event for this milestone is found (defensive — should be unreachable given how releaseTx is indexed)', () => {
    const receipt = { logs: [messageSentLog(0)] }
    expect(receiptEmittedCctpMessageForMilestone(receipt, 7, 1)).toEqual({ emitted: false, count: 0, messages: [], ordinals: [], totalMessages: 0, fingerprints: [] })
  })

  describe('Round 25 gap (a) / Round 26 finding 1: a foreign application\'s burn, log-index-adjacent but not this contract\'s own', () => {
    it('excludes a MessageSent log whose own messageSender is a DIFFERENT contract, even though it falls inside this milestone\'s computed range — but still counts it toward totalMessages, since it is a real log in the ordinal universe', () => {
      const receipt = {
        logs: [
          messageSentLog(0, { bodySender: FOREIGN_ADDRESS }),   // a foreign TrancheProtocol instance's own burn — no boundary of its own
          escrowLog(1, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })
        ]
      }
      expect(receiptEmittedCctpMessageForMilestone(receipt, 7, 1)).toEqual({ emitted: false, count: 0, messages: [], ordinals: [], totalMessages: 1, fingerprints: [] })
    })

    it('excludes a message forged via a direct MessageTransmitterV2.sendMessage call, even inside this milestone\'s own computed range — but still counts it toward totalMessages', () => {
      const receipt = {
        logs: [
          messageSentLog(0, { headerSender: FOREIGN_ADDRESS, bodySender: CONTRACT_ADDRESS }),
          escrowLog(1, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })
        ]
      }
      expect(receiptEmittedCctpMessageForMilestone(receipt, 7, 1)).toEqual({ emitted: false, count: 0, messages: [], ordinals: [], totalMessages: 1, fingerprints: [] })
    })

    it('counts only the real, own-sender message when a foreign-sender message shares the same computed range, but its ordinal position (1) correctly accounts for the foreign message occupying slot 0', () => {
      const receipt = {
        logs: [
          messageSentLog(0, { bodySender: FOREIGN_ADDRESS }),
          messageSentLog(1),   // this contract's own, real burn
          escrowLog(2, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })
        ]
      }
      expect(receiptEmittedCctpMessageForMilestone(receipt, 7, 1)).toEqual({
        emitted: true, count: 1, messages: [buildCctpMessage()], ordinals: [1], totalMessages: 2, fingerprints: [fingerprintFor()]
      })
    })
  })

  describe('Round 25 gap (b): a same-contract withdrawRefund burn batched adjacent to an Arc-only milestone release', () => {
    it('does not attribute withdrawRefund\'s own burn to a following Arc-only milestone release, but still counts it toward totalMessages', () => {
      const receipt = {
        logs: [
          messageSentLog(0),   // withdrawRefund's own real burn
          escrowLog(1, 'RefundWithdrawn', { depositor: '0x179cc4c8f23d257b7f4acb785464025570e3af86', amount: 100_000_000n }),
          escrowLog(2, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })   // Arc-only: no burn of its own
        ]
      }
      expect(receiptEmittedCctpMessageForMilestone(receipt, 7, 1)).toEqual({ emitted: false, count: 0, messages: [], ordinals: [], totalMessages: 1, fingerprints: [] })
    })
  })

  describe('Round 26 finding 2: identity, not just count, matters for downstream Iris filtering', () => {
    it('returns DISTINCT message bytes AND distinct ordinal positions for two genuinely different burns in the same milestone (a mixed split), so downstream ordinal selection can tell them apart', () => {
      const receipt = {
        logs: [
          messageSentLog(0, { bodySender: CONTRACT_ADDRESS }),
          messageSentLog(1, { bodySender: CONTRACT_ADDRESS }),
          escrowLog(2, 'MutualSettlementExecuted', { escrowId: 7n, milestoneIndex: 1n, bps: 6000n })
        ]
      }
      const { messages, ordinals, totalMessages } = receiptEmittedCctpMessageForMilestone(receipt, 7, 1)
      // Both messages are byte-identical here (same sender, no other
      // differentiating field in this fixture) — the point of this test is
      // that the array has the real per-message bytes available at all
      // (length 2, not a collapsed count), not that THESE TWO specific
      // fixtures differ. Round 27: ordinals are what downstream selection
      // actually uses now (content is no longer trusted at all, see
      // useCctpDelivery's own doc comment), and these two ARE distinct
      // (0 and 1) even though their bytes happen not to be.
      expect(messages).toHaveLength(2)
      expect(ordinals).toEqual([0, 1])
      expect(totalMessages).toBe(2)
    })
  })

  describe('Round 27 (High finding fix): ordinal position, not content, is what Iris selection uses', () => {
    it('a finding-1-style forged message (real contract, wrong header.sender) occupying an EARLIER ordinal slot does not shift this milestone\'s own message off its correct position', () => {
      // The exact batched scenario the fix has to get right: an attacker's
      // forged MessageTransmitterV2.sendMessage call (real contract, real
      // MessageSent topic, so it consumes a real ordinal slot in Iris's
      // response) lands BEFORE this milestone's own genuine burn in the
      // same transaction. verifiedOwnCctpMessage correctly rejects the
      // forged one as not-ours, but it must still count toward the ordinal
      // universe, or the genuine message's ordinal would be off by one.
      const receipt = {
        logs: [
          messageSentLog(0, { headerSender: FOREIGN_ADDRESS, bodySender: CONTRACT_ADDRESS }),   // forged — occupies ordinal 0
          messageSentLog(1),   // this milestone's own genuine burn — must resolve to ordinal 1, not 0
          escrowLog(2, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })
        ]
      }
      const result = receiptEmittedCctpMessageForMilestone(receipt, 7, 1)
      expect(result.emitted).toBe(true)
      expect(result.count).toBe(1)
      expect(result.ordinals).toEqual([1])
      expect(result.totalMessages).toBe(2)
    })

    it('realMessageTransmitterLogIndexesAsc includes every real-contract MessageSent log regardless of authenticity (check 1 only), sorted ascending by logIndex — the universe Iris\'s own ordering is counted against', () => {
      const receipt = {
        logs: [
          messageSentLog(5, { headerSender: FOREIGN_ADDRESS }),   // forged, but still a real log at the real contract
          messageSentLog(2, { bodySender: FOREIGN_ADDRESS }),     // a foreign application's own genuine burn
          messageSentLog(9)                                       // this contract's own genuine burn
        ]
      }
      // Deliberately out of logIndex order in the array — the function must
      // sort by the real logIndex field, not array position.
      expect(realMessageTransmitterLogIndexesAsc(receipt.logs)).toEqual([2, 5, 9])
    })

    it('realMessageTransmitterLogIndexesAsc excludes logs from a decoy contract address, and logs from the real contract that are not MessageSent at all', () => {
      const receipt = {
        logs: [
          messageSentLog(0, {}, '0x9999999999999999999999999999999999999999'),   // decoy address, real MessageSent topic
          { address: MESSAGE_TRANSMITTER_V2_ARC, logIndex: 1, topics: ['0xdeadbeef'], data: '0x' }   // real address, different event
        ]
      }
      expect(realMessageTransmitterLogIndexesAsc(receipt.logs)).toEqual([])
    })
  })
})

/* cctpMessageFingerprint — Round 29.
   Extracts exactly the four IMMUTABLE fields (destinationDomain, burnToken,
   mintRecipient, amount) plus the already-verified messageSender — never
   nonce, finalityThresholdExecuted, feeExecuted, or expirationBlock, the
   four Round 27 established DO mutate between the source-side log and
   Iris's attested response.
   Round 32: maxFee and hookData added — also confirmed immutable, see
   cctpMessageFingerprint's own doc comment in irisDelivery.js. */
// Round 33: flips a single byte (by absolute offset) in an otherwise-valid
// message and returns the corrupted hex string — used throughout the
// redesigned describe block below to prove a given byte range DOES or DOES
// NOT affect the fingerprint, without hand-assembling a second full message
// per field the way the old field-object design required.
const flipByteAt = (message, byteOffset) => {
  const charIndex = 2 + byteOffset * 2
  const original = message.slice(charIndex, charIndex + 2)
  const flipped = original === 'ff' ? '00' : 'ff'
  return message.slice(0, charIndex) + flipped + message.slice(charIndex + 2)
}

describe('cctpMessageFingerprint', () => {
  it('returns a fixed-length keccak256 hash string, not a field object', () => {
    const fp = cctpMessageFingerprint(buildCctpMessage({}))
    expect(fp).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('is deterministic — the same message always produces the same hash', () => {
    const message = buildCctpMessage({ destinationDomain: 6, amount: 42n })
    expect(cctpMessageFingerprint(message)).toBe(cctpMessageFingerprint(message))
  })

  it('is unaffected by the four fields Round 27 established mutate between source and attestation — nonce (12-44), finalityThresholdExecuted (144-148), feeExecuted (312-344), and expirationBlock (344-376) can each independently change with no effect on the hash', () => {
    const genuine = buildCctpMessage({ amount: 42n })
    const base = cctpMessageFingerprint(genuine)
    for (const [start, end] of [[12, 44], [144, 148], [312, 344], [344, 376]]) {
      // Flip a byte in the middle of the range, not just the first byte —
      // proves the WHOLE range is sanitized, not just its leading byte.
      const mid = start + Math.floor((end - start) / 2)
      expect(cctpMessageFingerprint(flipByteAt(genuine, mid))).toBe(base)
    }
  })

  /* Round 33 — the actual defect this redesign fixes. Round 32's own
     allow-list still omitted sourceDomain, header sender, recipient,
     destinationCaller, and minFinalityThreshold — corrupting any of them
     produced NO change in the old fingerprint at all. Every one of these
     now flips the hash, because the hash covers everything except the 4
     established-mutable ranges above by construction, not by remembering
     to name each field. */
  describe('every immutable byte outside the 4 mutable ranges is covered — a single corrupted byte anywhere changes the hash', () => {
    // version bytes (header offset 0, body offset 148) are deliberately
    // excluded from this table — assertWellFormedCctpV2Message rejects a
    // non-V2 version by THROWING before the hash is ever computed (see the
    // hex well-formedness gate describe block below), not by silently
    // producing a different hash, so they're a different behavior than
    // every other byte in the message.
    const genuine = buildCctpMessage({})
    const base = cctpMessageFingerprint(genuine)
    const cases = [
      ['sourceDomain', 4],
      ['destinationDomain', 8],
      ['header sender', 44],
      ['recipient — the field Round 32 omitted entirely', 76],
      ['destinationCaller', 108],
      ['minFinalityThreshold — the other field Round 32 omitted', 140],
      ['burnToken', 152],
      ['mintRecipient', 184],
      ['amount', 216],
      ['messageSender (body)', 248],
      ['maxFee', 280],
      ['hookData', 377]
    ]
    for (const [label, offset] of cases) {
      it(`byte offset ${offset} (${label})`, () => {
        expect(cctpMessageFingerprint(flipByteAt(genuine, offset))).not.toBe(base)
      })
    }
  })

  // NOTE: buildCctpMessage always zeros the `recipient` word (76-108) — it
  // takes no `recipient` param — so this test varies only destinationDomain,
  // not recipient. Recipient-byte coverage is proven separately by the
  // byte-offset-76 case in the systematic table above; this test's job is
  // narrower: showing that ordinary destinationDomain variation between two
  // otherwise-identical messages is unremarkable, hash-changing content, not
  // a case requiring special handling.
  it('legitimate destinationDomain variability is ordinary content, not a special case — two otherwise-identical messages to different destination domains simply hash differently, the same as any other differing field', () => {
    const toDomainSix = buildCctpMessage({ destinationDomain: 6 })
    const toDomainZero = buildCctpMessage({ destinationDomain: 0 })
    expect(cctpMessageFingerprint(toDomainSix)).not.toBe(cctpMessageFingerprint(toDomainZero))
  })

  it('hex case does not affect the hash — the same bytes represented with uppercase hex digits fingerprint identically (hex parsing is case-insensitive; only the numeric byte value is hashed)', () => {
    const message = buildCctpMessage({ burnToken: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01' })
    const shouted = '0x' + message.slice(2).toUpperCase()
    expect(cctpMessageFingerprint(shouted)).toBe(cctpMessageFingerprint(message))
  })

  /* Round 32 (fixing the Round 31 review's Medium finding: "the complete
     message check doesn't validate the whole message", part a). The
     length/version checks alone only ever covered bytes this function
     itself read (through messageSender at 280, in the old field-by-field
     design) — they never independently confirmed the STRING is well-formed
     hex end-to-end. A non-hex byte anywhere the checks above don't happen
     to touch could previously slip through with no throw at all. Still
     required under the Round 33 redesign: sanitizeCctpMessage's hexToBytes
     call needs well-formed hex before it can zero the mutable ranges at
     all. */
  describe('hex well-formedness gate', () => {
    it('throws on an odd-length hex string, even if long enough and version-correct otherwise', () => {
      const valid = buildCctpMessage({})
      const oddLength = valid.slice(0, -1) // drop the last hex digit
      expect(() => cctpMessageFingerprint(oddLength)).toThrow(/not well-formed hex/)
    })

    it('throws on a non-hex character anywhere in the string, including a byte range no named field reader ever directly touches', () => {
      const valid = buildCctpMessage({})
      // byte 100 sits inside `recipient` (76-108) — proving the
      // well-formedness check is a blanket string-level gate, not
      // dependent on any particular field being read by name.
      const charIndex = 2 + 100 * 2 // "0x" prefix + byte offset -> hex char index
      const corrupted = valid.slice(0, charIndex) + 'zz' + valid.slice(charIndex + 2)
      expect(() => cctpMessageFingerprint(corrupted)).toThrow(/not well-formed hex/)
    })
  })
})

/* irisMessageMatchesFingerprint — Round 30 (fixing the Round 29 review's
   Medium finding: "fingerprint check depends on a nullable Iris field").
   Circle's real schema marks decodedMessage/decodedMessageBody explicitly
   nullable (decode failure), so this now derives the Iris-side fingerprint
   directly from irisMessage.message (raw hex) via cctpMessageFingerprint —
   the same byte-offset parser the receipt-side fingerprint uses — instead
   of depending on Iris's optional decoded convenience object at all.

   Round 33: cctpMessageFingerprint is now a sanitized-message hash, not a
   field object — most of the "rejects a mismatched X" tests below need no
   changes at all (a differing message still hashes differently, whatever
   field the difference is in), which is itself evidence the redesign is
   strictly more general than the allow-list it replaced. */
describe('irisMessageMatchesFingerprint', () => {
  const destinationDomain = 6
  const burnToken = '0x1111111111111111111111111111111111111111'
  const mintRecipient = '0x2222222222222222222222222222222222222222'
  const amount = 5000n
  const bodySender = '0x3333333333333333333333333333333333333333'

  const fp = fingerprintFor({ destinationDomain, burnToken, mintRecipient, amount, bodySender })
  const realMessage = buildCctpMessage({ destinationDomain, burnToken, mintRecipient, amount, bodySender })

  const irisEntry = (overrides = {}) => ({
    message: realMessage,
    attestation: '0xatt',
    ...overrides
  })

  it('returns true when every immutable field matches, even with different address casing from Iris', () => {
    const shouted = irisEntry({
      message: buildCctpMessage({
        destinationDomain,
        burnToken: burnToken.toUpperCase().replace('0X', '0x'),
        mintRecipient,
        amount,
        bodySender
      })
    })
    expect(irisMessageMatchesFingerprint(shouted, fp)).toBe(true)
  })

  it('returns true when fingerprint is null — nothing to check against (legacy/absent record), matching the same permissive default expectedOrdinals == null already uses', () => {
    expect(irisMessageMatchesFingerprint(irisEntry(), null)).toBe(true)
    expect(irisMessageMatchesFingerprint(irisEntry(), undefined)).toBe(true)
  })

  it('rejects a mismatched destinationDomain', () => {
    expect(irisMessageMatchesFingerprint(irisEntry({ message: buildCctpMessage({ destinationDomain: 0, burnToken, mintRecipient, amount, bodySender }) }), fp)).toBe(false)
  })

  it('rejects a mismatched burnToken', () => {
    const wrong = irisEntry({ message: buildCctpMessage({ destinationDomain, burnToken: '0x9999999999999999999999999999999999999999', mintRecipient, amount, bodySender }) })
    expect(irisMessageMatchesFingerprint(wrong, fp)).toBe(false)
  })

  it('rejects a mismatched mintRecipient', () => {
    const wrong = irisEntry({ message: buildCctpMessage({ destinationDomain, burnToken, mintRecipient: '0x9999999999999999999999999999999999999999', amount, bodySender }) })
    expect(irisMessageMatchesFingerprint(wrong, fp)).toBe(false)
  })

  it('rejects a mismatched amount', () => {
    const wrong = irisEntry({ message: buildCctpMessage({ destinationDomain, burnToken, mintRecipient, amount: 1n, bodySender }) })
    expect(irisMessageMatchesFingerprint(wrong, fp)).toBe(false)
  })

  it('rejects a mismatched messageSender', () => {
    const wrong = irisEntry({ message: buildCctpMessage({ destinationDomain, burnToken, mintRecipient, amount, bodySender: '0x9999999999999999999999999999999999999999' }) })
    expect(irisMessageMatchesFingerprint(wrong, fp)).toBe(false)
  })

  // Round 32: maxFee and hookData, both newly added to the fingerprint.
  it('rejects a mismatched maxFee', () => {
    const withMaxFee = fingerprintFor({ destinationDomain, burnToken, mintRecipient, amount, bodySender, maxFee: 500_000n })
    const wrong = irisEntry({ message: buildCctpMessage({ destinationDomain, burnToken, mintRecipient, amount, bodySender, maxFee: 999_999n }) })
    expect(irisMessageMatchesFingerprint(wrong, withMaxFee)).toBe(false)
  })

  it('rejects a mismatched hookData', () => {
    const withHookData = fingerprintFor({ destinationDomain, burnToken, mintRecipient, amount, bodySender, hookData: hexZeros(32) })
    const wrong = irisEntry({ message: buildCctpMessage({ destinationDomain, burnToken, mintRecipient, amount, bodySender, hookData: CCTP_FORWARD_HOOK_HEX }) })
    expect(irisMessageMatchesFingerprint(wrong, withHookData)).toBe(false)
  })

  /* Round 33 — the actual defect this redesign fixes. Round 32's own
     allow-list never compared the header's `recipient` field (absolute
     76-108) at all — buildCctpMessage in this file has no override for it
     (it's always zeroed), so this corrupts it directly by byte offset,
     which the field-object design could never have caught regardless of
     what value it held. */
  it('rejects a corrupted recipient (header, byte 76) — a field the pre-Round-33 allow-list never compared at all', () => {
    const corruptedRecipient = irisEntry({ message: flipByteAt(realMessage, 76) })
    expect(irisMessageMatchesFingerprint(corruptedRecipient, fp)).toBe(false)
  })

  it('regression (Round 29 review Medium finding): succeeds when decodedMessage is null but the raw message field is present and genuinely matches — Iris\'s convenience decode failing must not misclassify a real, correct message as a mismatch', () => {
    const noDecode = irisEntry({ decodedMessage: null })
    expect(irisMessageMatchesFingerprint(noDecode, fp)).toBe(true)
  })

  it('treats a missing raw message as unattested/incomplete (matches, permissively) rather than an identity failure — useCctpDelivery\'s own attestation gate is what correctly keeps polling for this case', () => {
    expect(irisMessageMatchesFingerprint({ attestation: 'PENDING' }, fp)).toBe(true)
  })

  it('treats a raw message of "0x" (Circle\'s own pre-attestation sentinel) the same way — matches, permissively, not a mismatch', () => {
    expect(irisMessageMatchesFingerprint(irisEntry({ message: '0x', attestation: 'PENDING' }), fp)).toBe(true)
  })

  it('fails closed on a raw message that is present, non-"0x", but not valid CCTP V2 bytes — a genuinely different, more anomalous case than "not ready yet", so it must not be treated as a permissive match', () => {
    expect(irisMessageMatchesFingerprint(irisEntry({ message: '0xdead' }), fp)).toBe(false)
  })

  // Round 31 (fixing the Round 30 review's Medium finding: "raw-message
  // fingerprint check is fail-open in two ways", part a). An entry with an
  // empty message but a real, non-PENDING, non-null attestation (and, in a
  // real response, a terminal forwardState) is internally inconsistent and
  // should be unreachable — but the old code trusted the missing message
  // alone, without checking the paired attestation at all, so this
  // anomalous shape would previously have been waved through as "nothing
  // to check yet".
  it('fails closed on a missing raw message whose attestation is a real, non-PENDING, non-null value — an internally inconsistent shape a real response should never produce', () => {
    expect(irisMessageMatchesFingerprint({ attestation: 'COMPLETE' }, fp)).toBe(false)
  })

  it('fails closed on a raw message of "0x" whose attestation is a real, non-PENDING, non-null value', () => {
    expect(irisMessageMatchesFingerprint(irisEntry({ message: '0x', attestation: 'COMPLETE' }), fp)).toBe(false)
    expect(irisMessageMatchesFingerprint(irisEntry({ message: '0x' }), fp)).toBe(false)
  })

  /* Round 32 (fixing the Round 31 review's Medium finding: "attestation
     completeness ignores Circle's status field", the null-attestation
     half). Circle marks `attestation` itself nullable — a null (or
     entirely absent) attestation is a second, equally legitimate
     pre-attestation pairing alongside the PENDING-string one, not a
     mismatch. Matches useCctpDelivery's own attestation gate, which
     already treats a falsy attestation (including null) as unresolved,
     not an error. */
  it('treats a missing/"0x" message paired with a null OR entirely absent attestation as "nothing to check yet" (matches, permissively), not a mismatch', () => {
    expect(irisMessageMatchesFingerprint({ attestation: null }, fp)).toBe(true)
    expect(irisMessageMatchesFingerprint({}, fp)).toBe(true)
    expect(irisMessageMatchesFingerprint(irisEntry({ message: '0x', attestation: null }), fp)).toBe(true)
    expect(irisMessageMatchesFingerprint(irisEntry({ message: undefined, attestation: null }), fp)).toBe(true)
  })
})
