// Goldsky subgraph client. Replaces the contract's gas-bomb looping view
// functions as the frontend's bulk data source.
//
// Cutover is gated on VITE_GOLDSKY_ENDPOINT: when unset, the hooks in
// useEscrows.js fall back to the on-chain reads, so the app keeps working
// until the subgraph is deployed. Single-escrow reads stay on-chain.
//
// Known limitations inherited from the contract's events (see indexer/README):
//   - escrow COMPLETED state is not emitted, so `state` is ACTIVE until a
//     mutual cancel; activeEscrowCount may over-count the true active set.
//   - milestoneCount is best-effort (highest milestone index seen + 1).

const ENDPOINT = import.meta.env.VITE_GOLDSKY_ENDPOINT || ''

export const GOLDSKY_ENABLED = !!ENDPOINT

const ESCROW_STATE = { ACTIVE: 0, COMPLETED: 1, CANCELLED: 2 }

// Fields the card summaries need — mirrors the contract's EscrowSummary shape.
const SUMMARY_FIELDS = `
  escrowId
  depositor
  recipient
  totalAmount
  state
  deadline
  milestoneCount
  releasedMilestoneCount
  disputedMilestoneCount
  invoiceHash
  invoiceURI
`

async function gql(query, variables) {
  if (!ENDPOINT) throw new Error('VITE_GOLDSKY_ENDPOINT is not set')
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  if (!res.ok) throw new Error(`Goldsky HTTP ${res.status}`)
  const json = await res.json()
  if (json.errors?.length) {
    throw new Error(`Goldsky GraphQL error: ${json.errors[0].message}`)
  }
  return json.data
}

// Maps a subgraph Escrow node to the same shape normaliseSummary() produces,
// so downstream components are unchanged.
function toSummary(node) {
  return {
    id: Number(node.escrowId),
    depositor: node.depositor,
    recipient: node.recipient,
    totalAmount: BigInt(node.totalAmount),
    state: ESCROW_STATE[node.state] ?? 0,
    deadline: BigInt(node.deadline),
    milestoneCount: Number(node.milestoneCount),
    releasedMilestoneCount: Number(node.releasedMilestoneCount),
    disputedMilestoneCount: Number(node.disputedMilestoneCount),
    invoiceHash: node.invoiceHash,
    invoiceURI: node.invoiceURI
  }
}

// Bytes filters in The-Graph GraphQL must be lowercase hex.
function lc(addr) {
  return String(addr).toLowerCase()
}

// Single round-trip for the dashboard: both role lists + refund balance.
export async function fetchDashboard(address) {
  const addr = lc(address)
  const data = await gql(
    `query Dashboard($addr: Bytes!, $wallet: ID!) {
      asPayer: escrows(where: { depositor: $addr }, first: 1000, orderBy: createdAt, orderDirection: desc) { ${SUMMARY_FIELDS} }
      asFreelancer: escrows(where: { recipient: $addr }, first: 1000, orderBy: createdAt, orderDirection: desc) { ${SUMMARY_FIELDS} }
      refundBalance(id: $wallet) { balance }
    }`,
    { addr, wallet: addr }
  )

  const asPayer = (data.asPayer || []).map(toSummary)
  const asFreelancer = (data.asFreelancer || []).map(toSummary)

  // Dedup across roles for the active/open-dispute tallies.
  const byId = new Map()
  for (const e of asPayer.concat(asFreelancer)) byId.set(e.id, e)
  const all = Array.from(byId.values())

  return {
    asPayer,
    asFreelancer,
    activeEscrowCount: all.filter((e) => e.state === ESCROW_STATE.ACTIVE).length,
    openDisputeCount: all.reduce((n, e) => n + e.disputedMilestoneCount, 0),
    refundBalance: data.refundBalance ? BigInt(data.refundBalance.balance) : 0n
  }
}

export async function fetchEscrowsByRole(role, address) {
  const field = role === 'payer' ? 'depositor' : 'recipient'
  const data = await gql(
    `query ByRole($addr: Bytes!) {
      escrows(where: { ${field}: $addr }, first: 1000, orderBy: createdAt, orderDirection: desc) { ${SUMMARY_FIELDS} }
    }`,
    { addr: lc(address) }
  )
  return (data.escrows || []).map(toSummary)
}

export async function fetchDisputedEscrows() {
  const data = await gql(
    `query Disputed {
      escrows(where: { hasOpenDispute: true }, first: 1000, orderBy: updatedAt, orderDirection: desc) { ${SUMMARY_FIELDS} }
    }`,
    {}
  )
  return (data.escrows || []).map(toSummary)
}

// Milestone titles for one escrow, emitted once at deposit (MilestoneTitles
// event) and indexed onto the Escrow entity. Returns [] when the escrow
// predates on-chain titles or the depositor passed none.
export async function fetchEscrowTitles(escrowId) {
  const data = await gql(
    `query Titles($id: ID!) { escrow(id: $id) { titles } }`,
    { id: String(escrowId) }
  )
  return data.escrow?.titles || []
}

// Per-milestone release tx hash — the settlement event (MilestoneApproved /
// MilestoneReleased / DisputeResolved / DisputeTimedOutSettled /
// MutualSettlementExecuted) that carries the CCTP burn for a cross-chain
// release. Indexed on-chain so any device can find it, not just the one that
// submitted the tx. Returns { [milestoneIndex]: '0x...' }, only for
// milestones that have released.
export async function fetchMilestoneReleaseTxs(escrowId) {
  const data = await gql(
    `query ReleaseTx($id: ID!) { escrow(id: $id) { milestones { index releaseTx } } }`,
    { id: String(escrowId) }
  )
  const out = {}
  for (const m of data.escrow?.milestones || []) {
    if (m.releaseTx) out[m.index] = m.releaseTx
  }
  return out
}

export async function fetchEscrowInvoice(escrowId) {
  const data = await gql(
    `query Invoice($id: ID!) {
      escrow(id: $id) {
        invoiceData
        invoiceAcknowledgedAt
      }
    }`,
    { id: String(escrowId) }
  )
  return {
    invoiceData: data.escrow?.invoiceData ?? null,
    invoiceAcknowledgedAt: data.escrow?.invoiceAcknowledgedAt
      ? BigInt(data.escrow.invoiceAcknowledgedAt)
      : null
  }
}

export async function fetchRefundBalance(address) {
  const data = await gql(
    `query Refund($wallet: ID!) { refundBalance(id: $wallet) { balance } }`,
    { wallet: lc(address) }
  )
  return data.refundBalance ? BigInt(data.refundBalance.balance) : 0n
}

// Activity feed: events relevant to a wallet since `since` (unix seconds),
// plus time-sensitive alerts based on current state.
//
// arbiterWindowSecs: live value from useDisputeConfig() — used to compute
// the window in which "arbiter window expiring <24h" disputes fall.
// Pass 0 to skip arbiter-expiry alerts.
export async function fetchActivityFeed(address, { since = 0, arbiterWindowSecs = 0 } = {}) {
  const addr = lc(address)
  const now = Math.floor(Date.now() / 1000)
  const sinceStr = String(since)

  // Review-window expiring: milestones the payer needs to act on in <12h.
  const reviewExpiresAfter  = String(now)
  const reviewExpiresBefore = String(now + 12 * 3600)

  // Arbiter-window expiring: disputes where the window closes in the next 24h.
  // raisedAt_gt = now - window + 0 (already-expired disputes excluded by resolved:false)
  // raisedAt_lt = now - window + 86400 (the slice that expires in the next 24h)
  const arbiterExpiresAfter  = arbiterWindowSecs > 0 ? String(now - arbiterWindowSecs) : '0'
  const arbiterExpiresBefore = arbiterWindowSecs > 0 ? String(now - arbiterWindowSecs + 86400) : '0'

  const data = await gql(
    `query ActivityFeed(
      $addr: Bytes!
      $since: BigInt!
      $reviewExpiresAfter: BigInt!
      $reviewExpiresBefore: BigInt!
      $arbiterExpiresAfter: BigInt!
      $arbiterExpiresBefore: BigInt!
    ) {
      # Delivery claims the payer needs to review (since last visit)
      claimedMilestones: milestones(
        where: { deliveredAt_gt: $since, escrow_: { depositor: $addr } }
        orderBy: deliveredAt, orderDirection: desc, first: 50
      ) {
        id index deliveredAt reviewDeadline
        escrow { escrowId }
      }
      # Disputes raised against the freelancer (since last visit)
      raisedDisputes: disputes(
        where: { raisedAt_gt: $since, escrow_: { recipient: $addr } }
        orderBy: raisedAt, orderDirection: desc, first: 50
      ) {
        id milestoneIndex raisedAt
        escrow { escrowId }
      }
      # Review window closing <12h for payer's fulfilled milestones
      reviewExpiring: milestones(
        where: {
          state: FULFILLED
          reviewDeadline_gt: $reviewExpiresAfter
          reviewDeadline_lt: $reviewExpiresBefore
          escrow_: { depositor: $addr }
        }
        orderBy: reviewDeadline, orderDirection: asc, first: 20
      ) {
        id index reviewDeadline
        escrow { escrowId }
      }
      # Arbiter window closing <24h — payer's disputes
      arbiterExpiringPayer: disputes(
        where: {
          resolved: false
          raisedAt_gt: $arbiterExpiresAfter
          raisedAt_lt: $arbiterExpiresBefore
          escrow_: { depositor: $addr }
        }
        first: 20
      ) {
        id milestoneIndex raisedAt
        escrow { escrowId }
      }
      # Arbiter window closing <24h — freelancer's disputes
      arbiterExpiringFreelancer: disputes(
        where: {
          resolved: false
          raisedAt_gt: $arbiterExpiresAfter
          raisedAt_lt: $arbiterExpiresBefore
          escrow_: { recipient: $addr }
        }
        first: 20
      ) {
        id milestoneIndex raisedAt
        escrow { escrowId }
      }
    }`,
    {
      addr,
      since: sinceStr,
      reviewExpiresAfter,
      reviewExpiresBefore,
      arbiterExpiresAfter,
      arbiterExpiresBefore,
    }
  )

  const items = []

  for (const m of data.claimedMilestones || []) {
    items.push({
      type: 'delivery_claimed',
      escrowId: Number(m.escrow.escrowId),
      milestoneIndex: m.index,
      timestamp: Number(m.deliveredAt),
      reviewDeadline: m.reviewDeadline ? Number(m.reviewDeadline) : null,
    })
  }

  for (const d of data.raisedDisputes || []) {
    items.push({
      type: 'dispute_raised',
      escrowId: Number(d.escrow.escrowId),
      milestoneIndex: d.milestoneIndex,
      timestamp: Number(d.raisedAt),
    })
  }

  for (const m of data.reviewExpiring || []) {
    items.push({
      type: 'review_expiring',
      escrowId: Number(m.escrow.escrowId),
      milestoneIndex: m.index,
      timestamp: Number(m.reviewDeadline),
      reviewDeadline: Number(m.reviewDeadline),
    })
  }

  const arbiterSeen = new Set()
  for (const d of [...(data.arbiterExpiringPayer || []), ...(data.arbiterExpiringFreelancer || [])]) {
    if (arbiterSeen.has(d.id)) continue
    arbiterSeen.add(d.id)
    const expiresAt = arbiterWindowSecs > 0 ? Number(d.raisedAt) + arbiterWindowSecs : 0
    items.push({
      type: 'arbiter_expiring',
      escrowId: Number(d.escrow.escrowId),
      milestoneIndex: d.milestoneIndex,
      timestamp: expiresAt,
      expiresAt,
    })
  }

  return items
}
