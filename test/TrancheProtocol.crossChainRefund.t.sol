// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {MockTokenMessenger} from "./mocks/MockTokenMessenger.sol";

/// @notice Coverage for the cross-chain {withdrawRefund} path added on top of
///         the existing Arc safeTransfer path. A depositor whose refund credit
///         must leave Arc can burn it through CCTP to a wallet on another
///         domain; the contract converts the supplied address to bytes32 and
///         deducts the forwarding fee before the burn.
contract TrancheProtocolCrossChainRefundTest is Base {
    address internal xchainWallet = makeAddr("xchainWallet");

    /// @dev Deposit -> claim -> dispute -> arbiter refunds the depositor, so
    ///      `refundTo` ends up with a `amount` refund credit to withdraw.
    function _seedRefundCredit(uint256 amount) internal returns (uint256 id) {
        id = _depositSingle(amount);
        _claimDelivery(id, 0);
        _raiseDispute(id, 0);
        _resolveAs(arbiter, id, 0, false); // recipientBps = 0 -> full refund
        assertEq(escrow.refundBalances(refundTo), amount);
    }

    // ----------------------------------------------------------------------
    // Cross-chain happy path
    // ----------------------------------------------------------------------

    function test_CrossChain_BurnsClearsBalanceAndConvertsRecipient() public {
        _seedRefundCredit(100e6);

        uint256 maxFee = 1e6;
        uint256 expectedBurn = 100e6 - maxFee;
        uint256 callsBefore = tokenMessenger.callsLength();

        vm.expectEmit(true, false, false, true, address(escrow));
        emit RefundWithdrawn(xchainWallet, 100e6);

        vm.prank(refundTo);
        escrow.withdrawRefund(xchainWallet, DEST_DOMAIN, xchainWallet, maxFee);

        // Refund credit fully cleared.
        assertEq(escrow.refundBalances(refundTo), 0, "credit not cleared");

        // Exactly one new CCTP burn was issued with the right parameters.
        assertEq(tokenMessenger.callsLength(), callsBefore + 1, "no burn issued");
        MockTokenMessenger.BurnCall memory c = tokenMessenger.lastCall();
        assertEq(c.amount, expectedBurn, "burn amount should be credit minus maxFee");
        assertEq(c.maxFee, maxFee, "maxFee passed through");
        assertEq(c.destinationDomain, DEST_DOMAIN, "destination domain");
        // Address converted to bytes32 internally; user never passes bytes32.
        assertEq(c.mintRecipient, bytes32(uint256(uint160(xchainWallet))), "converted recipient");
    }

    // ----------------------------------------------------------------------
    // Cross-chain guards
    // ----------------------------------------------------------------------

    function test_CrossChain_RevertOn_ZeroMaxFee() public {
        _seedRefundCredit(100e6);
        vm.prank(refundTo);
        vm.expectRevert(MaxFeeRequired.selector);
        escrow.withdrawRefund(xchainWallet, DEST_DOMAIN, xchainWallet, 0);
    }

    function test_CrossChain_RevertOn_BalanceNotAboveMaxFee() public {
        _seedRefundCredit(100e6);
        // maxFee == balance -> nothing left to burn.
        vm.prank(refundTo);
        vm.expectRevert(RefundBelowMaxFee.selector);
        escrow.withdrawRefund(xchainWallet, DEST_DOMAIN, xchainWallet, 100e6);
    }

    function test_CrossChain_RevertOn_BalanceBelowMaxFee() public {
        _seedRefundCredit(100e6);
        vm.prank(refundTo);
        vm.expectRevert(RefundBelowMaxFee.selector);
        escrow.withdrawRefund(xchainWallet, DEST_DOMAIN, xchainWallet, 100e6 + 1);
    }

    function test_CrossChain_RevertOn_ZeroMintRecipient() public {
        _seedRefundCredit(100e6);
        vm.prank(refundTo);
        vm.expectRevert(ZeroAddress.selector);
        escrow.withdrawRefund(xchainWallet, DEST_DOMAIN, address(0), 1e6);
    }

    function test_CrossChain_RevertOn_UnsupportedDomain() public {
        _seedRefundCredit(100e6);
        uint32 unsupported = 99;
        vm.prank(refundTo);
        vm.expectRevert(UnsupportedDomain.selector);
        escrow.withdrawRefund(xchainWallet, unsupported, xchainWallet, 1e6);
    }

    // ----------------------------------------------------------------------
    // Arc path regression (destinationDomain == 0)
    // ----------------------------------------------------------------------

    function test_ArcPath_StillSafeTransfersFullBalance() public {
        _seedRefundCredit(100e6);
        uint256 callsBefore = tokenMessenger.callsLength();

        vm.expectEmit(true, false, false, true, address(escrow));
        emit RefundWithdrawn(xchainWallet, 100e6);

        vm.prank(refundTo);
        // mintRecipient / maxFee are ignored on the Arc path.
        escrow.withdrawRefund(xchainWallet, 0, address(0), 0);

        // Full balance delivered on-chain, no CCTP burn.
        assertEq(usdc.balanceOf(xchainWallet), 100e6, "did not receive funds");
        assertEq(escrow.refundBalances(refundTo), 0, "credit not cleared");
        assertEq(tokenMessenger.callsLength(), callsBefore, "Arc path must not burn");
    }

    function test_ArcPath_RevertOn_ZeroRecipient() public {
        _seedRefundCredit(100e6);
        vm.prank(refundTo);
        vm.expectRevert(InvalidRefundRecipient.selector);
        escrow.withdrawRefund(address(0), 0, address(0), 0);
    }

    function test_ArcPath_RevertOn_NothingToWithdraw() public {
        vm.prank(stranger);
        vm.expectRevert(NothingToWithdraw.selector);
        escrow.withdrawRefund(stranger, 0, address(0), 0);
    }
}
