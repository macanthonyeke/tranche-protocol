// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CrossChainEscrow} from "../src/CrossChainEscrow.sol";
import {ICrossChainEscrow} from "../src/interface/ICrossChainEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockTokenMessenger} from "./mocks/MockTokenMessenger.sol";

abstract contract Base is Test, ICrossChainEscrow {
    CrossChainEscrow internal escrow;
    MockUSDC internal usdc;
    MockTokenMessenger internal tokenMessenger;

    address internal deployer = makeAddr("deployer");
    address internal depositor = makeAddr("depositor");
    address internal recipient = makeAddr("recipient");
    address internal refundTo = makeAddr("refundTo");
    address internal arbiter = makeAddr("arbiter");
    address internal pauser = makeAddr("pauser");
    address internal domainManager = makeAddr("domainManager");
    address internal stranger = makeAddr("stranger");
    address internal protocolTreasury = makeAddr("protocolTreasury");

    uint32 internal constant DEST_DOMAIN = 6;
    bytes32 internal constant MINT_RECIPIENT = bytes32(uint256(uint160(0xBEEF)));
    bytes32 internal constant INVOICE_HASH = keccak256("invoice");
    string internal constant INVOICE_URI = "ipfs://invoice";
    uint256 internal constant DISPUTE_WINDOW = 1 days;
    uint256 internal constant DELIVERY_NOTICE_WINDOW = 3 days;
    uint256 internal constant CCTP_FORWARD_FEE = 100_000; // 0.1 USDC (6 decimals)

    function setUp() public virtual {
        vm.prank(deployer);
        usdc = new MockUSDC();
        tokenMessenger = new MockTokenMessenger();
        vm.prank(deployer);
        escrow = new CrossChainEscrow(
            address(usdc), arbiter, pauser, domainManager, address(tokenMessenger), protocolTreasury
        );

        // Existing tests pre-date the protocol fee, so disable it here. Tests
        // that exercise the fee logic explicitly re-enable it.
        vm.startPrank(deployer);
        escrow.setProtocolFee(0);
        vm.stopPrank();
        vm.prank(domainManager);
        escrow.addSupportedDomain(DEST_DOMAIN);
        vm.prank(deployer);
        // The default DEST_DOMAIN is cross-chain (Base = 6), so cross-chain
        // releases require cctpForwardFee > 0. Tests that exercise same-chain
        // (Arc) explicitly use ARC_DOMAIN.
        escrow.setCctpForwardFee(CCTP_FORWARD_FEE);

        usdc.mint(depositor, 1_000_000e6);
    }

    // ---------- helpers ----------

    function _singleMilestone(uint256 amount) internal pure returns (uint256[] memory arr) {
        arr = new uint256[](1);
        arr[0] = amount;
    }

    function _milestones3() internal pure returns (uint256[] memory arr) {
        arr = new uint256[](3);
        arr[0] = 100e6;
        arr[1] = 200e6;
        arr[2] = 300e6;
    }

    function _depositSingle(uint256 amount) internal returns (uint256 escrowId) {
        return _depositCustom(depositor, recipient, refundTo, amount, _singleMilestone(amount), DISPUTE_WINDOW);
    }

    function _depositMulti() internal returns (uint256 escrowId) {
        uint256[] memory ms = _milestones3();
        return _depositCustom(depositor, recipient, refundTo, 600e6, ms, DISPUTE_WINDOW);
    }

    function _depositCustom(
        address from,
        address _recipient,
        address _refundTo,
        uint256 totalAmount,
        uint256[] memory milestoneAmounts,
        uint256 disputeWindow
    ) internal returns (uint256 escrowId) {
        SplitRecipient[] memory noSplits = new SplitRecipient[](0);
        vm.startPrank(from);
        usdc.approve(address(escrow), totalAmount);
        escrowId = escrow.deposit(
            _recipient,
            _refundTo,
            totalAmount,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            disputeWindow,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            milestoneAmounts,
            block.timestamp + 30 days,
            noSplits
        );
        vm.stopPrank();
    }

    function _fulfill(uint256 escrowId, uint256 idx) internal {
        vm.prank(depositor);
        escrow.fulfillCondition(escrowId, idx);
    }

    function _raiseDisputeAs(address who, uint256 escrowId, uint256 idx) internal {
        vm.prank(who);
        escrow.raiseDispute(escrowId, idx, "reason", keccak256("ev"), "ipfs://ev");
    }

    function _resolveAs(address arb, uint256 escrowId, uint256 idx, bool releaseToRecipient) internal {
        vm.prank(arb);
        escrow.resolveDispute(escrowId, idx, releaseToRecipient, keccak256("res"), 0);
    }

    function _release(uint256 escrowId, uint256 idx) internal {
        // Default helper passes CCTP_FORWARD_FEE so cross-chain escrows
        // (the suite default DEST_DOMAIN) clear the maxFee floor introduced
        // in releaseAfterWindow. Same-chain tests override maxFee internally.
        escrow.releaseAfterWindow(escrowId, idx, CCTP_FORWARD_FEE);
    }

    function _getMilestoneState(uint256 escrowId, uint256 idx) internal view returns (MilestoneState) {
        (,, MilestoneState s,) = escrow.milestones(escrowId, idx);
        return s;
    }

    function _getMilestoneAmount(uint256 escrowId, uint256 idx) internal view returns (uint256) {
        (uint256 amount,,,) = escrow.milestones(escrowId, idx);
        return amount;
    }

    function _getMilestoneTimestamp(uint256 escrowId, uint256 idx) internal view returns (uint256) {
        (, uint256 ts,,) = escrow.milestones(escrowId, idx);
        return ts;
    }

    function _getMilestoneDeliveredAt(uint256 escrowId, uint256 idx) internal view returns (uint256) {
        (,,, uint256 deliveredAt) = escrow.milestones(escrowId, idx);
        return deliveredAt;
    }

    function _getEscrowState(uint256 escrowId) internal view returns (EscrowState) {
        (,,,,,,,,,,,,, EscrowState s,) = escrow.escrows(escrowId);
        return s;
    }

    function _getEscrowDepositor(uint256 escrowId) internal view returns (address d) {
        (d,,,,,,,,,,,,,,) = escrow.escrows(escrowId);
    }

    function _getEscrowMilestoneCount(uint256 escrowId) internal view returns (uint256 c) {
        (,,,,,,,,,,,, c,,) = escrow.escrows(escrowId);
    }

    function _getEscrowTotalAmount(uint256 escrowId) internal view returns (uint256 t) {
        (,,, t,,,,,,,,,,,) = escrow.escrows(escrowId);
    }
}
