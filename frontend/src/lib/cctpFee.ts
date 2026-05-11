// Helpers for fetching Circle's CCTP V2 forwarding fee. The escrow contract
// burns USDC on Arc and Circle's forwarding service relays the mint to the
// destination domain, deducting the forwarding fee from the minted amount.

const ARC_SOURCE_DOMAIN = 26;
const FEE_API = "https://iris-api-sandbox.circle.com/v2/burn/USDC/fees";

interface FeeResponseEntry {
  // Reported in USDC base units (6 decimals) as a string. Circle's API returns
  // both `forwardFee` (forwarding-service tier) and `transferFee` shapes; we
  // only need the forwarded path.
  forwardFee?: { min?: string; med?: string; max?: string };
}

/// Fetches the suggested forwarding fee (in USDC base units) for a given
/// destination CCTP domain. Returns the `med` (medium) tier as a bigint.
/// Returns `null` on any failure so the caller can degrade gracefully.
export async function fetchForwardFee(destinationDomain: number): Promise<bigint | null> {
  const url = `${FEE_API}/${ARC_SOURCE_DOMAIN}/${destinationDomain}?forward=true`;
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const data = (await res.json()) as FeeResponseEntry[] | FeeResponseEntry;
    const entry = Array.isArray(data) ? data[0] : data;
    const med = entry?.forwardFee?.med;
    if (!med) return null;
    return BigInt(med);
  } catch {
    return null;
  }
}

/// Same as `fetchForwardFee` but returns `0n` on failure. Useful when the
/// caller wants a non-null bigint to pass directly to the contract while
/// surfacing a separate "could not fetch fee" UI state.
export async function fetchForwardFeeOrZero(
  destinationDomain: number,
): Promise<bigint> {
  const v = await fetchForwardFee(destinationDomain);
  return v ?? 0n;
}
