// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice Deposit validation, review-window bounds, redirect, parameterised
///         withdrawRefund, role gating, and CCTP finality — updated for the
///         redesigned lifecycle.
contract TrancheProtocolUpgradesTest is Base {
    // -------------------------------------------------------------------------
    // Mandatory deadline
    // -------------------------------------------------------------------------

    function _depositBadDeadline(uint256 deadline, bytes4 err) internal {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(err);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            deadline,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_DeadlineZero() public {
        _depositBadDeadline(0, DeadlineRequired.selector);
    }

    function test_Deposit_RevertOn_DeadlineTooSoon() public {
        vm.warp(1_700_000_000);
        _depositBadDeadline(block.timestamp + 30 minutes, DeadlineTooSoon.selector);
    }

    function test_Deposit_RevertOn_DeadlineTooFar() public {
        vm.warp(1_700_000_000);
        _depositBadDeadline(block.timestamp + 3650 days, DeadlineTooFar.selector);
    }

    // -------------------------------------------------------------------------
    // Review-window bounds [1 day, 7 days]
    // -------------------------------------------------------------------------

    function _depositBadWindow(uint256 window, bytes4 err) internal {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(err);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            window,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 30 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_ReviewWindowTooShort() public {
        _depositBadWindow(1 days - 1, ReviewWindowTooShort.selector);
    }

    function test_Deposit_RevertOn_ReviewWindowTooLong() public {
        _depositBadWindow(7 days + 1, ReviewWindowTooLong.selector);
    }

    // -------------------------------------------------------------------------
    // Mint recipient + destination domain validation
    // -------------------------------------------------------------------------

    function _depositBadMint(bytes32 mint, uint32 domain, bytes4 err) internal {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(err);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            domain,
            mint,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 30 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_ZeroMintRecipient() public {
        _depositBadMint(bytes32(0), DEST_DOMAIN, ZeroAddress.selector);
    }

    function test_Deposit_RevertOn_UnsupportedDestinationDomain() public {
        _depositBadMint(MINT_RECIPIENT, 42, UnsupportedDomain.selector);
    }

    function test_Deposit_RevertOn_MintRecipientWithZeroAddressInLow160() public {
        bytes32 weird = bytes32(uint256(1) << 200);
        assertTrue(weird != bytes32(0));
        assertEq(address(uint160(uint256(weird))), address(0));
        _depositBadMint(weird, DEST_DOMAIN, ZeroAddress.selector);
    }

    // -------------------------------------------------------------------------
    // refundTo defaults to depositor when zero
    // -------------------------------------------------------------------------

    function test_Deposit_RefundTo_DefaultsToDepositor() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        uint256 id = escrow.deposit(
            recipient,
            address(0),
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 1 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
        assertEq(escrow.getEscrow(id).refundTo, depositor);
    }

    // -------------------------------------------------------------------------
    // updateReceivingAddress
    // -------------------------------------------------------------------------

    function test_UpdateReceivingAddress_RecipientCanUpdate_WhileActive() public {
        uint256 id = _depositSingle(100e6);
        bytes32 newDest = bytes32(uint256(uint160(0xC0FFEE)));

        vm.expectEmit(true, false, false, true, address(escrow));
        emit ReceivingAddressUpdated(id, MINT_RECIPIENT, newDest, DEST_DOMAIN, DEST_DOMAIN);

        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newDest, DEST_DOMAIN);

        assertEq(escrow.getEscrow(id).mintRecipient, newDest);
        assertEq(uint256(escrow.getEscrow(id).destinationDomain), uint256(DEST_DOMAIN));
    }

    function test_UpdateReceivingAddress_RevertOn_DepositorCaller() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(depositor);
        vm.expectRevert(NotRecipient.selector);
        escrow.updateReceivingAddress(id, bytes32(uint256(uint160(0xC0FFEE))), DEST_DOMAIN);
    }

    function test_UpdateReceivingAddress_RevertOn_StrangerCaller() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(stranger);
        vm.expectRevert(NotRecipient.selector);
        escrow.updateReceivingAddress(id, bytes32(uint256(uint160(0xC0FFEE))), DEST_DOMAIN);
    }

    function test_UpdateReceivingAddress_RevertOn_NotActive_Completed() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        _release(id, 0);
        vm.prank(recipient);
        vm.expectRevert(InvalidState.selector);
        escrow.updateReceivingAddress(id, bytes32(uint256(uint160(0xC0FFEE))), DEST_DOMAIN);
    }

    function test_UpdateReceivingAddress_RevertOn_ZeroBytes32() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(recipient);
        vm.expectRevert(ZeroAddress.selector);
        escrow.updateReceivingAddress(id, bytes32(0), DEST_DOMAIN);
    }

    function test_UpdateReceivingAddress_RevertOn_ZeroAddressIn_NonZeroBytes32() public {
        uint256 id = _depositSingle(100e6);
        bytes32 weird = bytes32(uint256(1) << 200);
        vm.prank(recipient);
        vm.expectRevert(ZeroAddress.selector);
        escrow.updateReceivingAddress(id, weird, DEST_DOMAIN);
    }

    function test_UpdateReceivingAddress_RevertOn_UnsupportedDomain() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(recipient);
        vm.expectRevert(UnsupportedDomain.selector);
        escrow.updateReceivingAddress(id, bytes32(uint256(uint160(0xC0FFEE))), 42);
    }

    function test_UpdateReceivingAddress_AppliesToFutureRelease() public {
        uint256 id = _depositMulti();
        bytes32 newDest = bytes32(uint256(uint160(0xC0FFEE)));
        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newDest, DEST_DOMAIN);

        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        _release(id, 0);

        (,,, bytes32 mr,,,,,,) = _readBurnCall();
        assertEq(mr, newDest, "release should burn to the updated mintRecipient");
    }

    // -------------------------------------------------------------------------
    // withdrawRefund(address)
    // -------------------------------------------------------------------------

    function test_WithdrawRefund_FundsGoToSpecifiedRecipient() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        _resolveAs(arbiter, id, 0, false);

        address altRecipient = makeAddr("altRecipient");

        vm.expectEmit(true, false, false, true, address(escrow));
        emit RefundWithdrawn(altRecipient, 100e6);

        vm.prank(refundTo);
        escrow.withdrawRefund(altRecipient, 0, address(0), 0);

        assertEq(usdc.balanceOf(altRecipient), 100e6);
        assertEq(usdc.balanceOf(refundTo), 0);
        assertEq(escrow.refundBalances(refundTo), 0);
    }

    function test_WithdrawRefund_RevertOn_ZeroRecipient() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        _resolveAs(arbiter, id, 0, false);

        vm.prank(refundTo);
        vm.expectRevert(InvalidRefundRecipient.selector);
        escrow.withdrawRefund(address(0), 0, address(0), 0);
    }

    // -------------------------------------------------------------------------
    // DOMAIN_MANAGER_ROLE gating
    // -------------------------------------------------------------------------

    function test_DomainManagerRole_CanAddAndRemoveDomain() public {
        bytes32 role = escrow.DOMAIN_MANAGER_ROLE();
        assertFalse(escrow.hasRole(role, deployer));
        assertTrue(escrow.hasRole(role, domainManager));

        address dm = makeAddr("dm");
        vm.prank(deployer);
        escrow.grantRole(role, dm);

        vm.prank(dm);
        escrow.addSupportedDomain(99);
        assertTrue(escrow.supportedDomains(99));

        vm.prank(dm);
        escrow.removeSupportedDomain(99);
        assertFalse(escrow.supportedDomains(99));
    }

    function test_DomainManagerRole_StrangerCannotAddOrRemove() public {
        bytes memory expected = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, escrow.DOMAIN_MANAGER_ROLE()
        );

        vm.prank(stranger);
        vm.expectRevert(expected);
        escrow.addSupportedDomain(99);

        vm.prank(stranger);
        vm.expectRevert(expected);
        escrow.removeSupportedDomain(DEST_DOMAIN);
    }

    // -------------------------------------------------------------------------
    // AccessControl admin operations
    // -------------------------------------------------------------------------

    function test_DefaultAdmin_CanGrantAndRevokeArbiterRole() public {
        bytes32 role = escrow.ARBITER_ROLE();
        address newArbiter = makeAddr("newArbiter");

        vm.prank(deployer);
        escrow.grantRole(role, newArbiter);
        assertTrue(escrow.hasRole(role, newArbiter));

        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        vm.prank(newArbiter);
        // L-R3-03: cross-chain recipient award must clear the fee floor.
        escrow.resolveDispute(id, 0, 10_000, keccak256("res"), "ipfs://res", CCTP_FORWARD_FEE);

        vm.prank(deployer);
        escrow.revokeRole(role, newArbiter);
        assertFalse(escrow.hasRole(role, newArbiter));
    }

    function test_Constructor_AssignsConfiguredRoles() public view {
        assertTrue(escrow.hasRole(escrow.ARBITER_ROLE(), arbiter));
        assertTrue(escrow.hasRole(escrow.PAUSER_ROLE(), pauser));
        assertTrue(escrow.hasRole(escrow.DEFAULT_ADMIN_ROLE(), deployer));
        assertTrue(escrow.hasRole(escrow.DOMAIN_MANAGER_ROLE(), domainManager));
    }

    // -------------------------------------------------------------------------
    // Mutual cancel flags are irreversible once set
    // -------------------------------------------------------------------------

    function test_MutualCancelFlags_AreIrreversibleOnceSet() public {
        uint256 id = _depositMulti();

        vm.prank(depositor);
        escrow.mutualCancel(id);

        assertTrue(escrow.getEscrow(id).depositorApproveCancel);
        assertFalse(escrow.getEscrow(id).recipientApproveCancel);

        vm.prank(depositor);
        escrow.mutualCancel(id);
        assertTrue(escrow.getEscrow(id).depositorApproveCancel);
        assertFalse(escrow.getEscrow(id).recipientApproveCancel);

        vm.prank(recipient);
        escrow.mutualCancel(id);
        assertTrue(escrow.getEscrow(id).depositorApproveCancel);
        assertTrue(escrow.getEscrow(id).recipientApproveCancel);
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.CANCELLED));
    }

    // -------------------------------------------------------------------------
    // CCTP finality + dispute timestamp
    // -------------------------------------------------------------------------

    function test_CCTP_StandardFinality_AndCrossChainUsesForwardFee() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        // M-R3-01: release() ignores the caller value and burns with the
        // per-escrow snapshotted forwarding fee.
        escrow.release(id, 0, CCTP_FORWARD_FEE + 12345);

        (,,,,,, uint256 maxFee, uint32 minFinality,,) = _readBurnCall();
        assertEq(maxFee, CCTP_FORWARD_FEE, "cross-chain release() uses the snapshotted forward fee");
        assertEq(uint256(minFinality), 2000, "minFinalityThreshold must be 2000 (Standard Transfer)");
        assertEq(uint256(minFinality), 2000, "constant must be 2000 (Standard Transfer)");
    }

    function test_RaiseDispute_StoresRaisedAtTimestamp() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + 7 hours); // within the review window
        _raiseDispute(id, 0);
        (, uint256 raisedAt,,,,,,,,) = escrow.disputes(id, 0);
        assertEq(raisedAt, block.timestamp);
    }

    // ---------- helpers ----------
    function _readBurnCall()
        internal
        view
        returns (
            address caller,
            uint256 amount,
            uint32 destinationDomain,
            bytes32 mintRecipient_,
            address burnToken,
            bytes32 destinationCaller,
            uint256 maxFee,
            uint32 minFinalityThreshold,
            bool withHook,
            bytes memory hookData
        )
    {
        (
            caller,
            amount,
            destinationDomain,
            mintRecipient_,
            burnToken,
            destinationCaller,
            maxFee,
            minFinalityThreshold,
            withHook,
            hookData
        ) = tokenMessenger.calls(tokenMessenger.callsLength() - 1);
    }
}
