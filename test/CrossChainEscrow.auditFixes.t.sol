// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {CrossChainEscrow} from "../src/CrossChainEscrow.sol";
import {ICrossChainEscrow} from "../src/interface/ICrossChainEscrow.sol";

/// @notice Regression tests for each audit finding fix.
contract CrossChainEscrowAuditFixesTest is Base {
    // -----------------------------------------------------------------------
    // H-01: constructor must reject address(0) for arbiter and pauser.
    // -----------------------------------------------------------------------

    function test_H01_Constructor_RevertOn_ZeroArbiter() public {
        vm.expectRevert(ZeroAddress.selector);
        new CrossChainEscrow(
            address(usdc), address(0), pauser, domainManager, address(tokenMessenger), protocolTreasury
        );
    }

    function test_H01_Constructor_RevertOn_ZeroPauser() public {
        vm.expectRevert(ZeroAddress.selector);
        new CrossChainEscrow(
            address(usdc), arbiter, address(0), domainManager, address(tokenMessenger), protocolTreasury
        );
    }

    // -----------------------------------------------------------------------
    // H-02: arbiter-inaction timeout refunds the depositor.
    // -----------------------------------------------------------------------

    function test_H02_ResolveDisputeByTimeout_RevertOn_NoDispute() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.expectRevert(NoDispute.selector);
        escrow.resolveDisputeByTimeout(id, 0);
    }

    function test_H02_ResolveDisputeByTimeout_RevertOn_TimeoutNotReached() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        vm.expectRevert(ArbiterTimeoutNotReached.selector);
        escrow.resolveDisputeByTimeout(id, 0);

        // One second before the threshold also reverts.
        vm.warp(block.timestamp + escrow.ARBITER_INACTION_TIMEOUT() - 1);
        vm.expectRevert(ArbiterTimeoutNotReached.selector);
        escrow.resolveDisputeByTimeout(id, 0);
    }

    function test_H02_ResolveDisputeByTimeout_RefundsDepositorAfterTimeout() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);

        vm.warp(block.timestamp + escrow.ARBITER_INACTION_TIMEOUT());
        // Permissionless: a stranger can trigger.
        vm.prank(stranger);
        escrow.resolveDisputeByTimeout(id, 0);

        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.REFUNDED));
        assertEq(escrow.refundBalances(refundTo), 100e6);
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));
    }

    function test_H02_ResolveDisputeByTimeout_RevertOn_NonexistentEscrow() public {
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.resolveDisputeByTimeout(999, 0);
    }

    // -----------------------------------------------------------------------
    // Redirect functions are open across the entire ACTIVE lifecycle
    // (including DISPUTED milestones). Only COMPLETED / CANCELLED escrows
    // are blocked — funds are already gone or the escrow is dead.
    // -----------------------------------------------------------------------

    function test_UpdateMintRecipient_AllowedDuringDisputedMilestone() public {
        uint256 id = _depositMulti();
        _fulfill(id, 0);
        _raiseDisputeAs(recipient, id, 0);

        bytes32 newAddr = bytes32(uint256(uint160(makeAddr("freshWallet"))));
        vm.prank(recipient);
        escrow.updateMintRecipient(id, newAddr, DEST_DOMAIN);

        (,,,,, bytes32 mr,,,,,,,,,) = escrow.escrows(id);
        assertEq(mr, newAddr, "redirect must apply even while a milestone is DISPUTED");
    }

    function test_UpdateReceivingAddress_AllowedDuringDisputedMilestone() public {
        uint256 id = _depositMulti();
        _fulfill(id, 0);
        _raiseDisputeAs(recipient, id, 0);

        address newAddr = makeAddr("freshWallet");
        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newAddr);

        (,,,, uint32 destAfter, bytes32 mrAfter,,,,,,,,,) = escrow.escrows(id);
        assertEq(destAfter, escrow.ARC_DOMAIN());
        assertEq(mrAfter, bytes32(uint256(uint160(newAddr))));
    }

    function test_UpdateMintRecipient_RevertOn_CancelledEscrow() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);
        // Escrow is now CANCELLED; redirects must revert.
        vm.prank(recipient);
        vm.expectRevert(InvalidState.selector);
        escrow.updateMintRecipient(id, bytes32(uint256(uint160(makeAddr("x")))), DEST_DOMAIN);
    }

    // -----------------------------------------------------------------------
    // H-04: maxFee >= burnAmount must revert (single-recipient path).
    // -----------------------------------------------------------------------

    function test_H04_ReleaseAfterWindow_RevertOn_MaxFeeEqualsBurnAmount() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.expectRevert(MaxFeeExceedsBurnAmount.selector);
        // burnAmount = 100e6 because protocol fee is 0 in test base.
        escrow.releaseAfterWindow(id, 0, 100e6);
    }

    function test_H04_ReleaseAfterWindow_RevertOn_MaxFeeGreaterThanBurnAmount() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.expectRevert(MaxFeeExceedsBurnAmount.selector);
        escrow.releaseAfterWindow(id, 0, 100e6 + 1);
    }

    function test_H04_ReleaseAfterWindow_MaxFeeJustBelowBurnAmount_Succeeds() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        // 99e6 < 100e6 -> permitted.
        escrow.releaseAfterWindow(id, 0, 99e6);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
    }

    // -----------------------------------------------------------------------
    // H-05: snapshotted fee / treasury isolate in-flight escrows from
    // admin changes to protocolFeeBps / protocolTreasury.
    // -----------------------------------------------------------------------

    function test_H05_SnapshottedFee_IgnoresLaterFeeBump() public {
        // Re-enable a 1% fee BEFORE creating this escrow so it snaps.
        vm.prank(deployer);
        escrow.setProtocolFee(100); // 1%

        uint256 id = _depositSingle(100e6);

        // Admin bumps the global fee to the 5% max AFTER deposit.
        vm.prank(deployer);
        escrow.setProtocolFee(500);

        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        escrow.releaseAfterWindow(id, 0, 0);

        // The treasury should have received the 1% snapshot fee, not 5%.
        assertEq(usdc.balanceOf(protocolTreasury), 1e6, "fee must be 1% per the snapshot");
        assertEq(usdc.balanceOf(address(tokenMessenger)), 99e6);
    }

    function test_H05_SnapshottedTreasury_IgnoresLaterTreasuryChange() public {
        vm.prank(deployer);
        escrow.setProtocolFee(100); // 1%
        uint256 id = _depositSingle(100e6);

        address rogueTreasury = makeAddr("rogueTreasury");
        vm.prank(deployer);
        escrow.setProtocolTreasury(rogueTreasury);

        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        escrow.releaseAfterWindow(id, 0, 0);

        // Fee must go to the original treasury that was snapshotted.
        assertEq(usdc.balanceOf(protocolTreasury), 1e6, "fee must reach the original treasury");
        assertEq(usdc.balanceOf(rogueTreasury), 0, "rogue treasury must receive nothing");
    }

    // -----------------------------------------------------------------------
    // M-04: updateReceivingAddress works even if ARC_DOMAIN is unregistered.
    // -----------------------------------------------------------------------

    function test_M04_UpdateReceivingAddress_WorksEvenIfArcDomainNotSupported() public {
        uint256 id = _depositSingle(100e6);
        // ARC was never added in the base setUp; confirm and try the redirect.
        assertFalse(escrow.supportedDomains(escrow.ARC_DOMAIN()));

        address freshAddr = makeAddr("fresh");
        vm.prank(recipient);
        escrow.updateReceivingAddress(id, freshAddr);

        (,,,, uint32 destAfter, bytes32 mrAfter,,,,,,,,,) = escrow.escrows(id);
        assertEq(destAfter, escrow.ARC_DOMAIN());
        assertEq(mrAfter, bytes32(uint256(uint160(freshAddr))));
    }

    // -----------------------------------------------------------------------
    // M-06: transferRefundCredit moves credit between accounts.
    // -----------------------------------------------------------------------

    function test_M06_TransferRefundCredit_HappyPath() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        _resolveAs(arbiter, id, 0, false);
        assertEq(escrow.refundBalances(refundTo), 100e6);

        address newOwner = makeAddr("rescueWallet");
        vm.prank(refundTo);
        escrow.transferRefundCredit(newOwner);

        assertEq(escrow.refundBalances(refundTo), 0);
        assertEq(escrow.refundBalances(newOwner), 100e6);

        // newOwner can now withdraw to its own address.
        vm.prank(newOwner);
        escrow.withdrawRefund(newOwner);
        assertEq(usdc.balanceOf(newOwner), 100e6);
    }

    function test_M06_TransferRefundCredit_RevertOn_ZeroAddress() public {
        vm.prank(refundTo);
        vm.expectRevert(ZeroAddress.selector);
        escrow.transferRefundCredit(address(0));
    }

    function test_M06_TransferRefundCredit_RevertOn_SelfTransfer() public {
        uint256 id = _depositSingle(100e6);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        _resolveAs(arbiter, id, 0, false);

        vm.prank(refundTo);
        vm.expectRevert(InvalidRefundRecipient.selector);
        escrow.transferRefundCredit(refundTo);
    }

    function test_M06_TransferRefundCredit_RevertOn_NoBalance() public {
        vm.prank(stranger);
        vm.expectRevert(NothingToWithdraw.selector);
        escrow.transferRefundCredit(makeAddr("anywhere"));
    }

    // -----------------------------------------------------------------------
    // M-02: paginated views.
    // -----------------------------------------------------------------------

    function test_M02_GetEscrowsForPayerPaginated_RespectsBounds() public {
        // Create 5 escrows.
        for (uint256 i = 0; i < 5; i++) {
            _depositSingle(10e6);
        }
        // First page (offset 0, limit 2) -> ids 1,2.
        EscrowSummary[] memory p1 = escrow.getEscrowsForPayerPaginated(depositor, 0, 2);
        assertEq(p1.length, 2);
        assertEq(p1[0].escrowId, 1);
        assertEq(p1[1].escrowId, 2);

        // Second page (offset 2, limit 2) -> ids 3,4.
        EscrowSummary[] memory p2 = escrow.getEscrowsForPayerPaginated(depositor, 2, 2);
        assertEq(p2.length, 2);
        assertEq(p2[0].escrowId, 3);
        assertEq(p2[1].escrowId, 4);

        // Tail page (offset 4, limit 10) -> id 5 only (truncates).
        EscrowSummary[] memory p3 = escrow.getEscrowsForPayerPaginated(depositor, 4, 10);
        assertEq(p3.length, 1);
        assertEq(p3[0].escrowId, 5);
    }

    function test_M02_GetDisputedEscrowsPaginated_FiltersDisputed() public {
        uint256 a = _depositSingle(10e6);
        uint256 b = _depositSingle(20e6);
        _fulfill(b, 0);
        _raiseDisputeAs(depositor, b, 0);

        EscrowSummary[] memory disputed = escrow.getDisputedEscrowsPaginated(0, 10);
        assertEq(disputed.length, 1, "only the disputed escrow should appear");
        assertEq(disputed[0].escrowId, b);
        assertTrue(a != b);
    }
}
