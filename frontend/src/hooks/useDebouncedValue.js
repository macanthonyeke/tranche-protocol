import { useEffect, useState } from 'react'

/* Trailing-edge debounce for a value that drives a network read.
 *
 * Written for the recovery panel, where the read is the problem rather than
 * the render: an admin investigating a restricted wallet types or corrects a
 * 42-character address, and every intermediate string that happens to parse as
 * an address fires `refundBalances` + both `pendingRefundRecovery` getters at
 * the configured RPC. The values are public — this is not about secrecy — but
 * the *pattern* is not: it hands whoever serves that endpoint a timestamped
 * trail of which wallets an admin looked at, before anything is signed and
 * whether or not they go through with it.
 *
 * Trailing edge specifically: a leading-edge debounce would fire on the first
 * keystroke, which is the one this exists to suppress.
 *
 * Returns the previous settled value while a new one is pending, so callers
 * can compare the two to tell "waiting to look" apart from "looked, and this
 * is the answer" — a distinction the recovery panel's submit gate depends on.
 */
export function useDebouncedValue(value, delayMs = 400) {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    if (value === settled) return undefined
    const timer = setTimeout(() => setSettled(value), delayMs)
    // Every change inside the window cancels the previous timer, so a run of
    // keystrokes costs one read rather than one per keystroke.
    return () => clearTimeout(timer)
  }, [value, delayMs, settled])

  return settled
}
