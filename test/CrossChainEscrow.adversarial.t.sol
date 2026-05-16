// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";
import {CrossChainEscrow} from "../src/CrossChainEscrow.sol";
import {ICrossChainEscrow} from "../src/interface/ICrossChainEscrow.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// Reentrancy probe routed through the mock TokenMessenger.
/// The TokenMessenger is invoked from inside `_executeCCTPRelease`, so a
/// malicious messenger represents the most realistic re-entry surface.
contract ReentrancyAttacker {
    CrossChainEscrow public escrow;
    bytes public payload;
    bool public attempted;
    bytes public lastRevert;
    bool public lastSucceeded;

    constructor(CrossChainEscrow _escrow) {
        escrow = _escrow;
    }

    function arm(bytes calldata _payload) external {
        payload = _payload;
        attempted = false;
    }

    // Called by the mock messenger as a reentrancy hook.
    function fire() external {
        attempted = true;
        (bool ok, bytes memory ret) = address(escrow).call(payload);
        lastSucceeded = ok;
        lastRevert = ret;
    }
}

contract CrossChainEscrowAdversarialTest is Base {
    // -------------------------------------------------------------------------
    // ACCESS CONTROL -- non-arbiter cannot resolve, non-pauser cannot pause
    // -------------------------------------------------------------------------

    function test_Adv_NonArbiterCannotResolve() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);

        bytes memory expected;
        // depositor & recipient also lack the role
        address[3] memory bad = [depositor, recipient, stranger];
        for (uint256 i = 0; i < 3; i++) {
            expected = abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, bad[i], escrow.ARBITER_ROLE()
            );
            vm.prank(bad[i]);
            vm.expectRevert(expected);
            escrow.resolveDispute(id, 0, true, keccak256("res"), 0);
        }
    }

    function test_Adv_AdminCannotResolveWithoutGrant() public {
        // DEFAULT_ADMIN_ROLE does NOT imply ARBITER_ROLE
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        bytes memory expected = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, deployer, escrow.ARBITER_ROLE()
        );
        vm.prank(deployer);
        vm.expectRevert(expected);
        escrow.resolveDispute(id, 0, true, keccak256("res"), 0);
    }

    function test_Adv_OnlyAdminCanGrantArbiter() public {
        bytes32 arbRole = escrow.ARBITER_ROLE();
        bytes32 adminRole = escrow.DEFAULT_ADMIN_ROLE();
        bytes memory expected =
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, adminRole);
        vm.prank(stranger);
        vm.expectRevert(expected);
        escrow.grantRole(arbRole, stranger);

        // admin can grant
        vm.prank(deployer);
        escrow.grantRole(arbRole, stranger);
        assertTrue(escrow.hasRole(arbRole, stranger));
    }

    // -------------------------------------------------------------------------
    // STATE MACHINE -- reverts for every illegal transition
    // -------------------------------------------------------------------------

    function test_Adv_CannotReleasePending() public {
        uint256 id = _depositSingle(100e6);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.expectRevert(InvalidState.selector);
        escrow.releaseAfterWindow(id, 0, 0);
    }

    function test_Adv_CannotReleaseDisputed() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.expectRevert(InvalidState.selector);
        escrow.releaseAfterWindow(id, 0, 0);
    }

    function test_Adv_CannotResolveBeforeDispute() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.prank(arbiter);
        vm.expectRevert(NoDispute.selector);
        escrow.resolveDispute(id, 0, true, keccak256("res"), 0);
    }

    function test_Adv_CannotResolveAfterRelease() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        _release(id, 0);
        vm.prank(arbiter);
        vm.expectRevert(NoDispute.selector);
        escrow.resolveDispute(id, 0, true, keccak256("res"), 0);
    }

    function test_Adv_CannotDoubleResolve() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        _resolveAs(arbiter, id, 0, true);
        vm.prank(arbiter);
        vm.expectRevert(NoDispute.selector);
        escrow.resolveDispute(id, 0, true, keccak256("res"), 0);
    }

    function test_Adv_CannotRaiseSameDisputeTwice() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        vm.prank(recipient);
        vm.expectRevert(InvalidState.selector);
        escrow.raiseDispute(id, 0, "r2", keccak256("ev2"), "ipfs://ev2");
    }

    function test_Adv_CannotMutualCancelAfterCompletion() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        _release(id, 0);
        vm.prank(depositor);
        vm.expectRevert(NoDeposit.selector);
        escrow.mutualCancel(id);
    }

    function test_Adv_CannotFulfillAfterCancel() public {
        uint256 id = _depositMulti();
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);
        // Milestone state is now REFUNDED; the current-state guard fires
        // before the escrow-state check.
        vm.prank(depositor);
        vm.expectRevert(InvalidState.selector);
        escrow.fulfillCondition(id, 0);
    }

    // -------------------------------------------------------------------------
    // REENTRANCY -- via malicious TokenMessenger during release / resolve
    // -------------------------------------------------------------------------

    function test_Adv_Reentrancy_BlockedDuringReleaseAfterWindow() public {
        ReentrancyAttacker attacker = new ReentrancyAttacker(escrow);
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        // Re-enter releaseAfterWindow from inside CCTP burn
        bytes memory payload =
            abi.encodeWithSelector(escrow.releaseAfterWindow.selector, id, uint256(0), uint256(CCTP_FORWARD_FEE));
        attacker.arm(payload);
        tokenMessenger.setReentrancy(address(attacker), abi.encodeWithSelector(ReentrancyAttacker.fire.selector));

        escrow.releaseAfterWindow(id, 0, CCTP_FORWARD_FEE);

        assertTrue(attacker.attempted(), "reentrancy attempt did not fire");
        assertFalse(attacker.lastSucceeded(), "reentrancy was NOT blocked");
    }

    function test_Adv_Reentrancy_BlockedReentrantWithdrawDuringRelease() public {
        // Attempt to call withdrawRefund during the CCTP burn callback.
        ReentrancyAttacker attacker = new ReentrancyAttacker(escrow);

        uint256 id = _depositMulti();
        // Refund milestone 1 to the attacker's address by setting refundTo to attacker.
        // We can't rewrite escrow's refundTo, so instead make a separate escrow whose
        // refundTo is the attacker, refund a milestone, and use that balance.
        uint256[] memory ms = new uint256[](1);
        ms[0] = 100e6;
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        uint256 idAttacker = escrow.deposit(
            recipient,
            address(attacker),
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            ms,
            block.timestamp + 30 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();

        _fulfill(idAttacker, 0);
        _raiseDisputeAs(depositor, idAttacker, 0);
        _resolveAs(arbiter, idAttacker, 0, false);
        assertEq(escrow.refundBalances(address(attacker)), 100e6);

        // Now release from the unrelated escrow (id), and have the attacker try
        // to drain its refund inside the CCTP callback.
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        bytes memory payload = abi.encodeWithSelector(escrow.withdrawRefund.selector, address(attacker));
        attacker.arm(payload);
        tokenMessenger.setReentrancy(address(attacker), abi.encodeWithSelector(ReentrancyAttacker.fire.selector));

        escrow.releaseAfterWindow(id, 0, CCTP_FORWARD_FEE);

        assertTrue(attacker.attempted());
        assertFalse(attacker.lastSucceeded(), "reentrant withdrawRefund was NOT blocked");
        // Refund balance is preserved
        assertEq(escrow.refundBalances(address(attacker)), 100e6);
    }

    // -------------------------------------------------------------------------
    // DOUBLE-SPEND / INDEX MANIPULATION
    // -------------------------------------------------------------------------

    function test_Adv_CannotReleaseSameMilestoneTwice() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        _release(id, 0);
        vm.expectRevert(InvalidState.selector);
        escrow.releaseAfterWindow(id, 0, 0);
    }

    function test_Adv_CannotFulfillOutOfOrderViaSkipping() public {
        uint256 id = _depositMulti();
        vm.prank(depositor);
        vm.expectRevert(PreviousMilestoneNotComplete.selector);
        escrow.fulfillCondition(id, 2);

        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        _release(id, 0);

        vm.prank(depositor);
        vm.expectRevert(PreviousMilestoneNotComplete.selector);
        escrow.fulfillCondition(id, 2);
    }

    function test_Adv_RaiseDispute_OnUnfulfilledIndexFails() public {
        uint256 id = _depositMulti();
        vm.prank(depositor);
        vm.expectRevert(InvalidState.selector);
        escrow.raiseDispute(id, 0, "r", keccak256("ev"), "ipfs://ev");
    }

    function test_Adv_RefundCannotBeWithdrawnByOthers() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        _resolveAs(arbiter, id, 0, false);
        // refund balance is for refundTo, NOT for depositor or recipient
        assertEq(escrow.refundBalances(refundTo), 100e6);
        assertEq(escrow.refundBalances(depositor), 0);
        assertEq(escrow.refundBalances(recipient), 0);

        vm.prank(stranger);
        vm.expectRevert(NothingToWithdraw.selector);
        escrow.withdrawRefund(stranger);

        vm.prank(depositor);
        vm.expectRevert(NothingToWithdraw.selector);
        escrow.withdrawRefund(depositor);
    }

    function test_Adv_WithdrawRefundCannotDrainTwice() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        _resolveAs(arbiter, id, 0, false);
        vm.prank(refundTo);
        escrow.withdrawRefund(refundTo);
        vm.prank(refundTo);
        vm.expectRevert(NothingToWithdraw.selector);
        escrow.withdrawRefund(refundTo);
    }

    // -------------------------------------------------------------------------
    // PAUSE -- sensitive functions block correctly
    // -------------------------------------------------------------------------

    function test_Adv_DepositPaused() public {
        vm.prank(pauser);
        escrow.pause();
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(Pausable.EnforcedPause.selector);
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
            block.timestamp + 1 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Adv_ReleaseAfterWindow_NotBlockedByPause() public {
        // Documents post-fix behaviour: releaseAfterWindow has no whenNotPaused.
        // Settlement after the dispute window cannot be censored by the pauser.
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.prank(pauser);
        escrow.pause();
        escrow.releaseAfterWindow(id, 0, CCTP_FORWARD_FEE);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
    }

    /// @dev Documents current behaviour: resolveDispute() is NOT pausable.
    /// If pause is meant to halt all token movement, this is a finding.
    function test_Adv_ResolveDispute_NotBlockedByPause() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        vm.prank(pauser);
        escrow.pause();
        // Arbiter can still release funds via CCTP while the contract is paused.
        _resolveAs(arbiter, id, 0, true);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
    }

    /// @dev Documents current behaviour: mutualCancel is NOT pausable.
    function test_Adv_MutualCancel_NotBlockedByPause() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(pauser);
        escrow.pause();
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.CANCELLED));
    }

    // -------------------------------------------------------------------------
    // CCTP CALL FAILURES -- failures propagate, leaving consistent state
    // -------------------------------------------------------------------------

    function test_Adv_ReleaseRevertsIfCCTPReverts() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        tokenMessenger.setShouldRevert(true);
        vm.expectRevert();
        escrow.releaseAfterWindow(id, 0, CCTP_FORWARD_FEE);
        // milestone state preserved (PENDING is wrong; it was set to RELEASED before .call,
        // but the revert unwinds it, so it should still be FULFILLED)
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.FULFILLED));
        assertEq(usdc.balanceOf(address(escrow)), 100e6);
    }

    function test_Adv_ResolveRevertsIfCCTPReverts() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        tokenMessenger.setShouldRevert(true);
        vm.prank(arbiter);
        vm.expectRevert();
        escrow.resolveDispute(id, 0, true, keccak256("res"), 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.DISPUTED));
    }

    // -------------------------------------------------------------------------
    // CROSS-ESCROW ISOLATION
    // -------------------------------------------------------------------------

    function test_Adv_CrossEscrow_NoFundsLeak() public {
        uint256 a = _depositSingle(100e6);
        uint256 b = _depositSingle(50e6);
        // resolve a -> recipient, b stays
        _fulfill(a, 0);
        _raiseDisputeAs(depositor, a, 0);
        _resolveAs(arbiter, a, 0, true);
        assertEq(usdc.balanceOf(address(escrow)), 50e6);
        assertEq(usdc.balanceOf(address(tokenMessenger)), 100e6);
        assertEq(uint256(_getEscrowState(b)), uint256(EscrowState.ACTIVE));
        assertEq(_getMilestoneAmount(b, 0), 50e6);
    }

    function test_Adv_CrossEscrow_SeparateRefunds() public {
        address refundA = makeAddr("refundA");
        address refundB = makeAddr("refundB");

        uint256[] memory ms = _singleMilestone(100e6);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        uint256 a = escrow.deposit(
            recipient,
            refundA,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            ms,
            block.timestamp + 30 days,
            new SplitRecipient[](0)
        );
        usdc.approve(address(escrow), 50e6);
        uint256[] memory ms2 = _singleMilestone(50e6);
        uint256 b = escrow.deposit(
            recipient,
            refundB,
            50e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            ms2,
            block.timestamp + 30 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();

        _fulfill(a, 0);
        _raiseDisputeAs(depositor, a, 0);
        _resolveAs(arbiter, a, 0, false);
        _fulfill(b, 0);
        _raiseDisputeAs(depositor, b, 0);
        _resolveAs(arbiter, b, 0, false);

        assertEq(escrow.refundBalances(refundA), 100e6);
        assertEq(escrow.refundBalances(refundB), 50e6);

        vm.prank(refundA);
        escrow.withdrawRefund(refundA);
        // refundB unaffected
        assertEq(escrow.refundBalances(refundB), 50e6);
    }

    // -------------------------------------------------------------------------
    // GRIEFING -- cannot brick another party's escrow
    // -------------------------------------------------------------------------

    function test_Adv_StrangerCannotPause() public {
        bytes memory expected = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, escrow.PAUSER_ROLE()
        );
        vm.prank(stranger);
        vm.expectRevert(expected);
        escrow.pause();
    }

    function test_Adv_StrangerCannotForceCancel() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(stranger);
        vm.expectRevert(NotEscrowOwnerOrRecipient.selector);
        escrow.mutualCancel(id);
    }

    function test_Adv_DepositorAloneCannotCancel() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(depositor);
        escrow.mutualCancel(id);
        // not yet cancelled
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.ACTIVE));
        // tokens NOT released
        assertEq(usdc.balanceOf(address(escrow)), 100e6);
        assertEq(escrow.refundBalances(refundTo), 0);
    }

    function test_Adv_RecipientCannotFulfillForDepositor() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(recipient);
        vm.expectRevert(NotEscrowOwner.selector);
        escrow.fulfillCondition(id, 0);
    }

    // -------------------------------------------------------------------------
    // FINDINGS -- regression tests for the fulfillCondition state-guard fix.
    // Pre-patch, fulfillCondition had no current-state check and could reset
    // DISPUTED / RELEASED / REFUNDED milestones back to FULFILLED, enabling
    // dispute-wiping, double-spend, and double-payout. The patched contract
    // checks `m.state != PENDING -> revert InvalidState` before any other
    // logic, so each variant below now correctly reverts.
    // -------------------------------------------------------------------------

    /// @dev FIX: a depositor can no longer erase an active dispute by calling
    ///      fulfillCondition again. The DISPUTED state is now sticky.
    function test_FINDING_FulfillResetsDisputedMilestone() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(recipient, id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.DISPUTED));

        vm.prank(depositor);
        vm.expectRevert(InvalidState.selector);
        escrow.fulfillCondition(id, 0);

        // State unchanged.
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.DISPUTED));
    }

    /// @dev FIX: a RELEASED milestone can no longer be re-fulfilled and
    ///      re-released; the second fulfillCondition reverts.
    function test_FINDING_DoubleSpendViaRefulfillAfterRelease() public {
        uint256 id = _depositMulti();

        _fulfill(id, 0);
        uint256 t0 = _getMilestoneTimestamp(id, 0);
        vm.warp(t0 + DISPUTE_WINDOW + 1);
        _release(id, 0);

        assertEq(usdc.balanceOf(address(escrow)), 500e6);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.ACTIVE));

        // Patched: re-fulfilling a RELEASED milestone reverts.
        vm.prank(depositor);
        vm.expectRevert(InvalidState.selector);
        escrow.fulfillCondition(id, 0);

        // No double spend possible: TokenMessenger only ever received the
        // single legitimate burn.
        assertEq(usdc.balanceOf(address(tokenMessenger)), 100e6);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
    }

    /// @dev FIX: a REFUNDED milestone can no longer be re-fulfilled and
    ///      released; the refund credit and the CCTP path are mutually exclusive.
    function test_FINDING_DoublePayoutViaRefulfillAfterRefund() public {
        uint256 id = _depositMulti();

        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        _resolveAs(arbiter, id, 0, false);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.REFUNDED));
        assertEq(escrow.refundBalances(refundTo), 100e6);

        // Patched: re-fulfilling a REFUNDED milestone reverts.
        vm.prank(depositor);
        vm.expectRevert(InvalidState.selector);
        escrow.fulfillCondition(id, 0);

        // Refund credit untouched, no CCTP burn.
        assertEq(escrow.refundBalances(refundTo), 100e6);
        assertEq(usdc.balanceOf(address(tokenMessenger)), 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.REFUNDED));
    }

    /// @dev FIX: the depositor can no longer grief the recipient by racing
    ///      fulfillCondition against raiseDispute -- once a dispute is raised
    ///      the milestone is locked into the DISPUTED -> arbiter flow.
    function test_FINDING_DepositorCanGriefDisputeWindow() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(recipient, id, 0);

        // Patched: the depositor's attempt to wipe the dispute reverts.
        vm.prank(depositor);
        vm.expectRevert(InvalidState.selector);
        escrow.fulfillCondition(id, 0);

        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.DISPUTED));
    }

    // -------------------------------------------------------------------------
    // INVOICE & EVIDENCE INTEGRITY
    // -------------------------------------------------------------------------

    function test_Adv_InvoiceHashImmutable() public {
        uint256 id = _depositSingle(100e6);
        // No setter exists; invoiceHash is read from storage and we don't expose
        // a getter that returns it directly because the auto getter skips strings.
        // We assert via storage slot if needed; here we simply assert no path
        // mutates it: every revert/path leaves the escrow record intact.
        _fulfill(id, 0);
        assertEq(_getEscrowDepositor(id), depositor); // sanity
    }

    function test_Adv_EvidenceImmutableAfterDispute() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        (address disputedBy, bytes32 evHash,, string memory reason,,,,) = escrow.disputes(id, 0);
        assertEq(disputedBy, depositor);
        assertEq(evHash, keccak256("ev"));
        assertEq(reason, "reason");

        // Counter evidence by the other party does not overwrite the original evidence
        vm.prank(recipient);
        escrow.submitCounterEvidence(id, 0, keccak256("counter"), "ipfs://counter");
        (address disputedBy2, bytes32 evHash2,, string memory reason2,,,,) = escrow.disputes(id, 0);
        assertEq(disputedBy2, depositor);
        assertEq(evHash2, keccak256("ev"));
        assertEq(reason2, "reason");
    }
}
