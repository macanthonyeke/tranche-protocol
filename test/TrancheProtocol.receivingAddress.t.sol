// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";

contract TrancheProtocolReceivingAddressTest is Base {
    uint32 internal constant ARC_DOMAIN = 26;

    function setUp() public override {
        super.setUp();
        // ARC_DOMAIN is the home chain; many tests redirect to it.
        vm.prank(domainManager);
        escrow.addSupportedDomain(ARC_DOMAIN);
    }

    function _seed() internal returns (uint256) {
        return _depositSingle(100e6);
    }

    function _toB32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    // ----- bytes32 storage + domain storage correctness -----

    function test_BytesAddress_IsStoredAsProvided() public {
        uint256 id = _seed();
        address newAddr = makeAddr("newRecipient");
        bytes32 newB32 = _toB32(newAddr);

        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newB32, ARC_DOMAIN);

        bytes32 stored = escrow.getEscrow(id).mintRecipient;
        assertEq(stored, newB32, "stored mintRecipient must match the provided bytes32");
        assertEq(address(uint160(uint256(stored))), newAddr, "decode round-trips to original address");
    }

    function test_BytesAddress_MatchesFrontendPadFormula() public {
        // Mirrors the frontend helper: '0x' + addr.slice(2).padStart(64, '0').
        uint256 id = _seed();
        address newAddr = 0xCa11AbcEFfFf1234567890123ABCdEF0Fedcba98;

        vm.prank(recipient);
        escrow.updateReceivingAddress(id, _toB32(newAddr), ARC_DOMAIN);

        bytes32 manual = bytes32(uint256(uint160(newAddr)));
        bytes32 stored = escrow.getEscrow(id).mintRecipient;
        assertEq(stored, manual);
    }

    function test_Domain_IsStoredCorrectly_Arc() public {
        uint256 id = _seed();
        bytes32 newAddr = _toB32(makeAddr("newRecipient"));

        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newAddr, ARC_DOMAIN);

        uint32 destAfter = escrow.getEscrow(id).destinationDomain;
        assertEq(destAfter, ARC_DOMAIN);
    }

    function test_Domain_IsStoredCorrectly_OtherSupported() public {
        uint256 id = _seed();
        bytes32 newAddr = _toB32(makeAddr("newRecipient"));

        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newAddr, DEST_DOMAIN);

        uint32 destAfter = escrow.getEscrow(id).destinationDomain;
        assertEq(destAfter, DEST_DOMAIN);
    }

    function test_Domain_CanChangeBetweenSupportedDomains() public {
        uint256 id = _seed();
        // _seed creates with DEST_DOMAIN (6, cross-chain). cross -> Arc is
        // allowed; Arc -> cross is now blocked (F3: a same-chain escrow's
        // milestones were never floor-validated for a cross-chain burn, and the
        // O(1) guard cannot tell this one was originally cross-chain).
        bytes32 a1 = _toB32(makeAddr("a1"));
        bytes32 a2 = _toB32(makeAddr("a2"));

        vm.prank(recipient);
        escrow.updateReceivingAddress(id, a1, ARC_DOMAIN);
        assertEq(escrow.getEscrow(id).destinationDomain, ARC_DOMAIN);

        vm.prank(recipient);
        vm.expectRevert(MilestoneBelowForwardFee.selector);
        escrow.updateReceivingAddress(id, a2, DEST_DOMAIN);
    }

    // ----- permission gating -----

    function test_OnlyRecipient_RevertOn_Depositor() public {
        uint256 id = _seed();
        vm.prank(depositor);
        vm.expectRevert(NotRecipient.selector);
        escrow.updateReceivingAddress(id, _toB32(makeAddr("x")), ARC_DOMAIN);
    }

    function test_OnlyRecipient_RevertOn_Arbiter() public {
        uint256 id = _seed();
        vm.prank(arbiter);
        vm.expectRevert(NotRecipient.selector);
        escrow.updateReceivingAddress(id, _toB32(makeAddr("x")), ARC_DOMAIN);
    }

    function test_OnlyRecipient_RevertOn_Stranger() public {
        uint256 id = _seed();
        vm.prank(stranger);
        vm.expectRevert(NotRecipient.selector);
        escrow.updateReceivingAddress(id, _toB32(makeAddr("x")), ARC_DOMAIN);
    }

    function testFuzz_OnlyRecipient(address caller) public {
        vm.assume(caller != recipient);
        vm.assume(caller != address(0));
        uint256 id = _seed();
        vm.prank(caller);
        vm.expectRevert(NotRecipient.selector);
        escrow.updateReceivingAddress(id, _toB32(makeAddr("x")), ARC_DOMAIN);
    }

    // ----- input validation -----

    function test_RevertOn_ZeroBytes32() public {
        uint256 id = _seed();
        vm.prank(recipient);
        vm.expectRevert(ZeroAddress.selector);
        escrow.updateReceivingAddress(id, bytes32(0), ARC_DOMAIN);
    }

    function test_RevertOn_NonZeroBytes32WithZeroLower160() public {
        uint256 id = _seed();
        bytes32 weird = bytes32(uint256(1) << 200);
        vm.prank(recipient);
        vm.expectRevert(ZeroAddress.selector);
        escrow.updateReceivingAddress(id, weird, ARC_DOMAIN);
    }

    function test_RevertOn_UnsupportedDomain() public {
        uint256 id = _seed();
        vm.prank(recipient);
        vm.expectRevert(UnsupportedDomain.selector);
        escrow.updateReceivingAddress(id, _toB32(makeAddr("x")), 42);
    }

    function test_RevertOn_NonExistentEscrow() public {
        vm.prank(recipient);
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.updateReceivingAddress(9999, _toB32(makeAddr("x")), ARC_DOMAIN);
    }

    // ----- state gating: ACTIVE and DISPUTED allowed; COMPLETED / CANCELLED blocked -----

    function test_AllowedDuringDisputedMilestone() public {
        uint256 id = _depositMulti();
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);

        bytes32 newAddr = _toB32(makeAddr("freshWallet"));
        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newAddr, ARC_DOMAIN);

        uint32 destAfter = escrow.getEscrow(id).destinationDomain;
        bytes32 mrAfter = escrow.getEscrow(id).mintRecipient;
        assertEq(destAfter, ARC_DOMAIN);
        assertEq(mrAfter, newAddr);
    }

    function test_RevertOn_CompletedEscrow() public {
        uint256 id = _seed();
        _claimDelivery(id, 0);
        // Switch to same-chain so release uses maxFee = 0.
        vm.prank(recipient);
        escrow.updateReceivingAddress(id, _toB32(recipient), ARC_DOMAIN);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        escrow.release(id, 0, 0);
        // Escrow is now COMPLETED.
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.COMPLETED));

        vm.prank(recipient);
        vm.expectRevert(InvalidState.selector);
        escrow.updateReceivingAddress(id, _toB32(makeAddr("z")), ARC_DOMAIN);
    }

    function test_RevertOn_CancelledEscrow() public {
        uint256 id = _seed();
        vm.prank(depositor);
        escrow.mutualCancel(id);
        vm.prank(recipient);
        escrow.mutualCancel(id);
        // Escrow is now CANCELLED.
        assertEq(uint256(_getEscrowState(id)), uint256(EscrowState.CANCELLED));

        vm.prank(recipient);
        vm.expectRevert(InvalidState.selector);
        escrow.updateReceivingAddress(id, _toB32(makeAddr("z")), ARC_DOMAIN);
    }

    // ----- event emission -----

    function test_EmitsEvent_WithOldAndNewAddressAndDomain() public {
        uint256 id = _seed();
        bytes32 newAddr = _toB32(makeAddr("brandNew"));

        // _seed creates with DEST_DOMAIN (cross-chain, 6) and MINT_RECIPIENT.
        vm.expectEmit(true, false, false, true, address(escrow));
        emit ReceivingAddressUpdated(id, MINT_RECIPIENT, newAddr, DEST_DOMAIN, ARC_DOMAIN);

        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newAddr, ARC_DOMAIN);
    }

    // ----- M-04: ARC_DOMAIN works even when not on supportedDomains allow-list -----

    function test_ArcDomain_AllowedEvenIfNotSupported() public {
        // Re-deploy via fresh helper: remove ARC from supported.
        vm.prank(domainManager);
        escrow.removeSupportedDomain(ARC_DOMAIN);
        assertFalse(escrow.supportedDomains(ARC_DOMAIN));

        uint256 id = _seed();
        bytes32 newAddr = _toB32(makeAddr("fresh"));

        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newAddr, ARC_DOMAIN);

        uint32 destAfter = escrow.getEscrow(id).destinationDomain;
        bytes32 mrAfter = escrow.getEscrow(id).mintRecipient;
        assertEq(destAfter, ARC_DOMAIN);
        assertEq(mrAfter, newAddr);
    }
}
