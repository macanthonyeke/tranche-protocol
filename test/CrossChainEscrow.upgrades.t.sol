// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";
import {CrossChainEscrow} from "../src/CrossChainEscrow.sol";
import {ICrossChainEscrow} from "../src/interface/ICrossChainEscrow.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice Tests for the upgrades introduced in this contract revision:
///         mandatory deadline, dispute-window cap, blacklist-recovery via
///         updateReceivingAddress + parameterised withdrawRefund, refundTo
///         default, deposit input validation, DOMAIN_MANAGER_ROLE, and the
///         AccessControlEnumerable role helpers.
contract CrossChainEscrowUpgradesTest is Base {
    function _baseDeposit(uint256 _disputeWindow, uint256 _deadline) internal returns (uint256) {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        uint256 id = escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            _disputeWindow,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            _deadline,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
        return id;
    }

    // -------------------------------------------------------------------------
    // 1-3. Mandatory deadline
    // -------------------------------------------------------------------------

    function test_Deposit_RevertOn_DeadlineZero() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(DeadlineRequired.selector);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            0,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_DeadlineTooSoon() public {
        vm.warp(1_700_000_000);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(DeadlineTooSoon.selector);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 30 minutes,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_DeadlineTooFar() public {
        vm.warp(1_700_000_000);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(DeadlineTooFar.selector);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 3650 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    // -------------------------------------------------------------------------
    // 4-5. Dispute-window bounds
    // -------------------------------------------------------------------------

    function test_Deposit_RevertOn_DisputeWindowTooShort() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(DisputeWindowTooShort.selector);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            1 hours - 1,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 1 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_DisputeWindowTooLong() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(DisputeWindowTooLong.selector);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            30 days + 1,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 60 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    // -------------------------------------------------------------------------
    // 6-7. Mint recipient + destination domain validation
    // -------------------------------------------------------------------------

    function test_Deposit_RevertOn_ZeroMintRecipient() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(ZeroAddress.selector);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            bytes32(0),
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 1 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_UnsupportedDestinationDomain() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(UnsupportedDomain.selector);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            42, // not registered
            MINT_RECIPIENT,
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 1 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_MintRecipientWithZeroAddressInLow160() public {
        // bytes32 not zero, but the low-order 20 bytes (address portion) is zero.
        bytes32 weird = bytes32(uint256(1) << 200);
        assertTrue(weird != bytes32(0));
        assertEq(address(uint160(uint256(weird))), address(0));

        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(ZeroAddress.selector);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            weird,
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 1 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    // -------------------------------------------------------------------------
    // 8. refundTo defaults to depositor when zero
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
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 1 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
        (,, address rt,,,,,,,,,,,,) = escrow.escrows(id);
        assertEq(rt, depositor);
    }

    // -------------------------------------------------------------------------
    // 9-13. updateReceivingAddress
    // -------------------------------------------------------------------------

    function test_UpdateReceivingAddress_RecipientCanUpdate_WhileActive() public {
        uint256 id = _depositSingle(100e6);
        bytes32 newDest = bytes32(uint256(uint160(0xC0FFEE)));

        // L-03: event now carries (oldAddress, newAddress, oldDomain, newDomain).
        vm.expectEmit(true, false, false, true, address(escrow));
        emit ReceivingAddressUpdated(id, MINT_RECIPIENT, newDest, DEST_DOMAIN, DEST_DOMAIN);

        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newDest, DEST_DOMAIN);

        (,,,, uint32 destDomain, bytes32 mr,,,,,,,,,) = escrow.escrows(id);
        assertEq(mr, newDest);
        assertEq(uint256(destDomain), uint256(DEST_DOMAIN));
    }

    function test_UpdateReceivingAddress_RevertOn_DepositorCaller() public {
        uint256 id = _depositSingle(100e6);
        bytes32 newDest = bytes32(uint256(uint160(0xC0FFEE)));
        vm.prank(depositor);
        vm.expectRevert(NotRecipient.selector);
        escrow.updateReceivingAddress(id, newDest, DEST_DOMAIN);
    }

    function test_UpdateReceivingAddress_RevertOn_StrangerCaller() public {
        uint256 id = _depositSingle(100e6);
        bytes32 newDest = bytes32(uint256(uint160(0xC0FFEE)));
        vm.prank(stranger);
        vm.expectRevert(NotRecipient.selector);
        escrow.updateReceivingAddress(id, newDest, DEST_DOMAIN);
    }

    function test_UpdateReceivingAddress_RevertOn_NotActive_Completed() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        _release(id, 0);
        // escrow is now COMPLETED
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

        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        _release(id, 0);

        (,,, bytes32 mr,,,,,,) = _readBurnCall();
        assertEq(mr, newDest, "release should burn to the updated mintRecipient");
    }

    // -------------------------------------------------------------------------
    // 14-15. withdrawRefund(address)
    // -------------------------------------------------------------------------

    function test_WithdrawRefund_FundsGoToSpecifiedRecipient() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        _resolveAs(arbiter, id, 0, false);

        address altRecipient = makeAddr("altRecipient");

        vm.expectEmit(true, false, false, true, address(escrow));
        emit RefundWithdrawn(altRecipient, 100e6);

        vm.prank(refundTo);
        escrow.withdrawRefund(altRecipient);

        assertEq(usdc.balanceOf(altRecipient), 100e6);
        assertEq(usdc.balanceOf(refundTo), 0);
        assertEq(escrow.refundBalances(refundTo), 0);
    }

    function test_WithdrawRefund_RevertOn_ZeroRecipient() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        _resolveAs(arbiter, id, 0, false);

        vm.prank(refundTo);
        vm.expectRevert(InvalidRefundRecipient.selector);
        escrow.withdrawRefund(address(0));
    }

    // -------------------------------------------------------------------------
    // 16-17. DOMAIN_MANAGER_ROLE gating
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
    // 18-19. AccessControl admin operations + enumeration
    // -------------------------------------------------------------------------

    function test_DefaultAdmin_CanGrantAndRevokeArbiterRole() public {
        bytes32 role = escrow.ARBITER_ROLE();
        address newArbiter = makeAddr("newArbiter");

        vm.prank(deployer);
        escrow.grantRole(role, newArbiter);
        assertTrue(escrow.hasRole(role, newArbiter));

        // The new arbiter can resolve a real dispute.
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        vm.prank(newArbiter);
        escrow.resolveDispute(id, 0, true, keccak256("res"), 0);

        vm.prank(deployer);
        escrow.revokeRole(role, newArbiter);
        assertFalse(escrow.hasRole(role, newArbiter));
    }

    function test_RoleEnumeration_CountsAndIndexLookup() public {
        bytes32 arbiterRole = escrow.ARBITER_ROLE();
        bytes32 pauserRole = escrow.PAUSER_ROLE();
        bytes32 adminRole = escrow.DEFAULT_ADMIN_ROLE();
        bytes32 dmRole = escrow.DOMAIN_MANAGER_ROLE();

        // After construction: each role has exactly one member.
        assertEq(escrow.getRoleMemberCount(arbiterRole), 1);
        assertEq(escrow.getRoleMember(arbiterRole, 0), arbiter);

        assertEq(escrow.getRoleMemberCount(pauserRole), 1);
        assertEq(escrow.getRoleMember(pauserRole, 0), pauser);

        assertEq(escrow.getRoleMemberCount(adminRole), 1);
        assertEq(escrow.getRoleMember(adminRole, 0), deployer);
        assertEq(escrow.getRoleMemberCount(dmRole), 1);
        assertEq(escrow.getRoleMember(dmRole, 0), domainManager);

        // Granting bumps the count and appends the new member.
        address extra = makeAddr("extraArbiter");
        vm.prank(deployer);
        escrow.grantRole(arbiterRole, extra);
        assertEq(escrow.getRoleMemberCount(arbiterRole), 2);
        address slot0 = escrow.getRoleMember(arbiterRole, 0);
        address slot1 = escrow.getRoleMember(arbiterRole, 1);
        assertTrue(slot0 == extra || slot1 == extra, "extra arbiter not enumerable");

        // Revoking shrinks the set.
        vm.prank(deployer);
        escrow.revokeRole(arbiterRole, extra);
        assertEq(escrow.getRoleMemberCount(arbiterRole), 1);
    }

    // -------------------------------------------------------------------------
    // 20. Mutual cancel flags are irreversible once set
    // -------------------------------------------------------------------------

    function test_MutualCancelFlags_AreIrreversibleOnceSet() public {
        uint256 id = _depositMulti();

        vm.prank(depositor);
        escrow.mutualCancel(id);

        assertTrue(_getDepositorApproveCancel(id));
        assertFalse(_getRecipientApproveCancel(id));

        // Depositor calling mutualCancel again is a no-op; flag stays true.
        vm.prank(depositor);
        escrow.mutualCancel(id);
        assertTrue(_getDepositorApproveCancel(id));
        assertFalse(_getRecipientApproveCancel(id));

        // Recipient also approves -> escrow cancels. Both flags stay true.
        vm.prank(recipient);
        escrow.mutualCancel(id);
        assertTrue(_getDepositorApproveCancel(id));
        assertTrue(_getRecipientApproveCancel(id));
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.CANCELLED));
    }

    function _getDepositorApproveCancel(uint256 id) internal view returns (bool b) {
        (,,,,,,, b,,,,,,,) = escrow.escrows(id);
    }

    function _getRecipientApproveCancel(uint256 id) internal view returns (bool b) {
        (,,,,,,,, b,,,,,,) = escrow.escrows(id);
    }

    // -------------------------------------------------------------------------
    // Bonus regressions for A8/A10
    // -------------------------------------------------------------------------

    function test_CCTP_StandardFinality_AndCrossChainUsesForwardFee() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        // Pass a non-zero live forwarding fee; the public API forwards it
        // directly to CCTP.
        escrow.releaseAfterWindow(id, 0, 12345);

        (,,,,,, uint256 maxFee, uint32 minFinality,,) = _readBurnCall();
        assertEq(maxFee, 12345, "cross-chain maxFee must equal the caller-supplied fee");
        assertEq(uint256(minFinality), 2000, "minFinalityThreshold must be 2000 (Standard Transfer)");
        assertEq(uint256(escrow.CCTP_MIN_FINALITY_THRESHOLD()), 2000);
    }

    function test_RaiseDispute_StoresRaisedAtTimestamp() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + 7 hours);
        _raiseDisputeAs(depositor, id, 0);
        (,,,,,,, uint256 raisedAt) = escrow.disputes(id, 0);
        assertEq(raisedAt, block.timestamp);
    }

    function test_EscalateAfterDeadline_StoresRaisedAtTimestamp() public {
        uint256 id = _depositSingle(100e6);
        // deadline passes
        vm.warp(block.timestamp + 31 days);
        vm.prank(recipient);
        escrow.escalateAfterDeadline(id, 0, "missed", keccak256("ev"), "ipfs://ev");
        (,,,,,,, uint256 raisedAt) = escrow.disputes(id, 0);
        assertEq(raisedAt, block.timestamp);
    }

    // ---------- helpers ----------
    /// @dev Returns the most recent CCTP burn call recorded by
    ///      MockTokenMessenger, in the storage order it uses:
    ///      (caller, amount, destinationDomain, mintRecipient, burnToken,
    ///       destinationCaller, maxFee, minFinalityThreshold, withHook, hookData).
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
