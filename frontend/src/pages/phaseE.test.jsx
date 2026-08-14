import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { getAddress, isAddress } from 'viem'

/* Phase E #21 — the recovery panel's lookups, debounced.

   Not a correctness bug and not a secrecy one: refundBalances and both
   pendingRefundRecovery getters are public, and anyone can read them for any
   address. What leaked was the read pattern. An admin investigating a
   restricted wallet typed or corrected a 42-character address and every
   intermediate string that parsed as an address fired three reads at the
   configured RPC — handing whoever serves that endpoint a timestamped trail of
   which wallets an admin was looking at, before anything was signed and
   whether or not they ever went through with it.

   The subtle part is not the debounce. It is that debouncing opens a window
   the existing submit gate could not see, and Phase A's guarantee has to
   survive it — see the second describe. */
import { useDebouncedValue } from '../hooks/useDebouncedValue.js'
import { recoveryReadsPending } from './ProtocolSettings.jsx'

const ADDR_A = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const ADDR_B = '0x4bdbe608ea998b4822476353df9dd83228ffd503'

describe('#21 — useDebouncedValue holds a value back until typing stops', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('', 400))
    expect(result.current).toBe('')
  })

  /* The whole point: the value the reads key off must not change on the
     keystroke itself. */
  it('does not surface a new value before the delay elapses', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 400), {
      initialProps: { v: '' }
    })
    rerender({ v: ADDR_A })
    expect(result.current).toBe('')
    act(() => { vi.advanceTimersByTime(399) })
    expect(result.current).toBe('')
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe(ADDR_A)
  })

  /* A run of edits inside the window must collapse to ONE settled value, not
     one per edit — this is the assertion that actually pins "one read instead
     of one per keystroke". Each intermediate here is a full valid address, the
     shape that used to fire a read. */
  it('collapses a burst of edits into a single settled value', () => {
    const seen = []
    const { rerender } = renderHook(({ v }) => {
      const settled = useDebouncedValue(v, 400)
      seen.push(settled)
      return settled
    }, { initialProps: { v: '' } })

    for (const v of [ADDR_A, ADDR_B, ADDR_A, ADDR_B]) {
      rerender({ v })
      act(() => { vi.advanceTimersByTime(100) })
    }
    // 400ms of edits, none of them 400ms apart: nothing has settled yet.
    expect([...new Set(seen)]).toEqual([''])

    act(() => { vi.advanceTimersByTime(400) })
    rerender({ v: ADDR_B })
    expect([...new Set(seen)]).toEqual(['', ADDR_B])
  })

  it('settles again on a later change', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 400), {
      initialProps: { v: ADDR_A }
    })
    rerender({ v: ADDR_B })
    act(() => { vi.advanceTimersByTime(400) })
    expect(result.current).toBe(ADDR_B)
  })

  /* Unmounting mid-window must not leave a timer to fire into a dead
     component. */
  it('clears its pending timer on unmount', () => {
    const { rerender, unmount } = renderHook(({ v }) => useDebouncedValue(v, 400), {
      initialProps: { v: '' }
    })
    rerender({ v: ADDR_A })
    unmount()
    expect(() => act(() => { vi.advanceTimersByTime(1000) })).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })
})

/* Phase A's gate: never submit against figures that have not been read. The
   confirm screen would otherwise show 0.00 USDC and "no proposal is currently
   pending" — both of which are what an unread result looks like, and both of
   which are exactly wrong for a funded wallet with a standing nomination.

   Debouncing breaks the old expression's assumption. Between the keystroke and
   the settle, the reads are DISABLED rather than in flight, so both isLoading
   flags read false. Gating on those alone would enable the button precisely
   during the pause this change introduces — turning a privacy fix into a
   correctness regression. */
describe('#21 — the submit gate survives the debounce window', () => {
  const gate = (over = {}) => recoveryReadsPending({
    typed: ADDR_A, debounced: ADDR_A, balanceLoading: false, recoveryLoading: false, ...over
  })

  it('counts a typed address the reads have not caught up with as pending', () => {
    expect(gate({ typed: ADDR_A, debounced: '' })).toBe(true)
    expect(gate({ typed: ADDR_A, debounced: ADDR_B })).toBe(true)
  })

  it('clears once the debounced value matches what was typed', () => {
    expect(gate()).toBe(false)
  })

  it('still reports pending while either read is actually in flight', () => {
    expect(gate({ balanceLoading: true })).toBe(true)
    expect(gate({ recoveryLoading: true })).toBe(true)
  })

  /* A half-typed address never triggered a read and never will, so it must not
     hold the gate — the address-validity check in front of the comparison is
     what keeps an empty or partial field from reading as "pending forever". */
  it('does not hold the gate for an incomplete address', () => {
    for (const typed of ['', '0x', '0x179cc4c8f23d257b7f4acb7854640255']) {
      expect(gate({ typed, debounced: '' })).toBe(false)
    }
  })

  /* Exact comparison, not case-insensitive. Both forms below are valid to
     viem — all-lowercase has no checksum to verify, and the mixed-case one is
     correctly checksummed — so a user who types the lowercase form and then
     pastes the checksummed one has genuinely changed the react-query key, and
     the second lookup really has not happened yet. */
  it('treats a checksum-case difference as not yet settled', () => {
    const checksummed = getAddress(ADDR_A)
    expect(checksummed).not.toBe(ADDR_A)
    expect(isAddress(checksummed) && isAddress(ADDR_A)).toBe(true)
    expect(gate({ typed: checksummed, debounced: ADDR_A })).toBe(true)
  })
})
