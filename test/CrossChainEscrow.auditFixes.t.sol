// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {CrossChainEscrow} from "../src/CrossChainEscrow.sol";
import {ICrossChainEscrow} from "../src/interface/ICrossChainEscrow.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

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

    function test_UpdateReceivingAddress_AllowedDuringDisputedMilestone_CrossChain() public {
        uint256 id = _depositMulti();
        _fulfill(id, 0);
        _raiseDisputeAs(recipient, id, 0);

        bytes32 newAddr = bytes32(uint256(uint160(makeAddr("freshWallet"))));
        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newAddr, DEST_DOMAIN);

        (,,,, uint32 destAfter, bytes32 mr,,,,,,,,,) = escrow.escrows(id);
        assertEq(mr, newAddr, "redirect must apply even while a milestone is DISPUTED");
        assertEq(destAfter, DEST_DOMAIN);
    }

    function test_UpdateReceivingAddress_AllowedDuringDisputedMilestone_SameChain() public {
        uint256 id = _depositMulti();
        _fulfill(id, 0);
        _raiseDisputeAs(recipient, id, 0);

        bytes32 newAddr = bytes32(uint256(uint160(makeAddr("freshWallet"))));
        uint32 arc = escrow.ARC_DOMAIN();
        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newAddr, arc);

        (,,,, uint32 destAfter, bytes32 mrAfter,,,,,,,,,) = escrow.escrows(id);
        assertEq(destAfter, arc);
        assertEq(mrAfter, newAddr);
    }

    function test_UpdateReceivingAddress_RevertOn_CancelledEscrow() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);
        // Escrow is now CANCELLED; redirects must revert.
        vm.prank(recipient);
        vm.expectRevert(InvalidState.selector);
        escrow.updateReceivingAddress(id, bytes32(uint256(uint160(makeAddr("x")))), DEST_DOMAIN);
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
        escrow.releaseAfterWindow(id, 0, CCTP_FORWARD_FEE);

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
        escrow.releaseAfterWindow(id, 0, CCTP_FORWARD_FEE);

        // Fee must go to the original treasury that was snapshotted.
        assertEq(usdc.balanceOf(protocolTreasury), 1e6, "fee must reach the original treasury");
        assertEq(usdc.balanceOf(rogueTreasury), 0, "rogue treasury must receive nothing");
    }

    // -----------------------------------------------------------------------
    // M-04: updateReceivingAddress works even if ARC_DOMAIN is unregistered.
    // -----------------------------------------------------------------------

    function test_M04_UpdateReceivingAddress_WorksEvenIfArcDomainNotSupported() public {
        uint256 id = _depositSingle(100e6);
        uint32 arc = escrow.ARC_DOMAIN();
        // ARC was never added in the base setUp; confirm and try the redirect.
        assertFalse(escrow.supportedDomains(arc));

        address freshAddr = makeAddr("fresh");
        bytes32 freshB32 = bytes32(uint256(uint160(freshAddr)));
        vm.prank(recipient);
        escrow.updateReceivingAddress(id, freshB32, arc);

        (,,,, uint32 destAfter, bytes32 mrAfter,,,,,,,,,) = escrow.escrows(id);
        assertEq(destAfter, arc);
        assertEq(mrAfter, freshB32);
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
    // adminTransferRefundCredit: emergency recovery for blacklisted wallets.
    // -----------------------------------------------------------------------

    function _seedRefundCredit(uint256 amount) internal returns (address wallet) {
        wallet = refundTo;
        uint256 id = _depositSingle(amount);
        _fulfill(id, 0);
        _raiseDisputeAs(depositor, id, 0);
        _resolveAs(arbiter, id, 0, false);
        assertEq(escrow.refundBalances(wallet), amount);
    }

    function test_AdminTransferRefundCredit_HappyPath() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");

        vm.prank(deployer);
        escrow.adminTransferRefundCredit(blacklisted, rescue);

        assertEq(escrow.refundBalances(blacklisted), 0);
        assertEq(escrow.refundBalances(rescue), 100e6);
    }

    function test_AdminTransferRefundCredit_NonAdminReverts() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");
        bytes32 recoveryRole = escrow.RECOVERY_MANAGER_ROLE();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, recoveryRole
            )
        );
        escrow.adminTransferRefundCredit(blacklisted, rescue);
    }

    function test_AdminTransferRefundCredit_RevertOn_ZeroNewOwner() public {
        address blacklisted = _seedRefundCredit(100e6);
        vm.prank(deployer);
        vm.expectRevert(ZeroAddress.selector);
        escrow.adminTransferRefundCredit(blacklisted, address(0));
    }

    function test_AdminTransferRefundCredit_RevertOn_NewOwnerEqualsBlacklisted() public {
        address blacklisted = _seedRefundCredit(100e6);
        vm.prank(deployer);
        vm.expectRevert(InvalidRefundRecipient.selector);
        escrow.adminTransferRefundCredit(blacklisted, blacklisted);
    }

    function test_AdminTransferRefundCredit_RevertOn_ZeroBalance() public {
        address blacklisted = makeAddr("emptyWallet");
        address rescue = makeAddr("rescueWallet");
        assertEq(escrow.refundBalances(blacklisted), 0);

        vm.prank(deployer);
        vm.expectRevert(NothingToWithdraw.selector);
        escrow.adminTransferRefundCredit(blacklisted, rescue);
    }

    function test_AdminTransferRefundCredit_EmitsEvent() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");

        vm.expectEmit(true, true, false, true, address(escrow));
        emit RefundCreditTransferred(blacklisted, rescue, 100e6);
        vm.prank(deployer);
        escrow.adminTransferRefundCredit(blacklisted, rescue);
    }

    function test_AdminTransferRefundCredit_BalanceMappingUpdates() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");

        // Pre-seed rescue with an existing credit to confirm accumulation, not overwrite.
        address otherSource = makeAddr("otherRefundTo");
        uint256 other = _depositCustom(
            depositor, recipient, otherSource, 50e6, _singleMilestone(50e6), DISPUTE_WINDOW
        );
        _fulfill(other, 0);
        _raiseDisputeAs(depositor, other, 0);
        _resolveAs(arbiter, other, 0, false);
        vm.prank(otherSource);
        escrow.transferRefundCredit(rescue);
        assertEq(escrow.refundBalances(rescue), 50e6);

        vm.prank(deployer);
        escrow.adminTransferRefundCredit(blacklisted, rescue);
        assertEq(escrow.refundBalances(blacklisted), 0);
        assertEq(escrow.refundBalances(rescue), 150e6);
    }

    // -----------------------------------------------------------------------
    // Role granularity: FEE_MANAGER_ROLE and RECOVERY_MANAGER_ROLE.
    // -----------------------------------------------------------------------

    function _deployerOnlyAdmin() internal returns (address adminOnly) {
        // An account that holds DEFAULT_ADMIN_ROLE but NOT the granular roles.
        adminOnly = makeAddr("adminOnly");
        bytes32 adminRole = escrow.DEFAULT_ADMIN_ROLE();
        bytes32 feeRole = escrow.FEE_MANAGER_ROLE();
        bytes32 recoveryRole = escrow.RECOVERY_MANAGER_ROLE();
        vm.startPrank(deployer);
        escrow.grantRole(adminRole, adminOnly);
        escrow.revokeRole(feeRole, adminOnly);
        escrow.revokeRole(recoveryRole, adminOnly);
        vm.stopPrank();
    }

    function test_FeeManagerRole_SetProtocolFee_AllowsHolder() public {
        address feeMgr = makeAddr("feeMgr");
        bytes32 feeRole = escrow.FEE_MANAGER_ROLE();
        vm.prank(deployer);
        escrow.grantRole(feeRole, feeMgr);

        vm.prank(feeMgr);
        escrow.setProtocolFee(123);
        assertEq(escrow.protocolFeeBps(), 123);
    }

    function test_FeeManagerRole_SetProtocolFee_RejectsStranger() public {
        bytes32 feeRole = escrow.FEE_MANAGER_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, feeRole
            )
        );
        escrow.setProtocolFee(123);
    }

    function test_FeeManagerRole_SetProtocolFee_RejectsAdminOnly() public {
        address adminOnly = _deployerOnlyAdmin();
        bytes32 feeRole = escrow.FEE_MANAGER_ROLE();
        vm.prank(adminOnly);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, adminOnly, feeRole
            )
        );
        escrow.setProtocolFee(123);
    }

    function test_FeeManagerRole_SetProtocolTreasury_AllowsHolder() public {
        address feeMgr = makeAddr("feeMgr");
        address newTreasury = makeAddr("newTreasury");
        bytes32 feeRole = escrow.FEE_MANAGER_ROLE();
        vm.prank(deployer);
        escrow.grantRole(feeRole, feeMgr);

        vm.prank(feeMgr);
        escrow.setProtocolTreasury(newTreasury);
        assertEq(escrow.protocolTreasury(), newTreasury);
    }

    function test_FeeManagerRole_SetProtocolTreasury_RejectsAdminOnly() public {
        address adminOnly = _deployerOnlyAdmin();
        bytes32 feeRole = escrow.FEE_MANAGER_ROLE();
        vm.prank(adminOnly);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, adminOnly, feeRole
            )
        );
        escrow.setProtocolTreasury(makeAddr("newTreasury"));
    }

    function test_FeeManagerRole_SetCctpForwardFee_AllowsHolder() public {
        address feeMgr = makeAddr("feeMgr");
        bytes32 feeRole = escrow.FEE_MANAGER_ROLE();
        vm.prank(deployer);
        escrow.grantRole(feeRole, feeMgr);

        vm.prank(feeMgr);
        escrow.setCctpForwardFee(42_000);
        assertEq(escrow.cctpForwardFee(), 42_000);
    }

    function test_FeeManagerRole_SetCctpForwardFee_RejectsAdminOnly() public {
        address adminOnly = _deployerOnlyAdmin();
        bytes32 feeRole = escrow.FEE_MANAGER_ROLE();
        vm.prank(adminOnly);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, adminOnly, feeRole
            )
        );
        escrow.setCctpForwardFee(42_000);
    }

    function test_RecoveryManagerRole_AdminTransfer_AllowsHolder() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");
        address recoveryMgr = makeAddr("recoveryMgr");
        bytes32 recoveryRole = escrow.RECOVERY_MANAGER_ROLE();
        vm.prank(deployer);
        escrow.grantRole(recoveryRole, recoveryMgr);

        vm.prank(recoveryMgr);
        escrow.adminTransferRefundCredit(blacklisted, rescue);
        assertEq(escrow.refundBalances(rescue), 100e6);
    }

    function test_RecoveryManagerRole_AdminTransfer_RejectsAdminOnly() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");
        address adminOnly = _deployerOnlyAdmin();
        bytes32 recoveryRole = escrow.RECOVERY_MANAGER_ROLE();

        vm.prank(adminOnly);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, adminOnly, recoveryRole
            )
        );
        escrow.adminTransferRefundCredit(blacklisted, rescue);
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

    function test_M02_GetEscrowsForFreelancerPaginated_RespectsBounds() public {
        // Create 5 escrows; depositor is the payer, `recipient` is the freelancer.
        for (uint256 i = 0; i < 5; i++) {
            _depositSingle(10e6);
        }

        // First page (offset 0, limit 2) -> ids 1,2.
        EscrowSummary[] memory p1 = escrow.getEscrowsForFreelancerPaginated(recipient, 0, 2);
        assertEq(p1.length, 2);
        assertEq(p1[0].escrowId, 1);
        assertEq(p1[1].escrowId, 2);

        // Second page (offset 2, limit 2) -> ids 3,4.
        EscrowSummary[] memory p2 = escrow.getEscrowsForFreelancerPaginated(recipient, 2, 2);
        assertEq(p2.length, 2);
        assertEq(p2[0].escrowId, 3);
        assertEq(p2[1].escrowId, 4);

        // Tail page (offset 4, limit 10) -> id 5 only (truncates).
        EscrowSummary[] memory p3 = escrow.getEscrowsForFreelancerPaginated(recipient, 4, 10);
        assertEq(p3.length, 1);
        assertEq(p3[0].escrowId, 5);

        // A stranger gets nothing.
        EscrowSummary[] memory none = escrow.getEscrowsForFreelancerPaginated(stranger, 0, 10);
        assertEq(none.length, 0);
    }

    // -----------------------------------------------------------------------
    // H-04 multi-split boundary: per-share maxFee must be < per-share burn.
    // The contract scales `cctpMaxFee` by each split's bps before comparing
    // against that split's burn share, so the boundary lives at the share.
    // -----------------------------------------------------------------------

    function _depositWithSplits(uint256 amount, SplitRecipient[] memory splits) internal returns (uint256 id) {
        uint256[] memory ms = _singleMilestone(amount);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        id = escrow.deposit(
            recipient,
            refundTo,
            amount,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            DISPUTE_WINDOW,
            DELIVERY_NOTICE_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            ms,
            block.timestamp + 30 days,
            splits
        );
        vm.stopPrank();
    }

    function test_H04_MultiSplit_RevertOn_PerShareMaxFeeEqualsShare() public {
        // 70/30 split, total = 100e6 -> shares = 70e6 / 30e6.
        SplitRecipient[] memory splits = new SplitRecipient[](2);
        splits[0] = SplitRecipient({
            mintRecipient: bytes32(uint256(uint160(makeAddr("split0")))),
            destinationDomain: DEST_DOMAIN,
            bps: 7000
        });
        splits[1] = SplitRecipient({
            mintRecipient: bytes32(uint256(uint160(makeAddr("split1")))),
            destinationDomain: DEST_DOMAIN,
            bps: 3000
        });

        uint256 id = _depositWithSplits(100e6, splits);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        // perShareMaxFee for split0 = cctpMaxFee * 7000 / 10000.
        // Pick cctpMaxFee = 100e6 so split0's share == its perShareMaxFee == 70e6.
        vm.expectRevert(MaxFeeExceedsBurnAmount.selector);
        escrow.releaseAfterWindow(id, 0, 100e6);
    }

    function test_H04_MultiSplit_PerShareMaxFeeJustBelowShare_Succeeds() public {
        SplitRecipient[] memory splits = new SplitRecipient[](2);
        splits[0] = SplitRecipient({
            mintRecipient: bytes32(uint256(uint160(makeAddr("split0")))),
            destinationDomain: DEST_DOMAIN,
            bps: 7000
        });
        splits[1] = SplitRecipient({
            mintRecipient: bytes32(uint256(uint160(makeAddr("split1")))),
            destinationDomain: DEST_DOMAIN,
            bps: 3000
        });

        uint256 id = _depositWithSplits(100e6, splits);
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        // cctpMaxFee = 100e6 - 10 -> perShareMaxFee0 = 70e6 - 7 (< 70e6 share)
        //                            perShareMaxFee1 = 30e6 - 3 (< 30e6 share).
        escrow.releaseAfterWindow(id, 0, 100e6 - 10);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
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
