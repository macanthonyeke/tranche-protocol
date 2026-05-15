const ERROR_MAP = {
  // From contract
  InvalidAmount:                  "Invalid amount.",
  ZeroAddress:                    "Zero address not allowed.",
  NoDeposit:                      "This escrow is no longer active.",
  EscrowNotActive:                "This escrow is no longer active.",
  NotEscrowOwner:                 "Only the payer can do this.",
  NotEscrowOwnerOrRecipient:      "Only the payer or freelancer can do this.",
  NotDepositor:                   "Only the payer can do this.",
  NotRecipient:                   "Only the freelancer can do this.",
  InvalidState:                   "This action isn't allowed in the current state.",
  MilestoneNotPending:            "This milestone has already been actioned.",
  MilestoneNotFulfilled:          "The payer hasn't approved this milestone yet.",
  DisputeWindowExpired:           "The dispute window has already closed.",
  DisputeWindowNotExpired:        "The review window hasn't closed yet.",
  WindowNotExpired:               "The review window hasn't closed yet.",
  NoDispute:                      "There's no open dispute on this milestone.",
  EscrowDoesNotExist:             "Escrow not found.",
  DisputeWindowTooShort:          "Dispute window is too short.",
  DisputeWindowTooLong:           "Dispute window is too long.",
  NothingToWithdraw:              "There's nothing to withdraw.",
  NoInvoice:                      "Invoice hash is required.",
  NoInvoiceURI:                   "Invoice URI is required.",
  DeadlineInPast:                 "Deadline must be in the future.",
  DeadlineRequired:               "Deadline is required.",
  DeadlineTooSoon:                "Deadline must be at least 1 hour from now.",
  DeadlineTooFar:                 "Deadline is too far in the future.",
  DeadlineNotReached:             "The project deadline hasn't passed yet.",
  NoEvidence:                     "Evidence is required.",
  NoEvidenceURI:                  "Evidence URI is required.",
  NoDisputeReason:                "Dispute reason is required.",
  CannotRespondToOwnDispute:      "You can't respond to your own dispute.",
  CounterEvidenceAlreadySubmitted:"Counter-evidence has already been submitted.",
  AlreadyDisputed:                "A dispute is already open on this milestone.",
  NoResolution:                   "Resolution hash is required.",
  NoMilestones:                   "At least one milestone is required.",
  MilestoneAmountMismatch:        "Milestone amounts must equal the total.",
  InvalidMilestoneIndex:          "Invalid milestone index.",
  PreviousMilestoneNotComplete:   "Previous milestone must be completed first.",
  CannotCancelDuringDispute:      "Can't cancel while a dispute is open.",
  InsufficientAllowance:          "USDC approval needed. Approve first, then try again.",
  ForwardFeeNotSet:               "Cross-chain fee not configured. Contact support.",
  UnsupportedDomain:              "This destination chain is not currently supported.",
  FeeTooHigh:                     "Fee is too high.",
  InvalidBps:                     "Invalid basis points.",
  BpsSumMismatch:                 "Split percentages must sum to 100%.",
  InvalidRefundRecipient:         "Invalid refund recipient.",
  NoticeWindowTooShort:           "Delivery notice window is too short.",
  NoticeWindowTooLong:            "Delivery notice window is too long.",
  AlreadySignaled:                "Delivery has already been signalled.",
  SignalTooCloseToDeadline:       "Too close to the project deadline to mark as delivered.",
  NoticeWindowNotExpired:         "Delivery notice window hasn't expired yet.",
  NotSignaled:                    "Delivery hasn't been signalled."
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
