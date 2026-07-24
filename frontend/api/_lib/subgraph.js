// Server-side read of the Goldsky subgraph.
//
// Currently only used by _lib/resolveAttachmentSalt.js to independently
// source an escrow's real invoiceData (the encrypted envelope's ipfs://
// URI, for private escrows) — see that file's header and
// request-invoice-key.js's for why this can't be a raw on-chain read:
// eth_getLogs on Arc Testnet's public RPC is capped to a 10,000-block
// window (verified empirically), and at this chain's ~0.5s block time
// that's under 1.5 hours of history per call. Finding an older escrow's
// InvoiceSnapshotted event would need potentially hundreds of paginated
// calls back to the contract's deploy block — impractical for a
// synchronous, latency-sensitive endpoint. invoiceData isn't in contract
// storage (only ever emitted as an event), so there's no cheaper on-chain
// read either. The subgraph already indexes this field with none of these
// limitations.

const QUERY = `query($id: ID!) { escrow(id: $id) { invoiceData } }`

/**
 * @param {number|string} escrowId
 * @returns {Promise<string|null>} the raw invoiceData string, or null if
 *   the escrow doesn't exist (yet) in the subgraph
 */
export async function getEscrowInvoiceData(escrowId) {
  const endpoint = process.env.VITE_GOLDSKY_ENDPOINT
  if (!endpoint) throw new Error('VITE_GOLDSKY_ENDPOINT is not configured on the server.')

  let res
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { id: String(escrowId) } })
    })
  } catch (err) {
    throw new Error(`Could not reach the subgraph: ${err.message}`)
  }
  if (!res.ok) throw new Error(`Subgraph query failed (status ${res.status}).`)

  let payload
  try {
    payload = await res.json()
  } catch {
    throw new Error('Subgraph returned an unreadable response.')
  }
  if (payload.errors?.length) {
    throw new Error(`Subgraph query error: ${payload.errors[0]?.message || 'unknown'}`)
  }

  return payload.data?.escrow?.invoiceData ?? null
}
