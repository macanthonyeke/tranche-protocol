// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";

/// @title Round-3 audit regression tests (WEB3-AUDIT-SKILLS pass, 2026-06-01)
/// @notice Each test pins the *fixed* behaviour for a round-3 finding:
///         M-R3-01 (permissionless maxFee cap), M-R3-02 (per-escrow fee
///         snapshot), L-R3-03 (settlement fee floor). They fail against the
///         pre-fix code and pass once the fixes are in.
contract AuditRound3Test is Base {
    // -------------------------------------------------------------------------
    // M-R3-01: permissionless release() lets ANY caller set an arbitrary maxFee
    // (up to burnAmount-1) on someone else's cross-chain payout. The contract
    // already knows the correct fee (cctpForwardFee) but trusts the caller's
    // value instead of capping it.
    // -------------------------------------------------------------------------
    function test_R3_01_release_caps_maxFee_at_protocol_fee() public {
        uint256 amount = 1_000e6; // 1,000 USDC milestone, cross-chain (domain 6)
        usdc.mint(depositor, amount);
        uint256 id = _depositSingle(amount);
        _claimDelivery(id, 0);

        // Review window lapses -> release() is permissionless.
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);

        // A stranger releases trying to inflate maxFee to ~the whole payout.
        uint256 grief = amount - 1;
        vm.prank(stranger);
        escrow.release(id, 0, grief);

        // FIXED: the griefer's maxFee is ignored; the burn carries the
        // protocol-tracked forwarding fee (0.1 USDC) instead.
        assertEq(tokenMessenger.lastCall().maxFee, CCTP_FORWARD_FEE);
        assertLt(tokenMessenger.lastCall().maxFee, grief);
    }

    // -------------------------------------------------------------------------
    // M-R3-02: FEE_MANAGER raising cctpForwardFee above an in-flight milestone's
    // burn amount bricks BOTH cross-chain release paths. The release math needs
    //   cctpForwardFee <= maxFee < burnAmount
    // which is unsatisfiable once cctpForwardFee >= burnAmount. M-02 only
    // guarded this at deposit time; the fee is admin-mutable afterwards.
    // -------------------------------------------------------------------------
    function test_R3_02_fee_snapshot_survives_admin_fee_bump() public {
        uint256 amount = 1e6; // 1 USDC milestone, > deposit-time fee (0.1 USDC)
        usdc.mint(depositor, amount);
        uint256 id = _depositSingle(amount);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);

        // The escrow snapshotted the forwarding fee (0.1 USDC) at deposit.
        assertEq(escrow.getEscrow(id).escrowCctpForwardFee, CCTP_FORWARD_FEE);

        // Admin later bumps the GLOBAL forwarding fee to 2 USDC -- larger than
        // the 1 USDC milestone, which pre-fix would have bricked release.
        vm.prank(deployer);
        escrow.setCctpForwardFee(2e6);

        // FIXED: the release uses the per-escrow snapshot, not the live global,
        // so it still succeeds and burns with the snapshotted 0.1 USDC fee.
        vm.prank(stranger);
        escrow.release(id, 0, 0); // caller maxFee ignored on permissionless path
        assertEq(uint8(_getMilestoneState(id, 0)), uint8(MilestoneState.RELEASED));
        assertEq(tokenMessenger.lastCall().maxFee, CCTP_FORWARD_FEE);
    }

    // -------------------------------------------------------------------------
    // L-R3-03: dispute settlement paths (resolveDispute / mutualSettle) route
    // the recipient's share through CCTP but never apply the cross-chain fee
    // floor that approveRelease/release enforce. A cross-chain settlement with
    // maxFee = 0 is accepted on-chain but is never auto-delivered by Circle's
    // Forwarding Service (the exact L-04 footgun the floor exists to prevent).
    // -------------------------------------------------------------------------
    function test_R3_03_dispute_settlement_enforces_crosschain_fee_floor() public {
        uint256 amount = 1_000e6;
        usdc.mint(depositor, amount);
        uint256 id = _depositSingle(amount);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        // FIXED: awarding a cross-chain recipient share with maxFee below the
        // floor now reverts instead of emitting an undeliverable burn.
        vm.prank(arbiter);
        vm.expectRevert(MaxFeeBelowFloor.selector);
        escrow.resolveDispute(id, 0, 10_000, keccak256("res"), "ipfs://res", 0);

        // With a maxFee that clears the floor it settles normally.
        vm.prank(arbiter);
        escrow.resolveDispute(id, 0, 10_000, keccak256("res"), "ipfs://res", CCTP_FORWARD_FEE);
        assertEq(tokenMessenger.lastCall().destinationDomain, DEST_DOMAIN);
        assertEq(tokenMessenger.lastCall().maxFee, CCTP_FORWARD_FEE);
    }
}
