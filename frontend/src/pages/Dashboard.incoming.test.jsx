import { describe, it, expect, vi } from 'vitest'

// Dashboard.jsx pulls in the whole app shell; only the predicate is needed.
vi.mock('../hooks/useEscrows.js', () => ({
  useDashboard: () => ({}), useUsdcBalance: () => ({}),
  useDisputedEscrows: () => ({}), useAccountActivity: () => ({})
}))

/* The Incoming section's split is a pure filter over the same list, using the
   REAL predicate the page uses — importing it rather than restating it, so
   this cannot pass while the page behaves differently. */
const { isAcknowledged } = await import('./Dashboard.jsx')

const split = (list) => ({
  unacknowledged: list.filter((e) => !isAcknowledged(e)),
  acknowledged: list.filter(isAcknowledged)
})

const incoming = [
  { id: 1, invoiceAcknowledgedAt: null },
  { id: 2, invoiceAcknowledgedAt: 1785633037n },
  { id: 3, invoiceAcknowledgedAt: null },
  { id: 4, invoiceAcknowledgedAt: 0n }
]

describe('Incoming requests grouping', () => {
  it('routes acknowledged escrows away from the "not started" group', () => {
    const { acknowledged } = split(incoming)
    expect(acknowledged.map((e) => e.id)).toEqual([2])
  })

  it('keeps unacknowledged escrows in the "not yet accepted" group', () => {
    const { unacknowledged } = split(incoming)
    expect(unacknowledged.map((e) => e.id)).toEqual([1, 3, 4])
  })

  // The split is presentational: membership of the section is unchanged, so
  // nothing may be dropped or shown twice.
  it('partitions exactly — no escrow lost or duplicated', () => {
    const { unacknowledged, acknowledged } = split(incoming)
    const ids = [...unacknowledged, ...acknowledged].map((e) => e.id).sort()
    expect(ids).toEqual(incoming.map((e) => e.id).sort())
    expect(unacknowledged.length + acknowledged.length).toBe(incoming.length)
  })

  // 0n is the subgraph's "never acknowledged" for a BigInt field; treating it
  // as truthy would put a never-accepted escrow under "awaiting your claim".
  it('treats a zero timestamp as not acknowledged', () => {
    expect(split([{ id: 9, invoiceAcknowledgedAt: 0n }]).acknowledged).toEqual([])
  })
})
