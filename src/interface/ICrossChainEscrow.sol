// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICrossChainEscrow {
    enum EscrowState {
        ACTIVE,
        COMPLETED,
        CANCELLED
    }

    enum MilestoneState {
        PENDING,
        FULFILLED,
        DISPUTED,
        RELEASED,
        REFUNDED
    }

    struct Escrow {
        address depositor;
        address recipient;
        address refundTo;
        uint256 totalAmount;
        uint32 destinationDomain;
        bytes32 mintRecipient;
        uint256 disputeWindow;
        bool depositorApproveCancel;
        bool recipientApproveCancel;
        bytes32 invoiceHash;
        string invoiceURI;
        uint256 deadline;
        uint256 milestoneCount;
        EscrowState state;
        // Window the depositor has, after the recipient signals delivery, to
        // raise a dispute or fulfill the milestone. Once expired, anyone can
        // call claimSilentApproval to release the milestone.
        uint256 deliveryNoticeWindow;
    }

    struct Milestone {
        uint256 amount;
        uint256 conditionMetTimestamp;
        MilestoneState state;
        // Timestamp at which the recipient signalled delivery via
        // signalDelivery(). 0 if never signalled.
        uint256 deliveredAt;
    }

    struct DisputeData {
        address disputedBy;
        bytes32 evidenceHash;
        string evidenceURI;
        string reason;
        bytes32 counterEvidenceHash;
        string counterEvidenceURI;
        bytes32 resolutionHash;
        uint256 raisedAt;
    }

    /// @notice Optional multi-party split. Each split recipient may live on a
    ///         different CCTP destination domain.
    struct SplitRecipient {
        bytes32 mintRecipient;
        uint32 destinationDomain;
        uint256 bps;
    }

    // ---------- events ----------

    event EscrowCreated(
        uint256 indexed escrowId,
        address depositor,
        address recipient,
        uint256 amount,
        bytes32 invoiceHash,
        string invoiceURI,
        uint256 deadline
    );
    event ConditionFulfilled(uint256 indexed escrowId, uint256 milestoneIndex, uint256 disputeDeadline);
    event DisputeRaised(
        uint256 indexed escrowId, address raisedBy, uint256 milestoneIndex, string reason, bytes32 evidenceHash
    );
    event CounterEvidenceSubmitted(
        uint256 indexed escrowId, address counteredBy, uint256 milestoneIndex, bytes32 counterEvidenceHash
    );
    event EscrowReleased(uint256 indexed escrowId, uint256 milestoneIndex, bytes32 resolutionHash);
    event EscrowRefunded(uint256 indexed escrowId, uint256 milestoneIndex, bytes32 resolutionHash);
    event EscrowReleasedWithoutDispute(uint256 indexed escrowId, uint256 milestoneIndex);
    event EscrowRefundedViaMutualCancel(uint256 indexed escrowId);
    event RefundWithdrawn(address indexed depositor, uint256 amount);
    event EscalatedAfterDeadline(
        uint256 indexed escrowId, uint256 milestoneIndex, address escalatedBy, string reason, bytes32 evidenceHash
    );

    event SupportedDomainUpdated(uint32 indexed destinationDomain, bool supported);
    event SplitsConfigured(uint256 indexed escrowId, uint256 splitCount);
    event ProtocolFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event ProtocolTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event ProtocolFeeCollected(uint256 indexed escrowId, uint256 milestoneIndex, uint256 fee);
    event MintRecipientUpdated(
        uint256 indexed escrowId, bytes32 newMintRecipient, uint32 newDestinationDomain, address updatedBy
    );
    event CctpForwardFeeUpdated(uint256 newFee);
    event DeliverySignaled(uint256 indexed escrowId, uint256 milestoneIndex, uint256 deliveredAt);
    event SilentApprovalClaimed(uint256 indexed escrowId, uint256 milestoneIndex, address claimedBy);

    // ---------- errors ----------

    error InvalidAmount();
    error ZeroAddress();
    error NoDeposit();
    error NotEscrowOwner();
    error NotEscrowOwnerOrRecipient();
    error InvalidState();
    error DisputeWindowExpired();
    error DisputeWindowNotExpired();
    error NoDispute();
    error EscrowDoesNotExist();
    error DisputeWindowTooShort();
    error NothingToWithdraw();
    error NoInvoice();
    error NoInvoiceURI();
    error DeadlineInPast();
    error NoEvidence();
    error NoEvidenceURI();
    error NoDisputeReason();
    error CannotRespondToOwnDispute();
    error CounterEvidenceAlreadySubmitted();
    error NoResolution();
    error NoMilestones();
    error MilestoneAmountMismatch();
    error InvalidMilestoneIndex();
    error PreviousMilestoneNotComplete();
    error CannotCancelDuringDispute();
    error NotRecipient();
    error DeadlineNotReached();

    error UnsupportedDomain();
    error FeeTooHigh();
    error InvalidBps();
    error BpsSumMismatch();

    error DeadlineRequired();
    error DeadlineTooSoon();
    error DeadlineTooFar();
    error DisputeWindowTooLong();
    error InvalidRefundRecipient();

    error ForwardFeeNotSet();
    error NoticeWindowTooShort();
    error NoticeWindowTooLong();
    error AlreadySignaled();
    error SignalTooCloseToDeadline();
    error NoticeWindowNotExpired();
    error NotSignaled();
}
