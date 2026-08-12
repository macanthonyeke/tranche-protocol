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
  if (!res.ok) throw new Error("Couldn't get delivery fee. Please try again.")
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error("Couldn't read delivery fee response. Please try again.")
  const tier = data.find((t) => Number(t.finalityThreshold) === STANDARD_FINALITY) ?? data[0]
  const fwd = tier?.forwardFee
  if (!fwd) throw new Error("Delivery to this chain may not be supported. Try Arc as the destination.")
  const raw = fwd[level] ?? fwd.high ?? fwd.med ?? fwd.low
  if (raw == null) throw new Error("Couldn't read delivery fee tiers. Please try again.")
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
    throw new Error('This payout is too small to deliver on another chain — increase the milestone amount or choose Arc as the destination.')
  }
  return maxFee
}

/**
 * A lower bound on what the contract will actually remainder after its
 * protocol fee, computable WITHOUT the escrow's own snapshotted fee bps
 * (escrowFeeBps has no getter — see TrancheProtocol.sol:117). Every escrow's
 * snapshot was checked against `maxProtocolFeeBps` (TrancheProtocol.sol:191,
 * MAX_PROTOCOL_FEE) at the moment `setProtocolFee` set it, and that ceiling
 * itself never changes — so the real per-escrow rate is always <= this
 * ceiling, meaning the real fee is always <= worstCaseFee and the real
 * remainder is always >= what this returns.
 *
 * Round 20 Phase C: re-added in a different role than Round 18 gave it.
 * Round 18 fed this straight into {resolveMaxFee}'s `burnAmount` to REJECT a
 * transaction outright when the estimate looked unsafe — but "conservative
 * estimate <= floor" and "real remainder <= floor" are different conditions,
 * so it could reject transactions the contract would have accepted (Round 19
 * removed it for exactly this reason). Here it is a pure SAFETY GATE inside
 * {resolveDominantMaxFee}, deciding whether a live quote is trustworthy
 * enough to prefer over the floor — never deciding whether to submit at all.
 * A live quote strictly below this bound is guaranteed strictly below the
 * REAL remainder too (this bound <= real remainder), so using it satisfies
 * the burn branch's `maxFee < remainder` constraint with certainty, not an
 * estimate. When the quote is NOT provably below this bound, the caller
 * falls back to the floor — which Round 19 already proved unconditionally
 * safe on its own, independent of any estimate.
 * @param {bigint} amount             Gross amount the protocol fee is cut from.
 * @param {bigint} [maxProtocolFeeBps]  getProtocolConfig().maxProtocolFeeBps.
 *   Defaults to 500 (TrancheProtocol.sol:23's hardcoded MAX_PROTOCOL_FEE,
 *   this contract's actual ceiling) for the brief window before
 *   getProtocolConfig() resolves — NOT to 0, which would assume no fee at
 *   all and overestimate the remainder, reproducing the exact bug this
 *   function exists to close.
 * @returns {bigint}
 */
export function worstCaseRemainder(amount, maxProtocolFeeBps) {
  const ceiling = maxProtocolFeeBps ?? 500n
  const worstCaseFee = (BigInt(amount) * BigInt(ceiling)) / 10_000n
  return BigInt(amount) - worstCaseFee
}

/**
 * Round 20 Phase C. Attempts a live Circle quote and uses it only when
 * PROVABLY safe against the contract's real, unknowable-in-advance remainder
 * — strictly below {worstCaseRemainder}'s lower bound on that remainder.
 * Falls back to `floor` — Round 19's unconditionally-safe submission — in
 * every other case: the quote fetch throws, the response is malformed, or
 * the quote resolves but isn't provably safe. NEVER throws itself, so a
 * transient Circle fee-API outage degrades to exactly Round 19's behaviour
 * instead of blocking the caller's transaction.
 *
 * Scope: only meaningful for a no-split cross-chain burn where the submitted
 * maxFee genuinely governs the burn (approveRelease, resolveDispute with
 * bps > 0 and a nonzero recipient share). Split legs, release()'s
 * permissionless path, and mutualSettle all ignore whatever maxFee is
 * submitted regardless (settled decision #7) — a live quote there would be
 * exactly as pointless as it was before this function existed, so callers
 * should keep submitting `floor` directly on those paths rather than routing
 * them through here.
 *
 * @param {object}  p
 * @param {number}  p.destinationDomain
 * @param {bigint}  p.floor              Escrow's own snapshotted forwarding-fee floor.
 * @param {bigint}  p.recipientAmount    USDC amount the protocol fee is cut from.
 * @param {bigint}  [p.maxProtocolFeeBps]  getProtocolConfig().maxProtocolFeeBps.
 * @param {'low'|'med'|'high'} [p.level]
 * @returns {Promise<bigint>}
 */
export async function resolveDominantMaxFee({ destinationDomain, floor, recipientAmount, maxProtocolFeeBps, level = 'high' }) {
  const safeFloor = BigInt(floor ?? 0n)
  try {
    const liveQuote = await fetchForwardFee(ARC_DOMAIN, Number(destinationDomain), level)
    const safeThreshold = worstCaseRemainder(recipientAmount, maxProtocolFeeBps)
    if (liveQuote < safeThreshold) {
      return liveQuote > safeFloor ? liveQuote : safeFloor
    }
  } catch {
    // Quote failed, errored, or came back malformed — fall through to the
    // floor rather than propagating. Never blocks the caller's transaction.
  }
  return safeFloor
}
