// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";
import {CrossChainEscrow} from "../src/CrossChainEscrow.sol";
import {ICrossChainEscrow} from "../src/interface/ICrossChainEscrow.sol";

contract CrossChainEscrowReceivingAddressTest is Base {
    uint32 internal constant ARC_DOMAIN = 26;

    function setUp() public override {
        super.setUp();
        // updateReceivingAddress always targets ARC_DOMAIN (same-chain flow).
        vm.prank(domainManager);
        escrow.addSupportedDomain(ARC_DOMAIN);
    }

    function _seed() internal returns (uint256) {
        return _depositSingle(100e6);
    }

    // ----- bytes32 conversion correctness -----

    function test_AddressToBytes32_LeftPadsAddressIntoUpperZeroes() public {
        uint256 id = _seed();
        address newAddr = makeAddr("newRecipient");

        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newAddr);

        bytes32 expected = bytes32(uint256(uint160(newAddr)));
        (,,,,, bytes32 storedMintRecipient,,,,,,,,,) = escrow.escrows(id);
        assertEq(storedMintRecipient, expected, "stored mintRecipient must be left-padded address");
        assertEq(uint256(storedMintRecipient) >> 160, 0, "upper 96 bits must be zero");
        assertEq(address(uint160(uint256(storedMintRecipient))), newAddr, "decode round-trips");
    }

    function test_AddressToBytes32_MatchesFrontendPadFormula() public {
        // Mirrors the frontend helper: '0x' + addr.slice(2).padStart(64, '0').
        uint256 id = _seed();
        address newAddr = 0xCa11AbcEFfFf1234567890123ABCdEF0Fedcba98;

        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newAddr);

        bytes32 manual = bytes32(uint256(uint160(newAddr)));
        (,,,,, bytes32 stored,,,,,,,,,) = escrow.escrows(id);
        assertEq(stored, manual);
    }

    // ----- permission gating -----

    function test_UpdateReceivingAddress_OnlyRecipient_RevertOn_Depositor() public {
        uint256 id = _seed();
        vm.prank(depositor);
        vm.expectRevert(NotRecipient.selector);
        escrow.updateReceivingAddress(id, makeAddr("x"));
    }

    function test_UpdateReceivingAddress_OnlyRecipient_RevertOn_Arbiter() public {
        uint256 id = _seed();
        vm.prank(arbiter);
        vm.expectRevert(NotRecipient.selector);
        escrow.updateReceivingAddress(id, makeAddr("x"));
    }

    function test_UpdateReceivingAddress_OnlyRecipient_RevertOn_Stranger() public {
        uint256 id = _seed();
        vm.prank(stranger);
        vm.expectRevert(NotRecipient.selector);
        escrow.updateReceivingAddress(id, makeAddr("x"));
    }

    function testFuzz_UpdateReceivingAddress_OnlyRecipient(address caller) public {
        vm.assume(caller != recipient);
        vm.assume(caller != address(0));
        uint256 id = _seed();
        vm.prank(caller);
        vm.expectRevert(NotRecipient.selector);
        escrow.updateReceivingAddress(id, makeAddr("x"));
    }

    // ----- input validation -----

    function test_UpdateReceivingAddress_RevertOn_ZeroAddress() public {
        uint256 id = _seed();
        vm.prank(recipient);
        vm.expectRevert(ZeroAddress.selector);
        escrow.updateReceivingAddress(id, address(0));
    }

    function test_UpdateReceivingAddress_RevertOn_NonExistentEscrow() public {
        vm.prank(recipient);
        vm.expectRevert(EscrowDoesNotExist.selector);
        escrow.updateReceivingAddress(9999, makeAddr("x"));
    }

    function test_UpdateReceivingAddress_RevertOn_CompletedEscrow() public {
        uint256 id = _seed();
        // Drive the escrow to COMPLETED via a full release path.
        _fulfill(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        // Switch the cross-chain escrow to same-chain so release uses maxFee=0.
        vm.prank(recipient);
        escrow.updateReceivingAddress(id, recipient);
        escrow.releaseAfterWindow(id, 0, 0);

        vm.prank(recipient);
        vm.expectRevert(InvalidState.selector);
        escrow.updateReceivingAddress(id, makeAddr("z"));
    }

    // ----- event emission -----

    function test_UpdateReceivingAddress_EmitsEvent() public {
        uint256 id = _seed();
        address newAddr = makeAddr("brandNew");

        // L-03: event now carries old (mintRecipient, destinationDomain).
        // _seed() creates the escrow with DEST_DOMAIN (cross-chain) and
        // MINT_RECIPIENT, so those are the "old" values for the redirect.
        vm.expectEmit(true, false, false, true, address(escrow));
        emit ReceivingAddressUpdated(id, MINT_RECIPIENT, DEST_DOMAIN, newAddr, recipient);

        vm.prank(recipient);
        escrow.updateReceivingAddress(id, newAddr);
    }

    function test_UpdateReceivingAddress_SwitchesDestinationToArcDomain() public {
        uint256 id = _seed();
        // _seed creates with DEST_DOMAIN = 6 (cross-chain); verify the update
        // flips destinationDomain to ARC_DOMAIN for the same-chain payout path.
        (,,,, uint32 destBefore,,,,,,,,,,) = escrow.escrows(id);
        assertEq(destBefore, DEST_DOMAIN);

        vm.prank(recipient);
        escrow.updateReceivingAddress(id, makeAddr("freelancer2"));

        (,,,, uint32 destAfter,,,,,,,,,,) = escrow.escrows(id);
        assertEq(destAfter, ARC_DOMAIN);
    }
}
