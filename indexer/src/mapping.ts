import { BigInt, Bytes, ethereum, Address } from "@graphprotocol/graph-ts";
import {
  Escrow,
  Milestone,
  Dispute,
  Split,
  RefundBalance,
  RefundCredit,
  EvidenceEntry,
} from "../generated/schema";
import {
  TrancheProtocol,
} from "../generated/TrancheProtocol/TrancheProtocol";
import {
  EscrowCreated,
  EscrowTermsSnapshotted,
  SplitConfigured,
  SplitsConfigured,
  DeliveryClaimed,
  MilestoneApproved,
  MilestoneReleased,
  MilestoneCancelled,
  RefundedAfterDeadline,
  DisputeRaised,
  CounterEvidenceSubmitted,
  DisputeResolved,
  DisputeTimedOutSettled,
  MutualSettlementExecuted,
  EscrowRefundedViaMutualCancel,
  PartialRefundCredited,
  RefundWithdrawn,
  RefundCreditTransferred,
  EvidenceAppended,
  MilestoneTitles,
} from "../generated/TrancheProtocol/TrancheProtocol";

// ---- enum string constants (must match schema.graphql) ----
const ESCROW_ACTIVE = "ACTIVE";
const ESCROW_COMPLETED = "COMPLETED";
const ESCROW_CANCELLED = "CANCELLED";

const MS_PENDING = "PENDING";
const MS_FULFILLED = "FULFILLED";
const MS_DISPUTED = "DISPUTED";
const MS_RELEASED = "RELEASED";
const MS_REFUNDED = "REFUNDED";

// ---- helpers ----

function milestoneId(escrowId: BigInt, index: BigInt): string {
  return escrowId.toString() + "-" + index.toString();
}

function getOrCreateEscrow(escrowId: BigInt, event: ethereum.Event): Escrow {
  let id = escrowId.toString();
  let e = Escrow.load(id);
  if (e == null) {
    e = new Escrow(id);
    e.escrowId = escrowId;
    e.depositor = Bytes.empty();
    e.recipient = Bytes.empty();
    e.totalAmount = BigInt.zero();
    e.invoiceHash = Bytes.empty();
    e.invoiceURI = "";
    e.deadline = BigInt.zero();
    e.state = ESCROW_ACTIVE;
    e.splitCount = 0;
    e.milestoneCount = 0;
    e.releasedMilestoneCount = 0;
    e.refundedMilestoneCount = 0;
    e.disputedMilestoneCount = 0;
    e.hasOpenDispute = false;
    e.titles = [];
    e.createdAt = event.block.timestamp;
    e.createdAtBlock = event.block.number;
    e.createdTx = event.transaction.hash;
    e.updatedAt = event.block.timestamp;
  }
  return e as Escrow;
}

function getOrCreateMilestone(
  escrowId: BigInt,
  index: BigInt,
  event: ethereum.Event
): Milestone {
  let id = milestoneId(escrowId, index);
  let m = Milestone.load(id);
  if (m == null) {
    m = new Milestone(id);
    m.escrow = escrowId.toString();
    m.index = index.toI32();
    m.state = MS_PENDING;
    m.updatedAt = event.block.timestamp;

    // Safety net for backfill: bump milestoneCount if we see an index beyond
    // what was recorded at creation (pre-C6a escrows on old deploys).
    let escrow = getOrCreateEscrow(escrowId, event);
    let observed = index.toI32() + 1;
    if (observed > escrow.milestoneCount) {
      escrow.milestoneCount = observed;
      escrow.updatedAt = event.block.timestamp;
      escrow.save();
    }
  }
  return m as Milestone;
}

function getOrCreateRefundBalance(wallet: Bytes, ts: BigInt): RefundBalance {
  let id = wallet.toHexString();
  let r = RefundBalance.load(id);
  if (r == null) {
    r = new RefundBalance(id);
    r.wallet = wallet;
    r.balance = BigInt.zero();
    r.totalCredited = BigInt.zero();
    r.totalWithdrawn = BigInt.zero();
  }
  r.updatedAt = ts;
  return r as RefundBalance;
}

// C6b: Set escrow to COMPLETED when all milestones have reached a terminal
// state (RELEASED or REFUNDED). Only transitions ACTIVE → COMPLETED.
function maybeCompleteEscrow(escrow: Escrow, event: ethereum.Event): void {
  if (escrow.state != ESCROW_ACTIVE) return;
  if (escrow.milestoneCount == 0) return;
  let terminal = escrow.releasedMilestoneCount + escrow.refundedMilestoneCount;
  if (terminal >= escrow.milestoneCount) {
    escrow.state = ESCROW_COMPLETED;
    escrow.updatedAt = event.block.timestamp;
  }
}

function closeDispute(
  escrowId: BigInt,
  index: BigInt,
  resolutionType: string,
  resolutionBps: BigInt,
  resolutionURI: string | null,
  resolutionHash: Bytes | null,
  event: ethereum.Event
): void {
  let dispute = Dispute.load(milestoneId(escrowId, index));
  if (dispute == null) return;
  if (!dispute.resolved) {
    dispute.resolved = true;
    let escrow = getOrCreateEscrow(escrowId, event);
    if (escrow.disputedMilestoneCount > 0) {
      escrow.disputedMilestoneCount = escrow.disputedMilestoneCount - 1;
    }
    escrow.hasOpenDispute = escrow.disputedMilestoneCount > 0;
    escrow.updatedAt = event.block.timestamp;
    escrow.save();
  }
  dispute.resolvedAt = event.block.timestamp;
  dispute.resolutionType = resolutionType;
  dispute.resolutionBps = resolutionBps;
  if (resolutionURI !== null) dispute.resolutionURI = resolutionURI;
  if (resolutionHash !== null) dispute.resolutionHash = resolutionHash;
  dispute.save();
}

// ---- handlers ----

export function handleEscrowCreated(event: EscrowCreated): void {
  let escrow = getOrCreateEscrow(event.params.escrowId, event);
  escrow.depositor = event.params.depositor;
  escrow.recipient = event.params.recipient;
  escrow.totalAmount = event.params.amount;
  escrow.invoiceHash = event.params.invoiceHash;
  escrow.invoiceURI = event.params.invoiceURI;
  escrow.deadline = event.params.deadline;
  escrow.state = ESCROW_ACTIVE;
  escrow.createdAt = event.block.timestamp;
  escrow.createdAtBlock = event.block.number;
  escrow.createdTx = event.transaction.hash;
  escrow.updatedAt = event.block.timestamp;

  // C6a: read the real milestoneCount from the contract rather than
  // accumulating from events (which start at 0 and only count seen indexes).
  let contract = TrancheProtocol.bind(event.address);
  let escrowData = contract.try_getEscrow(event.params.escrowId);
  if (!escrowData.reverted) {
    escrow.milestoneCount = escrowData.value.milestoneCount.toI32();
  }

  escrow.save();
}

export function handleEscrowTermsSnapshotted(
  event: EscrowTermsSnapshotted
): void {
  let escrow = getOrCreateEscrow(event.params.escrowId, event);
  escrow.protocolFeeBps = event.params.protocolFeeBps;
  escrow.protocolTreasury = event.params.protocolTreasury;
  escrow.updatedAt = event.block.timestamp;
  escrow.save();
}

export function handleSplitConfigured(event: SplitConfigured): void {
  let id = event.params.escrowId.toString() + "-" + event.params.index.toString();
  let split = new Split(id);
  split.escrow = event.params.escrowId.toString();
  split.index = event.params.index.toI32();
  split.mintRecipient = event.params.mintRecipient;
  split.destinationDomain = event.params.destinationDomain.toI32();
  split.bps = event.params.bps;
  split.save();
}

export function handleSplitsConfigured(event: SplitsConfigured): void {
  let escrow = getOrCreateEscrow(event.params.escrowId, event);
  escrow.splitCount = event.params.splitCount.toI32();
  escrow.updatedAt = event.block.timestamp;
  escrow.save();
}

// Recipient claims delivery; opens the review window for depositor to
// approve or dispute. reviewDeadline = block.timestamp + reviewWindow.
export function handleDeliveryClaimed(event: DeliveryClaimed): void {
  let m = getOrCreateMilestone(
    event.params.escrowId,
    event.params.milestoneIndex,
    event
  );
  if (m.state == MS_PENDING) {
    m.state = MS_FULFILLED;
  }
  m.reviewDeadline = event.params.reviewDeadline;
  m.deliveredAt = event.block.timestamp;
  m.updatedAt = event.block.timestamp;
  m.save();
}

// Depositor explicitly approves delivery and triggers immediate release.
export function handleMilestoneApproved(event: MilestoneApproved): void {
  let m = getOrCreateMilestone(
    event.params.escrowId,
    event.params.milestoneIndex,
    event
  );
  let was = m.state;
  m.state = MS_RELEASED;
  m.settledVia = "APPROVED";
  m.updatedAt = event.block.timestamp;
  m.save();
  if (was != MS_RELEASED) {
    let escrow = getOrCreateEscrow(event.params.escrowId, event);
    escrow.releasedMilestoneCount = escrow.releasedMilestoneCount + 1;
    escrow.updatedAt = event.block.timestamp;
    maybeCompleteEscrow(escrow, event);
    escrow.save();
  }
}

// Permissionless release after review window lapses with no action (silence = consent).
export function handleMilestoneReleased(event: MilestoneReleased): void {
  let m = getOrCreateMilestone(
    event.params.escrowId,
    event.params.milestoneIndex,
    event
  );
  let was = m.state;
  m.state = MS_RELEASED;
  m.settledVia = "RELEASED_NO_DISPUTE";
  m.updatedAt = event.block.timestamp;
  m.save();
  if (was != MS_RELEASED) {
    let escrow = getOrCreateEscrow(event.params.escrowId, event);
    escrow.releasedMilestoneCount = escrow.releasedMilestoneCount + 1;
    escrow.updatedAt = event.block.timestamp;
    maybeCompleteEscrow(escrow, event);
    escrow.save();
  }
}

// Milestone refunded via mutual cancel proposal (both parties agreed).
export function handleMilestoneCancelled(event: MilestoneCancelled): void {
  let m = getOrCreateMilestone(
    event.params.escrowId,
    event.params.milestoneIndex,
    event
  );
  let was = m.state;
  m.state = MS_REFUNDED;
  m.settledVia = "MILESTONE_CANCELLED";
  m.updatedAt = event.block.timestamp;
  m.save();
  if (was != MS_REFUNDED) {
    let escrow = getOrCreateEscrow(event.params.escrowId, event);
    escrow.refundedMilestoneCount = escrow.refundedMilestoneCount + 1;
    escrow.updatedAt = event.block.timestamp;
    maybeCompleteEscrow(escrow, event);
    escrow.save();
  }
}

// Depositor reclaims a milestone after the escrow deadline + grace period.
export function handleRefundedAfterDeadline(
  event: RefundedAfterDeadline
): void {
  let m = getOrCreateMilestone(
    event.params.escrowId,
    event.params.milestoneIndex,
    event
  );
  let was = m.state;
  m.state = MS_REFUNDED;
  m.settledVia = "REFUNDED_AFTER_DEADLINE";
  m.updatedAt = event.block.timestamp;
  m.save();
  if (was != MS_REFUNDED) {
    let escrow = getOrCreateEscrow(event.params.escrowId, event);
    escrow.refundedMilestoneCount = escrow.refundedMilestoneCount + 1;
    escrow.updatedAt = event.block.timestamp;
    maybeCompleteEscrow(escrow, event);
    escrow.save();
  }
}

export function handleDisputeRaised(event: DisputeRaised): void {
  let m = getOrCreateMilestone(
    event.params.escrowId,
    event.params.milestoneIndex,
    event
  );
  m.state = MS_DISPUTED;
  m.updatedAt = event.block.timestamp;

  let id = milestoneId(event.params.escrowId, event.params.milestoneIndex);
  let dispute = Dispute.load(id);
  let isNewOpen = false;
  if (dispute == null) {
    dispute = new Dispute(id);
    dispute.escrow = event.params.escrowId.toString();
    dispute.milestone = m.id;
    dispute.milestoneIndex = event.params.milestoneIndex.toI32();
    dispute.raisedAt = event.block.timestamp;
    dispute.raisedTx = event.transaction.hash;
    dispute.resolved = false;
    isNewOpen = true;
  } else if (dispute.resolved) {
    dispute.resolved = false;
    dispute.resolvedAt = null;
    dispute.resolutionType = null;
    isNewOpen = true;
  }
  dispute.raisedBy = event.params.raisedBy;
  dispute.isEscalation = false;
  dispute.reason = event.params.reason;
  dispute.evidenceHash = event.params.evidenceHash;
  dispute.save();

  m.dispute = dispute.id;
  m.save();

  if (isNewOpen) {
    let escrow = getOrCreateEscrow(event.params.escrowId, event);
    escrow.disputedMilestoneCount = escrow.disputedMilestoneCount + 1;
    escrow.hasOpenDispute = true;
    escrow.updatedAt = event.block.timestamp;
    escrow.save();
  }
}

export function handleCounterEvidenceSubmitted(
  event: CounterEvidenceSubmitted
): void {
  let id = milestoneId(event.params.escrowId, event.params.milestoneIndex);
  let dispute = Dispute.load(id);
  if (dispute == null) return;
  dispute.counteredBy = event.params.counteredBy;
  dispute.counterEvidenceHash = event.params.counterEvidenceHash;
  dispute.save();
}

export function handleDisputeResolved(event: DisputeResolved): void {
  closeDispute(
    event.params.escrowId,
    event.params.milestoneIndex,
    "RESOLVED",
    event.params.recipientBps,
    event.params.resolutionURI,
    event.params.resolutionHash,
    event
  );
  let m = getOrCreateMilestone(
    event.params.escrowId,
    event.params.milestoneIndex,
    event
  );
  m.state = MS_RELEASED;
  m.settledVia = "DISPUTE_RESOLVED";
  m.resolutionBps = event.params.recipientBps;
  m.resolutionURI = event.params.resolutionURI;
  m.resolutionHash = event.params.resolutionHash;
  m.updatedAt = event.block.timestamp;
  m.save();

  let escrow = getOrCreateEscrow(event.params.escrowId, event);
  escrow.releasedMilestoneCount = escrow.releasedMilestoneCount + 1;
  escrow.updatedAt = event.block.timestamp;
  maybeCompleteEscrow(escrow, event);
  escrow.save();
}

export function handleDisputeTimedOutSettled(
  event: DisputeTimedOutSettled
): void {
  closeDispute(
    event.params.escrowId,
    event.params.milestoneIndex,
    "TIMED_OUT",
    event.params.defaultBps,
    null,
    null,
    event
  );
  let m = getOrCreateMilestone(
    event.params.escrowId,
    event.params.milestoneIndex,
    event
  );
  m.state = MS_RELEASED;
  m.settledVia = "DISPUTE_TIMEOUT";
  m.resolutionBps = event.params.defaultBps;
  m.updatedAt = event.block.timestamp;
  m.save();

  let escrow = getOrCreateEscrow(event.params.escrowId, event);
  escrow.releasedMilestoneCount = escrow.releasedMilestoneCount + 1;
  escrow.updatedAt = event.block.timestamp;
  maybeCompleteEscrow(escrow, event);
  escrow.save();
}

export function handleMutualSettlementExecuted(
  event: MutualSettlementExecuted
): void {
  closeDispute(
    event.params.escrowId,
    event.params.milestoneIndex,
    "MUTUAL_SETTLED",
    event.params.bps,
    null,
    null,
    event
  );
  let m = getOrCreateMilestone(
    event.params.escrowId,
    event.params.milestoneIndex,
    event
  );
  m.state = MS_RELEASED;
  m.settledVia = "MUTUAL_SETTLEMENT";
  m.resolutionBps = event.params.bps;
  m.updatedAt = event.block.timestamp;
  m.save();

  let escrow = getOrCreateEscrow(event.params.escrowId, event);
  escrow.releasedMilestoneCount = escrow.releasedMilestoneCount + 1;
  escrow.updatedAt = event.block.timestamp;
  maybeCompleteEscrow(escrow, event);
  escrow.save();
}

export function handleEscrowRefundedViaMutualCancel(
  event: EscrowRefundedViaMutualCancel
): void {
  let escrow = getOrCreateEscrow(event.params.escrowId, event);
  escrow.state = ESCROW_CANCELLED;
  escrow.updatedAt = event.block.timestamp;
  escrow.save();
}

export function handlePartialRefundCredited(
  event: PartialRefundCredited
): void {
  let r = getOrCreateRefundBalance(
    event.params.refundTo,
    event.block.timestamp
  );
  r.balance = r.balance.plus(event.params.amount);
  r.totalCredited = r.totalCredited.plus(event.params.amount);
  r.save();

  let id =
    event.transaction.hash.toHexString() +
    "-" +
    event.logIndex.toString();
  let credit = new RefundCredit(id);
  credit.escrow = event.params.escrowId.toString();
  credit.milestoneIndex = event.params.milestoneIndex.toI32();
  credit.refundTo = event.params.refundTo;
  credit.amount = event.params.amount;
  credit.timestamp = event.block.timestamp;
  credit.tx = event.transaction.hash;
  credit.save();
}

export function handleRefundWithdrawn(event: RefundWithdrawn): void {
  let r = getOrCreateRefundBalance(
    event.params.depositor,
    event.block.timestamp
  );
  r.balance = r.balance.minus(event.params.amount);
  r.totalWithdrawn = r.totalWithdrawn.plus(event.params.amount);
  r.save();
}

export function handleRefundCreditTransferred(
  event: RefundCreditTransferred
): void {
  let from = getOrCreateRefundBalance(event.params.from, event.block.timestamp);
  from.balance = from.balance.minus(event.params.amount);
  from.save();

  let to = getOrCreateRefundBalance(event.params.to, event.block.timestamp);
  to.balance = to.balance.plus(event.params.amount);
  to.save();
}

// appendEvidence: either party may add evidence to an open dispute.
// Emit-only on-chain; we store an immutable ledger entry per call.
export function handleEvidenceAppended(event: EvidenceAppended): void {
  let id =
    event.transaction.hash.toHexString() +
    "-" +
    event.logIndex.toString();
  let entry = new EvidenceEntry(id);
  entry.escrow = event.params.escrowId.toString();
  entry.milestoneIndex = event.params.milestoneIndex.toI32();
  entry.caller = event.params.caller;
  entry.hash = event.params.hash;
  entry.uri = event.params.uri;
  entry.timestamp = event.params.timestamp;
  entry.tx = event.transaction.hash;
  entry.save();
}

// MilestoneTitles: emitted once at deposit with the depositor-supplied titles.
// Stored on the Escrow entity; an empty array means no titles were provided.
export function handleMilestoneTitles(event: MilestoneTitles): void {
  let escrow = getOrCreateEscrow(event.params.escrowId, event);
  escrow.titles = event.params.titles;
  escrow.updatedAt = event.block.timestamp;
  escrow.save();
}
