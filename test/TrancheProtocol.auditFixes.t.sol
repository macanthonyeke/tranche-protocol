// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {TrancheProtocol} from "../src/TrancheProtocol.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice Regression tests for the earlier audit-finding fixes, updated for the
///         redesigned lifecycle (claimDelivery / approveRelease / release).
contract TrancheProtocolAuditFixesTest is Base {
    // -----------------------------------------------------------------------
    // H-01: constructor must reject address(0) for arbiter and pauser.
    // -----------------------------------------------------------------------

    function test_H01_Constructor_RevertOn_ZeroArbiter() public {
        vm.expectRevert(ZeroAddress.selector);
        new TrancheProtocol(address(usdc), address(0), pauser, domainManager, address(tokenMessenger), protocolTreasury);
    }

    function test_H01_Constructor_RevertOn_ZeroPauser() public {
        vm.expectRevert(ZeroAddress.selector);
        new TrancheProtocol(
            address(usdc), arbiter, address(0), domainManager, address(tokenMessenger), protocolTreasury
        );
    }

    // -----------------------------------------------------------------------
    // Arbiter-inaction timeout: now an unconditional fair 50/50 split.
    // -----------------------------------------------------------------------

    function test_Timeout_RevertOn_NoDispute() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        vm.expectRevert(NoDispute.selector);
        escrow.resolveDisputeByTimeout(id, 0);
    }

    function test_Timeout_RevertOn_TimeoutNotReached() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        vm.expectRevert(ArbiterTimeoutNotReached.selector);
        escrow.resolveDisputeByTimeout(id, 0);

        vm.warp(block.timestamp + escrow.ARBITER_WINDOW() - 1);
        vm.expectRevert(ArbiterTimeoutNotReached.selector);
        escrow.resolveDisputeByTimeout(id, 0);
    }

    function test_Timeout_SplitsFiftyFifty() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        vm.warp(block.timestamp + escrow.ARBITER_WINDOW());
        vm.prank(stranger); // permissionless
        escrow.resolveDisputeByTimeout(id, 0);

        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.REFUNDED));
        assertEq(escrow.refundBalances(recipient), 50e6);
        assertEq(escrow.refundBalances(refundTo), 50e6);
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));
    }

    function test_Timeout_RevertOn_NonexistentEscrow() public {
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.resolveDisputeByTimeout(999, 0);
    }

    // -----------------------------------------------------------------------
    // Redirect is allowed across the ACTIVE lifecycle incl. DISPUTED milestones;
    // only COMPLETED / CANCELLED escrows are blocked.
    // -----------------------------------------------------------------------

    function test_UpdateReceivingAddress_AllowedDuringDisputedMilestone_CrossChain() public {
        uint256 id = _depositMulti();
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        bytes32 newAddr = bytes32(uint256(uint160(makeAddr("freshWallet"))));
        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newAddr, DEST_DOMAIN);

        assertEq(escrow.getEscrow(id).mintRecipient, newAddr);
        assertEq(escrow.getEscrow(id).destinationDomain, DEST_DOMAIN);
    }

    function test_UpdateReceivingAddress_AllowedDuringDisputedMilestone_SameChain() public {
        uint256 id = _depositMulti();
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        bytes32 newAddr = bytes32(uint256(uint160(makeAddr("freshWallet"))));
        uint32 arc = escrow.ARC_DOMAIN();
        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newAddr, arc);

        assertEq(escrow.getEscrow(id).destinationDomain, arc);
        assertEq(escrow.getEscrow(id).mintRecipient, newAddr);
    }

    function test_UpdateReceivingAddress_RevertOn_CancelledEscrow() public {
        uint256 id = _depositSingle(100e6);
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        vm.expectRevert(InvalidState.selector);
        escrow.updateReceivingAddress(id, bytes32(uint256(uint160(makeAddr("x")))), DEST_DOMAIN);
    }

    // -----------------------------------------------------------------------
    // H-04: maxFee >= burnAmount must revert (single-recipient path).
    // -----------------------------------------------------------------------

    function test_H04_Release_RevertOn_MaxFeeEqualsBurnAmount() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        vm.expectRevert(MaxFeeExceedsBurnAmount.selector);
        escrow.release(id, 0, 100e6); // burnAmount = 100e6 (fee 0)
    }

    function test_H04_Release_RevertOn_MaxFeeGreaterThanBurnAmount() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        vm.expectRevert(MaxFeeExceedsBurnAmount.selector);
        escrow.release(id, 0, 100e6 + 1);
    }

    function test_H04_Release_MaxFeeJustBelowBurnAmount_Succeeds() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        escrow.release(id, 0, 99e6); // < 100e6
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
    }

    // -----------------------------------------------------------------------
    // H-05: snapshotted fee / treasury isolate in-flight escrows.
    // -----------------------------------------------------------------------

    function test_H05_SnapshottedFee_IgnoresLaterFeeBump() public {
        vm.prank(deployer);
        escrow.setProtocolFee(100); // 1%

        uint256 id = _depositSingle(100e6);

        vm.prank(deployer);
        escrow.setProtocolFee(500); // bump to 5% after deposit

        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        escrow.release(id, 0, CCTP_FORWARD_FEE);

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

        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        escrow.release(id, 0, CCTP_FORWARD_FEE);

        assertEq(usdc.balanceOf(protocolTreasury), 1e6, "fee must reach the original treasury");
        assertEq(usdc.balanceOf(rogueTreasury), 0, "rogue treasury must receive nothing");
    }

    // -----------------------------------------------------------------------
    // M-04: updateReceivingAddress works even if ARC_DOMAIN is unregistered.
    // -----------------------------------------------------------------------

    function test_M04_UpdateReceivingAddress_WorksEvenIfArcDomainNotSupported() public {
        uint256 id = _depositSingle(100e6);
        uint32 arc = escrow.ARC_DOMAIN();
        assertFalse(escrow.supportedDomains(arc));

        address freshAddr = makeAddr("fresh");
        bytes32 freshB32 = bytes32(uint256(uint160(freshAddr)));
        vm.prank(recipient);
        escrow.updateReceivingAddress(id, freshB32, arc);

        assertEq(escrow.getEscrow(id).destinationDomain, arc);
        assertEq(escrow.getEscrow(id).mintRecipient, freshB32);
    }

    // -----------------------------------------------------------------------
    // M-06: transferRefundCredit moves credit between accounts.
    // -----------------------------------------------------------------------

    function test_M06_TransferRefundCredit_HappyPath() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        _resolveAs(arbiter, id, 0, false);
        assertEq(escrow.refundBalances(refundTo), 100e6);

        address newOwner = makeAddr("rescueWallet");
        vm.prank(refundTo);
        escrow.transferRefundCredit(newOwner);

        assertEq(escrow.refundBalances(refundTo), 0);
        assertEq(escrow.refundBalances(newOwner), 100e6);

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
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
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
    // M-03: two-step propose (RECOVERY_MANAGER) + self-claim recovery flow.
    // -----------------------------------------------------------------------

    function _seedRefundCredit(uint256 amount) internal returns (address wallet) {
        wallet = refundTo;
        uint256 id = _depositSingle(amount);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        _resolveAs(arbiter, id, 0, false);
        assertEq(escrow.refundBalances(wallet), amount);
    }

    function test_RecoveryTwoStep_HappyPath() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");

        vm.prank(deployer);
        escrow.proposeRefundCreditTransfer(blacklisted, rescue);
        assertEq(escrow.refundBalances(blacklisted), 100e6);
        assertEq(escrow.refundBalances(rescue), 0);
        assertEq(escrow.pendingRefundRecovery(blacklisted), rescue);

        vm.prank(rescue);
        escrow.claimRefundCreditTransfer(blacklisted);
        assertEq(escrow.refundBalances(blacklisted), 0);
        assertEq(escrow.refundBalances(rescue), 100e6);
        assertEq(escrow.pendingRefundRecovery(blacklisted), address(0));
    }

    function test_RecoveryPropose_NonRecoveryManagerReverts() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");
        bytes32 recoveryRole = escrow.RECOVERY_MANAGER_ROLE();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, recoveryRole)
        );
        escrow.proposeRefundCreditTransfer(blacklisted, rescue);
    }

    function test_RecoveryPropose_RevertOn_ZeroNewOwner() public {
        address blacklisted = _seedRefundCredit(100e6);
        vm.prank(deployer);
        vm.expectRevert(ZeroAddress.selector);
        escrow.proposeRefundCreditTransfer(blacklisted, address(0));
    }

    function test_RecoveryPropose_RevertOn_NewOwnerEqualsBlacklisted() public {
        address blacklisted = _seedRefundCredit(100e6);
        vm.prank(deployer);
        vm.expectRevert(InvalidRefundRecipient.selector);
        escrow.proposeRefundCreditTransfer(blacklisted, blacklisted);
    }

    function test_RecoveryPropose_RevertOn_ZeroBalance() public {
        address blacklisted = makeAddr("emptyWallet");
        address rescue = makeAddr("rescueWallet");
        assertEq(escrow.refundBalances(blacklisted), 0);

        vm.prank(deployer);
        vm.expectRevert(NothingToWithdraw.selector);
        escrow.proposeRefundCreditTransfer(blacklisted, rescue);
    }

    function test_RecoveryPropose_EmitsEvent() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");

        vm.expectEmit(true, true, false, true, address(escrow));
        emit RefundCreditTransferProposed(blacklisted, rescue, block.timestamp);
        vm.prank(deployer);
        escrow.proposeRefundCreditTransfer(blacklisted, rescue);
    }

    function test_RecoveryClaim_RevertOn_NotProposedWallet() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");
        vm.prank(deployer);
        escrow.proposeRefundCreditTransfer(blacklisted, rescue);

        vm.prank(deployer);
        vm.expectRevert(NotProposedOwner.selector);
        escrow.claimRefundCreditTransfer(blacklisted);
    }

    function test_RecoveryClaim_RevertOn_NoPendingProposal() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");
        vm.prank(rescue);
        vm.expectRevert(NoPendingRecovery.selector);
        escrow.claimRefundCreditTransfer(blacklisted);
    }

    function test_RecoveryClaim_EmitsTransferEvent_AndAccumulates() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");

        address otherSource = makeAddr("otherRefundTo");
        uint256 other = _depositCustom(depositor, recipient, otherSource, 50e6, _singleMilestone(50e6), REVIEW_WINDOW);
        _claimDelivery(other, 0);
        _raiseDispute(other, 0);
        _resolveAs(arbiter, other, 0, false);
        vm.prank(otherSource);
        escrow.transferRefundCredit(rescue);
        assertEq(escrow.refundBalances(rescue), 50e6);

        vm.prank(deployer);
        escrow.proposeRefundCreditTransfer(blacklisted, rescue);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit RefundCreditTransferred(blacklisted, rescue, 100e6);
        vm.prank(rescue);
        escrow.claimRefundCreditTransfer(blacklisted);

        assertEq(escrow.refundBalances(blacklisted), 0);
        assertEq(escrow.refundBalances(rescue), 150e6);
    }

    // -----------------------------------------------------------------------
    // Role granularity: FEE_MANAGER_ROLE and RECOVERY_MANAGER_ROLE.
    // -----------------------------------------------------------------------

    function _deployerOnlyAdmin() internal returns (address adminOnly) {
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
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, feeRole)
        );
        escrow.setProtocolFee(123);
    }

    function test_FeeManagerRole_SetProtocolFee_RejectsAdminOnly() public {
        address adminOnly = _deployerOnlyAdmin();
        bytes32 feeRole = escrow.FEE_MANAGER_ROLE();
        vm.prank(adminOnly);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, adminOnly, feeRole)
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
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, adminOnly, feeRole)
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
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, adminOnly, feeRole)
        );
        escrow.setCctpForwardFee(42_000);
    }

    function test_RecoveryManagerRole_Propose_AllowsHolder() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");
        address recoveryMgr = makeAddr("recoveryMgr");
        bytes32 recoveryRole = escrow.RECOVERY_MANAGER_ROLE();
        vm.prank(deployer);
        escrow.grantRole(recoveryRole, recoveryMgr);

        vm.prank(recoveryMgr);
        escrow.proposeRefundCreditTransfer(blacklisted, rescue);

        vm.prank(rescue);
        escrow.claimRefundCreditTransfer(blacklisted);
        assertEq(escrow.refundBalances(rescue), 100e6);
    }

    function test_RecoveryManagerRole_Propose_RejectsAdminOnly() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");
        address adminOnly = _deployerOnlyAdmin();
        bytes32 recoveryRole = escrow.RECOVERY_MANAGER_ROLE();

        vm.prank(adminOnly);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, adminOnly, recoveryRole)
        );
        escrow.proposeRefundCreditTransfer(blacklisted, rescue);
    }

    // -----------------------------------------------------------------------
    // H-04 multi-split boundary: per-share maxFee must be < per-share burn.
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
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            ms,
            block.timestamp + 30 days,
            splits
        );
        vm.stopPrank();
    }

    function _twoSplits() internal returns (SplitRecipient[] memory splits) {
        splits = new SplitRecipient[](2);
        splits[0] = SplitRecipient({
            mintRecipient: bytes32(uint256(uint160(makeAddr("split0")))), destinationDomain: DEST_DOMAIN, bps: 7000
        });
        splits[1] = SplitRecipient({
            mintRecipient: bytes32(uint256(uint160(makeAddr("split1")))), destinationDomain: DEST_DOMAIN, bps: 3000
        });
    }

    function test_H04_MultiSplit_RevertOn_PerShareMaxFeeEqualsShare() public {
        uint256 id = _depositWithSplits(100e6, _twoSplits());
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);

        // cctpMaxFee = 100e6 -> split0 share == perShareMaxFee == 70e6.
        vm.expectRevert(MaxFeeExceedsBurnAmount.selector);
        escrow.release(id, 0, 100e6);
    }

    function test_H04_MultiSplit_PerShareMaxFeeJustBelowShare_Succeeds() public {
        uint256 id = _depositWithSplits(100e6, _twoSplits());
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);

        escrow.release(id, 0, 100e6 - 10);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
    }
}
