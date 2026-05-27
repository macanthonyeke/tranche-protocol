// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ITokenMessenger} from "./interface/ITokenMessenger.sol";
import {ITrancheProtocol} from "./interface/ITrancheProtocol.sol";

contract TrancheProtocol is ITrancheProtocol, AccessControlEnumerable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant DOMAIN_MANAGER_ROLE = keccak256("DOMAIN_MANAGER_ROLE");
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 public constant RECOVERY_MANAGER_ROLE = keccak256("RECOVERY_MANAGER_ROLE");

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_PROTOCOL_FEE = 500; // 5%

    /// @notice Magic tag Circle's CCTP V2 Forwarding Service watches for in
    ///         the burn-message hook data. When present, Circle relays the
    ///         attestation and submits the destination-chain mint on behalf
    ///         of the depositor.
    /// @dev    Decoded layout (Circle docs):
    ///           bytes  0..11 = ASCII "cctp-forward" (12 bytes)
    ///           byte      12 = version byte (0)
    ///           byte      13 = length byte  (0)
    ///           bytes 14..31 = 18 zero padding bytes
    ///         Source: https://developers.circle.com/cctp/howtos/transfer-usdc-with-forwarding-service
    bytes32 public constant FORWARD_HOOK_DATA = 0x636374702d666f72776172640000000000000000000000000000000000000000;

    /// @dev CCTP V2 finality threshold. We hardcode 2000 = Standard Transfer
    ///      (finalized). 1000 = Fast Transfer is explicitly disallowed
    ///      because it carries different reorg and fee semantics.
    uint32 public constant CCTP_MIN_FINALITY_THRESHOLD = 2000;

    /// @notice Arc CCTP domain id. When destinationDomain == ARC_DOMAIN we are
    ///         doing a same-chain transfer and Circle does not charge the
    ///         forwarding fee, so we override maxFee = 0 regardless of the
    ///         configured `cctpForwardFee`.
    uint32 public constant ARC_DOMAIN = 26;

    uint256 public constant ARBITRATION_WINDOW = 14 days;
    uint256 public constant ESCALATION_ARBITRATION_WINDOW = 7 days;

    IERC20 public immutable usdc;
    ITokenMessenger public immutable tokenMessenger;

    uint256 public escrowCount;

    // Protocol fee config
    address public protocolTreasury;
    uint256 public protocolFeeBps; // basis points; 199 = 1.99%

    // Allow list of destination domains usable for CCTP transfers.
    mapping(uint32 => bool) public supportedDomains;

    /// @notice Fee (in USDC base units) the contract is willing to pay
    ///         Circle's Forwarding Service per cross-chain CCTP burn. The
    ///         service charges a gas-based fee that fluctuates with
    ///         destination-chain gas prices, so an admin must keep this in
    ///         sync via {setCctpForwardFee}.
    /// @dev    Same-chain (Arc) burns ignore this and pass maxFee = 0.
    ///         Cross-chain releases revert when this is 0.
    uint256 public cctpForwardFee;

    mapping(uint256 => Escrow) public escrows;
    mapping(address => uint256) public refundBalances;
    mapping(uint256 => mapping(uint256 => DisputeData)) public disputes;
    mapping(uint256 => mapping(uint256 => Milestone)) public milestones;
    mapping(uint256 => SplitRecipient[]) public splits;
    mapping(uint256 => mapping(uint256 => mapping(address => SettlementProposal))) public settlementProposals;

    /// @notice Per-escrow snapshot of `protocolFeeBps` taken at deposit (H-05).
    ///         Releases compute the protocol fee from this snapshot, so an
    ///         admin cannot retroactively raise the fee on in-flight escrows.
    mapping(uint256 => uint256) public escrowFeeBps;
    /// @notice Per-escrow snapshot of `protocolTreasury` taken at deposit
    ///         (H-05). Mirrors `escrowFeeBps`: prevents the admin from
    ///         redirecting fees of existing escrows by changing the global
    ///         `protocolTreasury` mid-flight.
    mapping(uint256 => address) public escrowTreasury;

    constructor(
        address _usdc,
        address _arbiter,
        address _pauser,
        address _domainManager,
        address _tokenMessenger,
        address _protocolTreasury
    ) {
        if (_usdc == address(0)) revert ZeroAddress();
        // H-01: arbiter and pauser were previously unchecked; deploying with
        // `_arbiter = 0` would brick every dispute (no one would hold
        // ARBITER_ROLE), and `_pauser = 0` would brick the kill-switch.
        if (_arbiter == address(0)) revert ZeroAddress();
        if (_pauser == address(0)) revert ZeroAddress();
        if (_domainManager == address(0)) revert ZeroAddress();
        if (_tokenMessenger == address(0)) revert ZeroAddress();
        if (_protocolTreasury == address(0)) revert ZeroAddress();

        usdc = IERC20(_usdc);
        tokenMessenger = ITokenMessenger(_tokenMessenger);
        protocolTreasury = _protocolTreasury;
        protocolFeeBps = 199;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ARBITER_ROLE, _arbiter);
        _grantRole(PAUSER_ROLE, _pauser);
        _grantRole(DOMAIN_MANAGER_ROLE, _domainManager);
        _grantRole(FEE_MANAGER_ROLE, msg.sender);
        _grantRole(RECOVERY_MANAGER_ROLE, msg.sender);
    }

    // =========================================================================
    // Admin configuration
    // =========================================================================

    function addSupportedDomain(uint32 destinationDomain) external onlyRole(DOMAIN_MANAGER_ROLE) {
        supportedDomains[destinationDomain] = true;
        emit SupportedDomainUpdated(destinationDomain, true);
    }

    function removeSupportedDomain(uint32 destinationDomain) external onlyRole(DOMAIN_MANAGER_ROLE) {
        supportedDomains[destinationDomain] = false;
        emit SupportedDomainUpdated(destinationDomain, false);
    }

    function setProtocolFee(uint256 _newFeeBps) external onlyRole(FEE_MANAGER_ROLE) {
        if (_newFeeBps > MAX_PROTOCOL_FEE) revert FeeTooHigh();
        emit ProtocolFeeUpdated(protocolFeeBps, _newFeeBps);
        protocolFeeBps = _newFeeBps;
    }

    function setProtocolTreasury(address _newTreasury) external onlyRole(FEE_MANAGER_ROLE) {
        if (_newTreasury == address(0)) revert ZeroAddress();
        emit ProtocolTreasuryUpdated(protocolTreasury, _newTreasury);
        protocolTreasury = _newTreasury;
    }

    /// @notice Update the maxFee used for cross-chain CCTP forwarding. Admin
    ///         tracks Circle's published gas-based fee and bumps this value
    ///         to keep auto-delivery working without under-fee reverts.
    function setCctpForwardFee(uint256 fee) external onlyRole(FEE_MANAGER_ROLE) {
        cctpForwardFee = fee;
        emit CctpForwardFeeUpdated(fee);
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    function deposit(
        address _recipient,
        address _refundTo,
        uint256 _totalAmount,
        uint32 _destinationDomain,
        bytes32 _mintRecipient,
        uint256 _disputeWindow,
        uint256 _deliveryNoticeWindow,
        bytes32 _invoiceHash,
        string calldata _invoiceURI,
        uint256[] calldata _milestoneAmounts,
        uint256 _deadline,
        SplitRecipient[] calldata _splits
    ) external whenNotPaused nonReentrant returns (uint256 escrowId) {
        if (_totalAmount == 0) revert InvalidAmount();
        if (_recipient == address(0)) revert ZeroAddress();
        if (_mintRecipient == bytes32(0)) revert ZeroAddress();
        if (address(uint160(uint256(_mintRecipient))) == address(0)) revert ZeroAddress();
        if (_disputeWindow < 1 hours) revert DisputeWindowTooShort();
        if (_disputeWindow > 14 days) revert DisputeWindowTooLong();
        if (_deliveryNoticeWindow < 1 days) revert NoticeWindowTooShort();
        if (_deliveryNoticeWindow > 14 days) revert NoticeWindowTooLong();
        if (_invoiceHash == bytes32(0)) revert NoInvoice();
        if (bytes(_invoiceURI).length == 0) revert NoInvoiceURI();
        if (_deadline == 0) revert DeadlineRequired();
        if (_deadline <= block.timestamp + 1 hours) revert DeadlineTooSoon();
        if (_deadline >= block.timestamp + 3650 days) revert DeadlineTooFar();
        if (_milestoneAmounts.length == 0) revert NoMilestones();

        // Validate destination domain only when no splits are used; with splits
        // each per-recipient destinationDomain is validated below.
        if (_splits.length == 0) {
            if (!supportedDomains[_destinationDomain]) revert UnsupportedDomain();
        } else {
            _validateSplits(_splits);
        }

        // Default refundTo to the depositor when address(0) is passed.
        if (_refundTo == address(0)) _refundTo = msg.sender;

        uint256 sum = 0;
        for (uint256 i = 0; i < _milestoneAmounts.length; i++) {
            if (_milestoneAmounts[i] == 0) revert InvalidAmount();
            sum += _milestoneAmounts[i];
        }
        if (sum != _totalAmount) revert MilestoneAmountMismatch();

        usdc.safeTransferFrom(msg.sender, address(this), _totalAmount);

        escrowId = ++escrowCount;

        escrows[escrowId] = Escrow({
            depositor: msg.sender,
            recipient: _recipient,
            refundTo: _refundTo,
            totalAmount: _totalAmount,
            destinationDomain: _destinationDomain,
            mintRecipient: _mintRecipient,
            disputeWindow: _disputeWindow,
            depositorApproveCancel: false,
            recipientApproveCancel: false,
            invoiceHash: _invoiceHash,
            invoiceURI: _invoiceURI,
            deadline: _deadline,
            milestoneCount: _milestoneAmounts.length,
            state: EscrowState.ACTIVE,
            deliveryNoticeWindow: _deliveryNoticeWindow
        });

        for (uint256 i = 0; i < _milestoneAmounts.length; i++) {
            milestones[escrowId][i] = Milestone({
                amount: _milestoneAmounts[i], conditionMetTimestamp: 0, state: MilestoneState.PENDING, deliveredAt: 0
            });
        }

        if (_splits.length > 0) {
            for (uint256 i = 0; i < _splits.length; i++) {
                splits[escrowId].push(_splits[i]);
                // M-05: per-recipient events so indexers can reconstruct
                // splits without an on-chain read.
                emit SplitConfigured(
                    escrowId, i, _splits[i].mintRecipient, _splits[i].destinationDomain, _splits[i].bps
                );
            }
            emit SplitsConfigured(escrowId, _splits.length);
        }

        // H-05: snapshot the live fee schedule onto this escrow so a future
        // admin call to setProtocolFee / setProtocolTreasury cannot rewrite
        // the economics under depositors who already locked their USDC.
        escrowFeeBps[escrowId] = protocolFeeBps;
        escrowTreasury[escrowId] = protocolTreasury;
        emit EscrowTermsSnapshotted(escrowId, protocolFeeBps, protocolTreasury);

        emit EscrowCreated(escrowId, msg.sender, _recipient, _totalAmount, _invoiceHash, _invoiceURI, _deadline);
    }

    function fulfillCondition(uint256 escrowId, uint256 milestoneIndex) external nonReentrant {
        // I-03: nonReentrant added for consistency with every other state-
        // mutating entry point. The function makes no external calls today
        // but is now future-proofed.
        Escrow storage e = escrows[escrowId];
        Milestone storage m = milestones[escrowId][milestoneIndex];

        if (m.state != MilestoneState.PENDING) revert InvalidState();
        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (e.state != EscrowState.ACTIVE) revert NoDeposit();
        if (e.depositor != msg.sender) revert NotEscrowOwner();
        if (milestoneIndex >= e.milestoneCount) revert InvalidMilestoneIndex();

        if (milestoneIndex > 0) {
            Milestone storage prev = milestones[escrowId][milestoneIndex - 1];
            if (prev.state != MilestoneState.RELEASED && prev.state != MilestoneState.REFUNDED) {
                revert PreviousMilestoneNotComplete();
            }
        }

        m.conditionMetTimestamp = block.timestamp;
        m.state = MilestoneState.FULFILLED;

        uint256 effectiveWindow = m.deliveredAt > 0 ? e.disputeWindow / 2 : e.disputeWindow;
        emit ConditionFulfilled(escrowId, milestoneIndex, block.timestamp + effectiveWindow);
    }

    function raiseDispute(
        uint256 escrowId,
        uint256 milestoneIndex,
        string calldata _reason,
        bytes32 _evidenceHash,
        string calldata _evidenceURI
    ) external {
        Escrow storage e = escrows[escrowId];
        Milestone storage m = milestones[escrowId][milestoneIndex];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (e.depositor != msg.sender && e.recipient != msg.sender) revert NotEscrowOwnerOrRecipient();
        if (m.state != MilestoneState.FULFILLED) revert InvalidState();
        if (_evidenceHash == bytes32(0)) revert NoEvidence();
        if (bytes(_evidenceURI).length == 0) revert NoEvidenceURI();
        if (bytes(_reason).length == 0) revert NoDisputeReason();

        // If the recipient signalled delivery before the depositor approved,
        // both parties were already aligned and we halve the dispute window
        // both for raising disputes and (in releaseAfterWindow) for releasing.
        uint256 effectiveWindow = m.deliveredAt > 0 ? e.disputeWindow / 2 : e.disputeWindow;
        if (block.timestamp > m.conditionMetTimestamp + effectiveWindow) revert DisputeWindowExpired();

        disputes[escrowId][milestoneIndex] = DisputeData({
            raisedBy: msg.sender,
            isEscalation: false,
            raisedAt: block.timestamp,
            evidenceHash: _evidenceHash,
            evidenceURI: _evidenceURI,
            reason: _reason,
            counterEvidenceHash: bytes32(0),
            counterEvidenceURI: "",
            resolutionHash: bytes32(0),
            resolutionURI: "",
            resolvedRecipientBps: 0
        });

        m.state = MilestoneState.DISPUTED;

        emit DisputeRaised(escrowId, msg.sender, milestoneIndex, _reason, _evidenceHash);
    }

    function submitCounterEvidence(
        uint256 escrowId,
        uint256 milestoneIndex,
        bytes32 _counterEvidenceHash,
        string calldata _counterEvidenceURI
    ) external {
        Escrow storage e = escrows[escrowId];
        Milestone storage m = milestones[escrowId][milestoneIndex];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (m.state != MilestoneState.DISPUTED) revert InvalidState();

        DisputeData storage d = disputes[escrowId][milestoneIndex];

        if (d.raisedBy == msg.sender) revert CannotRespondToOwnDispute();
        if (msg.sender != e.depositor && msg.sender != e.recipient) revert NotEscrowOwnerOrRecipient();
        if (_counterEvidenceHash == bytes32(0)) revert NoEvidence();
        if (bytes(_counterEvidenceURI).length == 0) revert NoEvidenceURI();
        if (d.counterEvidenceHash != bytes32(0)) revert CounterEvidenceAlreadySubmitted();
        if (d.resolutionHash != bytes32(0)) revert DisputeAlreadyResolved();

        d.counterEvidenceHash = _counterEvidenceHash;
        d.counterEvidenceURI = _counterEvidenceURI;

        emit CounterEvidenceSubmitted(escrowId, msg.sender, milestoneIndex, _counterEvidenceHash);
    }

    function resolveDispute(
        uint256 escrowId,
        uint256 milestoneIndex,
        uint256 _recipientBps,
        bytes32 _resolutionHash,
        string calldata _resolutionURI,
        uint256 maxFee
    ) external onlyRole(ARBITER_ROLE) nonReentrant {
        Escrow storage e = escrows[escrowId];
        DisputeData storage d = disputes[escrowId][milestoneIndex];
        Milestone storage m = milestones[escrowId][milestoneIndex];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (m.state != MilestoneState.DISPUTED) revert NoDispute();
        if (_resolutionHash == bytes32(0)) revert NoResolution();
        if (bytes(_resolutionURI).length == 0) revert NoResolutionURI();
        if (_recipientBps > BPS_DENOMINATOR) revert InvalidBps();

        d.resolutionHash = _resolutionHash;
        d.resolutionURI = _resolutionURI;
        d.resolvedRecipientBps = _recipientBps;

        _executePartialRelease(escrowId, milestoneIndex, e, m, _recipientBps, maxFee);

        emit DisputeResolved(escrowId, milestoneIndex, _recipientBps, _resolutionHash, _resolutionURI);
    }

    function mutualSettle(uint256 escrowId, uint256 milestoneIndex, uint256 _agreedBps, uint256 maxFee)
        external
        nonReentrant
    {
        Escrow storage e = escrows[escrowId];
        Milestone storage m = milestones[escrowId][milestoneIndex];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (m.state != MilestoneState.DISPUTED) revert MutualSettlementAlreadyExecuted();
        if (msg.sender != e.depositor && msg.sender != e.recipient) revert NotEscrowOwnerOrRecipient();
        if (_agreedBps > BPS_DENOMINATOR) revert InvalidBps();

        SettlementProposal storage proposal = settlementProposals[escrowId][milestoneIndex][msg.sender];
        proposal.exists = true;
        proposal.bps = _agreedBps;

        emit MutualSettlementProposed(escrowId, milestoneIndex, msg.sender, _agreedBps);

        SettlementProposal storage dep = settlementProposals[escrowId][milestoneIndex][e.depositor];
        SettlementProposal storage rec = settlementProposals[escrowId][milestoneIndex][e.recipient];

        if (dep.exists && rec.exists && dep.bps == rec.bps) {
            _executePartialRelease(escrowId, milestoneIndex, e, m, _agreedBps, maxFee);
            emit MutualSettlementExecuted(escrowId, milestoneIndex, _agreedBps);
        }
    }

    function resolveDisputeByTimeout(uint256 escrowId, uint256 milestoneIndex) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        Milestone storage m = milestones[escrowId][milestoneIndex];
        DisputeData storage d = disputes[escrowId][milestoneIndex];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (m.state != MilestoneState.DISPUTED) revert NoDispute();

        uint256 timeout = d.isEscalation ? ESCALATION_ARBITRATION_WINDOW : ARBITRATION_WINDOW;
        if (block.timestamp < d.raisedAt + timeout) revert ArbiterTimeoutNotReached();

        uint256 defaultBps = d.raisedBy == e.recipient ? 5000 : 0;
        uint256 recipientShare = (m.amount * defaultBps) / BPS_DENOMINATOR;
        uint256 depositorShare = m.amount - recipientShare;

        m.state = MilestoneState.REFUNDED;
        if (recipientShare > 0) {
            refundBalances[e.recipient] += recipientShare;
        }
        if (depositorShare > 0) {
            refundBalances[e.refundTo] += depositorShare;
        }

        d.resolvedRecipientBps = defaultBps;

        _checkEscrowCompletion(escrowId);

        emit DisputeTimedOutSettled(escrowId, milestoneIndex, defaultBps);
    }

    /// @notice Permissionless release of a FULFILLED milestone after its
    ///         dispute window has expired. The caller supplies `maxFee` so the
    ///         frontend can quote Circle's live forwarding fee at call time.
    /// @dev    Defense-in-depth floor: when the burn will actually be
    ///         cross-chain, `maxFee` must be at least the admin-tracked
    ///         `cctpForwardFee`. Circle still only charges its actual quote
    ///         (up to maxFee), but the floor stops a permissionless caller
    ///         from passing a value below the protocol's published fee.
    ///         Same-chain (Arc) burns force maxFee = 0 inside
    ///         `_approveAndBurn`, so the floor is intentionally skipped on
    ///         that path.
    function releaseAfterWindow(uint256 escrowId, uint256 milestoneIndex, uint256 maxFee) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        Milestone storage m = milestones[escrowId][milestoneIndex];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (m.state != MilestoneState.FULFILLED) revert InvalidState();

        uint256 effectiveWindow = m.deliveredAt > 0 ? e.disputeWindow / 2 : e.disputeWindow;
        if (block.timestamp < m.conditionMetTimestamp + effectiveWindow) revert DisputeWindowNotExpired();
        if (_isTrancheProtocol(escrowId, e) && maxFee < cctpForwardFee) revert MaxFeeBelowFloor();

        m.state = MilestoneState.RELEASED;

        _executeCCTPReleaseAmount(escrowId, milestoneIndex, e, m.amount, maxFee);

        _checkEscrowCompletion(escrowId);

        emit EscrowReleasedWithoutDispute(escrowId, milestoneIndex);
    }

    function _checkEscrowCompletion(uint256 escrowId) internal {
        Escrow storage e = escrows[escrowId];

        for (uint256 i = 0; i < e.milestoneCount; i++) {
            Milestone storage m = milestones[escrowId][i];
            if (m.state != MilestoneState.RELEASED && m.state != MilestoneState.REFUNDED) {
                return;
            }
        }

        e.state = EscrowState.COMPLETED;
    }

    function escalateAfterDeadline(
        uint256 escrowId,
        uint256 milestoneIndex,
        string calldata _reason,
        bytes32 _evidenceHash,
        string calldata _evidenceURI
    ) external {
        Escrow storage e = escrows[escrowId];
        Milestone storage m = milestones[escrowId][milestoneIndex];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (e.state != EscrowState.ACTIVE) revert InvalidState();
        if (msg.sender != e.recipient) revert NotRecipient();
        if (block.timestamp <= e.deadline) revert DeadlineNotReached();
        if (m.state != MilestoneState.PENDING) revert InvalidState();
        if (milestoneIndex >= e.milestoneCount) revert InvalidMilestoneIndex();

        if (_evidenceHash == bytes32(0)) revert NoEvidence();
        if (bytes(_evidenceURI).length == 0) revert NoEvidenceURI();
        if (bytes(_reason).length == 0) revert NoDisputeReason();

        if (milestoneIndex > 0) {
            Milestone storage prev = milestones[escrowId][milestoneIndex - 1];
            if (prev.state != MilestoneState.RELEASED && prev.state != MilestoneState.REFUNDED) {
                revert PreviousMilestoneNotComplete();
            }
        }

        disputes[escrowId][milestoneIndex] = DisputeData({
            raisedBy: msg.sender,
            isEscalation: true,
            raisedAt: block.timestamp,
            evidenceHash: _evidenceHash,
            evidenceURI: _evidenceURI,
            reason: _reason,
            counterEvidenceHash: bytes32(0),
            counterEvidenceURI: "",
            resolutionHash: bytes32(0),
            resolutionURI: "",
            resolvedRecipientBps: 0
        });

        m.state = MilestoneState.DISPUTED;

        emit EscalatedAfterDeadline(escrowId, milestoneIndex, msg.sender, _reason, _evidenceHash);
    }

    function mutualCancel(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (e.state != EscrowState.ACTIVE) revert NoDeposit();
        if (e.depositor != msg.sender && e.recipient != msg.sender) revert NotEscrowOwnerOrRecipient();

        if (e.depositor == msg.sender) {
            e.depositorApproveCancel = true;
        } else {
            e.recipientApproveCancel = true;
        }

        if (e.depositorApproveCancel && e.recipientApproveCancel) {
            uint256 refundable = 0;
            for (uint256 i = 0; i < e.milestoneCount; i++) {
                Milestone storage m = milestones[escrowId][i];
                if (m.state == MilestoneState.DISPUTED) revert CannotCancelDuringDispute();
                if (m.state == MilestoneState.PENDING || m.state == MilestoneState.FULFILLED) {
                    refundable += m.amount;
                    m.state = MilestoneState.REFUNDED;
                }
            }

            e.state = EscrowState.CANCELLED;

            refundBalances[e.refundTo] += refundable;

            emit EscrowRefundedViaMutualCancel(escrowId);
        }
    }

    /// @notice Withdraw the caller's accumulated refund credit to an address
    ///         the caller controls. The destination is parameterised so that
    ///         a depositor whose original address becomes blacklisted (e.g.
    ///         Circle freeze) can still recover funds to a different wallet.
    function withdrawRefund(address recipient) external nonReentrant {
        if (recipient == address(0)) revert InvalidRefundRecipient();

        uint256 amount = refundBalances[msg.sender];

        if (amount == 0) revert NothingToWithdraw();

        refundBalances[msg.sender] = 0;

        usdc.safeTransfer(recipient, amount);

        emit RefundWithdrawn(recipient, amount);
    }

    /// @notice Move the caller's refund credit to `newOwner` (M-06). Lets a
    ///         refund-credit holder who can no longer transact from their
    ///         current address (key loss, Circle freeze) hand the credit off
    ///         to a recoverable wallet — without moving any USDC yet, so
    ///         this stays a permissioned, single-tx admin-free operation.
    /// @dev    Does NOT transfer USDC; only re-keys the internal balance.
    function transferRefundCredit(address newOwner) external nonReentrant {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == msg.sender) revert InvalidRefundRecipient();

        uint256 amount = refundBalances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        refundBalances[msg.sender] = 0;
        refundBalances[newOwner] += amount;

        emit RefundCreditTransferred(msg.sender, newOwner, amount);
    }

    /// @notice Emergency recovery for wallets blacklisted
    /// by Circle on chains where USDC is the native gas token
    /// (e.g. Arc). On such chains a blacklisted wallet cannot
    /// pay gas and therefore cannot call transferRefundCredit
    /// itself. Admin verifies wallet ownership off-chain via
    /// signed message before calling this function.
    /// @dev Only callable by RECOVERY_MANAGER_ROLE. Does not
    /// move USDC — only re-keys the internal balance mapping.
    function adminTransferRefundCredit(address blacklistedWallet, address newOwner)
        external
        onlyRole(RECOVERY_MANAGER_ROLE)
        nonReentrant
    {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == blacklistedWallet) revert InvalidRefundRecipient();

        uint256 amount = refundBalances[blacklistedWallet];
        if (amount == 0) revert NothingToWithdraw();

        refundBalances[blacklistedWallet] = 0;
        refundBalances[newOwner] += amount;

        emit RefundCreditTransferred(blacklistedWallet, newOwner, amount);
    }

    /// @notice Recipient-only redirect for future milestone settlements. Updates
    ///         both the bytes32 receiving address and the CCTP destination
    ///         domain. Permitted during the entire ACTIVE lifecycle including
    ///         while milestones are DISPUTED; only COMPLETED / CANCELLED
    ///         escrows are blocked because their funds are gone or the escrow
    ///         is dead.
    function updateReceivingAddress(uint256 escrowId, bytes32 newAddress, uint32 newDestinationDomain) external {
        Escrow storage e = escrows[escrowId];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (e.state == EscrowState.COMPLETED) revert InvalidState();
        if (e.state == EscrowState.CANCELLED) revert InvalidState();
        if (msg.sender != e.recipient) revert NotRecipient();
        if (newAddress == bytes32(0)) revert ZeroAddress();
        if (address(uint160(uint256(newAddress))) == address(0)) revert ZeroAddress();
        // ARC_DOMAIN is the home chain — same-chain transfer is always
        // available even if the domain manager removed it from
        // supportedDomains. Other domains must be on the allow-list.
        if (newDestinationDomain != ARC_DOMAIN && !supportedDomains[newDestinationDomain]) revert UnsupportedDomain();

        bytes32 oldAddress = e.mintRecipient;
        uint32 oldDomain = e.destinationDomain;

        e.mintRecipient = newAddress;
        e.destinationDomain = newDestinationDomain;

        emit ReceivingAddressUpdated(escrowId, oldAddress, newAddress, oldDomain, newDestinationDomain);
    }

    /// @notice Recipient flags a milestone as delivered. If the depositor
    ///         takes no action (fulfillCondition / mutualCancel / dispute)
    ///         within `deliveryNoticeWindow`, anyone can call
    ///         {claimSilentApproval} to release the milestone via CCTP.
    /// @dev    Sequential: previous milestones must already be RELEASED or
    ///         REFUNDED. Cannot be invoked once `block.timestamp +
    ///         deliveryNoticeWindow > deadline` to stop a recipient from
    ///         signalling at the very end of the escrow and pushing
    ///         auto-release past the depositor's deadline.
    function signalDelivery(uint256 escrowId, uint256 milestoneIndex) external {
        Escrow storage e = escrows[escrowId];
        Milestone storage m = milestones[escrowId][milestoneIndex];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (e.state != EscrowState.ACTIVE) revert InvalidState();
        if (msg.sender != e.recipient) revert NotRecipient();
        if (milestoneIndex >= e.milestoneCount) revert InvalidMilestoneIndex();
        if (m.state != MilestoneState.PENDING) revert InvalidState();
        if (m.deliveredAt != 0) revert AlreadySignaled();

        if (milestoneIndex > 0) {
            Milestone storage prev = milestones[escrowId][milestoneIndex - 1];
            if (prev.state != MilestoneState.RELEASED && prev.state != MilestoneState.REFUNDED) {
                revert PreviousMilestoneNotComplete();
            }
        }

        // Late-signal protection: silent-approval must complete before the
        // escrow deadline, otherwise the depositor's escalateAfterDeadline
        // path is the correct remedy.
        if (block.timestamp + e.deliveryNoticeWindow > e.deadline) revert SignalTooCloseToDeadline();

        m.deliveredAt = block.timestamp;

        emit DeliverySignaled(escrowId, milestoneIndex, block.timestamp);
    }

    /// @notice Permissionless release of a milestone whose recipient signalled
    ///         delivery and whose `deliveryNoticeWindow` has expired without
    ///         depositor action. Same settlement path as
    ///         {releaseAfterWindow}: protocol fee + CCTP forwarded burn.
    /// @dev    Mirrors releaseAfterWindow's pause behaviour: NOT pausable, so
    ///         a paused contract cannot censor a recipient's deliverable.
    function claimSilentApproval(uint256 escrowId, uint256 milestoneIndex) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        Milestone storage m = milestones[escrowId][milestoneIndex];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (m.state != MilestoneState.PENDING) revert InvalidState();
        if (m.deliveredAt == 0) revert NotSignaled();
        if (block.timestamp <= m.deliveredAt + e.deliveryNoticeWindow) revert NoticeWindowNotExpired();

        m.state = MilestoneState.RELEASED;

        _executeCCTPReleaseAmount(escrowId, milestoneIndex, e, m.amount, cctpForwardFee);

        _checkEscrowCompletion(escrowId);

        emit SilentApprovalClaimed(escrowId, milestoneIndex, msg.sender);
    }

    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // =========================================================================
    // Views
    // =========================================================================

    function splitsLength(uint256 escrowId) external view returns (uint256) {
        return splits[escrowId].length;
    }

    /// @notice Refund credit accumulated for `account`. Mirrors the public
    ///         `refundBalances` getter under a stable name.
    function getRefundBalance(address account) external view returns (uint256) {
        return refundBalances[account];
    }

    /// @notice Full escrow struct for `escrowId`. Reverts if it does not exist.
    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        Escrow memory e = escrows[escrowId];
        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        return e;
    }

    /// @notice All milestones for `escrowId` in index order.
    function getMilestones(uint256 escrowId) public view returns (Milestone[] memory list) {
        Escrow storage e = escrows[escrowId];
        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        list = new Milestone[](e.milestoneCount);
        for (uint256 i = 0; i < e.milestoneCount; i++) {
            list[i] = milestones[escrowId][i];
        }
    }

    /// @notice All dispute records for `escrowId`, indexed by milestone. Slots
    ///         for milestones that were never disputed are zero-filled.
    function getDisputes(uint256 escrowId) public view returns (DisputeData[] memory list) {
        Escrow storage e = escrows[escrowId];
        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        list = new DisputeData[](e.milestoneCount);
        for (uint256 i = 0; i < e.milestoneCount; i++) {
            list[i] = disputes[escrowId][i];
        }
    }

    /// @notice All split recipients configured for `escrowId`. Empty array when
    ///         the escrow has no splits (single recipient path).
    function getSplits(uint256 escrowId) public view returns (SplitRecipient[] memory) {
        return splits[escrowId];
    }

    /// @notice True if a milestone is FULFILLED and its dispute window has
    ///         already passed (accounting for the half-window when the
    ///         recipient signalled delivery before the depositor fulfilled).
    function isDisputeWindowExpired(uint256 escrowId, uint256 milestoneIndex) public view returns (bool) {
        Escrow storage e = escrows[escrowId];
        Milestone storage m = milestones[escrowId][milestoneIndex];
        if (e.depositor == address(0)) return false;
        if (m.state != MilestoneState.FULFILLED) return false;
        uint256 effectiveWindow = m.deliveredAt > 0 ? e.disputeWindow / 2 : e.disputeWindow;
        return block.timestamp >= m.conditionMetTimestamp + effectiveWindow;
    }

    /// @notice True if the recipient has called `signalDelivery` on a
    ///         still-pending milestone.
    function isDeliverySignaled(uint256 escrowId, uint256 milestoneIndex) public view returns (bool) {
        return milestones[escrowId][milestoneIndex].deliveredAt != 0;
    }

    /// @notice Caller role on a given escrow.
    /// @return isPayer       caller is the depositor
    /// @return isFreelancer  caller is the recipient
    /// @return isArbiter     caller holds ARBITER_ROLE
    function getRole(uint256 escrowId, address caller)
        public
        view
        returns (bool isPayer, bool isFreelancer, bool isArbiter)
    {
        Escrow storage e = escrows[escrowId];
        isPayer = e.depositor == caller;
        isFreelancer = e.recipient == caller;
        isArbiter = hasRole(ARBITER_ROLE, caller);
    }

    /// @notice Single-call payload for the escrow detail page.
    function getEscrowDetail(uint256 escrowId, address caller) external view returns (EscrowDetail memory detail) {
        Escrow memory e = escrows[escrowId];
        if (e.depositor == address(0)) revert EscrowDoesNotExist();

        uint256 count = e.milestoneCount;
        Milestone[] memory ms = new Milestone[](count);
        DisputeData[] memory ds = new DisputeData[](count);
        bool[] memory expired = new bool[](count);
        bool[] memory signaled = new bool[](count);
        uint256[] memory deadlines = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            Milestone memory m = milestones[escrowId][i];
            ms[i] = m;
            ds[i] = disputes[escrowId][i];
            signaled[i] = m.deliveredAt != 0;

            uint256 effectiveWindow = m.deliveredAt > 0 ? e.disputeWindow / 2 : e.disputeWindow;
            if (m.state == MilestoneState.FULFILLED) {
                deadlines[i] = m.conditionMetTimestamp + effectiveWindow;
                expired[i] = block.timestamp >= deadlines[i];
            }
        }

        detail.escrowId = escrowId;
        detail.escrow = e;
        detail.milestones = ms;
        detail.disputes = ds;
        detail.splits = splits[escrowId];
        detail.disputeWindowExpired = expired;
        detail.deliverySignaled = signaled;
        detail.effectiveDisputeDeadlines = deadlines;
        (detail.isPayer, detail.isFreelancer, detail.isArbiter) = getRole(escrowId, caller);
    }

    /// @notice Escrow summaries where `payer` is the depositor.
    function getEscrowsForPayer(address payer) public view returns (EscrowSummary[] memory) {
        return _collectByParticipant(payer, true);
    }

    /// @notice Escrow summaries where `freelancer` is the recipient.
    function getEscrowsForFreelancer(address freelancer) public view returns (EscrowSummary[] memory) {
        return _collectByParticipant(freelancer, false);
    }

    /// @notice Count of ACTIVE escrows where `account` is depositor or recipient.
    function getActiveEscrowCount(address account) public view returns (uint256 count) {
        uint256 total = escrowCount;
        for (uint256 i = 1; i <= total; i++) {
            Escrow storage e = escrows[i];
            if (e.state != EscrowState.ACTIVE) continue;
            if (e.depositor == account || e.recipient == account) count++;
        }
    }

    /// @notice Count of milestones currently in DISPUTED state across all
    ///         escrows where `account` is depositor or recipient.
    function getOpenDisputeCount(address account) public view returns (uint256 count) {
        uint256 total = escrowCount;
        for (uint256 i = 1; i <= total; i++) {
            Escrow storage e = escrows[i];
            if (e.depositor != account && e.recipient != account) continue;
            for (uint256 j = 0; j < e.milestoneCount; j++) {
                if (milestones[i][j].state == MilestoneState.DISPUTED) count++;
            }
        }
    }

    /// @notice Everything the dashboard needs for `account` in one call.
    function getDashboard(address account) external view returns (DashboardData memory data) {
        data.asPayer = getEscrowsForPayer(account);
        data.asFreelancer = getEscrowsForFreelancer(account);
        data.refundBalance = refundBalances[account];

        uint256 total = escrowCount;
        for (uint256 i = 1; i <= total; i++) {
            Escrow storage e = escrows[i];
            bool involved = e.depositor == account || e.recipient == account;
            if (!involved) continue;
            if (e.state == EscrowState.ACTIVE) data.activeEscrowCount++;
            for (uint256 j = 0; j < e.milestoneCount; j++) {
                if (milestones[i][j].state == MilestoneState.DISPUTED) data.openDisputeCount++;
            }
        }
    }

    /// @notice One call lets the frontend gate admin / arbiter / pauser /
    ///         domain-manager UI for `account` without four hasRole reads.
    function getCallerRoles(address account) external view returns (CallerRoles memory r) {
        r.isDefaultAdmin = hasRole(DEFAULT_ADMIN_ROLE, account);
        r.isArbiter = hasRole(ARBITER_ROLE, account);
        r.isPauser = hasRole(PAUSER_ROLE, account);
        r.isDomainManager = hasRole(DOMAIN_MANAGER_ROLE, account);
    }

    /// @notice Single payload for an admin/settings page covering every
    ///         protocol-wide setting; replaces ~7 separate eth_calls.
    function getProtocolConfig() external view returns (ProtocolConfig memory c) {
        c.usdc = address(usdc);
        c.tokenMessenger = address(tokenMessenger);
        c.protocolTreasury = protocolTreasury;
        c.protocolFeeBps = protocolFeeBps;
        c.maxProtocolFeeBps = MAX_PROTOCOL_FEE;
        c.cctpForwardFee = cctpForwardFee;
        c.arcDomain = ARC_DOMAIN;
        c.escrowCount = escrowCount;
        c.paused = paused();
    }

    /// @notice Summaries for every escrow with at least one milestone in
    ///         DISPUTED state. Intended for the arbiter panel.
    function getDisputedEscrows() external view returns (EscrowSummary[] memory) {
        uint256 total = escrowCount;
        uint256[] memory ids = new uint256[](total);
        uint256 n;
        for (uint256 i = 1; i <= total; i++) {
            Escrow storage e = escrows[i];
            for (uint256 j = 0; j < e.milestoneCount; j++) {
                if (milestones[i][j].state == MilestoneState.DISPUTED) {
                    ids[n++] = i;
                    break;
                }
            }
        }
        EscrowSummary[] memory out = new EscrowSummary[](n);
        for (uint256 k = 0; k < n; k++) {
            out[k] = _summarize(ids[k]);
        }
        return out;
    }

    /// @notice Paginated variant of {getEscrowsForPayer} (M-02). Iterates
    ///         escrow ids in `[offset+1, offset+limit]`, returning summaries
    ///         where `payer` is the depositor. Use to keep the on-chain
    ///         dashboard responsive once `escrowCount` grows large.
    function getEscrowsForPayerPaginated(address payer, uint256 offset, uint256 limit)
        external
        view
        returns (EscrowSummary[] memory)
    {
        return _collectByParticipantPaginated(payer, true, offset, limit);
    }

    /// @notice Paginated variant of {getEscrowsForFreelancer} (M-02).
    function getEscrowsForFreelancerPaginated(address freelancer, uint256 offset, uint256 limit)
        external
        view
        returns (EscrowSummary[] memory)
    {
        return _collectByParticipantPaginated(freelancer, false, offset, limit);
    }

    /// @notice Paginated variant of {getDisputedEscrows} (M-02).
    function getDisputedEscrowsPaginated(uint256 offset, uint256 limit) external view returns (EscrowSummary[] memory) {
        uint256 total = escrowCount;
        uint256 end = offset + limit;
        if (end > total) end = total;

        uint256[] memory ids = new uint256[](limit);
        uint256 n;
        for (uint256 i = offset + 1; i <= end; i++) {
            Escrow storage e = escrows[i];
            for (uint256 j = 0; j < e.milestoneCount; j++) {
                if (milestones[i][j].state == MilestoneState.DISPUTED) {
                    ids[n++] = i;
                    break;
                }
            }
        }
        EscrowSummary[] memory out = new EscrowSummary[](n);
        for (uint256 k = 0; k < n; k++) {
            out[k] = _summarize(ids[k]);
        }
        return out;
    }

    function _collectByParticipantPaginated(address account, bool asPayer, uint256 offset, uint256 limit)
        internal
        view
        returns (EscrowSummary[] memory)
    {
        uint256 total = escrowCount;
        uint256 end = offset + limit;
        if (end > total) end = total;

        uint256[] memory tmp = new uint256[](limit);
        uint256 n;
        for (uint256 i = offset + 1; i <= end; i++) {
            Escrow storage e = escrows[i];
            if (asPayer ? e.depositor == account : e.recipient == account) {
                tmp[n++] = i;
            }
        }
        EscrowSummary[] memory out = new EscrowSummary[](n);
        for (uint256 k = 0; k < n; k++) {
            out[k] = _summarize(tmp[k]);
        }
        return out;
    }

    function _collectByParticipant(address account, bool asPayer) internal view returns (EscrowSummary[] memory) {
        uint256 total = escrowCount;
        uint256[] memory tmp = new uint256[](total);
        uint256 n;
        for (uint256 i = 1; i <= total; i++) {
            Escrow storage e = escrows[i];
            if (asPayer ? e.depositor == account : e.recipient == account) {
                tmp[n++] = i;
            }
        }
        EscrowSummary[] memory out = new EscrowSummary[](n);
        for (uint256 k = 0; k < n; k++) {
            out[k] = _summarize(tmp[k]);
        }
        return out;
    }

    function _summarize(uint256 escrowId) internal view returns (EscrowSummary memory s) {
        Escrow storage e = escrows[escrowId];
        uint256 released;
        uint256 disputed;
        for (uint256 i = 0; i < e.milestoneCount; i++) {
            MilestoneState ms = milestones[escrowId][i].state;
            if (ms == MilestoneState.RELEASED) released++;
            else if (ms == MilestoneState.DISPUTED) disputed++;
        }
        s = EscrowSummary({
            escrowId: escrowId,
            depositor: e.depositor,
            recipient: e.recipient,
            totalAmount: e.totalAmount,
            state: e.state,
            deadline: e.deadline,
            milestoneCount: e.milestoneCount,
            releasedMilestoneCount: released,
            disputedMilestoneCount: disputed,
            invoiceHash: e.invoiceHash,
            invoiceURI: e.invoiceURI
        });
    }

    // =========================================================================
    // Internal: CCTP release with protocol fee + optional splits
    // =========================================================================

    function _executePartialRelease(
        uint256 escrowId,
        uint256 milestoneIndex,
        Escrow storage e,
        Milestone storage m,
        uint256 recipientBps,
        uint256 maxFee
    ) internal {
        uint256 totalAmount = m.amount;
        uint256 recipientAmount = (totalAmount * recipientBps) / BPS_DENOMINATOR;
        uint256 refundAmount = totalAmount - recipientAmount;

        if (recipientBps == 0) {
            m.state = MilestoneState.REFUNDED;
        } else {
            m.state = MilestoneState.RELEASED;
        }

        if (refundAmount > 0) {
            refundBalances[e.refundTo] += refundAmount;
            emit PartialRefundCredited(escrowId, milestoneIndex, e.refundTo, refundAmount);
        }

        if (recipientAmount > 0) {
            _executeCCTPReleaseAmount(escrowId, milestoneIndex, e, recipientAmount, maxFee);
        }

        _checkEscrowCompletion(escrowId);
    }

    /// @dev Each CCTP burn from this contract uses
    ///      {CCTP_MIN_FINALITY_THRESHOLD} = 2000 (Standard Transfer only,
    ///      never Fast Transfer). For cross-chain forwarding, the frontend
    ///      fetches Circle's live fee immediately before release and passes it
    ///      as `cctpMaxFee`; same-chain (Arc) transfers still force maxFee = 0.
    function _executeCCTPReleaseAmount(
        uint256 escrowId,
        uint256 milestoneIndex,
        Escrow storage e,
        uint256 releaseAmount,
        uint256 cctpMaxFee
    ) internal {
        // H-05: read the fee bps + treasury that were locked in at deposit
        // time, not the live admin-mutable globals. This protects depositors
        // from a mid-flight `setProtocolFee` / `setProtocolTreasury` rug.
        uint256 feeBpsSnap = escrowFeeBps[escrowId];
        address treasurySnap = escrowTreasury[escrowId];
        uint256 fee = (releaseAmount * feeBpsSnap) / BPS_DENOMINATOR;
        uint256 remainder = releaseAmount - fee;

        if (fee > 0) {
            // Protocol fee stays on Arc; safeTransfer is fine for the precompile
            // (only forceApprove / safeApprove are blocked).
            usdc.safeTransfer(treasurySnap, fee);
            emit ProtocolFeeCollected(escrowId, milestoneIndex, fee);
        }

        SplitRecipient[] storage s = splits[escrowId];
        if (s.length == 0) {
            // H-04: bound the maxFee at burnAmount-1. CCTP's forwarder
            // reverts when maxFee >= amount, but failing here gives a clear
            // custom error instead of a generic CCTP revert.
            _approveAndBurn(remainder, e.destinationDomain, e.mintRecipient, cctpMaxFee);
        } else {
            uint256 distributed = 0;
            uint256 last = s.length - 1;
            for (uint256 i = 0; i < s.length; i++) {
                uint256 share;
                if (i == last) {
                    // Last recipient absorbs any rounding dust.
                    share = remainder - distributed;
                } else {
                    share = (remainder * s[i].bps) / BPS_DENOMINATOR;
                    distributed += share;
                }
                if (share > 0) {
                    // H-04: scale the caller-supplied global `cctpMaxFee`
                    // by this split's bps so a small share cannot be
                    // drained by a maxFee meant for the whole milestone.
                    uint256 perShareMaxFee = (cctpMaxFee * s[i].bps) / BPS_DENOMINATOR;
                    _approveAndBurn(share, s[i].destinationDomain, s[i].mintRecipient, perShareMaxFee);
                }
            }
        }
    }

    // M-01 / I-01: `_recipientShareAfterCctpFee` was a dead-code helper —
    // both branches returned `burnable`. Removed entirely; call sites now
    // pass the burn share directly into `_approveAndBurn`.

    function _approveAndBurn(uint256 burnAmount, uint32 destinationDomain, bytes32 mintRecipient, uint256 cctpMaxFee)
        internal
    {
        uint256 maxFee;

        if (destinationDomain == ARC_DOMAIN) {
            // Same-chain: no Forwarding Service involvement, Circle handles
            // the mint natively without taking a fee.
            maxFee = 0;
        } else {
            // H-04 / M-03: bound the per-burn maxFee strictly below
            // `burnAmount`. Catches the grief vector where a permissionless
            // caller passes a huge maxFee that the CCTP forwarder could
            // (in theory) consume in full, and the stale-stored-fee case
            // where `cctpForwardFee` drifts above the share size.
            if (cctpMaxFee >= burnAmount) revert MaxFeeExceedsBurnAmount();
            maxFee = cctpMaxFee;
        }

        // SafeERC20.forceApprove is incompatible with the Arc USDC precompile,
        // so we make a raw call but properly decode the ERC-20 return value.
        (bool success, bytes memory data) =
            address(usdc).call(abi.encodeWithSignature("approve(address,uint256)", address(tokenMessenger), burnAmount));
        // L-02: custom error instead of string require.
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert UsdcApproveFailed();

        tokenMessenger.depositForBurnWithHook(
            burnAmount,
            destinationDomain,
            mintRecipient,
            address(usdc),
            bytes32(0),
            maxFee,
            CCTP_MIN_FINALITY_THRESHOLD,
            abi.encodePacked(FORWARD_HOOK_DATA)
        );
    }

    /// @dev True if at least one destination on this escrow lives outside
    ///      ARC_DOMAIN, i.e. the burn would actually invoke Circle's
    ///      Forwarding Service. Used by {releaseAfterWindow} to scope the
    ///      `maxFee` floor to the path that can be griefed.
    function _isTrancheProtocol(uint256 escrowId, Escrow storage e) internal view returns (bool) {
        SplitRecipient[] storage s = splits[escrowId];
        if (s.length == 0) {
            return e.destinationDomain != ARC_DOMAIN;
        }
        for (uint256 i = 0; i < s.length; i++) {
            if (s[i].destinationDomain != ARC_DOMAIN) return true;
        }
        return false;
    }

    function _validateSplits(SplitRecipient[] calldata _splits) internal view {
        uint256 sumBps;
        for (uint256 i = 0; i < _splits.length; i++) {
            SplitRecipient calldata sr = _splits[i];
            if (sr.bps == 0) revert InvalidBps();
            if (sr.mintRecipient == bytes32(0)) revert ZeroAddress();
            if (address(uint160(uint256(sr.mintRecipient))) == address(0)) revert ZeroAddress();
            if (!supportedDomains[sr.destinationDomain]) revert UnsupportedDomain();
            sumBps += sr.bps;
        }
        if (sumBps != BPS_DENOMINATOR) revert BpsSumMismatch();
    }
}
