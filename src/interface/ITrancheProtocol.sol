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
        IN_REVIEW,
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
        // Window the depositor has, after the recipient claims delivery, to
        // approve or dispute. Once it lapses with no action, anyone can call
        // release() (optimistic auto-release: silence = consent).
        uint256 reviewWindow;
        bool depositorApproveCancel;
        bool recipientApproveCancel;
        bytes32 invoiceHash;
        string invoiceURI;
        uint256 deadline;
        uint256 milestoneCount;
        EscrowState state;
    }

    struct Milestone {
        uint256 amount;
        // Timestamp at which the recipient claimed delivery via
        // claimDelivery(); starts the review window. 0 while PENDING.
        uint256 claimedAt;
        MilestoneState state;
    }

    struct DisputeData {
        address raisedBy;
        uint256 raisedAt;
        bytes32 evidenceHash;
        string evidenceURI;
        string reason;
        bytes32 counterEvidenceHash;
        string counterEvidenceURI;
        bytes32 resolutionHash;
        string resolutionURI;
        uint256 resolvedRecipientBps;
    }

    struct SettlementProposal {
        bool exists;
        uint256 bps;
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
        bool[] reviewWindowExpired;
        bool[] claimed;
        uint256[] reviewDeadlines;
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
    /// @notice Recipient claimed delivery; `reviewDeadline` is when the
    ///         optimistic review window lapses and anyone may call release().
    event DeliveryClaimed(uint256 indexed escrowId, uint256 milestoneIndex, uint256 reviewDeadline);
    /// @notice Depositor explicitly approved a claimed milestone (instant release).
    event MilestoneApproved(uint256 indexed escrowId, uint256 milestoneIndex);
    /// @notice Milestone released to the recipient (approve or optimistic auto-release).
    event MilestoneReleased(uint256 indexed escrowId, uint256 milestoneIndex);
    /// @notice Milestone refunded to the depositor because the recipient never
    ///         claimed delivery before the escrow deadline.
    event RefundedAfterDeadline(uint256 indexed escrowId, uint256 milestoneIndex, uint256 amount);
    event DisputeRaised(
        uint256 indexed escrowId,
        address indexed raisedBy,
        uint256 indexed milestoneIndex,
        string reason,
        bytes32 evidenceHash
    );
    event CounterEvidenceSubmitted(
        uint256 indexed escrowId, address counteredBy, uint256 milestoneIndex, bytes32 counterEvidenceHash
    );
    event EscrowReleased(uint256 indexed escrowId, uint256 milestoneIndex, bytes32 resolutionHash);
    event EscrowRefunded(uint256 indexed escrowId, uint256 milestoneIndex, bytes32 resolutionHash);
    event EscrowRefundedViaMutualCancel(uint256 indexed escrowId);
    event RefundWithdrawn(address indexed depositor, uint256 amount);

    event SupportedDomainUpdated(uint32 indexed destinationDomain, bool supported);
    event SplitsConfigured(uint256 indexed escrowId, uint256 splitCount);
    event ProtocolFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event ProtocolTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event ProtocolFeeCollected(uint256 indexed escrowId, uint256 milestoneIndex, uint256 fee);
    event CctpForwardFeeUpdated(uint256 newFee);
    event ReceivingAddressUpdated(
        uint256 indexed escrowId, bytes32 oldAddress, bytes32 newAddress, uint32 oldDomain, uint32 newDomain
    );
    /// @notice Per-split configuration emitted at deposit so indexers can
    ///         reconstruct splits without an on-chain read (M-05).
    event SplitConfigured(
        uint256 indexed escrowId, uint256 index, bytes32 mintRecipient, uint32 destinationDomain, uint256 bps
    );
    /// @notice Snapshot of fee/treasury captured at deposit (H-05) so
    ///         indexers see the exact terms an escrow was created under.
    event EscrowTermsSnapshotted(uint256 indexed escrowId, uint256 protocolFeeBps, address protocolTreasury);
    /// @notice Emitted when a refund credit is moved between owners (M-06).
    event RefundCreditTransferred(address indexed from, address indexed to, uint256 amount);
    /// @notice Step 1 of the two-step recovery (M-03): a RECOVERY_MANAGER has
    ///         proposed moving `blacklistedWallet`'s credit to
    ///         `proposedNewOwner`. No balance moves until the proposed wallet
    ///         self-claims via {claimRefundCreditTransfer}.
    event RefundCreditTransferProposed(
        address indexed blacklistedWallet, address indexed proposedNewOwner, uint256 proposedAt
    );
    /// @notice Emitted when a split recipient redirects their own entry (L-03).
    event SplitReceivingAddressUpdated(
        uint256 indexed escrowId,
        uint256 splitIndex,
        bytes32 oldAddress,
        bytes32 newAddress,
        uint32 oldDomain,
        uint32 newDomain
    );
    event DisputeResolved(
        uint256 indexed escrowId,
        uint256 indexed milestoneIndex,
        uint256 recipientBps,
        bytes32 resolutionHash,
        string resolutionURI
    );
    event DisputeTimedOutSettled(uint256 indexed escrowId, uint256 indexed milestoneIndex, uint256 defaultBps);
    event PartialRefundCredited(
        uint256 indexed escrowId, uint256 indexed milestoneIndex, address indexed refundTo, uint256 amount
    );
    event MutualSettlementProposed(
        uint256 indexed escrowId, uint256 indexed milestoneIndex, address indexed proposer, uint256 bps
    );
    event MutualSettlementExecuted(uint256 indexed escrowId, uint256 indexed milestoneIndex, uint256 bps);
    /// @notice A party proposed a milestone-level mutual cancel. The cancel only
    ///         executes once both parties have proposed for that milestone.
    event MilestoneCancelProposed(uint256 indexed escrowId, uint256 milestoneIndex, address proposer);
    /// @notice A milestone was refunded to the payer via milestone-level mutual
    ///         cancel (both parties agreed; no protocol fee).
    event MilestoneCancelled(uint256 indexed escrowId, uint256 milestoneIndex, uint256 amount);

    // ---------- errors ----------

    error InvalidAmount();
    error ZeroAddress();
    error NoDeposit();
    error NotEscrowOwner();
    error NotEscrowOwnerOrRecipient();
    error InvalidState();
    error ReviewWindowExpired();
    error ReviewWindowNotExpired();
    error NoDispute();
    error EscrowDoesNotExist();
    error ReviewWindowTooShort();
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
    error ReviewWindowTooLong();
    error InvalidRefundRecipient();

    /// @notice Milestone is not IN_REVIEW (must be claimed and not yet
    ///         approved / disputed / released).
    error NotInReview();
    /// @notice Recipient tried to claim delivery after the escrow deadline.
    error DeadlinePassed();

    // ---- New errors introduced by audit fixes ----
    /// @notice `maxFee` parameter would let the CCTP forwarder take the
    ///         entire (or more than entire) burn amount (H-04).
    error MaxFeeExceedsBurnAmount();
    /// @notice The arbiter-inaction timeout has not yet elapsed since the
    ///         dispute was raised (H-02).
    error ArbiterTimeoutNotReached();
    /// @notice The low-level USDC `approve` call did not return success (L-02).
    error UsdcApproveFailed();
    /// @notice A cross-chain {approveRelease}/{release} caller passed `maxFee`
    ///         below the admin-tracked `cctpForwardFee` floor.
    error MaxFeeBelowFloor();

    error DisputeAlreadyResolved();
    error NoResolutionURI();
    error MutualSettlementAlreadyExecuted();

    /// @notice `cctpForwardFee` would exceed {MAX_CCTP_FORWARD_FEE} (L-01).
    error CctpForwardFeeTooHigh();
    /// @notice A milestone on a cross-chain escrow does not out-size the
    ///         current `cctpForwardFee` and could become unreleasable (M-02).
    error MilestoneBelowForwardFee();
    /// @notice A cross-chain silent-approval release was attempted while
    ///         `cctpForwardFee` is 0, which CCTP would not auto-deliver (L-04).
    error CctpForwardFeeNotSet();
    /// @notice No pending two-step refund recovery exists for the given source
    ///         wallet (M-03).
    error NoPendingRecovery();
    /// @notice Caller is not the wallet proposed in the pending recovery (M-03).
    error NotProposedOwner();
    /// @notice `splitIndex` is out of range for the escrow's splits (L-03).
    error InvalidSplitIndex();
}
