// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice CCTP forwarding parameters under the new lifecycle: FORWARD_HOOK_DATA,
///         dynamic forwarding fee, same-chain vs cross-chain maxFee handling on
///         the approve/release settlement paths, and the cross-chain fee guards.
contract TrancheProtocolCctpSignalTest is Base {
    bytes32 internal constant CIRCLE_HOOK = 0x636374702d666f72776172640000000000000000000000000000000000000000;

    // -------------------------------------------------------------------------
    // FORWARD_HOOK_DATA
    // -------------------------------------------------------------------------

    function test_ForwardHookData_MatchesCircleSpec() public view {
        assertEq(CIRCLE_HOOK, 0x636374702d666f72776172640000000000000000000000000000000000000000);
    }

    // -------------------------------------------------------------------------
    // setCctpForwardFee
    // -------------------------------------------------------------------------

    function test_SetCctpForwardFee_AdminCanUpdate_AndEmits() public {
        vm.expectEmit(false, false, false, true, address(escrow));
        emit CctpForwardFeeUpdated(2_500_000);

        vm.prank(deployer);
        escrow.setCctpForwardFee(2_500_000);
        assertEq(escrow.cctpForwardFee(), 2_500_000);
    }

    function test_SetCctpForwardFee_RevertOn_NonAdmin() public {
        bytes memory expected = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, keccak256("FEE_MANAGER_ROLE")
        );
        vm.prank(stranger);
        vm.expectRevert(expected);
        escrow.setCctpForwardFee(1);
    }

    // -------------------------------------------------------------------------
    // CCTP burn parameters: same-chain vs cross-chain
    // -------------------------------------------------------------------------

    function test_CCTP_SameChainRelease_UsesDirectTransfer() public {
        uint32 arcDomain = 26;
        address arcRecipientAddr = address(0xA1C0);
        bytes32 arcRecipient = bytes32(uint256(uint160(arcRecipientAddr)));

        vm.prank(domainManager);
        escrow.addSupportedDomain(arcDomain);

        uint256 id = _depositToDomain(100e6, arcDomain, arcRecipient);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW);

        uint256 balBefore = usdc.balanceOf(arcRecipientAddr);
        escrow.release(id, 0, 0);
        uint256 balAfter = usdc.balanceOf(arcRecipientAddr);

        // Base.setUp sets protocolFeeBps = 0, so full amount reaches recipient.
        uint256 fee = (100e6 * escrow.protocolFeeBps()) / 10_000;
        assertEq(balAfter - balBefore, 100e6 - fee, "same-chain release must direct-transfer to recipient");
    }

    // M-R3-01: the permissionless release() path IGNORES the caller-supplied
    // maxFee and burns with the per-escrow snapshotted forwarding fee, so a
    // griefer cannot inflate the fee on someone else's payout.
    function test_CCTP_CrossChainRelease_IgnoresCallerMaxFee_UsesSnapshot() public {
        uint256 id = _depositSingle(100e6); // snapshot fee = CCTP_FORWARD_FEE
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW);
        escrow.release(id, 0, 123_456); // caller value is ignored

        (,,,,,, uint256 maxFee,,,) = _readBurnCall();
        assertEq(maxFee, CCTP_FORWARD_FEE, "release() must use the snapshot, not the caller value");
    }

    // M-R3-02: the snapshot is taken at deposit; release() uses it regardless of
    // any later caller value or global fee change.
    function test_CCTP_CrossChainRelease_UsesSnapshot_NotCallerValue() public {
        vm.prank(deployer);
        escrow.setCctpForwardFee(777_777);

        uint256 id = _depositSingle(100e6); // snapshot fee = 777_777
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW);
        escrow.release(id, 0, 800_000); // caller value ignored

        (,,,,,, uint256 maxFee,,,) = _readBurnCall();
        assertEq(maxFee, 777_777, "release() uses the snapshotted fee, not the caller value");
    }

    // M-R3-01: release() can no longer revert below-floor (it uses the snapshot,
    // which always clears its own floor). The floor revert is now exercised on
    // the depositor path, approveRelease(), which still honours a caller value.
    function test_CCTP_CrossChainApproveRelease_RevertOn_MaxFeeBelowFloor() public {
        vm.prank(deployer);
        escrow.setCctpForwardFee(777_777);

        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        vm.prank(depositor);
        vm.expectRevert(MaxFeeBelowFloor.selector);
        escrow.approveRelease(id, 0, 777_776);
    }

    function test_CCTP_CrossChain_RevertOn_ZeroForwardFee() public {
        vm.prank(deployer);
        escrow.setCctpForwardFee(0);

        // F2 (Hole C): a zero forwarding fee now makes a cross-chain escrow
        // un-creatable, so the guard fires at deposit rather than at release
        // (which previously left a stuck, never-releasable escrow).
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        vm.expectRevert(CctpForwardFeeNotSet.selector);
        escrow.deposit(
            recipient,
            refundTo,
            100e6,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            REVIEW_WINDOW,
            INVOICE_HASH,
            INVOICE_URI,
            _singleMilestone(100e6),
            block.timestamp + 30 days,
            new SplitRecipient[](0),
            ""
        );
        vm.stopPrank();
    }

    function test_CCTP_ApproveRelease_ForwardsCallerMaxFee() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        vm.prank(depositor);
        escrow.approveRelease(id, 0, 222_222);

        (,,,,,, uint256 maxFee,,,) = _readBurnCall();
        assertEq(maxFee, 222_222);
    }

    function test_CCTP_CrossChainBurnAmount_EqualsMilestoneAmount() public {
        uint256 id = _depositSingle(100e6);
        _claimDelivery(id, 0);
        vm.warp(block.timestamp + REVIEW_WINDOW);
        escrow.release(id, 0, CCTP_FORWARD_FEE);

        (, uint256 burnAmount,,,,, uint256 maxFee,,,) = _readBurnCall();
        assertEq(maxFee, CCTP_FORWARD_FEE);
        assertEq(burnAmount, 100e6); // protocol fee is 0 in the harness
    }

    // -------------------------------------------------------------------------
    // helpers
    // -------------------------------------------------------------------------

    function _depositToDomain(uint256 amount, uint32 domain, bytes32 mintRecipient) internal returns (uint256 id) {
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        id = escrow.deposit(
            recipient,
            refundTo,
            amount,
            domain,
            mintRecipient,
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
    }

    /// @dev Most recent CCTP burn call in MockTokenMessenger's storage order.
    function _readBurnCall()
        internal
        view
        returns (
            address caller,
            uint256 amount,
            uint32 destinationDomain,
            bytes32 mintRecipient_,
            address burnToken,
            bytes32 destinationCaller,
            uint256 maxFee,
            uint32 minFinalityThreshold,
            bool withHook,
            bytes memory hookData
        )
    {
        (
            caller,
            amount,
            destinationDomain,
            mintRecipient_,
            burnToken,
            destinationCaller,
            maxFee,
            minFinalityThreshold,
            withHook,
            hookData
        ) = tokenMessenger.calls(tokenMessenger.callsLength() - 1);
    }
}
