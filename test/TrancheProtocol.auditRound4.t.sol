// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";

/// @notice Round-4 audit-fix regression tests (F1–F5):
///         F1 — per-burn CCTP fee on split releases (no bps scaling).
///         F2 — deposit cross-chain guard: net-of-fee, per-split share, fee==0.
///         F3 — redirect floor guards on updateReceivingAddress / split variant.
///         F4 — mutualSettle ignores the completing caller's maxFee.
///         F5 — stale pendingRefundRecovery cleared on self-service balance moves.
contract TrancheProtocolAuditRound4Test is Base {
    uint32 internal arcDomain;

    function setUp() public override {
        super.setUp();
        arcDomain = 26;
    }

    // ---------------------------------------------------------------- helpers

    function _mkSplit(bytes32 mr, uint32 dom, uint256 bps) internal pure returns (SplitRecipient memory s) {
        s = SplitRecipient({mintRecipient: mr, destinationDomain: dom, bps: bps});
    }

    function _depositSplits(uint256 amount, SplitRecipient[] memory sp) internal returns (uint256 id) {
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
            sp,
            ""
        );
        vm.stopPrank();

        vm.prank(recipient);
        escrow.acknowledgeInvoice(id);
    }

    function _maxFeeAt(uint256 i) internal view returns (uint256 mf) {
        (,,,,,, mf,,,) = tokenMessenger.calls(i);
    }

    function _amountAt(uint256 i) internal view returns (uint256 a) {
        (, a,,,,,,,,) = tokenMessenger.calls(i);
    }

    function _domainAt(uint256 i) internal view returns (uint32 d) {
        (,, d,,,,,,,) = tokenMessenger.calls(i);
    }

    function _b32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    /// @dev Credit `to` a refund balance through the deadline-refund path (no
    ///      burn). Cross-chain deposit, so amount must clear the F2 floor.
    function _creditRefund(address to, uint256 amount) internal returns (uint256 id) {
        id = _depositCustom(depositor, recipient, to, amount, _singleMilestone(amount), REVIEW_WINDOW);
        // deadline = now + 30 days; refund opens only after the 72h grace.
        vm.warp(block.timestamp + 30 days + 72 hours + 1);
        escrow.refundAfterDeadline(id, 0);
    }

    // ======================================================================
    // F1 — per-burn fee on split releases
    // ======================================================================

    function test_F1_MultiSplitCrossChain_ApproveRelease_EachBurnGetsFullFloor() public {
        SplitRecipient[] memory sp = new SplitRecipient[](2);
        sp[0] = _mkSplit(MINT_RECIPIENT, DEST_DOMAIN, 7000);
        sp[1] = _mkSplit(MINT_RECIPIENT, DEST_DOMAIN, 3000);
        uint256 id = _depositSplits(1_000_000, sp);

        _claimDelivery(id, 0);
        uint256 before = tokenMessenger.callsLength();
        vm.prank(depositor);
        escrow.approveRelease(id, 0, CCTP_FORWARD_FEE);

        assertEq(tokenMessenger.callsLength(), before + 2, "expected 2 split burns");
        // Each split burn carries the FULL per-escrow floor, not bps-scaled
        // (would be 70_000 / 30_000 before the fix).
        assertEq(_maxFeeAt(before), CCTP_FORWARD_FEE, "split0 maxFee");
        assertEq(_maxFeeAt(before + 1), CCTP_FORWARD_FEE, "split1 maxFee");
        assertEq(_amountAt(before), 700_000, "split0 amount");
        assertEq(_amountAt(before + 1), 300_000, "split1 amount");
    }

    function test_F1_PermissionlessRelease_Splits_UseSnapshotFloor() public {
        SplitRecipient[] memory sp = new SplitRecipient[](2);
        sp[0] = _mkSplit(MINT_RECIPIENT, DEST_DOMAIN, 7000);
        sp[1] = _mkSplit(MINT_RECIPIENT, DEST_DOMAIN, 3000);
        uint256 id = _depositSplits(1_000_000, sp);

        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        uint256 before = tokenMessenger.callsLength();
        _release(id, 0);

        assertEq(tokenMessenger.callsLength(), before + 2, "expected 2 split burns");
        assertEq(_maxFeeAt(before), CCTP_FORWARD_FEE, "split0 maxFee");
        assertEq(_maxFeeAt(before + 1), CCTP_FORWARD_FEE, "split1 maxFee");
    }

    function test_F1_SingleRecipientCrossChain_StillUsesCallerMaxFee() public {
        uint256 id = _depositSingle(1_000_000);
        _claimDelivery(id, 0);
        uint256 callerMaxFee = 120_000; // >= floor, < burn amount
        uint256 before = tokenMessenger.callsLength();
        vm.prank(depositor);
        escrow.approveRelease(id, 0, callerMaxFee);

        assertEq(tokenMessenger.callsLength(), before + 1, "single burn");
        assertEq(_maxFeeAt(before), callerMaxFee, "single recipient keeps caller maxFee");
    }

    // ======================================================================
    // F2 — deposit cross-chain guard
    // ======================================================================

    function test_F2_HoleA_NetOfFeeBoundaryBand_Reverts() public {
        vm.prank(deployer);
        escrow.setProtocolFee(199); // 1.99%
        // Gross just above the floor, but net-of-fee falls below it.
        uint256 amount = CCTP_FORWARD_FEE + 1; // 100_001; net = 98_011 < 100_000
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        vm.expectRevert(MilestoneBelowForwardFee.selector);
        escrow.deposit(
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
            new SplitRecipient[](0),
            ""
        );
        vm.stopPrank();
    }

    function test_F2_HoleB_SmallSplitShare_Reverts() public {
        SplitRecipient[] memory sp = new SplitRecipient[](2);
        sp[0] = _mkSplit(MINT_RECIPIENT, DEST_DOMAIN, 9999);
        sp[1] = _mkSplit(MINT_RECIPIENT, DEST_DOMAIN, 1); // share = 100 << floor
        uint256 amount = 1_000_000;
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        vm.expectRevert(MilestoneBelowForwardFee.selector);
        escrow.deposit(
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
            sp,
            ""
        );
        vm.stopPrank();
    }

    function test_F2_HoleC_FeeZero_Reverts() public {
        vm.prank(deployer);
        escrow.setCctpForwardFee(0);
        uint256 amount = 1_000_000;
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        vm.expectRevert(CctpForwardFeeNotSet.selector);
        escrow.deposit(
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
            new SplitRecipient[](0),
            ""
        );
        vm.stopPrank();
    }

    function test_F2_ValidCrossChain_Succeeds() public {
        uint256 id = _depositSingle(1_000_000);
        assertEq(_getMilestoneAmount(id, 0), 1_000_000);
    }

    function test_F2_SameChainTinyMilestone_Exempt() public {
        vm.prank(domainManager);
        escrow.addSupportedDomain(arcDomain);
        vm.prank(deployer);
        escrow.setCctpForwardFee(0); // even with no fee set, same-chain is exempt
        uint256 amount = 1_000; // far below any floor
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        uint256 id = escrow.deposit(
            recipient,
            refundTo,
            amount,
            arcDomain,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(amount),
            block.timestamp + 30 days,
            new SplitRecipient[](0),
            ""
        );
        vm.stopPrank();
        assertEq(_getMilestoneAmount(id, 0), amount);
    }

    // ======================================================================
    // F3 — redirect floor guards
    // ======================================================================

    /// @dev Same-chain (Arc) split escrow: deposit skips the cross-chain guard,
    ///      so we can later attempt a redirect onto a sub-floor share.
    function _depositArcSplitEscrow(uint256 amount, uint256 bps0, uint256 bps1) internal returns (uint256 id) {
        vm.prank(domainManager);
        escrow.addSupportedDomain(arcDomain);
        SplitRecipient[] memory sp = new SplitRecipient[](2);
        sp[0] = _mkSplit(_b32(recipient), arcDomain, bps0); // recipient controls split0
        sp[1] = _mkSplit(MINT_RECIPIENT, arcDomain, bps1);
        uint256[] memory ms = _singleMilestone(amount);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        id = escrow.deposit(
            recipient,
            refundTo,
            amount,
            arcDomain,
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

    function test_F3_SplitRedirectArcToCrossChain_Reverts() public {
        // An Arc split cannot be converted to cross-chain post-deposit: its share
        // was never floor-validated for a cross-chain burn.
        uint256 id = _depositArcSplitEscrow(1_000_000, 5000, 5000);
        vm.prank(recipient);
        vm.expectRevert(MilestoneBelowForwardFee.selector);
        escrow.updateSplitReceivingAddress(id, 0, _b32(recipient), DEST_DOMAIN);
    }

    function test_F3_SplitRedirectCrossToCross_Allowed_NoDoS() public {
        // A cross-chain split may move to another cross-chain domain, and the
        // all-or-nothing release loop still pays every leg.
        uint32 domB = 7;
        vm.prank(domainManager);
        escrow.addSupportedDomain(domB);

        SplitRecipient[] memory sp = new SplitRecipient[](2);
        sp[0] = _mkSplit(_b32(recipient), DEST_DOMAIN, 5000);
        sp[1] = _mkSplit(MINT_RECIPIENT, DEST_DOMAIN, 5000);
        uint256 amount = 1_000_000;
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        uint256 id = escrow.deposit(
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
            sp,
            ""
        );
        vm.stopPrank();

        vm.prank(recipient);
        escrow.acknowledgeInvoice(id);

        // cross-chain (6) -> cross-chain (7): allowed
        vm.prank(recipient);
        escrow.updateSplitReceivingAddress(id, 0, _b32(recipient), domB);

        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        uint256 before = tokenMessenger.callsLength();
        _release(id, 0);
        assertEq(tokenMessenger.callsLength(), before + 2, "both splits paid");
        assertEq(_maxFeeAt(before), CCTP_FORWARD_FEE, "leg0 floor");
        assertEq(_maxFeeAt(before + 1), CCTP_FORWARD_FEE, "leg1 floor");
    }

    function test_F3_SingleRecipientArcToCrossChain_Reverts() public {
        vm.prank(domainManager);
        escrow.addSupportedDomain(arcDomain);
        uint256 amount = 1_000_000; // size irrelevant; the conversion itself is blocked
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        uint256 id = escrow.deposit(
            recipient,
            refundTo,
            amount,
            arcDomain,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(amount),
            block.timestamp + 30 days,
            new SplitRecipient[](0),
            ""
        );
        vm.stopPrank();

        vm.prank(recipient);
        vm.expectRevert(MilestoneBelowForwardFee.selector);
        escrow.updateReceivingAddress(id, MINT_RECIPIENT, DEST_DOMAIN);
    }

    function test_F3_SingleRecipientCrossToArc_Allowed() public {
        // A cross-chain escrow can always be redirected back to Arc.
        uint256 id = _depositSingle(1_000_000); // DEST_DOMAIN (cross-chain) at deposit
        vm.prank(recipient);
        escrow.updateReceivingAddress(id, MINT_RECIPIENT, arcDomain);
        assertEq(escrow.getEscrow(id).destinationDomain, arcDomain);
    }

    // ======================================================================
    // F4 — mutualSettle ignores caller maxFee
    // ======================================================================

    function test_F4_MutualSettle_CrossChain_UsesSnapshotFloor() public {
        uint256 id = _depositSingle(1_000_000);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        // Recipient proposes 80% with a sensible maxFee...
        vm.prank(recipient);
        escrow.mutualSettle(id, 0, 8000, CCTP_FORWARD_FEE);
        // ...depositor completes with maxFee = 0 (would strand pre-fix). It is
        // ignored; the burn uses the snapshot floor.
        uint256 before = tokenMessenger.callsLength();
        vm.prank(depositor);
        escrow.mutualSettle(id, 0, 8000, 0);

        assertEq(tokenMessenger.callsLength(), before + 1, "recipient share burned");
        assertEq(_maxFeeAt(before), CCTP_FORWARD_FEE, "burn used snapshot floor");
        assertEq(_amountAt(before), 800_000, "80% to recipient");
        // 20% refunded to the depositor's refundTo.
        assertEq(escrow.refundBalances(refundTo), 200_000, "20% refund credited");
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
    }

    function test_F4_MutualSettle_SameChain_Unaffected() public {
        vm.prank(domainManager);
        escrow.addSupportedDomain(arcDomain);
        uint256 amount = 1_000_000;
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        uint256 id = escrow.deposit(
            recipient,
            refundTo,
            amount,
            arcDomain,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(amount),
            block.timestamp + 30 days,
            new SplitRecipient[](0),
            ""
        );
        vm.stopPrank();

        vm.prank(recipient);
        escrow.acknowledgeInvoice(id);

        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        vm.prank(recipient);
        escrow.mutualSettle(id, 0, 8000, 0);
        vm.prank(depositor);
        escrow.mutualSettle(id, 0, 8000, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
    }

    // ======================================================================
    // F5 — stale recovery proposal cleared on self-service
    // ======================================================================

    function test_F5_WithdrawRefund_ClearsPendingRecovery() public {
        address alice = makeAddr("aliceF5");
        address mallory = makeAddr("malloryF5");

        _creditRefund(alice, 500_000);
        assertEq(escrow.refundBalances(alice), 500_000);

        // Recovery manager (deployer) proposes a recovery to mallory.
        vm.prank(deployer);
        escrow.proposeRefundCreditTransfer(alice, mallory);
        assertEq(escrow.pendingRefundRecovery(alice), mallory);

        // Alice proves she is live by withdrawing herself.
        vm.prank(alice);
        escrow.withdrawRefund(alice, 0, address(0), 0);
        assertEq(escrow.pendingRefundRecovery(alice), address(0), "pending cleared");

        // Alice later re-accrues credit; the stale nominee cannot claim it.
        _creditRefund(alice, 500_000);
        vm.prank(mallory);
        vm.expectRevert(NoPendingRecovery.selector);
        escrow.claimRefundCreditTransfer(alice);
    }

    function test_F5_TransferRefundCredit_ClearsPendingRecovery() public {
        address alice = makeAddr("aliceF5b");
        address mallory = makeAddr("malloryF5b");
        address carol = makeAddr("carolF5b");

        _creditRefund(alice, 500_000);
        vm.prank(deployer);
        escrow.proposeRefundCreditTransfer(alice, mallory);

        vm.prank(alice);
        escrow.transferRefundCredit(carol);
        assertEq(escrow.pendingRefundRecovery(alice), address(0), "pending cleared");

        _creditRefund(alice, 500_000);
        vm.prank(mallory);
        vm.expectRevert(NoPendingRecovery.selector);
        escrow.claimRefundCreditTransfer(alice);
    }

    function test_F5_LegitFrozenWalletRecovery_StillWorks() public {
        address alice = makeAddr("aliceF5c");
        address bob = makeAddr("bobF5c");

        _creditRefund(alice, 500_000);
        vm.prank(deployer);
        escrow.proposeRefundCreditTransfer(alice, bob);

        // Alice never acts (genuinely frozen); Bob claims successfully.
        vm.prank(bob);
        escrow.claimRefundCreditTransfer(alice);

        assertEq(escrow.refundBalances(bob), 500_000, "bob received credit");
        assertEq(escrow.refundBalances(alice), 0, "alice drained");
        assertEq(escrow.pendingRefundRecovery(alice), address(0), "pending consumed");
    }

    // ======================================================================
    // Finding 3 — credit-on-Arc fallback for sub-floor partial cross-chain legs
    //
    // A partial release (resolveDispute / mutualSettle) can scale a recipient
    // leg to at-or-below the per-escrow forwarding-fee floor. Such a leg can
    // never be CCTP-burned (every admissible maxFee >= floor >= share), so
    // instead of reverting it is credited to the leg's Arc refundBalances and
    // CrossChainLegCreditedOnArc is emitted. Legs above the floor still burn.
    // protocolFeeBps == 0 in the fixture, so recipientShare == milestone*bps/1e4
    // with no fee subtraction; the snapshot floor is CCTP_FORWARD_FEE = 100_000.
    // ======================================================================

    function test_Finding3_NoSplit_ShareExactlyAtFloor_Diverts() public {
        // bps 1000 of 1e6 = 100_000 == floor; divert uses <=, so this diverts.
        uint256 id = _depositSingle(1_000_000);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        uint256 before = tokenMessenger.callsLength();
        vm.expectEmit(true, true, true, true, address(escrow));
        emit CrossChainLegCreditedOnArc(id, 0, recipient, 100_000);
        vm.prank(arbiter);
        escrow.resolveDispute(id, 0, 1000, keccak256("res"), "ipfs://res", CCTP_FORWARD_FEE);

        assertEq(tokenMessenger.callsLength(), before, "no burn: leg diverted to Arc");
        assertEq(escrow.refundBalances(recipient), 100_000, "recipient share credited on Arc");
        assertEq(escrow.refundBalances(refundTo), 900_000, "depositor 90% refund leg");
        assertEq(
            uint256(_getMilestoneState(id, 0)),
            uint256(MilestoneState.RELEASED),
            "milestone RELEASED even though funds stayed as Arc credit"
        );
    }

    function test_Finding3_NoSplit_ShareBelowFloor_Diverts() public {
        // bps 999 of 1e6 = 99_900 < floor; diverts.
        uint256 id = _depositSingle(1_000_000);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        uint256 before = tokenMessenger.callsLength();
        vm.expectEmit(true, true, true, true, address(escrow));
        emit CrossChainLegCreditedOnArc(id, 0, recipient, 99_900);
        vm.prank(arbiter);
        escrow.resolveDispute(id, 0, 999, keccak256("res"), "ipfs://res", CCTP_FORWARD_FEE);

        assertEq(tokenMessenger.callsLength(), before, "no burn: leg diverted to Arc");
        assertEq(escrow.refundBalances(recipient), 99_900, "recipient share credited on Arc");
        assertEq(escrow.refundBalances(refundTo), 900_100, "depositor refund leg");
        assertEq(
            uint256(_getMilestoneState(id, 0)),
            uint256(MilestoneState.RELEASED),
            "milestone RELEASED even though funds stayed as Arc credit"
        );
    }

    function test_Finding3_NoSplit_ShareAboveFloor_Burns() public {
        // Control: bps 1001 of 1e6 = 100_100 > floor; burns, does not divert.
        uint256 id = _depositSingle(1_000_000);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        uint256 before = tokenMessenger.callsLength();
        // maxFee = floor = 100_000 < 100_100, so the H-04 ceiling passes.
        vm.prank(arbiter);
        escrow.resolveDispute(id, 0, 1001, keccak256("res"), "ipfs://res", CCTP_FORWARD_FEE);

        assertEq(tokenMessenger.callsLength(), before + 1, "burn happened");
        assertEq(_amountAt(before), 100_100, "burned the recipient share");
        assertEq(_maxFeeAt(before), CCTP_FORWARD_FEE, "burn carried the snapshot floor as maxFee");
        assertEq(escrow.refundBalances(recipient), 0, "recipient NOT credited; it was mailed");
        assertEq(escrow.refundBalances(refundTo), 899_900, "depositor refund leg");
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED), "normal release, burned");
    }

    function test_Finding3_Split_MixedBurnAndDivert() public {
        // M = 2e6, splits 9000/1000 (smallest full share 200_000 > floor, so the
        // deposit F2 guard passes). Partial bps 2500 => recipientAmount 500_000:
        // split0 450_000 burns (> floor), split1 50_000 diverts (<= floor).
        address addrA = makeAddr("splitA");
        address addrB = makeAddr("splitB");
        SplitRecipient[] memory sp = new SplitRecipient[](2);
        sp[0] = _mkSplit(_b32(addrA), DEST_DOMAIN, 9000);
        sp[1] = _mkSplit(_b32(addrB), DEST_DOMAIN, 1000);
        uint256 id = _depositSplits(2_000_000, sp);

        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        uint256 before = tokenMessenger.callsLength();
        // split1 (50_000) diverts; expectEmit forward-matches the named event
        // even though split0 also burns in the same call. If log ordering ever
        // trips this, drop the expectEmit and rely on the refundBalances asserts.
        vm.expectEmit(true, true, true, true, address(escrow));
        emit CrossChainLegCreditedOnArc(id, 0, addrB, 50_000);
        vm.prank(arbiter);
        escrow.resolveDispute(id, 0, 2500, keccak256("res"), "ipfs://res", CCTP_FORWARD_FEE);

        assertEq(tokenMessenger.callsLength(), before + 1, "only split0 burned; split1 diverted");
        assertEq(_amountAt(before), 450_000, "split0 burn amount");
        assertEq(escrow.refundBalances(addrB), 50_000, "split1 diverted to its decoded address");
        assertEq(escrow.refundBalances(addrA), 0, "split0 mailed, not credited");
        assertEq(escrow.refundBalances(refundTo), 1_500_000, "depositor 75% refund leg");
        assertEq(
            uint256(_getMilestoneState(id, 0)),
            uint256(MilestoneState.RELEASED),
            "split milestone RELEASED: one leg burned, one diverted"
        );
    }

    function test_Finding3_MutualSettle_NoSplit_ShareBelowFloor_Diverts() public {
        // mutualSettle threads escrowCctpForwardFee as cctpMaxFee, so divert and
        // burn share the same yardstick. bps 800 of 1e6 = 80_000 < floor.
        uint256 id = _depositSingle(1_000_000);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        // Recipient proposes, depositor completes (mirrors the F4 two-call shape).
        vm.prank(recipient);
        escrow.mutualSettle(id, 0, 800, CCTP_FORWARD_FEE);
        uint256 before = tokenMessenger.callsLength();
        vm.prank(depositor);
        escrow.mutualSettle(id, 0, 800, 0);

        assertEq(tokenMessenger.callsLength(), before, "no burn: leg diverted to Arc");
        assertEq(escrow.refundBalances(recipient), 80_000, "recipient share credited on Arc");
        assertEq(escrow.refundBalances(refundTo), 920_000, "depositor 92% refund leg");
        assertEq(
            uint256(_getMilestoneState(id, 0)),
            uint256(MilestoneState.RELEASED),
            "milestone RELEASED even though funds stayed as Arc credit"
        );
    }
}
