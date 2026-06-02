// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";

/// @notice Regression tests for the deposit-time and redirect fixes that remain
///         distinct under the new lifecycle: M-02 (undersized cross-chain
///         milestones), L-01 (forwarding-fee cap), L-03 (split redirect).
contract TrancheProtocolAuditRound2Test is Base {
    function _deposit(
        uint32 domain,
        bytes32 mintRecipient,
        uint256[] memory ms,
        uint256 total,
        SplitRecipient[] memory sp
    ) internal returns (uint256 id) {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), total);
        id = escrow.deposit(
            recipient,
            refundTo,
            total,
            domain,
            mintRecipient,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            ms,
            block.timestamp + 30 days,
            sp
        );
        vm.stopPrank();
    }

    function _noSplits() internal pure returns (SplitRecipient[] memory) {
        return new SplitRecipient[](0);
    }

    // =======================================================================
    // M-02: cross-chain escrows reject milestones that do not out-size the
    //       forwarding fee; same-chain escrows are exempt.
    // =======================================================================

    function test_M02_Deposit_RevertOn_CrossChainMilestoneAtForwardFee() public {
        uint256[] memory ms = _singleMilestone(CCTP_FORWARD_FEE); // equal -> not > fee
        vm.startPrank(depositor);
        usdc.approve(address(escrow), CCTP_FORWARD_FEE);
        vm.expectRevert(MilestoneBelowForwardFee.selector);
        escrow.deposit(
            recipient,
            refundTo,
            CCTP_FORWARD_FEE,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            ms,
            block.timestamp + 30 days,
            _noSplits()
        );
        vm.stopPrank();
    }

    function test_M02_Deposit_AllowsCrossChainMilestoneAboveForwardFee() public {
        uint256 amt = CCTP_FORWARD_FEE + 1;
        uint256 id = _deposit(DEST_DOMAIN, MINT_RECIPIENT, _singleMilestone(amt), amt, _noSplits());
        assertEq(_getMilestoneAmount(id, 0), amt);
    }

    function test_M02_Deposit_AllowsSameChainTinyMilestone() public {
        uint32 arc = escrow.ARC_DOMAIN();
        vm.prank(domainManager);
        escrow.addSupportedDomain(arc);

        uint256 id = _deposit(arc, MINT_RECIPIENT, _singleMilestone(1), 1, _noSplits());
        assertEq(_getMilestoneAmount(id, 0), 1);
    }

    function test_M02_Deposit_RevertOn_SplitsCrossChainTinyMilestone() public {
        SplitRecipient[] memory sp = new SplitRecipient[](1);
        sp[0] = SplitRecipient({
            mintRecipient: bytes32(uint256(uint160(makeAddr("s")))),
            destinationDomain: DEST_DOMAIN,
            bps: 10_000
        });
        uint256[] memory ms = _singleMilestone(CCTP_FORWARD_FEE);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), CCTP_FORWARD_FEE);
        vm.expectRevert(MilestoneBelowForwardFee.selector);
        escrow.deposit(
            recipient,
            refundTo,
            CCTP_FORWARD_FEE,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            ms,
            block.timestamp + 30 days,
            sp
        );
        vm.stopPrank();
    }

    // =======================================================================
    // L-01: cctpForwardFee is capped at MAX_CCTP_FORWARD_FEE.
    // =======================================================================

    function test_L01_SetCctpForwardFee_RevertOn_AboveMax() public {
        uint256 max = escrow.MAX_CCTP_FORWARD_FEE();
        vm.prank(deployer);
        vm.expectRevert(CctpForwardFeeTooHigh.selector);
        escrow.setCctpForwardFee(max + 1);
    }

    function test_L01_SetCctpForwardFee_AllowsExactlyMax() public {
        uint256 max = escrow.MAX_CCTP_FORWARD_FEE();
        vm.prank(deployer);
        escrow.setCctpForwardFee(max);
        assertEq(escrow.cctpForwardFee(), max);
    }

    // =======================================================================
    // L-03: split recipients can redirect their own entry.
    // =======================================================================

    function _depositTwoSplits(address a, address b) internal returns (uint256 id) {
        SplitRecipient[] memory sp = new SplitRecipient[](2);
        sp[0] =
            SplitRecipient({mintRecipient: bytes32(uint256(uint160(a))), destinationDomain: DEST_DOMAIN, bps: 6000});
        sp[1] =
            SplitRecipient({mintRecipient: bytes32(uint256(uint160(b))), destinationDomain: DEST_DOMAIN, bps: 4000});
        id = _deposit(DEST_DOMAIN, MINT_RECIPIENT, _singleMilestone(1000e6), 1000e6, sp);
    }

    function test_L03_SplitRecipient_CanRedirectOwnEntry() public {
        address splitA = makeAddr("splitA");
        address splitB = makeAddr("splitB");
        uint256 id = _depositTwoSplits(splitA, splitB);

        address newAddr = makeAddr("splitANew");
        bytes32 newEncoded = bytes32(uint256(uint160(newAddr)));

        vm.prank(splitA);
        escrow.updateSplitReceivingAddress(id, 0, newEncoded, DEST_DOMAIN);

        SplitRecipient[] memory got = escrow.getSplits(id);
        assertEq(got[0].mintRecipient, newEncoded);
        assertEq(got[0].destinationDomain, DEST_DOMAIN);
        assertEq(got[1].mintRecipient, bytes32(uint256(uint160(splitB))));
    }

    function test_L03_SplitRedirect_RevertOn_NotController() public {
        address splitA = makeAddr("splitA");
        address splitB = makeAddr("splitB");
        uint256 id = _depositTwoSplits(splitA, splitB);

        vm.prank(splitB);
        vm.expectRevert(NotRecipient.selector);
        escrow.updateSplitReceivingAddress(id, 0, bytes32(uint256(uint160(makeAddr("x")))), DEST_DOMAIN);
    }

    function test_L03_SplitRedirect_RevertOn_BadIndex() public {
        address splitA = makeAddr("splitA");
        address splitB = makeAddr("splitB");
        uint256 id = _depositTwoSplits(splitA, splitB);

        vm.prank(splitA);
        vm.expectRevert(InvalidSplitIndex.selector);
        escrow.updateSplitReceivingAddress(id, 5, bytes32(uint256(uint160(makeAddr("x")))), DEST_DOMAIN);
    }

    function test_L03_SplitRedirect_RevertOn_CompletedEscrow() public {
        address splitA = makeAddr("splitA");
        address splitB = makeAddr("splitB");
        uint256 id = _depositTwoSplits(splitA, splitB);

        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        _release(id, 0);
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));

        vm.prank(splitA);
        vm.expectRevert(InvalidState.selector);
        escrow.updateSplitReceivingAddress(id, 0, bytes32(uint256(uint160(makeAddr("x")))), DEST_DOMAIN);
    }
}
