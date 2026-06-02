const ERROR_MAP = {
  // From contract
  InvalidAmount:                  "Invalid amount.",
  ZeroAddress:                    "Zero address not allowed.",
  NoDeposit:                      "This escrow is no longer active.",
  NotEscrowOwner:                 "Only the payer can do this.",
  NotEscrowOwnerOrRecipient:      "Only the payer or freelancer can do this.",
  NotRecipient:                   "Only the freelancer can do this.",
  InvalidState:                   "This action isn't allowed in the current state.",
  NotInReview:                    "This milestone isn't in the review window.",
  ReviewWindowExpired:            "The review window has already closed.",
  ReviewWindowNotExpired:         "The review window hasn't closed yet.",
  ReviewWindowTooShort:           "Review window is too short (min 1 day).",
  ReviewWindowTooLong:            "Review window is too long (max 7 days).",
  DeadlinePassed:                 "The project deadline has already passed.",
  DeadlineNotReached:             "The project deadline hasn't passed yet.",
  NoDispute:                      "There's no open dispute on this milestone.",
  EscrowDoesNotExist:             "Escrow not found.",
  NothingToWithdraw:              "There's nothing to withdraw.",
  NoInvoice:                      "Invoice hash is required.",
  NoInvoiceURI:                   "Invoice URI is required.",
  DeadlineRequired:               "Deadline is required.",
  DeadlineTooSoon:                "Deadline must be at least 1 hour from now.",
  DeadlineTooFar:                 "Deadline is too far in the future.",
  NoEvidence:                     "Evidence is required.",
  NoEvidenceURI:                  "Evidence URI is required.",
  NoDisputeReason:                "Dispute reason is required.",
  CannotRespondToOwnDispute:      "You can't respond to your own dispute.",
  CounterEvidenceAlreadySubmitted:"Counter-evidence has already been submitted.",
  DisputeAlreadyResolved:         "This dispute has already been resolved.",
  MutualSettlementAlreadyExecuted:"This milestone is no longer open to settlement.",
  ArbiterTimeoutNotReached:       "The arbiter timeout window hasn't elapsed yet.",
  NoResolution:                   "Resolution hash is required.",
  NoResolutionURI:                "Resolution URI is required.",
  NoMilestones:                   "At least one milestone is required.",
  TooManyMilestones:              "Too many milestones.",
  TooManySplits:                  "Too many split recipients.",
  MilestoneAmountMismatch:        "Milestone amounts must equal the total.",
  InvalidMilestoneIndex:          "Invalid milestone index.",
  PreviousMilestoneNotComplete:   "Previous milestone must be completed first.",
  CannotCancelDuringDispute:      "Can't cancel while a dispute is open.",
  InsufficientAllowance:          "USDC approval needed. Approve first, then try again.",
  UsdcApproveFailed:              "USDC approval failed. Please try again.",
  UnsupportedDomain:              "This destination chain is not currently supported.",
  FeeTooHigh:                     "Fee is too high.",
  InvalidBps:                     "Invalid basis points.",
  BpsSumMismatch:                 "Split percentages must sum to 100%.",
  InvalidRefundRecipient:         "Invalid refund recipient.",
  InvalidSplitIndex:              "Invalid split index.",
  // CCTP forwarding-fee guards
  MaxFeeExceedsBurnAmount:        "The forwarding fee would consume the whole payout.",
  MaxFeeBelowFloor:               "The forwarding fee is below the required minimum.",
  MilestoneBelowForwardFee:       "A milestone is too small to cover the cross-chain forwarding fee.",
  CctpForwardFeeNotSet:           "Cross-chain forwarding fee isn't set; release can't auto-deliver.",
  CctpForwardFeeTooHigh:          "Forwarding fee is too high.",
  // Refund-credit recovery (admin)
  NoPendingRecovery:              "No pending refund-credit recovery for that wallet.",
  NotProposedOwner:               "Only the proposed wallet can claim this credit."
}

export const parseRevertReason = (error) => {
  if (!error) return 'Transaction failed. Please try again.'
  const raw =
    error?.cause?.data?.errorName ||
    error?.cause?.reason ||
    error?.shortMessage ||
    error?.details ||
    error?.message ||
    ''
  for (const [key, msg] of Object.entries(ERROR_MAP)) {
    if (raw.includes(key)) return msg
  }
  const r = String(raw).toLowerCase()
  if (r.includes('user rejected') || r.includes('user denied')) return 'Transaction rejected in wallet.'
  if (r.includes('insufficient funds')) return 'Insufficient funds for gas.'
  return raw || 'Transaction failed. Please try again.'
}
