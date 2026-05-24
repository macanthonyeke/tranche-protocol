// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Role constants exposed at file level for off-chain tooling (deploy scripts,
// indexers) so callers can import them without duplicating the keccak. The
// implementation contract re-declares them as `public constant` so they remain
// ABI-accessible.
bytes32 constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
bytes32 constant RECOVERY_MANAGER_ROLE = keccak256("RECOVERY_MANAGER_ROLE");

interface ITrancheProtocol {
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

    // ---------- view return types ----------

    /// @notice Slim card-friendly summary used by dashboard / arbiter lists.
    struct EscrowSummary {
        uint256 escrowId;
        address depositor;
        address recipient;
        uint256 totalAmount;
        EscrowState state;
        uint256 deadline;
        uint256 milestoneCount;
        uint256 releasedMilestoneCount;
        uint256 disputedMilestoneCount;
        bytes32 invoiceHash;
        string invoiceURI;
    }

    /// @notice Everything the escrow detail page needs in one call.
    struct EscrowDetail {
        uint256 escrowId;
        Escrow escrow;
        Milestone[] milestones;
        DisputeData[] disputes;
        SplitRecipient[] splits;
        bool[] disputeWindowExpired;
        bool[] deliverySignaled;
        uint256[] effectiveDisputeDeadlines;
        bool isPayer;
        bool isFreelancer;
        bool isArbiter;
    }

    /// @notice Everything the dashboard needs in one call per wallet.
    struct DashboardData {
        EscrowSummary[] asPayer;
        EscrowSummary[] asFreelancer;
        uint256 activeEscrowCount;
        uint256 openDisputeCount;
        uint256 refundBalance;
    }

    /// @notice All four protocol-level role memberships for a single account in
    ///         one call, so the frontend can decide which admin/arbiter/pauser/
    ///         domain-manager UI to render without four separate hasRole reads.
    struct CallerRoles {
        bool isDefaultAdmin;
        bool isArbiter;
        bool isPauser;
        bool isDomainManager;
    }

    /// @notice Snapshot of every protocol-wide setting an admin/settings page
    ///         displays, returned in one call.
    struct ProtocolConfig {
        address usdc;
        address tokenMessenger;
        address protocolTreasury;
        uint256 protocolFeeBps;
        uint256 maxProtocolFeeBps;
        uint256 cctpForwardFee;
        uint32 arcDomain;
        uint256 escrowCount;
        bool paused;
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
    event CctpForwardFeeUpdated(uint256 newFee);
    event DeliverySignaled(uint256 indexed escrowId, uint256 milestoneIndex, uint256 deliveredAt);
    event SilentApprovalClaimed(uint256 indexed escrowId, uint256 milestoneIndex, address claimedBy);
    event ReceivingAddressUpdated(
        uint256 indexed escrowId,
        bytes32 oldAddress,
        bytes32 newAddress,
        uint32 oldDomain,
        uint32 newDomain
    );
    /// @notice Per-split configuration emitted at deposit so indexers can
    ///         reconstruct splits without an on-chain read (M-05).
    event SplitConfigured(
        uint256 indexed escrowId,
        uint256 index,
        bytes32 mintRecipient,
        uint32 destinationDomain,
        uint256 bps
    );
    /// @notice Snapshot of fee/treasury captured at deposit (H-05) so
    ///         indexers see the exact terms an escrow was created under.
    event EscrowTermsSnapshotted(
        uint256 indexed escrowId,
        uint256 protocolFeeBps,
        address protocolTreasury
    );
    /// @notice Emitted when a refund credit is moved between owners (M-06).
    event RefundCreditTransferred(address indexed from, address indexed to, uint256 amount);
    /// @notice Emitted when a stuck dispute is force-resolved by the
    ///         arbiter-inaction timeout (H-02).
    event DisputeTimedOutRefunded(uint256 indexed escrowId, uint256 milestoneIndex);

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

    error NoticeWindowTooShort();
    error NoticeWindowTooLong();
    error AlreadySignaled();
    error SignalTooCloseToDeadline();
    error NoticeWindowNotExpired();
    error NotSignaled();

    // ---- New errors introduced by audit fixes ----
    /// @notice `maxFee` parameter would let the CCTP forwarder take the
    ///         entire (or more than entire) burn amount (H-04).
    error MaxFeeExceedsBurnAmount();
    /// @notice The arbiter-inaction timeout has not yet elapsed since the
    ///         dispute was raised (H-02).
    error ArbiterTimeoutNotReached();
    /// @notice The low-level USDC `approve` call did not return success (L-02).
    error UsdcApproveFailed();
    /// @notice `releaseAfterWindow` caller passed `maxFee` below the
    ///         admin-tracked `cctpForwardFee` floor.
    error MaxFeeBelowFloor();
}
