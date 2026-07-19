import { keccak256, toHex } from 'viem'

// The single place invoiceHash is computed client-side. CreateEscrow.jsx
// calls this exactly once per submission and reuses the result both as the
// deposit() on-chain argument and (for private-mode escrows) as the value
// sent to /api/pin-invoice to derive the encryption key. Never recompute
// independently at a second call site: the encryption key is derived from
// whatever invoiceHash ends up on-chain, so if pinning used a hash computed
// from a re-serialized copy of the invoice (e.g. a second `new Date()` /
// JSON.stringify() pass), the two hashes silently diverge and the escrow's
// private invoice becomes permanently undecryptable — nobody, including the
// depositor, can reproduce the key that was actually used.
export function computeInvoiceHash(invoiceJson) {
  return keccak256(toHex(invoiceJson))
}
