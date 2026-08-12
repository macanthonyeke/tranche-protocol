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

const { fetchIrisMessages, receiptEmittedCctpMessage } = await import('./irisDelivery.js')

afterEach(() => {
  vi.unstubAllGlobals()
})

const mockOk = (body) => ({ ok: true, status: 200, json: async () => body })

describe('fetchIrisMessages', () => {
  it('requests the sourceDomain as a path segment and the tx hash as a transactionHash query param', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(mockOk({ messages: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await fetchIrisMessages('0xabc123')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain(`/v2/messages/${ARC_DOMAIN}`)
    expect(url).toContain('transactionHash=0xabc123')
    // The bug this closes: the tx hash must never appear where the domain
    // path segment goes.
    expect(url).not.toContain(`/v2/messages/0xabc123`)
  })

  it('defaults sourceDomain to ARC_DOMAIN — every tracked burn in this app originates from Arc', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(mockOk({ messages: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await fetchIrisMessages('0xabc123')

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/v2/messages/26?')
  })

  it('accepts an explicit sourceDomain override', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(mockOk({ messages: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await fetchIrisMessages('0xabc123', 6)

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
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockOk({ messages: [realShapedMessage], sourceTxHash: '0xabc123' }))))
    await expect(fetchIrisMessages('0xabc123')).resolves.toEqual([realShapedMessage])
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
    const fetchMock = vi.fn(() => Promise.resolve(mockOk({ messages: [] })))
    vi.stubGlobal('fetch', fetchMock)
    return fetchIrisMessages('0xabc999').then(() => {
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
    let resolveFetch
    const fetchMock = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))
    vi.stubGlobal('fetch', fetchMock)

    const p1 = fetchIrisMessages('0xsame')
    const p2 = fetchIrisMessages('0xsame')

    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch(mockOk({ messages: [{ message: '0xshared' }] }))
    await expect(p1).resolves.toEqual([{ message: '0xshared' }])
    await expect(p2).resolves.toEqual([{ message: '0xshared' }])
  })

  it('does NOT dedup a concurrent request for a genuinely different txHash', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(mockOk({ messages: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([fetchIrisMessages('0xone'), fetchIrisMessages('0xtwo')])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT dedup requests for the same txHash on different sourceDomains', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(mockOk({ messages: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([fetchIrisMessages('0xsametx', 26), fetchIrisMessages('0xsametx', 6)])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('allows a fresh request for the same txHash once the prior one has settled — the guard is not permanent', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(mockOk({ messages: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await fetchIrisMessages('0xsequential')
    await fetchIrisMessages('0xsequential')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('clears the in-flight slot even when the request throws, so the next poll is not permanently blocked', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500 })))
    await expect(fetchIrisMessages('0xerrors')).rejects.toThrow('Iris HTTP 500')

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockOk({ messages: [] }))))
    await expect(fetchIrisMessages('0xerrors')).resolves.toEqual([])
  })
})

/* receiptEmittedCctpMessage — Round 22 Phase A.

   Every prior fix to delivery tracking (Round 20 Phase B/D, Round 21 Phase
   C/D) taught the frontend to correctly check "did the intended
   business-logic action succeed" — did the ruling actually pay someone, did
   settlement proposals actually match. A correct answer to that question is
   still not the same question as "did a CCTP message actually get created":
   claimDelivery succeeding is real, it's just not a cross-chain delivery;
   MutualSettlementExecuted firing is real, it's just not proof a burn
   happened, since the contract emits it even when every leg rounds to zero
   or diverts to an Arc credit. This is the one shared ground-truth check —
   a real MessageSent log in the confirmed receipt — that answers the actual
   question, replacing three separately-reasoned-about "did this execute"
   checks (MilestoneAction, DisputeBlock, SettlementPanel).

   MESSAGE_TRANSMITTER, the topic0, and the exact "message" field decode
   were all verified live against a real Arc-testnet depositForBurnWithHook
   transaction (see receiptEmittedCctpMessage's own doc comment in
   irisDelivery.js) — these fixtures build the SAME real event shape via
   viem's encodeEventTopics/encodeAbiParameters, not hand-rolled objects, so
   a fixture only passes if it would actually decode against the real ABI. */
const MESSAGE_TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' // Arc's own (source-side) MessageTransmitterV2, verified live
const MESSAGE_SENT_ABI = [
  { name: 'MessageSent', type: 'event', inputs: [{ name: 'message', type: 'bytes', indexed: false }], anonymous: false }
]

const messageSentLog = (messageHex = '0x1234', address = MESSAGE_TRANSMITTER) => ({
  address,
  topics: encodeEventTopics({ abi: MESSAGE_SENT_ABI, eventName: 'MessageSent' }),
  data: encodeAbiParameters([{ type: 'bytes' }], [messageHex])
})

const escrowLog = (eventName, args, address = CONTRACT_ADDRESS) => {
  const abiItem = ESCROW_ABI.find((i) => i.type === 'event' && i.name === eventName)
  const topics = encodeEventTopics({ abi: ESCROW_ABI, eventName, args })
  const nonIndexed = abiItem.inputs.filter((i) => !i.indexed)
  const data = nonIndexed.length > 0
    ? encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name]))
    : '0x'
  return { address, topics, data }
}

describe('receiptEmittedCctpMessage', () => {
  it('is false for a real claimDelivery receipt — no funds move, no CCTP message, regardless of the escrow\'s configured domain', () => {
    // claimDelivery's own confirm descriptor states this outright: "No
    // funds move on this transaction." A real receipt for it contains only
    // DeliveryClaimed, never anything from the MessageTransmitter.
    const receipt = {
      transactionHash: '0xtx1',
      logs: [escrowLog('DeliveryClaimed', { escrowId: 7n, milestoneIndex: 1n, reviewDeadline: 123n })]
    }
    expect(receiptEmittedCctpMessage(receipt)).toEqual({ emitted: false, count: 0 })
  })

  it('is false for a real refundAfterDeadline receipt — credits an Arc refund balance only, never cross-chain', () => {
    // TrancheProtocol.sol:715: refundBalances[e.refundTo] on Arc, no
    // transfer, no CCTP burn — true regardless of destinationDomain.
    const receipt = {
      transactionHash: '0xtx2',
      logs: [escrowLog('RefundedAfterDeadline', { escrowId: 7n, milestoneIndex: 1n, amount: 250_000_000n })]
    }
    expect(receiptEmittedCctpMessage(receipt)).toEqual({ emitted: false, count: 0 })
  })

  it('is false for a resolveDispute ruling that executes but rounds to zero or diverts every cross-chain leg to Arc', () => {
    // DisputeResolved fires unconditionally on a successful resolveDispute
    // call — it does not by itself mean a burn happened. A ruling whose
    // recipient share rounds to zero, or whose every cross-chain leg
    // diverts to an Arc credit (sub-floor), settles with no MessageSent at
    // all despite genuinely executing.
    const receipt = {
      transactionHash: '0xtx3',
      logs: [escrowLog('DisputeResolved', { escrowId: 7n, milestoneIndex: 1n, recipientBps: 6000n, resolutionHash: '0x' + '00'.repeat(32), resolutionURI: 'ipfs://x' })]
    }
    expect(receiptEmittedCctpMessage(receipt)).toEqual({ emitted: false, count: 0 })
  })

  it('is true, count 1, for a genuine no-split cross-chain approveRelease burn', () => {
    const receipt = {
      transactionHash: '0xtx4',
      logs: [
        escrowLog('MilestoneApproved', { escrowId: 7n, milestoneIndex: 1n }),
        messageSentLog('0xdeadbeef')
      ]
    }
    expect(receiptEmittedCctpMessage(receipt)).toEqual({ emitted: true, count: 1 })
  })

  it('is true, count matching the real number, for a mixed split settling multiple cross-chain legs in one transaction', () => {
    // A mixed split can burn several legs to different chains in a single
    // call (bounded by MAX_SPLITS = 10) — each is its own MessageSent.
    const receipt = {
      transactionHash: '0xtx5',
      logs: [
        escrowLog('MutualSettlementProposed', { escrowId: 7n, milestoneIndex: 1n, proposer: '0x179cc4c8f23d257b7f4acb785464025570e3af86', bps: 6000n }),
        escrowLog('MutualSettlementExecuted', { escrowId: 7n, milestoneIndex: 1n, bps: 6000n }),
        messageSentLog('0x0001'),
        messageSentLog('0x0002'),
        messageSentLog('0x0003')
      ]
    }
    expect(receiptEmittedCctpMessage(receipt)).toEqual({ emitted: true, count: 3 })
  })

  it('does not mistake a log from a different contract for MessageSent, and does not crash on one', () => {
    const receipt = {
      transactionHash: '0xtx6',
      logs: [
        { address: '0x3600000000000000000000000000000000000000', topics: ['0xdeadbeef'], data: '0x' }, // USDC precompile, unrelated topic
        messageSentLog('0xcafe')
      ]
    }
    expect(receiptEmittedCctpMessage(receipt)).toEqual({ emitted: true, count: 1 })
  })

  it('returns false, count 0, not throws, for an empty logs array', () => {
    expect(receiptEmittedCctpMessage({ transactionHash: '0xtx7', logs: [] })).toEqual({ emitted: false, count: 0 })
  })
})
