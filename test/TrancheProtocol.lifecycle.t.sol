// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";

/// @notice Full-coverage suite for the redesigned post-deposit lifecycle:
///         PENDING -> (claimDelivery) -> IN_REVIEW -> (approve | dispute |
///         optimistic release) -> RELEASED/DISPUTED, with refund-after-deadline
///         and the 50/50 arbiter timeout. Replaces the old fulfill/signal/
///         escalate suites.
contract TrancheProtocolLifecycleTest is Base {
    // ----------------------------------------------------------------------
    // Happy path: claim -> approve (instant) / optimistic release
    // ----------------------------------------------------------------------

    function test_Claim_MovesToInReview() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.IN_REVIEW));
        assertEq(_getMilestoneTimestamp(id, 0), block.timestamp);
        assertTrue(escrow.isClaimed(id, 0));
    }

    function test_Claim_RevertOn_NonRecipient() public {
        uint256 id = _depositSingle(1000e6);
        vm.prank(depositor);
        vm.expectRevert(NotRecipient.selector);
        escrow.claimDelivery(id, 0);
    }

    function test_Claim_RevertOn_AlreadyInReview() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        vm.prank(recipient);
        vm.expectRevert(InvalidState.selector);
        escrow.claimDelivery(id, 0);
    }

    function test_Claim_RevertOn_AfterDeadline() public {
        uint256 id = _depositSingle(1000e6);
        // Past the deadline *and* the delivery grace period.
        vm.warp(block.timestamp + 30 days + escrow.DELIVERY_GRACE_PERIOD() + 1);
        vm.prank(recipient);
        vm.expectRevert(DeadlinePassed.selector);
        escrow.claimDelivery(id, 0);
    }

    function test_ApproveRelease_InstantPayout() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        _approve(id, 0);

        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));
        assertEq(usdc.balanceOf(address(tokenMessenger)), 1000e6);
    }

    function test_ApproveRelease_RevertOn_NonDepositor() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        vm.prank(recipient);
        vm.expectRevert(NotEscrowOwner.selector);
        escrow.approveRelease(id, 0, CCTP_FORWARD_FEE);
    }

    function test_ApproveRelease_RevertOn_NotInReview() public {
        uint256 id = _depositSingle(1000e6);
        vm.prank(depositor);
        vm.expectRevert(NotInReview.selector);
        escrow.approveRelease(id, 0, CCTP_FORWARD_FEE);
    }

    function test_Release_AfterReviewWindow_Permissionless() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);

        vm.warp(block.timestamp + REVIEW_WINDOW);
        assertTrue(escrow.isReviewWindowExpired(id, 0));
        // Anyone can call.
        vm.prank(stranger);
        escrow.release(id, 0, CCTP_FORWARD_FEE);

        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
        assertEq(usdc.balanceOf(address(tokenMessenger)), 1000e6);
    }

    function test_Release_RevertOn_WindowNotExpired() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW - 1);
        vm.expectRevert(ReviewWindowNotExpired.selector);
        escrow.release(id, 0, CCTP_FORWARD_FEE);
    }

    function test_Release_RevertOn_NotClaimed() public {
        uint256 id = _depositSingle(1000e6);
        vm.expectRevert(NotInReview.selector);
        escrow.release(id, 0, CCTP_FORWARD_FEE);
    }

    // ----------------------------------------------------------------------
    // Refund when the recipient never claims before the deadline
    // ----------------------------------------------------------------------

    function test_RefundAfterDeadline_RecipientNeverClaimed() public {
        uint256 id = _depositSingle(1000e6);
        // Refund only opens after the full delivery grace period elapses.
        vm.warp(block.timestamp + 30 days + escrow.DELIVERY_GRACE_PERIOD() + 1);
        vm.prank(stranger); // permissionless
        escrow.refundAfterDeadline(id, 0);

        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.REFUNDED));
        assertEq(escrow.refundBalances(refundTo), 1000e6);
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));
    }

    function test_RefundAfterDeadline_RevertOn_BeforeDeadline() public {
        uint256 id = _depositSingle(1000e6);
        vm.expectRevert(DeadlineNotReached.selector);
        escrow.refundAfterDeadline(id, 0);
    }

    function test_RefundAfterDeadline_RevertOn_AlreadyClaimed() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + 30 days + 1);
        // Milestone is IN_REVIEW, not PENDING -> cannot refund-after-deadline.
        vm.expectRevert(InvalidState.selector);
        escrow.refundAfterDeadline(id, 0);
    }

    // ----------------------------------------------------------------------
    // Delivery grace period (DELIVERY_GRACE_PERIOD = 72h)
    // ----------------------------------------------------------------------

    /// @notice The recipient may still claim delivery after the nominal
    ///         deadline as long as the grace period has not fully elapsed.
    function test_GracePeriod_Claim_SucceedsWithinGrace() public {
        uint256 id = _depositSingle(1000e6);
        // 1 hour past the deadline, well inside the 72h grace window.
        vm.warp(block.timestamp + 30 days + 1 hours);
        _claimDelivery(id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.IN_REVIEW));
    }

    /// @notice The recipient can claim right up to the last second of grace.
    function test_GracePeriod_Claim_SucceedsAtGraceEdge() public {
        uint256 id = _depositSingle(1000e6);
        vm.warp(block.timestamp + 30 days + escrow.DELIVERY_GRACE_PERIOD());
        _claimDelivery(id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.IN_REVIEW));
    }

    /// @notice refundAfterDeadline reverts while the grace period is still
    ///         active (past the deadline but within the 72h window).
    function test_GracePeriod_Refund_RevertWhileGraceActive() public {
        uint256 id = _depositSingle(1000e6);
        // Past the deadline but still inside the grace window.
        vm.warp(block.timestamp + 30 days + escrow.DELIVERY_GRACE_PERIOD());
        vm.expectRevert(DeadlineNotReached.selector);
        escrow.refundAfterDeadline(id, 0);
    }

    /// @notice refundAfterDeadline succeeds once the full grace period elapses
    ///         with no delivery claim.
    function test_GracePeriod_Refund_SucceedsAfterFullGrace() public {
        uint256 id = _depositSingle(1000e6);
        vm.warp(block.timestamp + 30 days + escrow.DELIVERY_GRACE_PERIOD() + 1);
        vm.prank(stranger); // permissionless
        escrow.refundAfterDeadline(id, 0);

        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.REFUNDED));
        assertEq(escrow.refundBalances(refundTo), 1000e6);
    }

    /// @notice A depositor cannot front-run a late-but-valid recipient delivery
    ///         claim with refundAfterDeadline inside the grace window: the
    ///         refund reverts, and the recipient can still claim.
    function test_GracePeriod_DepositorCannotFrontRunClaim() public {
        uint256 id = _depositSingle(1000e6);
        // Just past the deadline, inside the grace window.
        vm.warp(block.timestamp + 30 days + 1);

        // Depositor tries to snatch the funds back early -> blocked.
        vm.prank(depositor);
        vm.expectRevert(DeadlineNotReached.selector);
        escrow.refundAfterDeadline(id, 0);

        // Recipient's delivery claim still goes through.
        _claimDelivery(id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.IN_REVIEW));
    }

    // ----------------------------------------------------------------------
    // Sequential milestone gating
    // ----------------------------------------------------------------------

    function test_Claim_Sequential_RevertOn_PreviousIncomplete() public {
        uint256 id = _depositMulti(); // 3 milestones
        vm.prank(recipient);
        vm.expectRevert(PreviousMilestoneNotComplete.selector);
        escrow.claimDelivery(id, 1);
    }

    function test_Claim_Sequential_AfterPreviousReleased() public {
        uint256 id = _depositMulti();
        _claimDelivery(id, 0);
        _approve(id, 0);
        // Now milestone 1 can be claimed.
        _claimDelivery(id, 1);
        assertEq(uint256(_getMilestoneState(id, 1)), uint256(MilestoneState.IN_REVIEW));
    }

    // ----------------------------------------------------------------------
    // Dispute: depositor-only, from IN_REVIEW
    // ----------------------------------------------------------------------

    function test_RaiseDispute_MovesToDisputed() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.DISPUTED));
    }

    function test_RaiseDispute_RevertOn_RecipientCaller() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        vm.prank(recipient);
        vm.expectRevert(NotEscrowOwner.selector);
        escrow.raiseDispute(id, 0, "r", keccak256("e"), "ipfs://e");
    }

    function test_RaiseDispute_RevertOn_Pending() public {
        uint256 id = _depositSingle(1000e6);
        vm.prank(depositor);
        vm.expectRevert(NotInReview.selector);
        escrow.raiseDispute(id, 0, "r", keccak256("e"), "ipfs://e");
    }

    function test_RaiseDispute_RevertOn_AfterReviewWindow() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        vm.prank(depositor);
        vm.expectRevert(ReviewWindowExpired.selector);
        escrow.raiseDispute(id, 0, "r", keccak256("e"), "ipfs://e");
    }

    // ----------------------------------------------------------------------
    // GRIEF-IMPOSSIBLE regressions: the old "approve/fulfill then dispute" and
    // "dispute-to-0%-on-timeout" attacks are structurally removed.
    // ----------------------------------------------------------------------

    function test_Grief_CannotDisputeAfterApprove() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        _approve(id, 0); // RELEASED
        vm.prank(depositor);
        vm.expectRevert(NotInReview.selector);
        escrow.raiseDispute(id, 0, "r", keccak256("e"), "ipfs://e");
    }

    function test_Grief_CannotDisputeAfterRelease() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW);
        _release(id, 0);
        vm.prank(depositor);
        vm.expectRevert(NotInReview.selector);
        escrow.raiseDispute(id, 0, "r", keccak256("e"), "ipfs://e");
    }

    function test_Grief_DepositorDisputeTimeout_GivesFiftyFifty() public {
        // Depositor disputes a claimed milestone and waits out the arbiter.
        // The fair default is 50/50 (never the old 0%-to-recipient clawback).
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        vm.warp(block.timestamp + escrow.ARBITER_WINDOW());
        escrow.resolveDisputeByTimeout(id, 0);

        assertEq(escrow.refundBalances(recipient), 500e6);
        assertEq(escrow.refundBalances(refundTo), 500e6);
    }

    // ----------------------------------------------------------------------
    // Dispute resolution: counter-evidence, arbiter, mutual settle, timeout
    // ----------------------------------------------------------------------

    function test_CounterEvidence_RecipientResponds() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        vm.prank(recipient);
        escrow.submitCounterEvidence(id, 0, keccak256("c"), "ipfs://c");
        // Raiser (depositor) cannot counter their own dispute.
        vm.prank(depositor);
        vm.expectRevert(CannotRespondToOwnDispute.selector);
        escrow.submitCounterEvidence(id, 0, keccak256("c2"), "ipfs://c2");
    }

    function test_ResolveDispute_PartialSplit() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        vm.prank(arbiter);
        escrow.resolveDispute(id, 0, 6000, keccak256("res"), "ipfs://res", CCTP_FORWARD_FEE);

        // 60% to recipient (CCTP burn), 40% refunded to depositor.
        assertEq(usdc.balanceOf(address(tokenMessenger)), 600e6);
        assertEq(escrow.refundBalances(refundTo), 400e6);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
    }

    function test_MutualSettle_BothAgree() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        vm.prank(depositor);
        escrow.mutualSettle(id, 0, 3000, CCTP_FORWARD_FEE);
        vm.prank(recipient);
        escrow.mutualSettle(id, 0, 3000, CCTP_FORWARD_FEE);

        assertEq(usdc.balanceOf(address(tokenMessenger)), 300e6);
        assertEq(escrow.refundBalances(refundTo), 700e6);
    }

    function test_ResolveDisputeByTimeout_RevertOn_BeforeWindow() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        vm.warp(block.timestamp + escrow.ARBITER_WINDOW() - 1);
        vm.expectRevert(ArbiterTimeoutNotReached.selector);
        escrow.resolveDisputeByTimeout(id, 0);
    }

    function test_ResolveDisputeByTimeout_ChargesFeeOnRecipientShare() public {
        vm.prank(deployer);
        escrow.setProtocolFee(199); // 1.99%
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        vm.warp(block.timestamp + escrow.ARBITER_WINDOW());
        escrow.resolveDisputeByTimeout(id, 0);

        uint256 fee = (500e6 * 199) / 10_000;
        assertEq(usdc.balanceOf(protocolTreasury), fee);
        assertEq(escrow.refundBalances(recipient), 500e6 - fee);
        assertEq(escrow.refundBalances(refundTo), 500e6);
    }

    // ----------------------------------------------------------------------
    // Mutual cancel
    // ----------------------------------------------------------------------

    function test_MutualCancel_RefundsPendingAndInReview() public {
        uint256 id = _depositMulti(); // [100, 200, 300]
        _claimDelivery(id, 0); // milestone 0 IN_REVIEW; 1 & 2 PENDING

        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);

        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.CANCELLED));
        assertEq(escrow.refundBalances(refundTo), 600e6);
    }

    function test_MutualCancel_RevertOn_DuringDispute() public {
        uint256 id = _depositMulti();
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        vm.expectRevert(CannotCancelDuringDispute.selector);
        escrow.mutualCancel(id);
    }

    // ----------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------

    function test_GetEscrowDetail_ReflectsReviewState() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);

        EscrowDetail memory d = escrow.getEscrowDetail(id, depositor);
        assertTrue(d.claimed[0]);
        assertEq(d.reviewDeadlines[0], block.timestamp + REVIEW_WINDOW);
        assertFalse(d.reviewWindowExpired[0]);
        assertTrue(d.isPayer);

        vm.warp(block.timestamp + REVIEW_WINDOW);
        d = escrow.getEscrowDetail(id, depositor);
        assertTrue(d.reviewWindowExpired[0]);
    }

    // ----------------------------------------------------------------------
    // Milestone-level mutual cancel
    // ----------------------------------------------------------------------

    function test_MilestoneCancel_BothPropose_RefundsPayer() public {
        uint256 id = _depositMulti(); // [100, 200, 300]

        vm.expectEmit(true, false, false, true, address(escrow));
        emit MilestoneCancelProposed(id, 0, depositor);
        vm.prank(depositor);
        escrow.proposeMilestoneCancel(id, 0);

        // Not executed on the first proposal.
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.PENDING));

        vm.expectEmit(true, false, false, true, address(escrow));
        emit MilestoneCancelled(id, 0, 100e6);
        vm.prank(recipient);
        escrow.proposeMilestoneCancel(id, 0);

        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.REFUNDED));
        assertEq(escrow.refundBalances(refundTo), 100e6);
        // Other milestones untouched; escrow still ACTIVE.
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.ACTIVE));
    }

    function test_MilestoneCancel_FromInReview() public {
        uint256 id = _depositMulti();
        _claimDelivery(id, 0); // IN_REVIEW
        vm.prank(recipient);
        escrow.proposeMilestoneCancel(id, 0);
        vm.prank(depositor);
        escrow.proposeMilestoneCancel(id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.REFUNDED));
        assertEq(escrow.refundBalances(refundTo), 100e6);
    }

    function test_MilestoneCancel_OneProposal_DoesNotExecute() public {
        uint256 id = _depositMulti();
        vm.prank(depositor);
        escrow.proposeMilestoneCancel(id, 0);
        assertTrue(escrow.milestoneCancelProposals(id, 0, depositor));
        assertFalse(escrow.milestoneCancelProposals(id, 0, recipient));
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.PENDING));
    }

    function test_MilestoneCancel_RevertOn_Stranger() public {
        uint256 id = _depositMulti();
        vm.prank(stranger);
        vm.expectRevert(NotEscrowOwnerOrRecipient.selector);
        escrow.proposeMilestoneCancel(id, 0);
    }

    function test_MilestoneCancel_RevertOn_Disputed() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        vm.prank(depositor);
        vm.expectRevert(InvalidState.selector);
        escrow.proposeMilestoneCancel(id, 0);
    }

    function test_MilestoneCancel_RevertOn_Released() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        _approve(id, 0); // RELEASED
        vm.prank(depositor);
        vm.expectRevert(InvalidState.selector);
        escrow.proposeMilestoneCancel(id, 0);
    }

    function test_MilestoneCancel_RevertOn_PreviousNotComplete() public {
        uint256 id = _depositMulti();
        vm.prank(depositor);
        vm.expectRevert(PreviousMilestoneNotComplete.selector);
        escrow.proposeMilestoneCancel(id, 1); // milestone 0 still PENDING
    }

    function test_MilestoneCancel_Sequential_MiddleMilestone() public {
        uint256 id = _depositMulti(); // [100, 200, 300]

        // Release milestone 0.
        _claimDelivery(id, 0);
        _approve(id, 0);

        // Cancel the middle milestone 1 (both parties).
        vm.prank(depositor);
        escrow.proposeMilestoneCancel(id, 1);
        vm.prank(recipient);
        escrow.proposeMilestoneCancel(id, 1);
        assertEq(uint256(_getMilestoneState(id, 1)), uint256(MilestoneState.REFUNDED));
        assertEq(escrow.refundBalances(refundTo), 200e6);

        // Sequential gating still works: milestone 2's prev (1) is REFUNDED.
        _claimDelivery(id, 2);
        _approve(id, 2);
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));
    }

    function test_MilestoneCancel_CompletesEscrow_WhenLastNonTerminal() public {
        uint256 id = _depositSingle(1000e6);
        vm.prank(depositor);
        escrow.proposeMilestoneCancel(id, 0);
        vm.prank(recipient);
        escrow.proposeMilestoneCancel(id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.REFUNDED));
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));
        assertEq(escrow.refundBalances(refundTo), 1000e6);
        // Tokens stay in the contract, backing the refund credit.
        assertEq(usdc.balanceOf(address(escrow)), 1000e6);
    }

    function test_EscrowMutualCancel_ClearsMilestoneProposals() public {
        uint256 id = _depositMulti();
        vm.prank(depositor);
        escrow.proposeMilestoneCancel(id, 0);
        assertTrue(escrow.milestoneCancelProposals(id, 0, depositor));

        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);

        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.CANCELLED));
        assertFalse(escrow.milestoneCancelProposals(id, 0, depositor));
    }
}
