const ERROR_MAP = {
  // From contract — pairs where one name is a prefix of another are ordered
  // longest-first here for readability; the parseRevertReason fallback sorts
  // by key length before scanning so prefix order in this object doesn't matter.
  InvalidAmount:                   "Invalid amount.",
  ZeroAddress:                     "Zero address not allowed.",
  NoDeposit:                       "This escrow is no longer active.",
  NotEscrowOwner:                  "Only the payer can do this.",
  NotEscrowOwnerOrRecipient:       "Only the payer or freelancer can do this.",
  NotRecipient:                    "Only the freelancer can do this.",
  InvalidState:                    "This action isn't allowed in the current state.",
  NotInReview:                     "This milestone isn't in the review window.",
  ReviewWindowExpired:             "The review window has already closed.",
  ReviewWindowNotExpired:          "The review window hasn't closed yet.",
  ReviewWindowTooShort:            "Review window is too short (min 1 day).",
  ReviewWindowTooLong:             "Review window is too long (max 7 days).",
  DeadlinePassed:                  "The project deadline has already passed.",
  DeadlineNotReached:              "The project deadline hasn't passed yet.",
  NoDispute:                       "There's no open dispute on this milestone.",
  EscrowDoesNotExist:              "Escrow not found.",
  NothingToWithdraw:               "There's nothing to withdraw.",
  NoInvoiceURI:                    "Invoice URI is required.",
  NoInvoice:                       "Invoice hash is required.",
  DeadlineRequired:                "Deadline is required.",
  DeadlineTooSoon:                 "Deadline must be at least 1 hour from now.",
  DeadlineTooFar:                  "Deadline is too far in the future.",
  NoEvidenceURI:                   "Evidence URI is required.",
  NoEvidence:                      "Evidence is required.",
  NoDisputeReason:                 "Dispute reason is required.",
  CannotRespondToOwnDispute:       "You can't respond to your own dispute.",
  CounterEvidenceAlreadySubmitted: "Counter-evidence has already been submitted.",
  DisputeAlreadyResolved:          "This dispute has already been resolved.",
  MutualSettlementAlreadyExecuted: "This milestone is no longer open to settlement.",
  ArbiterTimeoutNotReached:        "The arbiter timeout window hasn't elapsed yet.",
  NoResolutionURI:                 "Resolution URI is required.",
  NoResolution:                    "Resolution hash is required.",
  NoMilestones:                    "At least one milestone is required.",
  TooManyMilestones:               "Too many milestones.",
  TooManySplits:                   "Too many split recipients.",
  MilestoneAmountMismatch:         "Milestone amounts must equal the total.",
  InvalidMilestoneIndex:           "Invalid milestone index.",
  PreviousMilestoneNotComplete:    "Previous milestone must be completed first.",
  CannotCancelDuringDispute:       "Can't cancel while a dispute is open.",
  InsufficientAllowance:           "USDC approval needed. Approve first, then try again.",
  UsdcApproveFailed:               "USDC approval failed. Please try again.",
  UnsupportedDomain:               "This destination chain is not currently supported.",
  FeeTooHigh:                      "Fee is too high.",
  InvalidBps:                      "Invalid basis points.",
  BpsSumMismatch:                  "Split percentages must sum to 100%.",
  InvalidRefundRecipient:          "Invalid refund recipient.",
  InvalidSplitIndex:               "Invalid split index.",
  // Transfer-fee guards — plain English, no CCTP/forwarding-fee jargon
  MaxFeeExceedsBurnAmount:  "This payout is too small to send to another chain — the transfer fee would take the whole amount.",
  MaxFeeBelowFloor:         "The transfer fee provided is below the minimum required for delivery.",
  MilestoneBelowForwardFee: "This milestone is too small to deliver on another chain — increase the amount or choose Arc as the destination.",
  CctpForwardFeeNotSet:     "Auto-delivery to another chain isn't configured. Contact the protocol team.",
  CctpForwardFeeTooHigh:    "The transfer fee exceeds the allowed limit.",
  // Refund-credit recovery (admin)
  NoPendingRecovery:  "No pending refund-credit recovery for that wallet.",
  NotProposedOwner:   "Only the proposed wallet can claim this credit."
}

// Returns the raw technical error string for display in a collapsible
// "Technical details" section. Never show this to users by default.
export const getRawErrorDetails = (error) => {
  if (!error) return null
  const raw =
    error?.cause?.data?.errorName ||
    error?.cause?.reason ||
    error?.shortMessage ||
    error?.details ||
    error?.message ||
    ''
  return raw || null
}

export const parseRevertReason = (error) => {
  if (!error) return 'Transaction failed. Please try again.'

  // Exact match on viem's decoded errorName — checked before any substring scan
  // so a name like NoInvoiceURI is never shadowed by the shorter NoInvoice entry.
  const errorName = error?.cause?.data?.errorName
  if (errorName && ERROR_MAP[errorName]) return ERROR_MAP[errorName]

  // Substring fallback on the remaining error signal — sorted longest-first so
  // prefix collisions (NoInvoice vs NoInvoiceURI, etc.) always resolve correctly.
  const raw =
    error?.cause?.reason ||
    error?.shortMessage ||
    error?.details ||
    error?.message ||
    ''
  const sortedKeys = Object.keys(ERROR_MAP).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (raw.includes(key)) return ERROR_MAP[key]
  }

  const r = String(raw).toLowerCase()
  if (r.includes('user rejected') || r.includes('user denied')) return 'Transaction rejected in wallet.'
  if (r.includes('insufficient funds')) return 'Insufficient funds for gas.'
  return 'Something went wrong.'
}
