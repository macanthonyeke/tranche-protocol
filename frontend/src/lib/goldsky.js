// Goldsky subgraph client. Replaces the contract's gas-bomb looping view
// functions (getDashboard / getDisputedEscrows / getEscrowsForPayer /
// getEscrowsForFreelancer) as the frontend's bulk data source.
//
// Cutover is gated on VITE_GOLDSKY_ENDPOINT: when unset, the hooks in
// useEscrows.js fall back to the on-chain reads, so the app keeps working
// until the subgraph is deployed. Single-escrow reads stay on-chain.
//
// Known limitations inherited from the contract's events (see indexer/README):
//   - escrow COMPLETED state is not emitted, so `state` is ACTIVE until a
//     mutual cancel; activeEscrowCount may over-count vs on-chain getDashboard.
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

export async function fetchRefundBalance(address) {
  const data = await gql(
    `query Refund($wallet: ID!) { refundBalance(id: $wallet) { balance } }`,
    { wallet: lc(address) }
  )
  return data.refundBalance ? BigInt(data.refundBalance.balance) : 0n
}
