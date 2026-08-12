// useCctpDelivery — Round 20 Phase D.
//
// Two properties matter here: (1) the second argument is now a plain
// isCrossChain boolean, used only to gate polling — not a domain value the
// hook trusts for anything else; and (2) each parsed delivery keeps ITS OWN
// destinationDomain from Iris, defaulting to null (never a caller-supplied
// guess) when Iris omits one. A mixed split settlement can burn to several
// DIFFERENT chains in one transaction, so collapsing every message's domain
// to one caller-supplied value was never safe — this is what stops that.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const fetchIrisMessages = vi.hoisted(() => vi.fn())
vi.mock('../utils/irisDelivery', () => ({ fetchIrisMessages }))

const { useCctpDelivery } = await import('./useCctpDelivery.js')

beforeEach(() => {
  fetchIrisMessages.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

const attested = (overrides = {}) => ({
  message: '0xmessage',
  attestation: '0xattestation',
  destinationDomain: 6,
  forward: { forwardState: 'COMPLETE', destinationTxHash: '0xdesttx', forwardErrorCode: null },
  ...overrides
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
    fetchIrisMessages.mockResolvedValue([attested()])
    renderHook(() => useCctpDelivery('0xtx', true))
    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalledWith('0xtx'))
  })
})

describe('useCctpDelivery — per-message domain, never collapsed to a caller-supplied value', () => {
  it('keeps each message\'s own destinationDomain from Iris, even when they differ from each other', async () => {
    fetchIrisMessages.mockResolvedValue([
      attested({ destinationDomain: 6 }),   // Base Sepolia
      attested({ destinationDomain: 0 })    // Ethereum Sepolia — genuinely different chain
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(result.current.deliveries.map((d) => d.destinationDomain)).toEqual([6, 0])
  })

  it('defaults an Iris-omitted domain to null, never to some other message\'s domain or a guess', async () => {
    fetchIrisMessages.mockResolvedValue([
      attested({ destinationDomain: 6 }),
      attested({ destinationDomain: undefined })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true))
    await waitFor(() => expect(result.current.phase).toBe('delivered'))
    expect(result.current.deliveries[0].destinationDomain).toBe(6)
    expect(result.current.deliveries[1].destinationDomain).toBeNull()
  })
})

describe('useCctpDelivery — mixed outcomes are preserved in `deliveries`, not collapsed by `phase`', () => {
  it('keeps the COMPLETE message\'s own data intact even when phase is "failed" because a DIFFERENT message failed', async () => {
    fetchIrisMessages.mockResolvedValue([
      attested({ destinationDomain: 6, forward: { forwardState: 'COMPLETE', destinationTxHash: '0xgood', forwardErrorCode: null } }),
      attested({ destinationDomain: 0, forward: { forwardState: 'FAILED', destinationTxHash: null, forwardErrorCode: 'INSUFFICIENT_FEE' } })
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
      attested({ destinationDomain: 6, forward: { forwardState: 'FAILED', destinationTxHash: null, forwardErrorCode: 'INSUFFICIENT_FEE' } }),
      attested({ destinationDomain: 0, forward: { forwardState: 'FAILED', destinationTxHash: null, forwardErrorCode: 'INSUFFICIENT_FEE' } })
    ])
    const { result } = renderHook(() => useCctpDelivery('0xtx', true))
    await waitFor(() => expect(result.current.phase).toBe('failed'))
    expect(result.current.deliveries).toHaveLength(2)
    expect(result.current.deliveries.map((d) => d.destinationDomain)).toEqual([6, 0])
    expect(result.current.deliveries.every((d) => d.forwardState === 'FAILED')).toBe(true)
  })
})
