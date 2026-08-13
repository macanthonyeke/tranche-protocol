// useCctpDelivery — Round 20 Phase D / Round 21 Phase A.
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const fetchIrisMessages = vi.hoisted(() => vi.fn())
vi.mock('../utils/irisDelivery', () => ({ fetchIrisMessages }))

const { useCctpDelivery } = await import('./useCctpDelivery.js')

beforeEach(() => {
  fetchIrisMessages.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

const irisMessage = ({ destinationDomain = 6, forwardState = 'COMPLETE', forwardTxHash = '0xdesttx', forwardErrorCode = null } = {}) => ({
  message: '0xmessage',
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

  it('polls once isCrossChain is true and a txHash is present', async () => {
    fetchIrisMessages.mockResolvedValue([irisMessage()])
    renderHook(() => useCctpDelivery('0xtx', true))
    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalledWith('0xtx'))
  })
})

describe('useCctpDelivery — per-message domain, never collapsed to a caller-supplied value', () => {
  it('keeps each message\'s own destinationDomain from Iris, even when they differ from each other', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6 }),   // Base Sepolia
      irisMessage({ destinationDomain: 0 })    // Ethereum Sepolia — genuinely different chain
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(result.current.deliveries.map((d) => d.destinationDomain)).toEqual([6, 0])
  })

  it('defaults an Iris-omitted domain to null, never to some other message\'s domain or a guess', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6 }),
      irisMessage({ destinationDomain: null })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true))
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
    const { result } = renderHook(() => useCctpDelivery('0xtx', true))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(result.current.deliveries[0].destinationDomain).toBe(6)
  })
})

describe('useCctpDelivery — forwardState/forwardTxHash/forwardErrorCode are flat, never nested under a `forward` wrapper', () => {
  it('reads a real completed message correctly with no `forward` object present anywhere', async () => {
    fetchIrisMessages.mockResolvedValue([irisMessage({ forwardState: 'COMPLETE', forwardTxHash: '0xrealdesttx' })])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(result.current.deliveries[0].forwardState).toBe('COMPLETE')
    expect(result.current.deliveries[0].destinationTxHash).toBe('0xrealdesttx')
  })

  it('reads a real failed message\'s errorCode correctly', async () => {
    fetchIrisMessages.mockResolvedValue([irisMessage({ forwardState: 'FAILED', forwardTxHash: null, forwardErrorCode: 'INSUFFICIENT_FEE' })])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true))
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
    const { result } = renderHook(() => useCctpDelivery('0xtx', true))
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
    const { result } = renderHook(() => useCctpDelivery('0xtx', true))
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
    const { result } = renderHook(() => useCctpDelivery('0xtx', true))

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
    const { result } = renderHook(() => useCctpDelivery('0xtx', true))

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

/* Round 23 — expectedMessageCount guard, direct coverage.
   Introduced in Round 22 Phase A for the three write sites (a receipt-
   verified local track always knows its own real MessageSent count), and
   now also fed by MilestoneRow's fallback path once it has a receipt in
   hand (Round 23). The guard itself — `messages.length < expectedMessageCount`
   keeps polling before ANY completeness check runs — had no direct test
   until now; it was only ever exercised incidentally through fixtures where
   messages.length already matched. This isolates it: a burn that emitted 2
   real MessageSent events but Iris has only indexed 1 of must not be treated
   as "fully known" just because the one message it does have is COMPLETE. */
describe('useCctpDelivery — expectedMessageCount guard', () => {
  it('keeps polling when Iris has indexed fewer messages than the receipt proved should exist, even though the one it has is already COMPLETE', async () => {
    fetchIrisMessages.mockResolvedValue([irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE' })])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, 2))
    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalled())
    expect(result.current.phase).toBe('polling')
    expect(result.current.deliveries).toEqual([])
  })

  it('proceeds to delivered once Iris catches up to the full expected count', async () => {
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE' }),
      irisMessage({ destinationDomain: 0, forwardState: 'COMPLETE' })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true, 2))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(result.current.deliveries).toHaveLength(2)
  })

  it('is a no-op (falls back to the messages.length === 0 heuristic) when expectedMessageCount is not provided', async () => {
    fetchIrisMessages.mockResolvedValue([irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE' })])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
  })
})
