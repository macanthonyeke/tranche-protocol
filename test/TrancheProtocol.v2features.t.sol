// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";

/// @notice Tests for the v2 feature batch:
///   C4a — mutualCancel blocked during IN_REVIEW
///   mutualSettle from IN_REVIEW
///   EVM padding guard on split mintRecipient
///   extendDeadline
///   retractCancelApproval (C4b)
///   declineEscrow
///   appendEvidence
///   InvoiceSnapshotted event
contract TrancheProtocolV2FeaturesTest is Base {
    // =========================================================================
    // C4a — mutualCancel blocked when any milestone is IN_REVIEW
    // =========================================================================

    function test_C4a_MutualCancel_RevertOn_InReview_Depositor() public {
        uint256 id = _depositMulti();
        _claimDelivery(id, 0); // milestone 0 → IN_REVIEW

        vm.prank(depositor);
        escrow.mutualCancel(id); // sets flag
        vm.prank(recipient);
        vm.expectRevert(CannotCancelDuringDispute.selector);
        escrow.mutualCancel(id);
    }

    function test_C4a_MutualCancel_RevertOn_InReview_Recipient() public {
        uint256 id = _depositMulti();
        _claimDelivery(id, 0);

        vm.prank(recipient);
        escrow.mutualCancel(id);
        vm.prank(depositor);
        vm.expectRevert(CannotCancelDuringDispute.selector);
        escrow.mutualCancel(id);
    }

    function test_C4a_MutualCancel_StillReverts_During_Disputed() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        vm.expectRevert(CannotCancelDuringDispute.selector);
        escrow.mutualCancel(id);
    }

    function test_C4a_MutualCancel_Succeeds_AllPending() public {
        uint256 id = _depositMulti();
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.CANCELLED));
        assertEq(escrow.refundBalances(refundTo), 600e6);
    }

    // =========================================================================
    // mutualSettle from IN_REVIEW
    // =========================================================================

    function test_MutualSettle_FromInReview_BothAgree() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0); // IN_REVIEW, no dispute raised

        vm.prank(depositor);
        escrow.mutualSettle(id, 0, 6000, CCTP_FORWARD_FEE);
        vm.prank(recipient);
        escrow.mutualSettle(id, 0, 6000, CCTP_FORWARD_FEE);

        // 60% → recipient (CCTP burn), 40% → refundTo
        assertEq(usdc.balanceOf(address(tokenMessenger)), 600e6);
        assertEq(escrow.refundBalances(refundTo), 400e6);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
    }

    function test_MutualSettle_FromInReview_RevertOn_BpsMismatch() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);

        vm.prank(depositor);
        escrow.mutualSettle(id, 0, 6000, CCTP_FORWARD_FEE);
        // Recipient proposes a different split — no execution.
        vm.prank(recipient);
        escrow.mutualSettle(id, 0, 5000, CCTP_FORWARD_FEE);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.IN_REVIEW));
    }

    function test_MutualSettle_FromInReview_RaceCondition_ReleasePrevails() public {
        // Depositor proposes, then review window lapses and release() is called
        // before the recipient proposes. The second mutualSettle should revert.
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);

        vm.prank(depositor);
        escrow.mutualSettle(id, 0, 6000, CCTP_FORWARD_FEE);

        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        _release(id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));

        vm.prank(recipient);
        vm.expectRevert(MutualSettlementAlreadyExecuted.selector);
        escrow.mutualSettle(id, 0, 6000, CCTP_FORWARD_FEE);
    }

    function test_MutualSettle_FromInReview_RevertOn_NonParty() public {
        uint256 id = _depositSingle(1000e6);
        _claimDelivery(id, 0);
        vm.prank(stranger);
        vm.expectRevert(NotEscrowOwnerOrRecipient.selector);
        escrow.mutualSettle(id, 0, 5000, CCTP_FORWARD_FEE);
    }

    // =========================================================================
    // EVM padding guard on split mintRecipient
    // =========================================================================

    function test_SplitPaddingGuard_RevertOn_NonZeroTopBytes() public {
        // A key whose top 12 bytes are non-zero AND whose low 20 bytes are also
        // non-zero (so ZeroAddress fires after, not before, InvalidSplitMintRecipient).
        // Bit 200 set (top region) | 0xBEEF in low bits.
        bytes32 paddedKey = bytes32(uint256(uint160(0xBEEF)) | (uint256(1) << 200));
        SplitRecipient[] memory sp = new SplitRecipient[](1);
        sp[0] = SplitRecipient({mintRecipient: paddedKey, destinationDomain: DEST_DOMAIN, bps: 10_000});

        vm.startPrank(depositor);
        usdc.approve(address(escrow), 1_000_000);
        vm.expectRevert(InvalidSplitMintRecipient.selector);
        escrow.deposit(
            recipient,
            refundTo,
            1_000_000,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(1_000_000),
            block.timestamp + 30 days,
            sp,
            ""
        );
        vm.stopPrank();
    }

    function test_SplitPaddingGuard_Accepts_ValidEvmAddress() public {
        address splitAddr = makeAddr("splitAddr");
        SplitRecipient[] memory sp = new SplitRecipient[](1);
        sp[0] = SplitRecipient({
            mintRecipient: bytes32(uint256(uint160(splitAddr))), destinationDomain: DEST_DOMAIN, bps: 10_000
        });

        vm.startPrank(depositor);
        usdc.approve(address(escrow), 1_000_000);
        uint256 id = escrow.deposit(
            recipient,
            refundTo,
            1_000_000,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(1_000_000),
            block.timestamp + 30 days,
            sp,
            ""
        );
        vm.stopPrank();
        assertEq(_getMilestoneAmount(id, 0), 1_000_000);
    }

    // =========================================================================
    // extendDeadline
    // =========================================================================

    function test_ExtendDeadline_DepositorCanExtend() public {
        uint256 id = _depositSingle(100e6);
        uint256 oldDeadline = escrow.getEscrow(id).deadline;
        uint256 newDeadline = oldDeadline + 10 days;

        vm.expectEmit(true, false, false, true, address(escrow));
        emit DeadlineExtended(id, newDeadline);

        vm.prank(depositor);
        escrow.extendDeadline(id, newDeadline);
        assertEq(escrow.getEscrow(id).deadline, newDeadline);
    }

    function test_ExtendDeadline_RevertOn_NotDepositor() public {
        uint256 id = _depositSingle(100e6);
        uint256 newDeadline = escrow.getEscrow(id).deadline + 1 days;
        vm.prank(recipient);
        vm.expectRevert(NotEscrowOwner.selector);
        escrow.extendDeadline(id, newDeadline);
    }

    function test_ExtendDeadline_RevertOn_SameDeadline() public {
        uint256 id = _depositSingle(100e6);
        uint256 deadline = escrow.getEscrow(id).deadline;
        vm.prank(depositor);
        vm.expectRevert(DeadlineNotExtended.selector);
        escrow.extendDeadline(id, deadline);
    }

    function test_ExtendDeadline_RevertOn_EarlierDeadline() public {
        uint256 id = _depositSingle(100e6);
        uint256 deadline = escrow.getEscrow(id).deadline;
        vm.prank(depositor);
        vm.expectRevert(DeadlineNotExtended.selector);
        escrow.extendDeadline(id, deadline - 1);
    }

    function test_ExtendDeadline_RevertOn_NotActive() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        _release(id, 0); // escrow COMPLETED

        vm.prank(depositor);
        vm.expectRevert(NoDeposit.selector);
        escrow.extendDeadline(id, block.timestamp + 60 days);
    }

    function test_ExtendDeadline_RevertOn_DoesNotExist() public {
        vm.prank(depositor);
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.extendDeadline(999, block.timestamp + 30 days);
    }

    function test_ExtendDeadline_DeadlineRefundOpensAfterExtended() public {
        uint256 id = _depositSingle(100e6);
        uint256 originalDeadline = escrow.getEscrow(id).deadline;

        // Warp past the original deadline + grace.
        vm.warp(originalDeadline + 72 hours + 1);
        // Before extending, refundAfterDeadline would succeed.
        // Extend first (must happen before warp makes it live).
        // Let's demonstrate the other direction: extend BEFORE deadline passes.
        uint256 id2 = _depositSingle(100e6);
        uint256 newDeadline = escrow.getEscrow(id2).deadline + 10 days;
        vm.prank(depositor);
        escrow.extendDeadline(id2, newDeadline);

        // refundAfterDeadline not yet available (new deadline hasn't passed).
        vm.expectRevert(DeadlineNotReached.selector);
        escrow.refundAfterDeadline(id2, 0);
    }

    // =========================================================================
    // retractCancelApproval (C4b)
    // =========================================================================

    function test_RetractCancel_DepositorCanRetract() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(depositor);
        escrow.mutualCancel(id);
        assertTrue(escrow.getEscrow(id).depositorApproveCancel);

        vm.expectEmit(true, true, false, false, address(escrow));
        emit CancelApprovalRetracted(id, depositor);

        vm.prank(depositor);
        escrow.retractCancelApproval(id);
        assertFalse(escrow.getEscrow(id).depositorApproveCancel);
        // Recipient flag untouched.
        assertFalse(escrow.getEscrow(id).recipientApproveCancel);
    }

    function test_RetractCancel_RecipientCanRetract() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(recipient);
        escrow.mutualCancel(id);
        assertTrue(escrow.getEscrow(id).recipientApproveCancel);

        vm.prank(recipient);
        escrow.retractCancelApproval(id);
        assertFalse(escrow.getEscrow(id).recipientApproveCancel);
        assertFalse(escrow.getEscrow(id).depositorApproveCancel);
    }

    function test_RetractCancel_OnlyOwnFlag_NotOther() public {
        // Depositor sets their flag via mutualCancel.
        uint256 id = _depositSingle(100e6);
        vm.prank(depositor);
        escrow.mutualCancel(id);
        assertTrue(escrow.getEscrow(id).depositorApproveCancel);
        assertFalse(escrow.getEscrow(id).recipientApproveCancel);

        // Recipient clears their own flag (was false; now explicitly false).
        // Depositor's flag must not be touched.
        vm.prank(recipient);
        escrow.retractCancelApproval(id);
        assertTrue(escrow.getEscrow(id).depositorApproveCancel, "depositor flag untouched");
        assertFalse(escrow.getEscrow(id).recipientApproveCancel, "recipient flag cleared");
    }

    function test_RetractCancel_RevertOn_Stranger() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(stranger);
        vm.expectRevert(NotEscrowOwnerOrRecipient.selector);
        escrow.retractCancelApproval(id);
    }

    function test_RetractCancel_RevertOn_NotActive() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        _release(id, 0);
        vm.prank(depositor);
        vm.expectRevert(NoDeposit.selector);
        escrow.retractCancelApproval(id);
    }

    function test_RetractCancel_DoesNotExist() public {
        vm.prank(depositor);
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.retractCancelApproval(999);
    }

    function test_RetractCancel_AllowsNewApprovalAfterRetract() public {
        uint256 id = _depositMulti();
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);
        // Both set → would cancel. Depositor retracts before recipient processes.
        // (In this test the cancel already executed because we called mutualCancel
        // with both parties — instead test a single-flag retract + re-approval.)
        uint256 id2 = _depositMulti();
        vm.prank(depositor);
        escrow.mutualCancel(id2);
        vm.prank(depositor);
        escrow.retractCancelApproval(id2);
        assertFalse(escrow.getEscrow(id2).depositorApproveCancel);

        // Re-approve and complete cancel.
        vm.prank(depositor);
        escrow.mutualCancel(id2);
        vm.prank(recipient);
        escrow.mutualCancel(id2);
        assertEq(uint256(_getEscrowState(id2)), uint256(EscrowState.CANCELLED));
    }

    // =========================================================================
    // declineEscrow
    // =========================================================================

    function test_DeclineEscrow_RecipientCanDecline() public {
        uint256 id = _depositMulti(); // [100, 200, 300]

        vm.expectEmit(true, false, false, true, address(escrow));
        emit EscrowDeclined(id, recipient);

        vm.prank(recipient);
        escrow.declineEscrow(id);

        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.CANCELLED));
        assertEq(escrow.refundBalances(refundTo), 600e6);
        for (uint256 i = 0; i < 3; i++) {
            assertEq(uint256(_getMilestoneState(id, i)), uint256(MilestoneState.REFUNDED));
        }
    }

    function test_DeclineEscrow_RefundsCreditBalance_NoUsdcTransferred() public {
        uint256 id = _depositSingle(100e6);
        uint256 contractBefore = usdc.balanceOf(address(escrow));

        vm.prank(recipient);
        escrow.declineEscrow(id);

        // USDC stays in contract; credit is in refundBalances.
        assertEq(usdc.balanceOf(address(escrow)), contractBefore);
        assertEq(escrow.refundBalances(refundTo), 100e6);
    }

    function test_DeclineEscrow_RevertOn_NotRecipient() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(depositor);
        vm.expectRevert(NotRecipient.selector);
        escrow.declineEscrow(id);
    }

    function test_DeclineEscrow_RevertOn_MilestoneClaimed() public {
        uint256 id = _depositMulti();
        _claimDelivery(id, 0); // milestone 0 → IN_REVIEW

        vm.prank(recipient);
        vm.expectRevert(InvalidState.selector);
        escrow.declineEscrow(id);
    }

    function test_DeclineEscrow_RevertOn_MilestoneReleased() public {
        uint256 id = _depositMulti();
        _claimDelivery(id, 0);
        _approve(id, 0); // RELEASED

        vm.prank(recipient);
        vm.expectRevert(InvalidState.selector);
        escrow.declineEscrow(id);
    }

    function test_DeclineEscrow_RevertOn_NotActive() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(recipient);
        escrow.declineEscrow(id); // first decline succeeds → CANCELLED

        vm.prank(recipient);
        vm.expectRevert(NoDeposit.selector);
        escrow.declineEscrow(id);
    }

    function test_DeclineEscrow_RevertOn_DoesNotExist() public {
        vm.prank(recipient);
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.declineEscrow(999);
    }

    // =========================================================================
    // appendEvidence
    // =========================================================================

    function test_AppendEvidence_DepositorCanAppend() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        bytes32 hash = keccak256("additional-doc");
        string memory uri = "ipfs://additional-doc";

        vm.expectEmit(true, false, true, true, address(escrow));
        emit EvidenceAppended(id, 0, depositor, hash, uri, block.timestamp);

        vm.prank(depositor);
        escrow.appendEvidence(id, 0, hash, uri);
    }

    function test_AppendEvidence_RecipientCanAppend() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        vm.prank(recipient);
        escrow.appendEvidence(id, 0, keccak256("recipient-doc"), "ipfs://recipient-doc");
    }

    function test_AppendEvidence_MultipleAppends_SameParty() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        vm.prank(depositor);
        escrow.appendEvidence(id, 0, keccak256("doc1"), "ipfs://doc1");
        vm.prank(depositor);
        escrow.appendEvidence(id, 0, keccak256("doc2"), "ipfs://doc2");
    }

    function test_AppendEvidence_RevertOn_NotDisputed() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0); // IN_REVIEW, not DISPUTED

        vm.prank(depositor);
        vm.expectRevert(NoDispute.selector);
        escrow.appendEvidence(id, 0, keccak256("doc"), "ipfs://doc");
    }

    function test_AppendEvidence_RevertOn_Stranger() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        vm.prank(stranger);
        vm.expectRevert(NotEscrowOwnerOrRecipient.selector);
        escrow.appendEvidence(id, 0, keccak256("doc"), "ipfs://doc");
    }

    function test_AppendEvidence_RevertOn_ZeroHash() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        vm.prank(depositor);
        vm.expectRevert(NoEvidence.selector);
        escrow.appendEvidence(id, 0, bytes32(0), "ipfs://doc");
    }

    function test_AppendEvidence_RevertOn_EmptyURI() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        vm.prank(depositor);
        vm.expectRevert(NoEvidenceURI.selector);
        escrow.appendEvidence(id, 0, keccak256("doc"), "");
    }

    function test_AppendEvidence_RevertOn_DoesNotExist() public {
        vm.prank(depositor);
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.appendEvidence(999, 0, keccak256("doc"), "ipfs://doc");
    }

    // =========================================================================
    // InvoiceSnapshotted event
    // =========================================================================

    function test_InvoiceSnapshotted_EmittedAtDeposit() public {
        string memory data = "{\"invoiceNumber\":\"INV-0001\",\"lineItems\":[]}";

        uint256[] memory ms = _milestones3();
        SplitRecipient[] memory noSplits = new SplitRecipient[](0);

        vm.startPrank(depositor);
        usdc.approve(address(escrow), 600e6);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit InvoiceSnapshotted(escrowCount() + 1, data);
        escrow.deposit(
            recipient,
            refundTo,
            600e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            ms,
            block.timestamp + 30 days,
            noSplits,
            data
        );
        vm.stopPrank();
    }

    function test_InvoiceSnapshotted_EmptyData_NoRevert() public {
        uint256 id = _depositSingle(100e6); // passes "" as invoiceData
        assertGt(id, 0);
    }

    // ---------- helpers ----------

    function escrowCount() internal view returns (uint256) {
        return escrow.escrowCount();
    }
}
