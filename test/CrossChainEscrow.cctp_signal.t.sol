// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";
import {ICrossChainEscrow} from "../src/interface/ICrossChainEscrow.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice Tests for: dynamic CCTP forwarding fee, FORWARD_HOOK_DATA constant,
///         signalDelivery / claimSilentApproval, deliveryNoticeWindow
///         validation, and the tightened (14-day) disputeWindow upper bound.
contract CrossChainEscrowCctpSignalTest is Base {
    bytes32 internal constant CIRCLE_HOOK = 0x636374702d666f72776172640000000000000000000000000000000000000000;

    // -------------------------------------------------------------------------
    // FORWARD_HOOK_DATA
    // -------------------------------------------------------------------------

    function test_ForwardHookData_MatchesCircleSpec() public view {
        // Exact bytes documented at
        // https://developers.circle.com/cctp/howtos/transfer-usdc-with-forwarding-service
        // ASCII "cctp-forward" (12 bytes) + 0x00 version + 0x00 length + 18 zero pad bytes.
        assertEq(escrow.FORWARD_HOOK_DATA(), CIRCLE_HOOK);
    }

    // -------------------------------------------------------------------------
    // setCctpForwardFee
    // -------------------------------------------------------------------------

    function test_SetCctpForwardFee_AdminCanUpdate_AndEmits() public {
        vm.expectEmit(false, false, false, true, address(escrow));
        emit CctpForwardFeeUpdated(2_500_000);

        vm.prank(deployer);
        escrow.setCctpForwardFee(2_500_000);
        assertEq(escrow.cctpForwardFee(), 2_500_000);
    }

    function test_SetCctpForwardFee_RevertOn_NonAdmin() public {
        bytes memory expected = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, escrow.DEFAULT_ADMIN_ROLE()
        );
        vm.prank(stranger);
        vm.expectRevert(expected);
        escrow.setCctpForwardFee(1);
    }

    // -------------------------------------------------------------------------
    // CCTP burn parameters: same-chain vs cross-chain
    // -------------------------------------------------------------------------

    function test_CCTP_SameChainRelease_UsesZeroMaxFee() public {
        uint32 arcDomain = escrow.ARC_DOMAIN();
        bytes32 arcRecipient = bytes32(uint256(uint160(0xA1C0))); // arbitrary address on Arc

        // Register Arc as a supported domain and route a release there.
        vm.prank(domainManager);
        escrow.addSupportedDomain(arcDomain);

        uint256 id = _depositToDomain(100e6, arcDomain, arcRecipient);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        escrow.releaseAfterWindow(id, 0, 0);

        (,,,,,, uint256 maxFee,,,) = _readBurnCall();
        assertEq(maxFee, 0, "same-chain (Arc) release must pass maxFee = 0");

        // burnAmount equals milestone amount because no forwarding fee was added.
        (, uint256 burnAmount,,,,,,,,) = _readBurnCall();
        assertEq(burnAmount, 100e6);
    }

    function test_CCTP_CrossChainRelease_UsesCctpForwardFeeAsMaxFee() public {
        uint256 id = _depositSingle(100e6); // DEST_DOMAIN = 6 (cross-chain)
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        escrow.releaseAfterWindow(id, 0, 0);

        (,,,,,, uint256 maxFee,,,) = _readBurnCall();
        assertEq(maxFee, CCTP_FORWARD_FEE);
    }

    function test_CCTP_CrossChainRelease_RevertsIfForwardFeeUnset() public {
        // Reset the forwarding fee to 0.
        vm.prank(deployer);
        escrow.setCctpForwardFee(0);

        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.expectRevert(ForwardFeeNotSet.selector);
        escrow.releaseAfterWindow(id, 0, 0);
    }

    function test_CCTP_CrossChainBurnAmount_EqualsRecipientAmountPlusForwardFee() public {
        // Cross-chain burn: burnAmount = recipientAmount + cctpForwardFee.
        // With protocol fee = 0 and milestone = 100e6, the recipient nets
        // 100e6 - cctpForwardFee and the contract burns the full 100e6.
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        escrow.releaseAfterWindow(id, 0, 0);

        (, uint256 burnAmount,,,,, uint256 maxFee,,,) = _readBurnCall();
        assertEq(maxFee, CCTP_FORWARD_FEE);
        // recipientAmount = burnAmount - cctpForwardFee
        uint256 recipientAmount = burnAmount - maxFee;
        assertEq(burnAmount, recipientAmount + CCTP_FORWARD_FEE);
        assertEq(burnAmount, 100e6);
        assertEq(recipientAmount, 100e6 - CCTP_FORWARD_FEE);
    }

    // -------------------------------------------------------------------------
    // signalDelivery
    // -------------------------------------------------------------------------

    function test_SignalDelivery_OnlyRecipientCanCall() public {
        uint256 id = _depositSingle(100e6);

        vm.prank(stranger);
        vm.expectRevert(NotRecipient.selector);
        escrow.signalDelivery(id, 0);

        vm.prank(depositor);
        vm.expectRevert(NotRecipient.selector);
        escrow.signalDelivery(id, 0);
    }

    function test_SignalDelivery_RevertOn_NotPending_AfterFulfill() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.prank(recipient);
        vm.expectRevert(InvalidState.selector);
        escrow.signalDelivery(id, 0);
    }

    function test_SignalDelivery_RevertOn_SequentialViolation() public {
        uint256 id = _depositMulti();
        // milestone 0 is still PENDING; signalling milestone 1 must revert
        vm.prank(recipient);
        vm.expectRevert(PreviousMilestoneNotComplete.selector);
        escrow.signalDelivery(id, 1);
    }

    function test_SignalDelivery_RevertOn_AlreadySignaled() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(recipient);
        escrow.signalDelivery(id, 0);
        vm.prank(recipient);
        vm.expectRevert(AlreadySignaled.selector);
        escrow.signalDelivery(id, 0);
    }

    function test_SignalDelivery_RevertOn_TooCloseToDeadline() public {
        // Deposit with deadline ~= now + 30d, deliveryNoticeWindow = 3d.
        // Warp to 28 days after creation; remaining time to deadline ≈ 2d < 3d.
        uint256 id = _depositSingle(100e6);
        vm.warp(block.timestamp + 28 days);
        vm.prank(recipient);
        vm.expectRevert(SignalTooCloseToDeadline.selector);
        escrow.signalDelivery(id, 0);
    }

    function test_SignalDelivery_SetsDeliveredAt_AndEmits() public {
        uint256 id = _depositSingle(100e6);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit DeliverySignaled(id, 0, block.timestamp);

        vm.prank(recipient);
        escrow.signalDelivery(id, 0);

        assertEq(_getMilestoneDeliveredAt(id, 0), block.timestamp);
        // State is still PENDING; signalling does not change milestone state.
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.PENDING));
    }

    // -------------------------------------------------------------------------
    // claimSilentApproval
    // -------------------------------------------------------------------------

    function test_ClaimSilentApproval_RevertOn_NotSignaled() public {
        uint256 id = _depositSingle(100e6);
        vm.expectRevert(NotSignaled.selector);
        escrow.claimSilentApproval(id, 0);
    }

    function test_ClaimSilentApproval_RevertOn_WindowNotExpired() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(recipient);
        escrow.signalDelivery(id, 0);

        // Boundary: at exactly deliveredAt + window, the strict-greater check
        // still rejects.
        vm.warp(block.timestamp + DELIVERY_NOTICE_WINDOW);
        vm.expectRevert(NoticeWindowNotExpired.selector);
        escrow.claimSilentApproval(id, 0);
    }

    function test_ClaimSilentApproval_ReleasesAfterWindowExpires() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(recipient);
        escrow.signalDelivery(id, 0);

        vm.warp(block.timestamp + DELIVERY_NOTICE_WINDOW + 1);
        escrow.claimSilentApproval(id, 0);

        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));
        assertEq(usdc.balanceOf(address(tokenMessenger)), 100e6);
    }

    function test_ClaimSilentApproval_CallableByAnyone() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(recipient);
        escrow.signalDelivery(id, 0);
        vm.warp(block.timestamp + DELIVERY_NOTICE_WINDOW + 1);

        // Stranger triggers the release on the recipient's behalf.
        vm.prank(stranger);
        escrow.claimSilentApproval(id, 0);

        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
    }

    function test_ClaimSilentApproval_RevertOn_NotPendingState() public {
        uint256 id = _depositSingle(100e6);
        // Fulfill (PENDING -> FULFILLED) without signalling delivery first.
        _fulfill(id, 0);
        vm.expectRevert(InvalidState.selector);
        escrow.claimSilentApproval(id, 0);
    }

    function test_ClaimSilentApproval_EmitsEvent() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(recipient);
        escrow.signalDelivery(id, 0);
        vm.warp(block.timestamp + DELIVERY_NOTICE_WINDOW + 1);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit SilentApprovalClaimed(id, 0, address(this));

        escrow.claimSilentApproval(id, 0);
    }

    // -------------------------------------------------------------------------
    // deliveryNoticeWindow validation
    // -------------------------------------------------------------------------

    function test_Deposit_RevertOn_NoticeWindowTooShort() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(NoticeWindowTooShort.selector);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            DISPUTE_WINDOW,
            1 days - 1,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 30 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_NoticeWindowTooLong() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(NoticeWindowTooLong.selector);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            DISPUTE_WINDOW,
            14 days + 1,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 60 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    // -------------------------------------------------------------------------
    // disputeWindow new upper bound (14 days)
    // -------------------------------------------------------------------------

    function test_Deposit_RevertOn_DisputeWindowOver14Days() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(DisputeWindowTooLong.selector);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            14 days + 1,
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
    // helpers
    // -------------------------------------------------------------------------

    function _depositToDomain(uint256 amount, uint32 domain, bytes32 mintRecipient) internal returns (uint256 id) {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        id = escrow.deposit(
            recipient,
            refundTo,
            amount,
            domain,
            mintRecipient,
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(amount),
            block.timestamp + 30 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    /// @dev Returns the most recent CCTP burn call, in MockTokenMessenger's
    ///      storage order: caller, amount, destinationDomain, mintRecipient,
    ///      burnToken, destinationCaller, maxFee, minFinalityThreshold,
    ///      withHook, hookData.
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
