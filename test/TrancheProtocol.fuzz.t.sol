// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";

contract TrancheProtocolFuzzTest is Base {
    function testFuzz_Deposit_ValidAmounts(uint256 a, uint256 b, uint256 c, uint256 reviewWindow) public {
        // The suite default DEST_DOMAIN is cross-chain, so each milestone must
        // out-size CCTP_FORWARD_FEE (M-02 floor enforced at deposit).
        a = bound(a, CCTP_FORWARD_FEE + 1, 1e12);
        b = bound(b, CCTP_FORWARD_FEE + 1, 1e12);
        c = bound(c, CCTP_FORWARD_FEE + 1, 1e12);
        reviewWindow = bound(reviewWindow, 1 days, 7 days);

        uint256 total = a + b + c;
        usdc.mint(depositor, total);

        uint256[] memory ms = new uint256[](3);
        ms[0] = a;
        ms[1] = b;
        ms[2] = c;

        uint256 before = usdc.balanceOf(address(escrow));
        uint256 id = _depositCustom(depositor, recipient, refundTo, total, ms, reviewWindow);

        assertEq(_getEscrowTotalAmount(id), total);
        assertEq(_getEscrowMilestoneCount(id), 3);
        assertEq(usdc.balanceOf(address(escrow)) - before, total);
        for (uint256 i = 0; i < 3; i++) {
            assertEq(uint256(_getMilestoneState(id, i)), uint256(MilestoneState.PENDING));
        }
    }

    function testFuzz_Deposit_RevertOn_SumMismatch(uint256 a, uint256 b, uint256 wrong) public {
        a = bound(a, 1, 1e12);
        b = bound(b, 1, 1e12);
        wrong = bound(wrong, 1, 1e12);
        vm.assume(wrong != a + b);

        usdc.mint(depositor, wrong);

        uint256[] memory ms = new uint256[](2);
        ms[0] = a;
        ms[1] = b;

        vm.startPrank(depositor);
        usdc.approve(address(escrow), wrong);
        vm.expectRevert(MilestoneAmountMismatch.selector);
        escrow.deposit(
            recipient,
            refundTo,
            wrong,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            ms,
            block.timestamp + 1 days,
            new SplitRecipient[](0),
            new string[](0)
        );
        vm.stopPrank();
    }

    function testFuzz_ClaimDelivery_OnlyRecipient(address caller) public {
        vm.assume(caller != recipient);
        uint256 id = _depositSingle(100e6);
        vm.prank(caller);
        vm.expectRevert(NotRecipient.selector);
        escrow.claimDelivery(id, 0);
    }

    function testFuzz_RaiseDispute_OnlyDepositor(address caller) public {
        vm.assume(caller != depositor);
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        vm.prank(caller);
        vm.expectRevert(NotEscrowOwner.selector);
        escrow.raiseDispute(id, 0, "r", keccak256("ev"), "ipfs://ev");
    }

    function testFuzz_RaiseDispute_WithinWindow(uint256 elapsed) public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        elapsed = bound(elapsed, 0, REVIEW_WINDOW);
        vm.warp(block.timestamp + elapsed);
        _raiseDispute(id, 0);
        assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.DISPUTED));
    }

    function testFuzz_RaiseDispute_OutsideWindow(uint256 elapsed) public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        elapsed = bound(elapsed, REVIEW_WINDOW + 1, REVIEW_WINDOW + 20 days);
        vm.warp(block.timestamp + elapsed);
        vm.prank(depositor);
        vm.expectRevert(ReviewWindowExpired.selector);
        escrow.raiseDispute(id, 0, "r", keccak256("ev"), "ipfs://ev");
    }

    function testFuzz_Release_Timing(uint256 elapsed) public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        elapsed = bound(elapsed, 0, REVIEW_WINDOW * 5);
        vm.warp(block.timestamp + elapsed);
        if (elapsed < REVIEW_WINDOW) {
            vm.expectRevert(ReviewWindowNotExpired.selector);
            escrow.release(id, 0, CCTP_FORWARD_FEE);
        } else {
            escrow.release(id, 0, CCTP_FORWARD_FEE);
            assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
        }
    }

    function testFuzz_ResolveDispute_OnlyArbiter(address caller) public {
        vm.assume(caller != arbiter);
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        vm.prank(caller);
        vm.expectRevert(); // AccessControlUnauthorizedAccount(caller, ARBITER_ROLE)
        escrow.resolveDispute(id, 0, 10_000, keccak256("res"), "ipfs://res", 0);
    }

    function testFuzz_ResolveDispute_ReleaseOrRefund(bool releaseToRecipient) public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        _resolveAs(arbiter, id, 0, releaseToRecipient);
        if (releaseToRecipient) {
            assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.RELEASED));
            assertEq(usdc.balanceOf(address(tokenMessenger)), 100e6);
        } else {
            assertEq(uint256(_getMilestoneState(id, 0)), uint256(MilestoneState.REFUNDED));
            assertEq(escrow.refundBalances(refundTo), 100e6);
        }
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));
    }

    function testFuzz_MutualCancel_OrderInvariant(bool depositorFirst) public {
        uint256 id = _depositMulti();
        if (depositorFirst) {
            vm.prank(depositor);
            escrow.mutualCancel(id);
            vm.prank(recipient);
            escrow.mutualCancel(id);
        } else {
            vm.prank(recipient);
            escrow.mutualCancel(id);
            vm.prank(depositor);
            escrow.mutualCancel(id);
        }
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.CANCELLED));
        assertEq(escrow.refundBalances(refundTo), 600e6);
    }

    function testFuzz_FullLifecycle_RandomReleaseRefundMix(uint256 seed) public {
        uint256 id = _depositMulti();
        uint256 expectedBurn;
        uint256 expectedRefund;
        for (uint256 i = 0; i < 3; i++) {
            _claimDelivery(id, i);
            uint256 choice = uint256(keccak256(abi.encode(seed, i))) % 3;
            uint256 amt = _getMilestoneAmount(id, i);
            if (choice == 0) {
                vm.warp(block.timestamp + REVIEW_WINDOW);
                _release(id, i);
                expectedBurn += amt;
            } else if (choice == 1) {
                _raiseDispute(id, i);
                _resolveAs(arbiter, id, i, true);
                expectedBurn += amt;
            } else {
                _raiseDispute(id, i);
                _resolveAs(arbiter, id, i, false);
                expectedRefund += amt;
            }
        }
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));
        assertEq(usdc.balanceOf(address(tokenMessenger)), expectedBurn);
        assertEq(escrow.refundBalances(refundTo), expectedRefund);
        assertEq(usdc.balanceOf(address(escrow)), expectedRefund);
    }
}
