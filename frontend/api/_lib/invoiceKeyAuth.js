// Pure authorization check for private-invoice key access. Deliberately
// takes already-fetched, plain-JS-typed inputs — no contract calls, no I/O —
// so it's unit-testable with plain objects and portable if this logic ever
// needs to move (e.g. into a different runtime for the bot/arbiter tooling).

// ITrancheProtocol.sol: enum MilestoneState { PENDING, IN_REVIEW, DISPUTED, RELEASED, REFUNDED }
export const MILESTONE_STATE_DISPUTED = 2

/**
 * @param {{
 *   walletAddress: string,
 *   recipient: string,
 *   depositor: string,
 *   isArbiter: boolean,
 *   milestoneStates: number[]
 * }} params
 * @returns {boolean} true if walletAddress may read this escrow's invoice key
 */
export function authorizeInvoiceKeyAccess({ walletAddress, recipient, depositor, isArbiter, milestoneStates }) {
  const wallet = String(walletAddress || '').toLowerCase()
  if (!wallet) return false

  if (wallet === String(recipient || '').toLowerCase()) return true
  if (wallet === String(depositor || '').toLowerCase()) return true

  const anyMilestoneDisputed = (milestoneStates || []).some(
    (state) => Number(state) === MILESTONE_STATE_DISPUTED
  )
  return !!isArbiter && anyMilestoneDisputed
}
