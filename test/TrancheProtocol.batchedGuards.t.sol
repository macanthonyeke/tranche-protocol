// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";

/// @notice Coverage for two batched changes that previously had ZERO test
///         coverage:
///           (1) high-bits mintRecipient guards on deposit /
///               updateReceivingAddress / updateSplitReceivingAddress
///               (errors InvalidMintRecipient + InvalidSplitMintRecipient).
///           (2) 14-day recovery-proposal expiry on
///               claimRefundCreditTransfer (RecoveryProposalExpired), keyed off
///               the pendingRefundRecoveryAt parallel mapping.
contract TrancheProtocolBatchedGuardsTest is Base {
    uint32 internal constant ARC_DOMAIN = 26;
    // ARBITER_WINDOW is `internal` in the contract (no public getter), so the
    // recovery-expiry boundary must be mirrored here. Keep in sync with
    // `src/TrancheProtocol.sol` (`ARBITER_WINDOW = 14 days`).
    uint256 internal constant ARBITER_WINDOW = 14 days;

    function setUp() public override {
        super.setUp();
        // ARC_DOMAIN is the home chain; redirect tests target it.
        vm.prank(domainManager);
        escrow.addSupportedDomain(ARC_DOMAIN);
    }

    function _toB32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    /// @notice A bytes32 whose low 160 bits decode to `a` but whose high 96
    ///         bits are dirty (a non-zero word above the address). Passes the
    ///         decode/ZeroAddress check but must trip the high-bits guard.
    function _dirtyHighBits(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)) | (uint256(1) << 200));
    }

    // =======================================================================
    // High-bits guard
    // =======================================================================

    function test_Deposit_RevertOn_DirtyHighBitsMintRecipient() public {
        bytes32 dirty = _dirtyHighBits(makeAddr("dest"));
        uint256 amount = 100e6;
        uint256[] memory ms = _singleMilestone(amount);
        SplitRecipient[] memory noSplits = new SplitRecipient[](0);

        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        vm.expectRevert(InvalidMintRecipient.selector);
        escrow.deposit(
            recipient,
            refundTo,
            amount,
            DEST_DOMAIN,
            dirty,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            ms,
            block.timestamp + 30 days,
            noSplits,
            ""
        );
        vm.stopPrank();
    }

    /// @notice Positive control: a clean left-padded address clears the
    ///         high-bits guard, proving the guard is not rejecting valid input.
    function test_Deposit_CleanMintRecipient_PassesGuard() public {
        bytes32 clean = _toB32(makeAddr("dest"));
        uint256 amount = 100e6;
        uint256[] memory ms = _singleMilestone(amount);
        SplitRecipient[] memory noSplits = new SplitRecipient[](0);

        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        uint256 id = escrow.deposit(
            recipient,
            refundTo,
            amount,
            DEST_DOMAIN,
            clean,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            ms,
            block.timestamp + 30 days,
            noSplits,
            ""
        );
        vm.stopPrank();

        assertEq(escrow.getEscrow(id).mintRecipient, clean, "clean recipient stored");
    }

    function test_UpdateReceivingAddress_RevertOn_DirtyHighBits() public {
        uint256 id = _depositSingle(100e6);
        bytes32 dirty = _dirtyHighBits(makeAddr("newDest"));

        vm.prank(recipient);
        vm.expectRevert(InvalidMintRecipient.selector);
        escrow.updateReceivingAddress(id, dirty, ARC_DOMAIN);
    }

    function test_UpdateSplitReceivingAddress_RevertOn_DirtyHighBits() public {
        address splitA = makeAddr("splitA");
        address splitB = makeAddr("splitB");
        uint256 id = _depositTwoSplits(splitA, splitB);

        bytes32 dirty = _dirtyHighBits(makeAddr("splitANew"));

        // splitA controls split 0, so it clears the NotRecipient gate and
        // reaches the high-bits guard on the new address.
        vm.prank(splitA);
        vm.expectRevert(InvalidSplitMintRecipient.selector);
        escrow.updateSplitReceivingAddress(id, 0, dirty, DEST_DOMAIN);
    }

    function _depositTwoSplits(address a, address b) internal returns (uint256 id) {
        SplitRecipient[] memory sp = new SplitRecipient[](2);
        sp[0] = SplitRecipient({mintRecipient: _toB32(a), destinationDomain: DEST_DOMAIN, bps: 6000});
        sp[1] = SplitRecipient({mintRecipient: _toB32(b), destinationDomain: DEST_DOMAIN, bps: 4000});

        uint256 total = 1000e6;
        uint256[] memory ms = _singleMilestone(total);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), total);
        id = escrow.deposit(
            recipient,
            refundTo,
            total,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            ms,
            block.timestamp + 30 days,
            sp,
            ""
        );
        vm.stopPrank();
    }

    // =======================================================================
    // Recovery-proposal 14-day expiry
    // =======================================================================

    /// @notice Seeds refund credit on `refundTo` via a refund-resolved dispute,
    ///         mirroring `_seedRefundCredit` in the auditFixes suite.
    function _seedRefundCredit(uint256 amount) internal returns (address wallet) {
        wallet = refundTo;
        uint256 id = _depositSingle(amount);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        _resolveAs(arbiter, id, 0, false);
        assertEq(escrow.refundBalances(wallet), amount);
    }

    function test_RecoveryClaim_SucceedsJustInsideWindow() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");

        vm.prank(deployer);
        escrow.proposeRefundCreditTransfer(blacklisted, rescue);
        uint256 proposedAt = escrow.pendingRefundRecoveryAt(blacklisted);

        // One second before the window closes — still claimable.
        vm.warp(proposedAt + ARBITER_WINDOW - 1);
        vm.prank(rescue);
        escrow.claimRefundCreditTransfer(blacklisted);

        assertEq(escrow.refundBalances(blacklisted), 0, "source drained");
        assertEq(escrow.refundBalances(rescue), 100e6, "credit re-keyed to nominee");
        assertEq(escrow.pendingRefundRecovery(blacklisted), address(0), "recovery mapping cleared");
        assertEq(escrow.pendingRefundRecoveryAt(blacklisted), 0, "timestamp mapping cleared");
    }

    function test_RecoveryClaim_SucceedsAtExactWindowBoundary() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");

        vm.prank(deployer);
        escrow.proposeRefundCreditTransfer(blacklisted, rescue);
        uint256 proposedAt = escrow.pendingRefundRecoveryAt(blacklisted);

        // Exactly at proposedAt + ARBITER_WINDOW. The guard is a strict `>`
        // (`block.timestamp > proposedAt + ARBITER_WINDOW`), so the boundary
        // instant must still SUCCEED. Pinning this so the semantics can't drift.
        vm.warp(proposedAt + ARBITER_WINDOW);
        vm.prank(rescue);
        escrow.claimRefundCreditTransfer(blacklisted);

        assertEq(escrow.refundBalances(rescue), 100e6, "boundary claim re-keys credit");
        assertEq(escrow.refundBalances(blacklisted), 0, "source drained at boundary");
        assertEq(escrow.pendingRefundRecovery(blacklisted), address(0), "recovery mapping cleared");
        assertEq(escrow.pendingRefundRecoveryAt(blacklisted), 0, "timestamp mapping cleared");
    }

    function test_RecoveryClaim_RevertOn_ExpiredProposal() public {
        address blacklisted = _seedRefundCredit(100e6);
        address rescue = makeAddr("rescueWallet");

        vm.prank(deployer);
        escrow.proposeRefundCreditTransfer(blacklisted, rescue);
        uint256 proposedAt = escrow.pendingRefundRecoveryAt(blacklisted);

        // One second past the window — the proposal has expired.
        vm.warp(proposedAt + ARBITER_WINDOW + 1);
        vm.prank(rescue);
        vm.expectRevert(RecoveryProposalExpired.selector);
        escrow.claimRefundCreditTransfer(blacklisted);

        // Nothing moved; the credit is still parked on the source wallet.
        assertEq(escrow.refundBalances(blacklisted), 100e6, "credit untouched after expiry");
        assertEq(escrow.refundBalances(rescue), 0, "nominee got nothing after expiry");
    }
}
