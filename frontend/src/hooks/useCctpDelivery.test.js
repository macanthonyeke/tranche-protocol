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
// Round 31: cctpMessageFingerprint is left as the REAL implementation
// (spread from importOriginal), not mocked — useCctpDelivery now calls it
// directly to derive destinationDomain from the raw message bytes (see the
// "raw-message domain" describe block below), and that needs genuine
// byte-offset parsing to exercise for real, not a stub.
vi.mock('../utils/irisDelivery', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchIrisMessages,
  irisMessageMatchesFingerprint
}))

const { useCctpDelivery } = await import('./useCctpDelivery.js')

beforeEach(() => {
  fetchIrisMessages.mockReset()
  irisMessageMatchesFingerprint.mockReset()
  irisMessageMatchesFingerprint.mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

// Round 33: a genuinely well-formed attestation — 65 bytes (one ECDSA
// signature), matching Circle's real CCTP V2 format — not a placeholder
// string like the old '0xattestation'/'0xrealattestation' literals, which
// read as plausible English but are not valid hex at all ('t' is not a hex
// digit) and would now fail isWellFormedAttestation's own check.
const REAL_ATTESTATION = '0x' + '11'.repeat(65)

const irisMessage = ({
  destinationDomain = 6, forwardState = 'COMPLETE', forwardTxHash = '0xdesttx',
  forwardErrorCode = null, message = '0xmessage', status = 'complete', attestation = REAL_ATTESTATION
} = {}) => ({
  message,
  attestation,
  status,
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
      message: '0xmessage', attestation: REAL_ATTESTATION, status: 'complete',
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

/* Round 32 — attestation completeness must check Circle's own `status`
   field, not just a present/non-PENDING `attestation` string.
   Codex's exact anomalous case: a message with a real, non-empty,
   non-PENDING attestation and even a terminal forwardState, but status
   still 'pending' (or absent) — internally inconsistent, should be
   unreachable in a genuine response, but the OLD gate (`m.attestation &&
   m.attestation !== 'PENDING'`) would have waved it through as delivered
   anyway, ignoring forwardState terminality entirely being reached on a
   response Circle itself hasn't marked complete. */
describe('useCctpDelivery — attestation completeness requires status === "complete", not just a non-PENDING attestation string', () => {
  it('does NOT treat a message as delivered when attestation is present and non-PENDING but status is "pending" — Codex\'s anomalous case', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ status: 'pending', attestation: REAL_ATTESTATION, forwardState: 'COMPLETE' })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalled())
    expect(result.current.phase).toBe('polling')
    expect(result.current.deliveries).toHaveLength(0)
  })

  it('does NOT treat a message as delivered when status is missing entirely, even with a real attestation and terminal forwardState', async () => {
    // Built directly, not via the irisMessage() helper — passing
    // status: undefined through the helper's destructuring defaults would
    // silently resolve back to 'complete' (JS applies a default parameter
    // whenever the value is undefined, key present or not), which would
    // defeat the point of this exact test.
    const { status: _omit, ...messageWithoutStatus } = irisMessage({ attestation: REAL_ATTESTATION, forwardState: 'COMPLETE' })
    fetchIrisMessages.mockResolvedValue([messageWithoutStatus])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalled())
    expect(result.current.phase).toBe('polling')
    expect(result.current.deliveries).toHaveLength(0)
  })

  it('treats a null attestation as unresolved (keep polling), not an error state, even with status "complete"', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ status: 'complete', attestation: null, forwardState: 'COMPLETE' })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalled())
    expect(result.current.phase).toBe('polling')
    expect(result.current.deliveries).toHaveLength(0)
  })

  it('resolves to delivered once status is "complete" AND attestation is present and non-PENDING', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ status: 'complete', attestation: REAL_ATTESTATION, forwardState: 'COMPLETE' })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
  })
})

/* Round 33 (Low finding). status === 'complete' and a present, non-PENDING
   attestation string can both hold while the value itself still isn't
   shaped like a real attestation — Circle's real format is one or more
   concatenated 65-byte ECDSA signatures. This is a gas-waste guard, not a
   fund-safety one (on-chain verification in receiveMessage already rejects
   a bad value) — a malformed attestation stays in the unresolved/keep-
   polling branch, exactly like every other not-yet-ready state, never a
   hard error. */
describe('useCctpDelivery — attestation completeness also requires a well-formed value, not just status + a non-PENDING string', () => {
  it('does NOT treat a message as delivered when attestation is present, non-PENDING, and status is "complete", but the value is not valid hex at all', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ status: 'complete', attestation: '0xnotvalidhexatall', forwardState: 'COMPLETE' })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalled())
    expect(result.current.phase).toBe('polling')
    expect(result.current.deliveries).toHaveLength(0)
  })

  it('does NOT treat a message as delivered when the attestation is well-formed hex but an odd number of hex digits', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ status: 'complete', attestation: REAL_ATTESTATION.slice(0, -1), forwardState: 'COMPLETE' })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalled())
    expect(result.current.phase).toBe('polling')
    expect(result.current.deliveries).toHaveLength(0)
  })

  it('does NOT treat a message as delivered when the attestation is well-formed hex but its byte length is not a multiple of 65 (a truncated or padded signature)', async () => {
    fetchIrisMessages.mockResolvedValue([
      // 64 bytes, one short of a real single signature.
      irisMessage({ status: 'complete', attestation: '0x' + '11'.repeat(64), forwardState: 'COMPLETE' })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalled())
    expect(result.current.phase).toBe('polling')
    expect(result.current.deliveries).toHaveLength(0)
  })

  it('does NOT treat a message as delivered when the attestation is exactly "0x" — well-formed hex, but zero bytes, not a genuine signature', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ status: 'complete', attestation: '0x', forwardState: 'COMPLETE' })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalled())
    expect(result.current.phase).toBe('polling')
    expect(result.current.deliveries).toHaveLength(0)
  })

  it('resolves to delivered for a genuine two-of-two multi-signature attestation (130 bytes = 2x65) — the multiple-signature threshold case, not just a single signature', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ status: 'complete', attestation: '0x' + '11'.repeat(130), forwardState: 'COMPLETE' })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
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

/* Round 31 (fixing the Round 30 review's Medium finding: "display/recovery
   logic still depends on the nullable decode"). decodedMessage is nullable
   per Circle's real schema — a genuine, terminal (even FAILED) message can
   have decodedMessage: null. The old code read destinationDomain from
   decodedMessage alone, so this case rendered EscrowDetail.jsx's
   SelfRelayCard with "Unknown chain" and no in-app self-relay option, even
   though the raw message bytes (already parsed for the identity check) hold
   the real domain. buildCctpMessage below constructs a real, complete
   (376+ byte) CCTP V2 message so cctpMessageFingerprint can genuinely parse
   it — the same fixture shape irisDelivery.test.js uses, needed because
   Round 31 also added a minimum-length/version floor to that parser. */
const hexZeros = (byteLen) => '00'.repeat(byteLen)
const uint32Hex = (n) => n.toString(16).padStart(8, '0')
const addressWordHex = (addr) => addr.slice(2).toLowerCase().padStart(64, '0')
const SOME_ADDRESS = '0x1234567890123456789012345678901234567890'
// Round 32: this app's real hookData is the FULL, right-padded 32-byte
// FORWARD_HOOK_DATA (bytes32, TrancheProtocol.sol:51), not just the raw
// 12-byte ASCII "cctp-forward" string — abi.encodePacked(bytes32) packs the
// whole fixed-size value verbatim (TrancheProtocol.sol:1371). Built
// programmatically (asciiHex + hexZeros) rather than hand-typed, matching
// irisDelivery.test.js's own fixture.
const asciiHex = (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
const CCTP_FORWARD_HOOK_HEX = asciiHex('cctp-forward') + hexZeros(32 - 'cctp-forward'.length)

const buildCctpMessage = (destinationDomain) =>
  '0x' +
  uint32Hex(1) +                       // header version            0-4
  hexZeros(4) +                        // sourceDomain               4-8
  uint32Hex(destinationDomain) +       // destinationDomain          8-12
  hexZeros(32) +                       // nonce                      12-44
  addressWordHex(SOME_ADDRESS) +       // header sender              44-76
  hexZeros(32 + 32 + 4 + 4) +          // recipient, destinationCaller, finality fields  76-148
  uint32Hex(1) +                       // body version               148-152
  hexZeros(32 + 32 + 32) +             // burnToken, mintRecipient, amount               152-248
  addressWordHex(SOME_ADDRESS) +       // messageSender              248-280
  hexZeros(32 + 32 + 32) +             // maxFee, feeExecuted, expirationBlock           280-376
  CCTP_FORWARD_HOOK_HEX                // hookData                   376+

describe('useCctpDelivery — raw-message domain, not solely the nullable decode', () => {
  it('derives destinationDomain from the raw message when decodedMessage is null, even on a terminal FAILED forwardState — SelfRelayCard needs the real chain to offer in-app self-relay, not "Unknown chain"', async () => {
    fetchIrisMessages.mockResolvedValue([{
      message: buildCctpMessage(6),
      attestation: REAL_ATTESTATION,
      status: 'complete',
      decodedMessage: null,
      forwardState: 'FAILED',
      forwardTxHash: null,
      forwardErrorCode: 'INSUFFICIENT_FEE'
    }])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(result.current.phase).toBe('failed'))
    expect(result.current.deliveries[0].destinationDomain).toBe(6)
  })

  it('falls back to decodedMessage when the raw message cannot be parsed — malformed/too-short bytes, an anomalous shape a real response should not produce', async () => {
    fetchIrisMessages.mockResolvedValue([{
      message: '0xdead', // present, non-"0x", but not a valid/complete CCTP V2 message
      attestation: REAL_ATTESTATION,
      status: 'complete',
      decodedMessage: { destinationDomain: '6' },
      forwardState: 'COMPLETE',
      forwardTxHash: '0xdesttx',
      forwardErrorCode: null
    }])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0], 1))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(result.current.deliveries[0].destinationDomain).toBe(6)
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

  /* Round 30 (Low finding): the catch/exception path previously left
     staleCountRef/lastSignatureRef untouched, so an outage sitting between
     two otherwise-identical unresolved outcomes didn't break the streak at
     all — the count kept accumulating across it as if nothing had
     interrupted. */
  it('resets the stale counter on the exception/catch path — an outage does not silently continue an unresolved streak from before it', async () => {
    vi.useFakeTimers()
    const overflow = () => [
      irisMessage({ destinationDomain: 6 }), irisMessage({ destinationDomain: 0 }), irisMessage({ destinationDomain: 7 })
    ]
    fetchIrisMessages.mockResolvedValue(overflow())
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, [0, 1], 2))

    // 8 identical-overflow polls — one short of the stale threshold (mirrors
    // the "stays polling" test above: internal streak count is 7, not yet 8).
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    for (let i = 0; i < 7; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    }
    expect(fetchIrisMessages).toHaveBeenCalledTimes(8)
    expect(result.current.phase).toBe('polling')

    // One poll that throws — this must reset the streak, not just skip a beat.
    fetchIrisMessages.mockRejectedValueOnce(new Error('network error'))
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(result.current.phase).toBe('unavailable')

    // Resume the exact same identical-overflow signature. Without the reset,
    // the pre-exception streak count (7) plus this one call would cross the
    // threshold and go stale immediately here. With the reset, this is only
    // the FIRST poll of a fresh streak, so it must stay in polling.
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(result.current.phase).toBe('polling')
  })
})
