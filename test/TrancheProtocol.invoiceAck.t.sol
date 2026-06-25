// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";

/// @notice Coverage for invoice acknowledgement: acknowledgeInvoice's own
///         guards, the claimDelivery gate it unlocks, and the NoInvoiceURI
///         validation on deposit/updateInvoiceURI.
contract TrancheProtocolInvoiceAckTest is Base {
    /// @dev Mirrors _depositCustom but stops before the acknowledge step, so
    ///      callers can control acknowledgement timing themselves.
    function _depositUnacknowledged(uint256 amount) internal returns (uint256 escrowId) {
        SplitRecipient[] memory noSplits = new SplitRecipient[](0);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        escrowId = escrow.deposit(
            recipient,
            refundTo,
            amount,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(amount),
            block.timestamp + 30 days,
            noSplits,
            ""
        );
        vm.stopPrank();
    }

    // ----------------------------------------------------------------------
    // acknowledgeInvoice
    // ----------------------------------------------------------------------

    function test_AcknowledgeInvoice_WritesTimestamp() public {
        uint256 id = _depositUnacknowledged(1000e6);
        assertEq(escrow.getEscrow(id).invoiceAcknowledgedAt, 0);

        vm.prank(recipient);
        escrow.acknowledgeInvoice(id);

        assertEq(escrow.getEscrow(id).invoiceAcknowledgedAt, block.timestamp);
    }

    function test_AcknowledgeInvoice_RevertOn_DoubleAck() public {
        uint256 id = _depositUnacknowledged(1000e6);
        vm.prank(recipient);
        escrow.acknowledgeInvoice(id);

        vm.prank(recipient);
        vm.expectRevert(InvoiceAlreadyAcknowledged.selector);
        escrow.acknowledgeInvoice(id);
    }

    function test_AcknowledgeInvoice_RevertOn_NonRecipient() public {
        uint256 id = _depositUnacknowledged(1000e6);
        vm.prank(depositor);
        vm.expectRevert(NotRecipient.selector);
        escrow.acknowledgeInvoice(id);
    }

    function test_AcknowledgeInvoice_RevertOn_NonexistentEscrow() public {
        vm.prank(recipient);
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.acknowledgeInvoice(99999);
    }

    // ----------------------------------------------------------------------
    // claimDelivery gating on acknowledgement
    // ----------------------------------------------------------------------

    function test_ClaimDelivery_RevertOn_NotAcknowledged() public {
        uint256 id = _depositUnacknowledged(1000e6);
        vm.prank(recipient);
        vm.expectRevert(InvoiceNotAcknowledged.selector);
        escrow.claimDelivery(id, 0);
    }

    function test_ClaimDelivery_Succeeds_AfterAcknowledge() public {
        uint256 id = _depositUnacknowledged(1000e6);
        vm.prank(recipient);
        escrow.acknowledgeInvoice(id);

        vm.prank(recipient);
        escrow.claimDelivery(id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.IN_REVIEW));
    }

    // ----------------------------------------------------------------------
    // Invoice URI validation
    // ----------------------------------------------------------------------

    function test_Deposit_RevertOn_EmptyInvoiceURI() public {
        uint256 amount = 1000e6;
        SplitRecipient[] memory noSplits = new SplitRecipient[](0);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        vm.expectRevert(NoInvoiceURI.selector);
        escrow.deposit(
            recipient,
            refundTo,
            amount,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            "",
            _singleMilestone(amount),
            block.timestamp + 30 days,
            noSplits,
            ""
        );
        vm.stopPrank();
    }

    function test_UpdateInvoiceURI_RevertOn_EmptyURI() public {
        // Use an un-acknowledged escrow so the empty-URI check is reached; on an
        // acknowledged escrow the InvoiceLocked freeze would short-circuit first.
        uint256 id = _depositUnacknowledged(1000e6);
        vm.prank(depositor);
        vm.expectRevert(NoInvoiceURI.selector);
        escrow.updateInvoiceURI(id, "");
    }

    function test_UpdateInvoiceURI_RevertOn_PostAck() public {
        // SE-1 core proof: once the recipient acknowledges, the depositor can no
        // longer mutate the invoice URI (no bait-and-switch).
        uint256 id = _depositUnacknowledged(1000e6);
        vm.prank(recipient);
        escrow.acknowledgeInvoice(id);

        vm.prank(depositor);
        vm.expectRevert(InvoiceLocked.selector);
        escrow.updateInvoiceURI(id, "ipfs://new");
    }

    function test_UpdateInvoiceURI_Succeeds_PreAck() public {
        // The freeze only restricts post-ack updates; before ack the depositor
        // may still correct the URI.
        uint256 id = _depositUnacknowledged(1000e6);

        vm.expectEmit(true, false, false, true);
        emit InvoiceURIUpdated(id, INVOICE_URI, "ipfs://updated");

        vm.prank(depositor);
        escrow.updateInvoiceURI(id, "ipfs://updated");

        assertEq(escrow.getEscrow(id).invoiceURI, "ipfs://updated");
    }
}
