import { describe, it, expect, vi } from 'vitest'

// Dashboard.jsx pulls in the whole app shell; only the predicate is needed.
vi.mock('../hooks/useEscrows.js', () => ({
  useDashboard: () => ({}), useUsdcBalance: () => ({}),
  useDisputedEscrows: () => ({}), useAccountActivity: () => ({})
}))

/* The Incoming section's split is a pure filter over the same list, using the
   REAL predicate the page uses — importing it rather than restating it, so
   this cannot pass while the page behaves differently. */
const { isAcknowledged, isIncoming } = await import('./Dashboard.jsx')
const { toSummary } = await import('../lib/goldsky.js')

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

/* Milestone-driven membership of the Incoming section.

   Shapes below are the real subgraph record for escrow 5 on the live 0.5.3
   endpoint, verified by querying it: milestoneCount 1 with an EMPTY milestones
   array, because the subgraph creates Milestone entities lazily. That is the
   case a naive `milestones.every(isFulfilled)` gets backwards — it is
   vacuously true on [] and would evict an escrow nobody has touched. */
const liveEscrow5 = {
  escrowId: '5',
  depositor: '0x1a260601f65a1c270a1cabf65c09f2f31c0869a5',
  recipient: '0x4bdbe608ea998b4822476353df9dd83228ffd503',
  totalAmount: '2000000',
  state: 'ACTIVE',
  deadline: '1785708600',
  milestoneCount: 1,
  releasedMilestoneCount: 0,
  disputedMilestoneCount: 0,
  invoiceHash: '0xc254698bbb523bc9c92e490edf3c505153f840fec49f9f53250c90b0ee7b55d3',
  invoiceURI: 'none',
  invoiceAcknowledgedAt: '1785633037',
  milestones: []
}
const asFreelancer = (node) => ({ ...toSummary(node), isPayer: false })

describe('Incoming membership by milestone state', () => {
  it('keeps an untouched escrow whose milestones array is empty', () => {
    const e = asFreelancer(liveEscrow5)
    expect(e.pendingMilestoneCount).toBe(1)
    expect(isIncoming(e)).toBe(true)
  })

  it('drops it once the last milestone is claimed', () => {
    const e = asFreelancer({ ...liveEscrow5, milestones: [{ state: 'FULFILLED' }] })
    expect(e.pendingMilestoneCount).toBe(0)
    expect(e.fulfilledMilestoneCount).toBe(1)
    expect(isIncoming(e)).toBe(false)
  })

  it('keeps it while any milestone is still pending', () => {
    const e = asFreelancer({ ...liveEscrow5, milestoneCount: 2, milestones: [{ state: 'FULFILLED' }] })
    expect(e.pendingMilestoneCount).toBe(1)
    expect(isIncoming(e)).toBe(true)
  })

  it('counts a present-but-PENDING entity as pending, not as moved on', () => {
    const e = asFreelancer({ ...liveEscrow5, milestones: [{ state: 'PENDING' }] })
    expect(e.pendingMilestoneCount).toBe(1)
    expect(isIncoming(e)).toBe(true)
  })

  // Released / disputed already excluded Incoming before this change; the new
  // pending condition must not accidentally readmit them.
  it('still excludes released and disputed escrows', () => {
    const released = asFreelancer({ ...liveEscrow5, releasedMilestoneCount: 1, milestones: [{ state: 'RELEASED' }] })
    const disputed = asFreelancer({ ...liveEscrow5, milestoneCount: 2, disputedMilestoneCount: 1, milestones: [{ state: 'DISPUTED' }] })
    expect(isIncoming(released)).toBe(false)
    expect(isIncoming(disputed)).toBe(false)
  })

  it('never shows a payer their own escrow as incoming', () => {
    expect(isIncoming({ ...toSummary(liveEscrow5), isPayer: true })).toBe(false)
  })
})
