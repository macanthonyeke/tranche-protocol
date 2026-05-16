// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";
import {CrossChainEscrow} from "../src/CrossChainEscrow.sol";
import {ICrossChainEscrow} from "../src/interface/ICrossChainEscrow.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract CrossChainEscrowUnitTest is Base {
    // =========================================================================
    // 1. DEPOSIT
    // =========================================================================

    function test_Deposit_HappyPath_SingleMilestone() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit EscrowCreated(1, depositor, recipient, 100e6, INVOICE_HASH, INVOICE_URI, block.timestamp + 30 days);

        uint256 id = escrow.deposit(
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
            block.timestamp + 30 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();

        assertEq(id, 1);
        assertEq(escrow.escrowCount(), 1);
        assertEq(usdc.balanceOf(address(escrow)), 100e6);
        assertEq(_getEscrowDepositor(id), depositor);
        assertEq(_getEscrowTotalAmount(id), 100e6);
        assertEq(_getEscrowMilestoneCount(id), 1);
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.ACTIVE));
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.PENDING));
        assertEq(_getMilestoneAmount(id, 0), 100e6);
    }

    function test_Deposit_HappyPath_ThreeMilestones() public {
        uint256 id = _depositMulti();
        assertEq(_getEscrowMilestoneCount(id), 3);
        assertEq(_getMilestoneAmount(id, 0), 100e6);
        assertEq(_getMilestoneAmount(id, 1), 200e6);
        assertEq(_getMilestoneAmount(id, 2), 300e6);
        assertEq(_getEscrowTotalAmount(id), 600e6);
        assertEq(usdc.balanceOf(address(escrow)), 600e6);
    }

    function test_Deposit_IncrementsEscrowId() public {
        uint256 a = _depositSingle(10e6);
        uint256 b = _depositSingle(20e6);
        uint256 c = _depositSingle(30e6);
        assertEq(a, 1);
        assertEq(b, 2);
        assertEq(c, 3);
    }

    function test_Deposit_RevertOn_ZeroTotalAmount() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 0);
        vm.expectRevert(InvalidAmount.selector);
        escrow.deposit(
            recipient,
            refundTo,
            0,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(0),
            block.timestamp + 1 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_ZeroRecipient() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(ZeroAddress.selector);
        escrow.deposit(
            address(0),
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

    function test_Deposit_DefaultsRefundToDepositor_WhenZero() public {
        // Passing address(0) as refundTo silently defaults to msg.sender.
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
        (,, address storedRefundTo,,,,,,,,,,,,) = escrow.escrows(id);
        assertEq(storedRefundTo, depositor);
    }

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

    function test_Deposit_RevertOn_NoInvoiceHash() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(NoInvoice.selector);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            bytes32(0),
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 1 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_NoInvoiceURI() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(NoInvoiceURI.selector);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            "",
            _singleMilestone(100e6),
            block.timestamp + 1 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_DeadlineTooSoon_AtCurrentTime() public {
        vm.warp(1_700_000_000);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        // A deadline at block.timestamp is also "too soon" under the
        // mandatory-deadline regime (must be > now + 1 hour).
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
            block.timestamp,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_NoMilestones() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(NoMilestones.selector);
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
            new uint256[](0),
            block.timestamp + 1 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_ZeroAmountInMilestone() public {
        uint256[] memory ms = new uint256[](2);
        ms[0] = 50e6;
        ms[1] = 0;
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 50e6);
        vm.expectRevert(InvalidAmount.selector);
        escrow.deposit(
            recipient,
            refundTo,
            50e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            ms,
            block.timestamp + 1 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_MilestoneSumMismatch() public {
        uint256[] memory ms = new uint256[](2);
        ms[0] = 50e6;
        ms[1] = 49e6;
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(MilestoneAmountMismatch.selector);
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
            ms,
            block.timestamp + 1 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Deposit_RevertOn_NotEnoughAllowance() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 50e6);
        vm.expectRevert();
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

    function test_Deposit_RevertOn_Paused() public {
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

    // =========================================================================
    // 2. FULFILL CONDITION
    // =========================================================================

    function test_FulfillCondition_HappyPath() public {
        uint256 id = _depositSingle(100e6);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit ConditionFulfilled(id, 0, block.timestamp + DISPUTE_WINDOW);
        vm.prank(depositor);
        escrow.fulfillCondition(id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.FULFILLED));
        assertEq(_getMilestoneTimestamp(id, 0), block.timestamp);
    }

    function test_FulfillCondition_RevertOn_NotDepositor() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(recipient);
        vm.expectRevert(NotEscrowOwner.selector);
        escrow.fulfillCondition(id, 0);
        vm.prank(stranger);
        vm.expectRevert(NotEscrowOwner.selector);
        escrow.fulfillCondition(id, 0);
    }

    function test_FulfillCondition_RevertOn_NonexistentEscrow() public {
        vm.prank(depositor);
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.fulfillCondition(999, 0);
    }

    function test_FulfillCondition_RevertOn_InvalidIndex() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(depositor);
        vm.expectRevert(InvalidMilestoneIndex.selector);
        escrow.fulfillCondition(id, 1);
    }

    function test_FulfillCondition_SequentialOrderEnforced() public {
        uint256 id = _depositMulti();
        vm.prank(depositor);
        vm.expectRevert(PreviousMilestoneNotComplete.selector);
        escrow.fulfillCondition(id, 1);

        _fulfill(id, 0);
        vm.prank(depositor);
        vm.expectRevert(PreviousMilestoneNotComplete.selector);
        escrow.fulfillCondition(id, 2);
    }

    function test_FulfillCondition_AfterPreviousReleased() public {
        uint256 id = _depositMulti();
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        _release(id, 0);
        // milestone 0 now RELEASED -> can fulfill milestone 1
        _fulfill(id, 1);
        assertEq(uint256(_getMilestoneState(id, 1)), uint256(MilestoneState.FULFILLED));
    }

    function test_FulfillCondition_AfterPreviousRefunded() public {
        uint256 id = _depositMulti();
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        _resolveAs(arbiter, id, 0, false); // refund
        _fulfill(id, 1);
        assertEq(uint256(_getMilestoneState(id, 1)), uint256(MilestoneState.FULFILLED));
    }

    function test_FulfillCondition_RevertOn_NotActive() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);
        // After mutualCancel the milestone becomes REFUNDED; the milestone
        // current-state guard fires before the escrow-state check.
        vm.prank(depositor);
        vm.expectRevert(InvalidState.selector);
        escrow.fulfillCondition(id, 0);
    }

    function test_FulfillCondition_RevertOn_AlreadyFulfilled() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.prank(depositor);
        vm.expectRevert(InvalidState.selector);
        escrow.fulfillCondition(id, 0);
    }

    // =========================================================================
    // 3. RAISE DISPUTE
    // =========================================================================

    function test_RaiseDispute_HappyPath_ByDepositor() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit DisputeRaised(id, depositor, 0, "reason", keccak256("ev"));
        _raiseDisputeAs(depositor, id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.DISPUTED));
    }

    function test_RaiseDispute_HappyPath_ByRecipient() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(recipient, id, 0);
        (address disputedBy,,,,,,,) = escrow.disputes(id, 0);
        assertEq(disputedBy, recipient);
    }

    function test_RaiseDispute_RevertOn_Stranger() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.prank(stranger);
        vm.expectRevert(NotEscrowOwnerOrRecipient.selector);
        escrow.raiseDispute(id, 0, "r", keccak256("ev"), "ipfs://ev");
    }

    function test_RaiseDispute_RevertOn_NotFulfilled() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(depositor);
        vm.expectRevert(InvalidState.selector);
        escrow.raiseDispute(id, 0, "r", keccak256("ev"), "ipfs://ev");
    }

    function test_RaiseDispute_RevertOn_AfterReleased() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        _release(id, 0);
        vm.prank(depositor);
        vm.expectRevert(InvalidState.selector);
        escrow.raiseDispute(id, 0, "r", keccak256("ev"), "ipfs://ev");
    }

    function test_RaiseDispute_RevertOn_WindowExpired() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.prank(depositor);
        vm.expectRevert(DisputeWindowExpired.selector);
        escrow.raiseDispute(id, 0, "r", keccak256("ev"), "ipfs://ev");
    }

    function test_RaiseDispute_AtExactWindowBoundary_Allowed() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        // strictly greater required to revert; equal is allowed
        vm.warp(block.timestamp + DISPUTE_WINDOW);
        _raiseDisputeAs(depositor, id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.DISPUTED));
    }

    function test_RaiseDispute_RevertOn_NoEvidenceHash() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.prank(depositor);
        vm.expectRevert(NoEvidence.selector);
        escrow.raiseDispute(id, 0, "r", bytes32(0), "ipfs://ev");
    }

    function test_RaiseDispute_RevertOn_NoEvidenceURI() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.prank(depositor);
        vm.expectRevert(NoEvidenceURI.selector);
        escrow.raiseDispute(id, 0, "r", keccak256("ev"), "");
    }

    function test_RaiseDispute_RevertOn_NoReason() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.prank(depositor);
        vm.expectRevert(NoDisputeReason.selector);
        escrow.raiseDispute(id, 0, "", keccak256("ev"), "ipfs://ev");
    }

    function test_RaiseDispute_PerMilestone_Independent() public {
        uint256 id = _depositMulti();
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        // milestone 1 still PENDING -> raising dispute reverts
        vm.prank(depositor);
        vm.expectRevert(InvalidState.selector);
        escrow.raiseDispute(id, 1, "r", keccak256("ev"), "ipfs://ev");
    }

    // =========================================================================
    // 4. SUBMIT COUNTER EVIDENCE
    // =========================================================================

    function test_SubmitCounterEvidence_HappyPath() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit CounterEvidenceSubmitted(id, recipient, 0, keccak256("counter"));
        vm.prank(recipient);
        escrow.submitCounterEvidence(id, 0, keccak256("counter"), "ipfs://counter");

        (,,,, bytes32 cHash, string memory cURI,,) = escrow.disputes(id, 0);
        assertEq(cHash, keccak256("counter"));
        assertEq(cURI, "ipfs://counter");
    }

    function test_SubmitCounterEvidence_RevertOn_RespondingToOwn() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        vm.prank(depositor);
        vm.expectRevert(CannotRespondToOwnDispute.selector);
        escrow.submitCounterEvidence(id, 0, keccak256("counter"), "ipfs://counter");
    }

    function test_SubmitCounterEvidence_RevertOn_NotDisputed() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.prank(recipient);
        vm.expectRevert(InvalidState.selector);
        escrow.submitCounterEvidence(id, 0, keccak256("counter"), "ipfs://counter");
    }

    function test_SubmitCounterEvidence_RevertOn_Stranger() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        vm.prank(stranger);
        vm.expectRevert(NotEscrowOwnerOrRecipient.selector);
        escrow.submitCounterEvidence(id, 0, keccak256("counter"), "ipfs://counter");
    }

    function test_SubmitCounterEvidence_RevertOn_Twice() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        vm.prank(recipient);
        escrow.submitCounterEvidence(id, 0, keccak256("counter"), "ipfs://counter");
        vm.prank(recipient);
        vm.expectRevert(CounterEvidenceAlreadySubmitted.selector);
        escrow.submitCounterEvidence(id, 0, keccak256("counter2"), "ipfs://counter2");
    }

    function test_SubmitCounterEvidence_RevertOn_NoEvidenceHash() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        vm.prank(recipient);
        vm.expectRevert(NoEvidence.selector);
        escrow.submitCounterEvidence(id, 0, bytes32(0), "ipfs://counter");
    }

    function test_SubmitCounterEvidence_RevertOn_NoEvidenceURI() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        vm.prank(recipient);
        vm.expectRevert(NoEvidenceURI.selector);
        escrow.submitCounterEvidence(id, 0, keccak256("counter"), "");
    }

    // =========================================================================
    // 5. RELEASE AFTER WINDOW
    // =========================================================================

    function test_ReleaseAfterWindow_HappyPath() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit EscrowReleasedWithoutDispute(id, 0);
        _release(id, 0);

        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));

        // CCTP burn was invoked with milestone amount. The helper passes
        // CCTP_FORWARD_FEE so the cross-chain floor is cleared; the burn
        // records that value as the maxFee.
        assertEq(tokenMessenger.callsLength(), 1);
        MockTokenMessengerCall memory c = _lastCall();
        assertEq(c.caller, address(escrow));
        assertEq(c.amount, 100e6);
        assertEq(uint256(c.destinationDomain), uint256(DEST_DOMAIN));
        assertEq(c.mintRecipient, MINT_RECIPIENT);
        assertEq(c.burnToken, address(usdc));
        assertEq(c.maxFee, CCTP_FORWARD_FEE);
        assertEq(uint256(c.minFinalityThreshold), 2000);
        assertTrue(c.withHook, "release should use depositForBurnWithHook");
        // Hook data is the 32-byte ASCII tag "cctp-forward".
        bytes32 hookTag;
        bytes memory hookData = c.hookData;
        assembly {
            hookTag := mload(add(hookData, 32))
        }
        assertEq(hookTag, bytes32(0x636374702d666f72776172640000000000000000000000000000000000000000));

        // tokens burned from escrow
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(address(tokenMessenger)), 100e6);
    }

    function test_ReleaseAfterWindow_RevertOn_BeforeWindow() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        // boundary: at exactly conditionMet + window, should still revert (strict <)
        vm.warp(_getMilestoneTimestamp(id, 0) + DISPUTE_WINDOW - 1);
        vm.expectRevert(DisputeWindowNotExpired.selector);
        escrow.releaseAfterWindow(id, 0, 0);
    }

    function test_ReleaseAfterWindow_AtExactWindowBoundary_Allowed() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(_getMilestoneTimestamp(id, 0) + DISPUTE_WINDOW);
        _release(id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
    }

    function test_ReleaseAfterWindow_RevertOn_NotFulfilled() public {
        uint256 id = _depositSingle(100e6);
        vm.expectRevert(InvalidState.selector);
        escrow.releaseAfterWindow(id, 0, 0);
    }

    function test_ReleaseAfterWindow_RevertOn_AlreadyReleased() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        _release(id, 0);
        vm.expectRevert(InvalidState.selector);
        escrow.releaseAfterWindow(id, 0, 0);
    }

    function test_ReleaseAfterWindow_RevertOn_DisputedState() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.expectRevert(InvalidState.selector);
        escrow.releaseAfterWindow(id, 0, 0);
    }

    function test_ReleaseAfterWindow_AnyoneCanCall() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.prank(stranger);
        escrow.releaseAfterWindow(id, 0, CCTP_FORWARD_FEE);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
    }

    function test_ReleaseAfterWindow_WorksWhenPaused() public {
        // releaseAfterWindow is intentionally not pausable: settlement of an
        // already-fulfilled milestone after the dispute window must not be
        // blockable by the pauser.
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.prank(pauser);
        escrow.pause();
        escrow.releaseAfterWindow(id, 0, CCTP_FORWARD_FEE);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
        assertEq(usdc.balanceOf(address(tokenMessenger)), 100e6);
    }

    function test_ReleaseAfterWindow_RevertOn_NonexistentEscrow() public {
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.releaseAfterWindow(999, 0, 0);
    }

    function test_ReleaseAfterWindow_DoesNotComplete_WithMoreMilestones() public {
        uint256 id = _depositMulti();
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        _release(id, 0);
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.ACTIVE));
    }

    function test_ReleaseAfterWindow_AllMilestones_CompletesEscrow() public {
        uint256 id = _depositMulti();
        for (uint256 i = 0; i < 3; i++) {
            _fulfill(id, i);
            // Use the milestone's recorded fulfillment timestamp; expressions like
            // `block.timestamp + ...` re-evaluate per loop iteration but the prior
            // warp can leave the value unchanged in some traces.
            uint256 t = _getMilestoneTimestamp(id, i);
            vm.warp(t + DISPUTE_WINDOW + 1);
            _release(id, i);
        }
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));

        // Account for the protocol fee: the test base disables it (setProtocolFee(0))
        // so the full milestone amount reaches the TokenMessenger and nothing
        // is withheld. Compute expected values from the live fee bps so this
        // assertion stays correct if the base is later changed to leave the fee on.
        uint256 feeBps = escrow.protocolFeeBps();
        uint256 totalFee = (100e6 * feeBps) / 10_000 + (200e6 * feeBps) / 10_000 + (300e6 * feeBps) / 10_000;
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(address(tokenMessenger)), 600e6 - totalFee);
        assertEq(usdc.balanceOf(escrow.protocolTreasury()), totalFee);
    }

    // =========================================================================
    // 6. RESOLVE DISPUTE
    // =========================================================================

    function test_ResolveDispute_ReleaseToRecipient() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit EscrowReleased(id, 0, keccak256("res"));
        _resolveAs(arbiter, id, 0, true);

        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));
        assertEq(usdc.balanceOf(address(tokenMessenger)), 100e6);
        (,,,,,, bytes32 resolutionHash,) = escrow.disputes(id, 0);
        assertEq(resolutionHash, keccak256("res"));
    }

    function test_ResolveDispute_RefundToRefundTo() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit EscrowRefunded(id, 0, keccak256("res"));
        _resolveAs(arbiter, id, 0, false);

        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.REFUNDED));
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));
        assertEq(escrow.refundBalances(refundTo), 100e6);
        // Funds remain inside escrow contract until refund withdrawn
        assertEq(usdc.balanceOf(address(escrow)), 100e6);
    }

    function test_ResolveDispute_RevertOn_NotArbiter() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);

        bytes memory expected = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, escrow.ARBITER_ROLE()
        );
        vm.prank(stranger);
        vm.expectRevert(expected);
        escrow.resolveDispute(id, 0, true, keccak256("res"), 0);
    }

    function test_ResolveDispute_RevertOn_NotDisputed() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.prank(arbiter);
        vm.expectRevert(NoDispute.selector);
        escrow.resolveDispute(id, 0, true, keccak256("res"), 0);
    }

    function test_ResolveDispute_RevertOn_NoResolutionHash() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        vm.prank(arbiter);
        vm.expectRevert(NoResolution.selector);
        escrow.resolveDispute(id, 0, true, bytes32(0), 0);
    }

    function test_ResolveDispute_RevertOn_NonexistentEscrow() public {
        vm.prank(arbiter);
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.resolveDispute(999, 0, true, keccak256("res"), 0);
    }

    function test_ResolveDispute_PartialEscrow_DoesNotComplete() public {
        uint256 id = _depositMulti();
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        _resolveAs(arbiter, id, 0, false);
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.ACTIVE));
    }

    function test_ResolveDispute_MixedReleaseRefund_Completes() public {
        uint256 id = _depositMulti();
        // milestone 0: release via dispute
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        _resolveAs(arbiter, id, 0, true);
        // milestone 1: refund via dispute
        _fulfill(id, 1);
        _raiseDisputeAs(recipient, id, 1);
        _resolveAs(arbiter, id, 1, false);
        // milestone 2: release after window
        _fulfill(id, 2);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        _release(id, 2);

        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));
        assertEq(escrow.refundBalances(refundTo), 200e6);
        assertEq(usdc.balanceOf(address(tokenMessenger)), 100e6 + 300e6);
    }

    // =========================================================================
    // 7. MUTUAL CANCEL
    // =========================================================================

    function test_MutualCancel_HappyPath_NoFulfilled() public {
        uint256 id = _depositMulti();
        vm.prank(depositor);
        escrow.mutualCancel(id);
        // not yet completed; recipient hasn't approved
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.ACTIVE));

        vm.expectEmit(true, false, false, true, address(escrow));
        emit EscrowRefundedViaMutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.CANCELLED));
        assertEq(escrow.refundBalances(refundTo), 600e6);
        for (uint256 i = 0; i < 3; i++) {
            assertEq(uint256(_getMilestoneState(id, i)), uint256(MilestoneState.REFUNDED));
        }
    }

    function test_MutualCancel_RefundsOnlyUnreleased() public {
        uint256 id = _depositMulti();
        // release milestone 0
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        _release(id, 0);
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);
        // refund balance covers remaining 200 + 300
        assertEq(escrow.refundBalances(refundTo), 500e6);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
        assertEq(uint256(_getMilestoneState(id, 1)), uint256(MilestoneState.REFUNDED));
        assertEq(uint256(_getMilestoneState(id, 2)), uint256(MilestoneState.REFUNDED));
    }

    function test_MutualCancel_RevertOn_DuringDispute() public {
        uint256 id = _depositMulti();
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        vm.expectRevert(CannotCancelDuringDispute.selector);
        escrow.mutualCancel(id);
    }

    function test_MutualCancel_RevertOn_Stranger() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(stranger);
        vm.expectRevert(NotEscrowOwnerOrRecipient.selector);
        escrow.mutualCancel(id);
    }

    function test_MutualCancel_RevertOn_NotActive() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);
        // already cancelled
        vm.prank(depositor);
        vm.expectRevert(NoDeposit.selector);
        escrow.mutualCancel(id);
    }

    function test_MutualCancel_RevertOn_NonexistentEscrow() public {
        vm.prank(depositor);
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.mutualCancel(42);
    }

    function test_MutualCancel_DepositorTwice_NoDoubleApprove() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(depositor);
        escrow.mutualCancel(id);
        // still active because recipient hasn't approved
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.ACTIVE));
    }

    function test_MutualCancel_RefundsFulfilledMilestone() public {
        // Even FULFILLED milestone within dispute window can be refunded by mutual agreement
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.REFUNDED));
        assertEq(escrow.refundBalances(refundTo), 100e6);
    }

    // =========================================================================
    // WITHDRAW REFUND
    // =========================================================================

    function test_WithdrawRefund_HappyPath() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        _resolveAs(arbiter, id, 0, false);
        assertEq(escrow.refundBalances(refundTo), 100e6);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit RefundWithdrawn(refundTo, 100e6);
        vm.prank(refundTo);
        escrow.withdrawRefund(refundTo);
        assertEq(usdc.balanceOf(refundTo), 100e6);
        assertEq(escrow.refundBalances(refundTo), 0);
    }

    function test_WithdrawRefund_RevertOn_Nothing() public {
        vm.prank(refundTo);
        vm.expectRevert(NothingToWithdraw.selector);
        escrow.withdrawRefund(refundTo);
    }

    function test_WithdrawRefund_AfterMutualCancel() public {
        uint256 id = _depositMulti();
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);

        vm.prank(refundTo);
        escrow.withdrawRefund(refundTo);
        assertEq(usdc.balanceOf(refundTo), 600e6);
    }

    function test_WithdrawRefund_AccumulatesAcrossEscrows() public {
        uint256 a = _depositSingle(100e6);
        uint256 b = _depositSingle(50e6);
        _fulfill(a, 0);
        _fulfill(b, 0);
        _raiseDisputeAs(depositor, a, 0);
        _raiseDisputeAs(depositor, b, 0);
        _resolveAs(arbiter, a, 0, false);
        _resolveAs(arbiter, b, 0, false);
        assertEq(escrow.refundBalances(refundTo), 150e6);
        vm.prank(refundTo);
        escrow.withdrawRefund(refundTo);
        assertEq(usdc.balanceOf(refundTo), 150e6);
    }

    // =========================================================================
    // PAUSE / UNPAUSE
    // =========================================================================

    function test_Pause_OnlyPauserRole() public {
        bytes memory expected = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, escrow.PAUSER_ROLE()
        );
        vm.prank(stranger);
        vm.expectRevert(expected);
        escrow.pause();
    }

    function test_Unpause_Works() public {
        vm.prank(pauser);
        escrow.pause();
        vm.prank(pauser);
        escrow.unpause();
        // deposit works again
        _depositSingle(50e6);
    }

    function test_Unpause_OnlyPauserRole() public {
        vm.prank(pauser);
        escrow.pause();
        bytes memory expected = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, escrow.PAUSER_ROLE()
        );
        vm.prank(stranger);
        vm.expectRevert(expected);
        escrow.unpause();
    }

    function test_DefaultAdminIsDeployer() public view {
        assertTrue(escrow.hasRole(escrow.DEFAULT_ADMIN_ROLE(), deployer));
        assertTrue(escrow.hasRole(escrow.ARBITER_ROLE(), arbiter));
        assertTrue(escrow.hasRole(escrow.PAUSER_ROLE(), pauser));
    }

    // =========================================================================
    // 8. EDGE CASES
    // =========================================================================

    function test_Edge_FulfillCondition_OutOfRangeIndex() public {
        uint256 id = _depositMulti();
        vm.prank(depositor);
        vm.expectRevert(InvalidMilestoneIndex.selector);
        escrow.fulfillCondition(id, 10);
    }

    function test_Edge_RaiseDispute_OnNonexistentEscrow() public {
        vm.prank(depositor);
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.raiseDispute(123, 0, "r", keccak256("ev"), "ipfs://ev");
    }

    function test_Edge_SubmitCounterEvidence_OnNonexistentEscrow() public {
        vm.prank(recipient);
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.submitCounterEvidence(123, 0, keccak256("counter"), "ipfs://counter");
    }

    function test_Edge_DepositAtExactlyOneHourDisputeWindow() public {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            1 hours,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 1 days,
            new SplitRecipient[](0)
        );
        vm.stopPrank();
    }

    function test_Edge_DepositorEqualsRecipient_AllowedByContract() public {
        // Contract does not forbid depositor == recipient. Document current behaviour.
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        escrow.deposit(
            depositor,
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

    // ---------- helpers ----------
    struct MockTokenMessengerCall {
        address caller;
        uint256 amount;
        uint32 destinationDomain;
        bytes32 mintRecipient;
        address burnToken;
        bytes32 destinationCaller;
        uint256 maxFee;
        uint32 minFinalityThreshold;
        bool withHook;
        bytes hookData;
    }

    function _lastCall() internal view returns (MockTokenMessengerCall memory c) {
        (
            c.caller,
            c.amount,
            c.destinationDomain,
            c.mintRecipient,
            c.burnToken,
            c.destinationCaller,
            c.maxFee,
            c.minFinalityThreshold,
            c.withHook,
            c.hookData
        ) = tokenMessenger.calls(tokenMessenger.callsLength() - 1);
    }
}
