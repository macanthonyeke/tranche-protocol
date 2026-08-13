// useCctpDelivery — Round 20 Phase D / Round 21 Phase A / Round 27.
//
// Two properties matter here: (1) the second argument is a plain
// isCrossChain boolean, used only to gate polling — not a domain value the
// hook trusts for anything else; and (2) each parsed delivery keeps ITS OWN
// destinationDomain from Iris, defaulting to null (never a caller-supplied
// guess) when Iris omits one. A mixed split settlement can burn to several
// DIFFERENT chains in one transaction, so collapsing every message's domain
// to one caller-supplied value was never safe — this is what stops that.
//
// Round 21 Phase A: the raw-message fixture below (`irisMessage`) matches
// Circle's REAL Iris response schema — verified live against
// iris-api-sandbox.circle.com using real Arc-testnet burn transactions,
// including a genuine depositForBurnWithHook call (hookData decodes to
// "cctp-forward"). destinationDomain lives at decodedMessage.destinationDomain
// (a string); forwardState/forwardTxHash/forwardErrorCode are flat on the
// message itself — there is no `forward` wrapper object. The previous
// version of this fixture used a shape that was never real, which is why the
// integration itself was broken despite these tests passing — the fixture
// and the bug agreed with each other, not with Circle's actual API.
//
// Round 27: every test below now passes expectedOrdinals/expectedTotalMessages
// — the hook no longer has an "unfiltered, trust whatever Iris returns"
// branch at all (see the hook's own doc comment for why: that branch was
// the exact identity gap Round 26 built content-matching to close, and
// Round 26's content-matching turned out to never work for a real message
// in the first place, since CCTP V2 mutates several message fields between
// burn-time and attestation). A real call site (a receipt-verified local
// track, or FallbackCrossChainDelivery's live receipt refetch) always has
// ordinals in hand before mounting a tracker at all.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const fetchIrisMessages = vi.hoisted(() => vi.fn())
// Round 29: irisMessageMatchesFingerprint is mocked too, not left to the
// real implementation — its own logic is exercised directly in
// irisDelivery.test.js; here the point is only testing useCctpDelivery's
// WIRING (does a mismatch stop it from selecting the message, does a match
// let normal flow continue). Defaults to true so every pre-Round-29 test
// below, which never passes expectedFingerprints, is unaffected.
const irisMessageMatchesFingerprint = vi.hoisted(() => vi.fn(() => true))
vi.mock('../utils/irisDelivery', () => ({ fetchIrisMessages, irisMessageMatchesFingerprint }))

const { useCctpDelivery } = await import('./useCctpDelivery.js')

beforeEach(() => {
  fetchIrisMessages.mockReset()
  irisMessageMatchesFingerprint.mockReset()
  irisMessageMatchesFingerprint.mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

const irisMessage = ({ destinationDomain = 6, forwardState = 'COMPLETE', forwardTxHash = '0xdesttx', forwardErrorCode = null, message = '0xmessage' } = {}) => ({
  message,
  attestation: '0xattestation',
  status: 'complete',
  decodedMessage: destinationDomain != null ? { destinationDomain: String(destinationDomain) } : {},
  forwardState,
  forwardTxHash,
  forwardErrorCode
})

describe('useCctpDelivery — isCrossChain gate', () => {
  it('stays idle and never fetches when isCrossChain is false', async () => {
    const { result } = renderHook(() => useCctpDelivery('0xtx', false))
    expect(result.current.phase).toBe('idle')
    await waitFor(() => expect(fetchIrisMessages).not.toHaveBeenCalled())
  })

  it('stays idle and never fetches when there is no txHash yet, even if isCrossChain is true', async () => {
    const { result } = renderHook(() => useCctpDelivery(null, true))
    expect(result.current.phase).toBe('idle')
    await waitFor(() => expect(fetchIrisMessages).not.toHaveBeenCalled())
  })

  it('polls once isCrossChain is true, a txHash is present, and expectedOrdinals is provided', async () => {
    fetchIrisMessages.mockResolvedValue([irisMessage()])
    renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalledWith('0xtx'))
  })
})

describe('useCctpDelivery — per-message domain, never collapsed to a caller-supplied value', () => {
  it('keeps each message\'s own destinationDomain from Iris, even when they differ from each other', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6 }),   // Base Sepolia
      irisMessage({ destinationDomain: 0 })    // Ethereum Sepolia — genuinely different chain
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0, 1], 2))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(result.current.deliveries.map((d) => d.destinationDomain)).toEqual([6, 0])
  })

  it('defaults an Iris-omitted domain to null, never to some other message\'s domain or a guess', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6 }),
      irisMessage({ destinationDomain: null })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0, 1], 2))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(result.current.deliveries[0].destinationDomain).toBe(6)
    expect(result.current.deliveries[1].destinationDomain).toBeNull()
  })

  it('reads the real Iris nesting — decodedMessage.destinationDomain as a string — not a flat top-level field', async () => {
    // Regression guard for the actual Round 21 bug: the OLD code read
    // m.destinationDomain (flat, never real) and always got undefined. This
    // fixture has NO flat destinationDomain at all, only the nested real one,
    // so a reversion to the flat read would make this resolve to null.
    fetchIrisMessages.mockResolvedValue([{
      message: '0xmessage', attestation: '0xattestation', status: 'complete',
      decodedMessage: { destinationDomain: '6' },
      forwardState: 'COMPLETE', forwardTxHash: '0xdesttx', forwardErrorCode: null
    }])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(result.current.deliveries[0].destinationDomain).toBe(6)
  })
})

describe('useCctpDelivery — forwardState/forwardTxHash/forwardErrorCode are flat, never nested under a `forward` wrapper', () => {
  it('reads a real completed message correctly with no `forward` object present anywhere', async () => {
    fetchIrisMessages.mockResolvedValue([irisMessage({ forwardState: 'COMPLETE', forwardTxHash: '0xrealdesttx' })])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(result.current.deliveries[0].forwardState).toBe('COMPLETE')
    expect(result.current.deliveries[0].destinationTxHash).toBe('0xrealdesttx')
  })

  it('reads a real failed message\'s errorCode correctly', async () => {
    fetchIrisMessages.mockResolvedValue([irisMessage({ forwardState: 'FAILED', forwardTxHash: null, forwardErrorCode: 'INSUFFICIENT_FEE' })])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(result.current.phase).toBe('failed'))
    expect(result.current.deliveries[0].forwardState).toBe('FAILED')
    expect(result.current.deliveries[0].errorCode).toBe('INSUFFICIENT_FEE')
  })
})

describe('useCctpDelivery — mixed outcomes are preserved in `deliveries`, not collapsed by `phase`', () => {
  it('keeps the COMPLETE message\'s own data intact even when phase is "failed" because a DIFFERENT message failed', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE', forwardTxHash: '0xgood', forwardErrorCode: null }),
      irisMessage({ destinationDomain: 0, forwardState: 'FAILED', forwardTxHash: null, forwardErrorCode: 'INSUFFICIENT_FEE' })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0, 1], 2))
    await waitFor(() => expect(result.current.phase).toBe('failed'))

    // The aggregate phase says "failed", but the actually-delivered message's
    // own record is still fully present and correct in `deliveries` — a
    // consumer rendering per-message (not gating on `phase` alone) can still
    // show it as delivered.
    const [complete, failed] = result.current.deliveries
    expect(complete.forwardState).toBe('COMPLETE')
    expect(complete.destinationDomain).toBe(6)
    expect(complete.destinationTxHash).toBe('0xgood')
    expect(failed.forwardState).toBe('FAILED')
    expect(failed.destinationDomain).toBe(0)
    expect(failed.errorCode).toBe('INSUFFICIENT_FEE')
  })

  it('surfaces two independently-failed messages on different domains, both present in `deliveries`', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6, forwardState: 'FAILED', forwardTxHash: null, forwardErrorCode: 'INSUFFICIENT_FEE' }),
      irisMessage({ destinationDomain: 0, forwardState: 'FAILED', forwardTxHash: null, forwardErrorCode: 'INSUFFICIENT_FEE' })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0, 1], 2))
    await waitFor(() => expect(result.current.phase).toBe('failed'))
    expect(result.current.deliveries).toHaveLength(2)
    expect(result.current.deliveries.map((d) => d.destinationDomain)).toEqual([6, 0])
    expect(result.current.deliveries.every((d) => d.forwardState === 'FAILED')).toBe(true)
  })
})

/* Round 22 Phase B — terminality regression guard.
   CONFIRMED is a real, directly observed forwardState (a live Arc-testnet tx
   was seen transitioning CONFIRMED -> COMPLETE between two real Iris polls),
   and it is NOT terminal. The old check inferred "done" from "no PENDING and
   no missing forwardState" — a mixed FAILED + CONFIRMED response satisfied
   that (no PENDING present) and stopped polling with phase 'failed', even
   though the CONFIRMED leg could still resolve to COMPLETE. This exercises
   exactly that combination, not the COMPLETE + FAILED one the older tests
   above already cover. */
describe('useCctpDelivery — terminality requires every message to be explicitly COMPLETE or FAILED', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps polling on a FAILED + CONFIRMED mix — CONFIRMED is not terminal', async () => {
    vi.useFakeTimers()
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6, forwardState: 'FAILED', forwardTxHash: null, forwardErrorCode: 'INSUFFICIENT_FEE' }),
      irisMessage({ destinationDomain: 0, forwardState: 'CONFIRMED', forwardTxHash: null, forwardErrorCode: null })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0, 1], 2))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchIrisMessages).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('polling')

    // A second poll with the SAME mixed response must not have latched a
    // terminal phase — the hook should still be actively polling.
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(fetchIrisMessages).toHaveBeenCalledTimes(2)
    expect(result.current.phase).toBe('polling')
  })

  it('settles to failed only once the CONFIRMED leg itself reaches an explicit terminal state', async () => {
    vi.useFakeTimers()
    fetchIrisMessages
      .mockResolvedValueOnce([
        irisMessage({ destinationDomain: 6, forwardState: 'FAILED', forwardTxHash: null, forwardErrorCode: 'INSUFFICIENT_FEE' }),
        irisMessage({ destinationDomain: 0, forwardState: 'CONFIRMED', forwardTxHash: null, forwardErrorCode: null })
      ])
      .mockResolvedValueOnce([
        irisMessage({ destinationDomain: 6, forwardState: 'FAILED', forwardTxHash: null, forwardErrorCode: 'INSUFFICIENT_FEE' }),
        irisMessage({ destinationDomain: 0, forwardState: 'COMPLETE', forwardTxHash: '0xdesttx', forwardErrorCode: null })
      ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0, 1], 2))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.phase).toBe('polling')

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(fetchIrisMessages).toHaveBeenCalledTimes(2)
    expect(result.current.phase).toBe('failed')

    // Terminal now — a third tick must not fire another fetch.
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(fetchIrisMessages).toHaveBeenCalledTimes(2)
  })
})

/* Round 27 (fixing the Round 26 review's High finding) — expectedOrdinals /
   expectedTotalMessages guard, direct coverage.

   Round 22 Phase A introduced a bare count. Round 26 replaced it with
   content identity (raw message hex, matched against Iris's own `message`
   field) to fix a real cross-attribution bug (finding 2: a bare count let a
   message genuinely belonging to a DIFFERENT milestone in the same batched
   tx pass undetected). But content identity turned out to never work for a
   REAL message at all: CCTP V2 assigns nonce off-chain, fills in
   finalityThresholdExecuted/feeExecuted only once Iris attests, and can
   change expirationBlock too, so a real message's source-side bytes and
   Iris's returned bytes for the SAME delivery are never byte-equal —
   confirmed live against a real Arc-testnet burn. Every real poll under
   Round 26's design had messages.length === 0 forever.

   Round 27 replaces content matching with ORDINAL POSITION: Circle's own
   GET /v2/messages API reference states "Each message for a given
   transaction hash is ordered by ascending log index" — so
   expectedOrdinals (this milestone's own verified messages' 0-indexed
   positions among every real MessageTransmitterV2 log in the WHOLE
   receipt) picks the right Iris entries without ever comparing content,
   once expectedTotalMessages (the universe's own size) confirms Iris has
   indexed the whole transaction. */
describe('useCctpDelivery — expectedOrdinals / expectedTotalMessages guard', () => {
  it('keeps polling when Iris has indexed fewer messages than the receipt proved should exist across the WHOLE transaction, even though the ones it has are already COMPLETE', async () => {
    fetchIrisMessages.mockResolvedValue([irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE' })])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 2))
    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalled())
    expect(result.current.phase).toBe('polling')
    expect(result.current.deliveries).toEqual([])
  })

  it('proceeds to delivered once Iris catches up to the full expected set', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE' }),
      irisMessage({ destinationDomain: 0, forwardState: 'COMPLETE' })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0, 1], 2))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(result.current.deliveries).toHaveLength(2)
  })

  // Round 28 — fail closed on overflow, not just undershoot. Nothing in
  // Circle's API reference rules out Iris ever returning MORE entries than
  // the receipt's real count, and an overflow occurring before or between
  // the selected ordinals would shift indexing and select the wrong
  // message. The old `<` check silently accepted this; `!==` keeps polling
  // instead.
  it('keeps polling — never selects — when Iris returns MORE entries than expectedTotalMessages', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE' }),
      irisMessage({ destinationDomain: 0, forwardState: 'COMPLETE' }),
      irisMessage({ destinationDomain: 3, forwardState: 'COMPLETE' })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0, 1], 2))
    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalled())
    expect(result.current.phase).toBe('polling')
    expect(result.current.deliveries).toEqual([])
  })

  it('selects Iris entries by POSITION, not the milestone\'s own count — a foreign milestone\'s message occupying an earlier ordinal slot in the same tx must not be selected as this milestone\'s own', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 3, forwardState: 'FAILED' }),      // ordinal 0 — a DIFFERENT milestone's own message
      irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE' })     // ordinal 1 — this milestone's own
    ])
    // This milestone's own verified message is ordinal 1 of 2 total.
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [1], 2))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    // The foreign message at ordinal 0 (FAILED, domain 3) must never leak
    // in — if it had, phase would be 'failed' and deliveries would have
    // length 2, not 1.
    expect(result.current.deliveries).toHaveLength(1)
    expect(result.current.deliveries[0].destinationDomain).toBe(6)
  })

  /* The exact regression the High finding describes: a genuine message
     whose Iris-returned form differs from its receipt-derived source form
     in precisely the fields CCTP V2 treats as mutable (nonce,
     finalityThresholdExecuted, feeExecuted, expirationBlock) must still be
     correctly attributed to the milestone. Under Round 26's content-matching
     design this would have failed forever (messages.length stuck at 0);
     under ordinal selection, content is never even inspected for matching. */
  it('attributes a genuine message correctly even though its Iris-returned `message` bytes differ from the source-side bytes in CCTP V2\'s mutable fields (nonce, finalityThresholdExecuted, feeExecuted, expirationBlock) — content is never compared', async () => {
    // The source-side receipt would have had nonce/finalityThresholdExecuted/
    // feeExecuted/expirationBlock all zero (pre-attestation); Iris's response
    // here uses deliberately DIFFERENT, non-zero values in exactly those
    // fields — real CCTP V2 behavior, confirmed live against an actual
    // Arc-testnet burn. The fixture only needs a message string that would
    // NEVER content-match a zeroed source message; the exact bytes don't
    // matter since ordinal selection never reads them for matching.
    fetchIrisMessages.mockResolvedValue([
      irisMessage({
        destinationDomain: 6,
        forwardState: 'COMPLETE',
        message: '0xattested-form-with-real-nonce-and-finality-and-fee-filled-in'
      })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(result.current.deliveries).toHaveLength(1)
    expect(result.current.deliveries[0].destinationDomain).toBe(6)
  })

  /* The other scenario the High finding's own review explicitly asked for:
     a batched transaction where a forged (finding-1-style) message —
     real MessageTransmitterV2 contract, wrong header.sender, so it still
     gets a real MessageSent log and a real ordinal slot in Iris's response
     — occupies an EARLIER ordinal slot than this milestone's own genuine
     message. The forged message must not shift or replace what gets
     selected for the genuine one. */
  it('selects the correct Iris entry despite a finding-1-style forged message occupying an earlier ordinal slot in the same transaction', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 0, forwardState: 'FAILED', message: '0xforged' }),     // ordinal 0 — the forged message
      irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE', message: '0xgenuine' })    // ordinal 1 — this milestone's own genuine message
    ])
    // receiptEmittedCctpMessageForMilestone would have computed ordinals: [1]
    // here — verifiedOwnCctpMessage rejects the forged message (wrong
    // header.sender), but it still occupies ordinal 0 of the 2-message
    // universe, so the genuine message's own position is 1, not 0.
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [1], 2))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(result.current.deliveries).toHaveLength(1)
    expect(result.current.deliveries[0].message).toBe('0xgenuine')
    expect(result.current.deliveries[0].destinationDomain).toBe(6)
  })

  it('never trusts Iris unfiltered when expectedOrdinals is not provided — stays in polling forever rather than reopening the identity gap the ordinal/content guards exist to close', async () => {
    fetchIrisMessages.mockResolvedValue([irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE' })])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true))
    await waitFor(() => expect(result.current.phase).toBe('polling'))
    // Never even calls Iris — there is nothing safe to do with the response
    // without ordinals to select by.
    expect(fetchIrisMessages).not.toHaveBeenCalled()
    expect(result.current.deliveries).toEqual([])
  })
})

/* expectedFingerprints — Round 29 (fixing the Round 29 review's Medium
   finding: "equal cardinality doesn't prove equal membership"). Ordinal
   position (Round 27) proves WHERE a message sits; it does not prove its
   CONTENT is genuinely this milestone's own. irisMessageMatchesFingerprint
   is the last check before an ordinal-selected entry gets trusted. */
describe('useCctpDelivery — expectedFingerprints identity check', () => {
  it('proceeds normally when every selected message matches its fingerprint', async () => {
    irisMessageMatchesFingerprint.mockReturnValue(true)
    fetchIrisMessages.mockResolvedValue([irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE' })])
    const fp = [{ destinationDomain: 6, burnToken: '0xa', mintRecipient: '0xb', amount: '1', messageSender: '0xc' }]
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1, fp))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(irisMessageMatchesFingerprint).toHaveBeenCalledWith(expect.objectContaining({ message: '0xmessage' }), fp[0])
  })

  it('regression: same length AND same ordinal position, but the selected entry\'s content does not match its fingerprint — stays polling, never selected. This is the layered defense ordinal-position matching alone cannot provide: Phase C\'s sourceTxHash check catches a foreign message from a DIFFERENT transaction; this catches misattribution WITHIN the same transaction/response', async () => {
    irisMessageMatchesFingerprint.mockReturnValue(false)
    fetchIrisMessages.mockResolvedValue([irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE' })])
    const fp = [{ destinationDomain: 0, burnToken: '0xwrong', mintRecipient: '0xwrong', amount: '999', messageSender: '0xwrong' }]
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1, fp))
    await waitFor(() => expect(irisMessageMatchesFingerprint).toHaveBeenCalled())
    // Give it a moment to settle — must never transition to 'delivered'.
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.phase).toBe('polling')
    expect(result.current.deliveries).toEqual([])
  })

  it('a partial mismatch — one of two messages fails its fingerprint — keeps the WHOLE selection untrusted, not just the mismatched one (there is no safe partial-trust state)', async () => {
    irisMessageMatchesFingerprint.mockImplementation((_, fp) => fp.ok)
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE' }),
      irisMessage({ destinationDomain: 0, forwardState: 'COMPLETE' })
    ])
    const fp = [{ ok: true }, { ok: false }]
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0, 1], 2, fp))
    await waitFor(() => expect(irisMessageMatchesFingerprint).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.phase).toBe('polling')
    expect(result.current.deliveries).toEqual([])
  })

  it('skips the fingerprint check entirely when expectedFingerprints is not provided — same permissive default as expectedOrdinals, so this never regresses pre-Round-29 call sites', async () => {
    fetchIrisMessages.mockResolvedValue([irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE' })])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(irisMessageMatchesFingerprint).not.toHaveBeenCalled()
  })
})

/* 'stale' phase — Round 29 (Low finding). A persistent overflow (Round 28's
   fail-closed case) is indistinguishable in the UI from a genuinely
   still-in-progress delivery — "Delivering…" forever with no diagnostic.
   These tests drive the poll loop through real intervals with fake timers
   (the same pattern the terminality tests above already use) to prove the
   counting/reset logic end to end, not just call it directly. */
describe('useCctpDelivery — stale phase (persistent-overflow / stuck detection)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays in polling — never stale — for fewer than the threshold\'s worth of identical outcomes', async () => {
    vi.useFakeTimers()
    // Round 28 overflow scenario: 3 real Iris entries when the receipt only
    // ever proved 2 exist. Static across every poll — the exact "same wrong
    // answer forever" case this mechanism targets.
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6 }), irisMessage({ destinationDomain: 0 }), irisMessage({ destinationDomain: 7 })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0, 1], 2))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    // 7 more identical polls (8 total) — still one short of the threshold.
    for (let i = 0; i < 6; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    }
    expect(fetchIrisMessages).toHaveBeenCalledTimes(7)
    expect(result.current.phase).toBe('polling')
  })

  it('transitions to stale once the SAME overflow repeats for 8 consecutive polls (Round 28\'s persistent-overflow scenario)', async () => {
    vi.useFakeTimers()
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6 }), irisMessage({ destinationDomain: 0 }), irisMessage({ destinationDomain: 7 })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0, 1], 2))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    for (let i = 0; i < 8; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    }
    expect(fetchIrisMessages).toHaveBeenCalledTimes(9)
    expect(result.current.phase).toBe('stale')
    // Still polling in the background, not a terminal state — the interval
    // must not have been cleared (unlike 'delivered'/'failed', which do
    // clearInterval). One more tick keeps calling fetchIrisMessages.
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(fetchIrisMessages).toHaveBeenCalledTimes(10)
  })

  it('never goes stale when the count is genuinely growing poll to poll — real indexing progress, not stuck', async () => {
    vi.useFakeTimers()
    // 9 polls of a STRICTLY INCREASING (but never reaching expectedTotalMessages
    // until the very end) count would never repeat a signature — simulated
    // here with 8 identical under-counts would go stale, so instead each
    // poll returns one MORE message than the last, proving growth resets
    // the counter every time.
    for (let n = 1; n <= 9; n++) {
      fetchIrisMessages.mockResolvedValueOnce(
        Array.from({ length: n }, (_, i) => irisMessage({ destinationDomain: i }))
      )
    }
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 20))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    for (let i = 0; i < 8; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    }
    expect(fetchIrisMessages).toHaveBeenCalledTimes(9)
    // Every poll saw a different count than the last (1..9, never 20) — the
    // signature changed every single time, so this must never go stale.
    expect(result.current.phase).toBe('polling')
  })

  it('recovers out of stale once Iris\'s response actually resolves correctly', async () => {
    vi.useFakeTimers()
    const stuck = () => [
      irisMessage({ destinationDomain: 6 }), irisMessage({ destinationDomain: 0 }), irisMessage({ destinationDomain: 7 })
    ]
    for (let i = 0; i < 9; i++) fetchIrisMessages.mockResolvedValueOnce(stuck())
    fetchIrisMessages.mockResolvedValueOnce([
      irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE' }),
      irisMessage({ destinationDomain: 0, forwardState: 'COMPLETE' })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0, 1], 2))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    for (let i = 0; i < 8; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    }
    expect(result.current.phase).toBe('stale')

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(result.current.phase).toBe('delivered')
  })
})
