const KNOWN: Record<string, string> = {
  InvalidState: "This action isn't allowed in the current state.",
  InvalidAmount: "Amount must be greater than zero.",
  ZeroAddress: "Address cannot be zero.",
  NoDeposit: "Escrow has no active deposit.",
  NotEscrowOwner: "Only the depositor can do this.",
  NotEscrowOwnerOrRecipient: "Only the depositor or recipient can do this.",
  NotRecipient: "Only the recipient can do this.",
  DisputeWindowExpired: "The dispute window has expired.",
  DisputeWindowNotExpired: "The dispute window hasn't expired yet.",
  DisputeWindowTooShort: "Dispute window must be at least 1 hour.",
  NoDispute: "No active dispute on this milestone.",
  EscrowDoesNotExist: "Escrow not found.",
  NothingToWithdraw: "You have no pending refunds.",
  NoInvoice: "Invoice hash is required.",
  NoInvoiceURI: "Invoice URI is required.",
  DeadlineInPast: "Deadline must be in the future.",
  DeadlineNotReached: "Deadline hasn't been reached yet.",
  NoEvidence: "Evidence hash is required.",
  NoEvidenceURI: "Evidence URI is required.",
  NoDisputeReason: "A dispute reason is required.",
  CannotRespondToOwnDispute: "You can't submit counter-evidence on your own dispute.",
  CounterEvidenceAlreadySubmitted: "Counter-evidence has already been submitted.",
  NoResolution: "Resolution hash is required.",
  NoMilestones: "At least one milestone is required.",
  MilestoneAmountMismatch: "Milestone amounts must sum to the total.",
  InvalidMilestoneIndex: "Invalid milestone index.",
  PreviousMilestoneNotComplete: "The previous milestone must be released or refunded first.",
  CannotCancelDuringDispute: "Cannot mutual-cancel while a milestone is in dispute.",
  UnsupportedDomain: "That destination chain isn't enabled by the protocol admin.",
  FeeTooHigh: "Fee exceeds maximum (5%).",
  InvalidBps: "Split share must be greater than zero.",
  BpsSumMismatch: "Split shares must sum to 100% (10000 bps).",
};

export function decodeError(err: unknown): string {
  if (!err) return "Unknown error";
  const e = err as { shortMessage?: string; message?: string; details?: string; cause?: { shortMessage?: string } };
  const candidates = [e.shortMessage, e.cause?.shortMessage, e.details, e.message ?? String(err)];

  for (const c of candidates) {
    if (!c) continue;
    for (const [name, friendly] of Object.entries(KNOWN)) {
      if (c.includes(name)) return friendly;
    }
    if (c.toLowerCase().includes("user rejected")) return "Transaction rejected in wallet.";
    if (c.toLowerCase().includes("insufficient funds")) return "Insufficient funds for gas.";
  }

  const fallback = e.shortMessage ?? e.message ?? "Transaction failed";
  // Trim noisy long messages
  return fallback.length > 160 ? fallback.slice(0, 157) + "…" : fallback;
}
