import { ARC_DOMAIN } from '../config/chains.js'

// Circle's Iris API. The cross-chain release/settlement paths attach the
// `cctp-forward` hook so Circle's Forwarding Service auto-mints on the
// destination chain. That service charges a gas-based fee (≈$0.20 + dest gas)
// that the burn's `maxFee` MUST cover, or the burn is attested but the mint is
// rejected with `forwardState: FAILED / INSUFFICIENT_FEE`. We therefore quote
// the live fee immediately before submitting, instead of reusing the contract's
// static `cctpForwardFee` floor (which is only a lower bound).
const IRIS_BASE = import.meta.env.VITE_IRIS_API_BASE || 'https://iris-api-sandbox.circle.com'

// Matches the contract's CCTP_MIN_FINALITY_THRESHOLD (Standard Transfer). We
// pick this tier's forwardFee from the API response.
const STANDARD_FINALITY = 2000

/**
 * Fetch Circle's live Forwarding-Service fee for an Arc→destination burn.
 * @param {number} srcDomain   CCTP source domain (Arc = 26).
 * @param {number} dstDomain   CCTP destination domain.
 * @param {'low'|'med'|'high'} level  Fee tier; 'high' adds a delivery buffer.
 * @returns {Promise<bigint>}  Fee in USDC base units (6 decimals).
 */
export async function fetchForwardFee(srcDomain, dstDomain, level = 'high') {
  const url = `${IRIS_BASE}/v2/burn/USDC/fees/${srcDomain}/${dstDomain}?forward=true`
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
  if (!res.ok) throw new Error(`Circle fee API returned ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error('Circle fee API: unexpected response shape')
  const tier = data.find((t) => Number(t.finalityThreshold) === STANDARD_FINALITY) ?? data[0]
  const fwd = tier?.forwardFee
  if (!fwd) throw new Error('Circle fee API: no forwardFee in response (forwarding may be unsupported for this route)')
  const raw = fwd[level] ?? fwd.high ?? fwd.med ?? fwd.low
  if (raw == null) throw new Error('Circle fee API: forwardFee missing tiers')
  return BigInt(Math.ceil(Number(raw)))
}

/**
 * Resolve the `maxFee` to pass to a cross-chain release / settlement / dispute
 * call. Same-chain (Arc) burns force maxFee = 0 inside the contract. Cross-chain
 * burns must cover Circle's live forwarding fee, clamped into the band the
 * contract accepts: [escrowCctpForwardFee snapshot floor, burnAmount).
 *
 * @param {object}  p
 * @param {number}  p.destinationDomain
 * @param {bigint}  [p.escrowCctpForwardFee]  Per-escrow snapshotted floor.
 * @param {bigint}  [p.burnAmount]            USDC actually burned for the recipient
 *                                            (after protocol fee); used to keep
 *                                            maxFee < burnAmount. Pass 0n / omit
 *                                            when no recipient burn occurs.
 * @param {'low'|'med'|'high'} [p.level]
 * @returns {Promise<bigint>}
 */
export async function resolveMaxFee({ destinationDomain, escrowCctpForwardFee, burnAmount, level = 'high' }) {
  if (Number(destinationDomain) === ARC_DOMAIN) return 0n
  // A pure refund / 0% recipient share triggers no recipient burn, so the
  // contract skips the cross-chain fee floor — any maxFee (incl. 0) is fine.
  if (burnAmount != null && BigInt(burnAmount) === 0n) return 0n

  const live = await fetchForwardFee(ARC_DOMAIN, Number(destinationDomain), level)
  const floor = BigInt(escrowCctpForwardFee ?? 0n)
  const maxFee = live > floor ? live : floor

  if (burnAmount != null && maxFee >= BigInt(burnAmount)) {
    throw new Error('Cross-chain forwarding fee exceeds this payout amount — increase the milestone size or release on Arc.')
  }
  return maxFee
}
