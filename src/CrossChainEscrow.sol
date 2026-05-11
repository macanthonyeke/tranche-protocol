// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ITokenMessenger} from "./interface/ITokenMessenger.sol";
import {ICrossChainEscrow} from "./interface/ICrossChainEscrow.sol";

contract CrossChainEscrow is ICrossChainEscrow, AccessControlEnumerable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant DOMAIN_MANAGER_ROLE = keccak256("DOMAIN_MANAGER_ROLE");

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
    bytes32 public constant FORWARD_HOOK_DATA =
        0x636374702d666f72776172640000000000000000000000000000000000000000;

    /// @dev CCTP V2 finality threshold. We hardcode 2000 = Standard Transfer
    ///      (finalized). 1000 = Fast Transfer is explicitly disallowed
    ///      because it carries different reorg and fee semantics.
    uint32 public constant CCTP_MIN_FINALITY_THRESHOLD = 2000;

    /// @notice Arc CCTP domain id. When destinationDomain == ARC_DOMAIN we are
    ///         doing a same-chain transfer and Circle does not charge the
    ///         forwarding fee, so we override maxFee = 0 regardless of the
    ///         configured `cctpForwardFee`.
    uint32 public constant ARC_DOMAIN = 26;

    IERC20 public usdc;
    ITokenMessenger public tokenMessenger;

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

    constructor(
        address _usdc,
        address _arbiter,
        address _pauser,
        address _domainManager,
        address _tokenMessenger,
        address _protocolTreasury
    ) {
        if (_usdc == address(0)) revert ZeroAddress();
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

    function setProtocolFee(uint256 _newFeeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newFeeBps > MAX_PROTOCOL_FEE) revert FeeTooHigh();
        emit ProtocolFeeUpdated(protocolFeeBps, _newFeeBps);
        protocolFeeBps = _newFeeBps;
    }

    function setProtocolTreasury(address _newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newTreasury == address(0)) revert ZeroAddress();
        emit ProtocolTreasuryUpdated(protocolTreasury, _newTreasury);
        protocolTreasury = _newTreasury;
    }

    /// @notice Update the maxFee used for cross-chain CCTP forwarding. Admin
    ///         tracks Circle's published gas-based fee and bumps this value
    ///         to keep auto-delivery working without under-fee reverts.
    function setCctpForwardFee(uint256 fee) external onlyRole(DEFAULT_ADMIN_ROLE) {
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
                amount: _milestoneAmounts[i],
                conditionMetTimestamp: 0,
                state: MilestoneState.PENDING,
                deliveredAt: 0
            });
        }

        if (_splits.length > 0) {
            for (uint256 i = 0; i < _splits.length; i++) {
                splits[escrowId].push(_splits[i]);
            }
            emit SplitsConfigured(escrowId, _splits.length);
        }

        emit EscrowCreated(escrowId, msg.sender, _recipient, _totalAmount, _invoiceHash, _invoiceURI, _deadline);
    }

    function fulfillCondition(uint256 escrowId, uint256 milestoneIndex) external {
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

        emit ConditionFulfilled(escrowId, milestoneIndex, block.timestamp + e.disputeWindow);
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

        if (block.timestamp > m.conditionMetTimestamp + e.disputeWindow) revert DisputeWindowExpired();

        disputes[escrowId][milestoneIndex] = DisputeData({
            disputedBy: msg.sender,
            evidenceHash: _evidenceHash,
            evidenceURI: _evidenceURI,
            reason: _reason,
            counterEvidenceHash: bytes32(0),
            counterEvidenceURI: "",
            resolutionHash: bytes32(0),
            raisedAt: block.timestamp
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

        if (d.disputedBy == msg.sender) revert CannotRespondToOwnDispute();
        if (msg.sender != e.depositor && msg.sender != e.recipient) revert NotEscrowOwnerOrRecipient();
        if (_counterEvidenceHash == bytes32(0)) revert NoEvidence();
        if (bytes(_counterEvidenceURI).length == 0) revert NoEvidenceURI();
        if (d.counterEvidenceHash != bytes32(0)) revert CounterEvidenceAlreadySubmitted();

        d.counterEvidenceHash = _counterEvidenceHash;
        d.counterEvidenceURI = _counterEvidenceURI;

        emit CounterEvidenceSubmitted(escrowId, msg.sender, milestoneIndex, _counterEvidenceHash);
    }

    function resolveDispute(
        uint256 escrowId,
        uint256 milestoneIndex,
        bool releaseToRecipient,
        bytes32 _resolutionHash,
        uint256 maxFee
    ) external onlyRole(ARBITER_ROLE) {
        Escrow storage e = escrows[escrowId];
        DisputeData storage d = disputes[escrowId][milestoneIndex];
        Milestone storage m = milestones[escrowId][milestoneIndex];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (m.state != MilestoneState.DISPUTED) revert NoDispute();
        if (_resolutionHash == bytes32(0)) revert NoResolution();

        d.resolutionHash = _resolutionHash;

        uint256 amount = m.amount;

        if (releaseToRecipient) {
            m.state = MilestoneState.RELEASED;

            _executeCCTPRelease(escrowId, milestoneIndex, e, m, maxFee);

            emit EscrowReleased(escrowId, milestoneIndex, _resolutionHash);
        } else {
            m.state = MilestoneState.REFUNDED;
            refundBalances[e.refundTo] += amount;

            emit EscrowRefunded(escrowId, milestoneIndex, _resolutionHash);
        }

        _checkEscrowCompletion(escrowId);
    }

    function releaseAfterWindow(uint256 escrowId, uint256 milestoneIndex, uint256 maxFee) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        Milestone storage m = milestones[escrowId][milestoneIndex];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (m.state != MilestoneState.FULFILLED) revert InvalidState();

        if (block.timestamp < m.conditionMetTimestamp + e.disputeWindow) revert DisputeWindowNotExpired();

        m.state = MilestoneState.RELEASED;

        _executeCCTPRelease(escrowId, milestoneIndex, e, m, maxFee);

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
            disputedBy: msg.sender,
            evidenceHash: _evidenceHash,
            evidenceURI: _evidenceURI,
            reason: _reason,
            counterEvidenceHash: bytes32(0),
            counterEvidenceURI: "",
            resolutionHash: bytes32(0),
            raisedAt: block.timestamp
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

    /// @notice Allow the recipient of an active escrow to redirect future
    ///         milestone settlements to a different mint recipient and/or
    ///         destination domain. This protects against scenarios where the
    ///         original mint address becomes unusable (e.g. a Circle freeze)
    ///         or the recipient simply wants their payment on another chain.
    /// @dev    Only the escrow's recipient can call. The escrow must be
    ///         ACTIVE (no per-milestone gating: pending milestones haven't
    ///         settled yet, and any already-RELEASED ones are in CCTP-land).
    function updateMintRecipient(uint256 escrowId, bytes32 newMintRecipient, uint32 newDestinationDomain) external {
        Escrow storage e = escrows[escrowId];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (e.state != EscrowState.ACTIVE) revert InvalidState();
        if (msg.sender != e.recipient) revert NotRecipient();
        if (newMintRecipient == bytes32(0)) revert ZeroAddress();
        if (address(uint160(uint256(newMintRecipient))) == address(0)) revert ZeroAddress();
        if (!supportedDomains[newDestinationDomain]) revert UnsupportedDomain();

        e.mintRecipient = newMintRecipient;
        e.destinationDomain = newDestinationDomain;

        emit MintRecipientUpdated(escrowId, newMintRecipient, newDestinationDomain, msg.sender);
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

        _executeCCTPRelease(escrowId, milestoneIndex, e, m, 0);

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

    // =========================================================================
    // Internal: CCTP release with protocol fee + optional splits
    // =========================================================================

    /// @dev Each CCTP burn from this contract uses
    ///      {CCTP_MIN_FINALITY_THRESHOLD} = 2000 (Standard Transfer only,
    ///      never Fast Transfer). For cross-chain forwarding, the frontend
    ///      fetches Circle's live fee immediately before release and passes it
    ///      as `cctpMaxFee`; same-chain (Arc) transfers still force maxFee = 0.
    function _executeCCTPRelease(
        uint256 escrowId,
        uint256 milestoneIndex,
        Escrow storage e,
        Milestone storage m,
        uint256 cctpMaxFee
    ) internal {
        uint256 amount = m.amount;
        uint256 fee = (amount * protocolFeeBps) / BPS_DENOMINATOR;
        uint256 remainder = amount - fee;

        if (fee > 0) {
            // Protocol fee stays on Arc; safeTransfer is fine for the precompile
            // (only forceApprove / safeApprove are blocked).
            usdc.safeTransfer(protocolTreasury, fee);
            emit ProtocolFeeCollected(escrowId, milestoneIndex, fee);
        }

        SplitRecipient[] storage s = splits[escrowId];
        if (s.length == 0) {
            uint256 recipientAmount = _recipientShareAfterCctpFee(remainder, e.destinationDomain);
            _approveAndBurn(recipientAmount, e.destinationDomain, e.mintRecipient, cctpMaxFee);
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
                    uint256 recipientAmount = _recipientShareAfterCctpFee(share, s[i].destinationDomain);
                    _approveAndBurn(recipientAmount, s[i].destinationDomain, s[i].mintRecipient, cctpMaxFee);
                }
            }
        }
    }

    /// @dev UI/display helper for the recipient's burnable share. The
    ///      frontend now subtracts Circle's live forwarding fee off-chain when
    ///      previewing net receipt, then passes that live fee as `cctpMaxFee`
    ///      for the burn. On-chain, we keep the original burnable amount here.
    function _recipientShareAfterCctpFee(uint256 burnable, uint32 destinationDomain) internal view returns (uint256) {
        if (destinationDomain == ARC_DOMAIN) {
            return burnable;
        }
        return burnable;
    }

    function _approveAndBurn(
        uint256 recipientAmount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        uint256 cctpMaxFee
    ) internal {
        uint256 burnAmount;
        uint256 maxFee;

        if (destinationDomain == ARC_DOMAIN) {
            // Same-chain: no Forwarding Service involvement, Circle handles
            // the mint natively without taking a fee.
            burnAmount = recipientAmount;
            maxFee = 0;
        } else {
            // Cross-chain: the frontend already accounted for the forwarding
            // fee in the recipient preview and passes Circle's live maxFee
            // from the sandbox API immediately before submitting the tx.
            burnAmount = recipientAmount;
            maxFee = cctpMaxFee;
        }

        // SafeERC20.forceApprove is incompatible with the Arc USDC precompile,
        // so we make a raw call but properly decode the ERC-20 return value.
        (bool success, bytes memory data) = address(usdc).call(
            abi.encodeWithSignature("approve(address,uint256)", address(tokenMessenger), burnAmount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "USDC approve failed");

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

    function _validateSplits(SplitRecipient[] calldata _splits) internal view {
        uint256 sumBps;
        for (uint256 i = 0; i < _splits.length; i++) {
            SplitRecipient calldata sr = _splits[i];
            if (sr.bps == 0) revert InvalidBps();
            if (sr.mintRecipient == bytes32(0)) revert ZeroAddress();
            if (!supportedDomains[sr.destinationDomain]) revert UnsupportedDomain();
            sumBps += sr.bps;
        }
        if (sumBps != BPS_DENOMINATOR) revert BpsSumMismatch();
    }
}
