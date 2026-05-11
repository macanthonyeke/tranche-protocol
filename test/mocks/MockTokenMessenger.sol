// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITokenMessenger} from "../../src/interface/ITokenMessenger.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Records every `depositForBurnWithHook` call and pulls USDC out of the
// caller using the previously granted allowance, mirroring real CCTP V2
// behaviour for tests.
contract MockTokenMessenger is ITokenMessenger {
    struct BurnCall {
        address caller;
        uint256 amount;
        uint32 destinationDomain;
        bytes32 mintRecipient;
        address burnToken;
        bytes32 destinationCaller;
        uint256 maxFee;
        uint32 minFinalityThreshold;
        bool withHook;
        bytes hookData;
    }

    BurnCall[] public calls;
    bool public shouldRevert;
    bool public reentrancyEnabled;
    address public reentrancyTarget;
    bytes public reentrancyPayload;

    event DepositForBurnRecorded(address indexed caller, uint256 amount, uint32 domain, bytes32 recipient);

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function setReentrancy(address target, bytes calldata payload) external {
        reentrancyEnabled = true;
        reentrancyTarget = target;
        reentrancyPayload = payload;
    }

    function callsLength() external view returns (uint256) {
        return calls.length;
    }

    function lastCall() external view returns (BurnCall memory) {
        return calls[calls.length - 1];
    }

    uint256 public minFeeAmount;

    function setMinFeeAmount(uint256 v) external {
        minFeeAmount = v;
    }

    function getMinFeeAmount(uint256 /* amount */) external view override returns (uint256) {
        return minFeeAmount;
    }

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external override {
        _recordAndBurn(
            amount,
            destinationDomain,
            mintRecipient,
            burnToken,
            destinationCaller,
            maxFee,
            minFinalityThreshold,
            true,
            hookData
        );
    }

    function _recordAndBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bool withHook,
        bytes memory hookData
    ) internal {
        if (shouldRevert) revert("MockTokenMessenger: forced revert");

        calls.push(
            BurnCall({
                caller: msg.sender,
                amount: amount,
                destinationDomain: destinationDomain,
                mintRecipient: mintRecipient,
                burnToken: burnToken,
                destinationCaller: destinationCaller,
                maxFee: maxFee,
                minFinalityThreshold: minFinalityThreshold,
                withHook: withHook,
                hookData: hookData
            })
        );

        // Pull the tokens from the caller using the allowance the contract
        // granted via its low-level approve. This validates that approve
        // actually moved allowance.
        IERC20(burnToken).transferFrom(msg.sender, address(this), amount);

        emit DepositForBurnRecorded(msg.sender, amount, destinationDomain, mintRecipient);

        if (reentrancyEnabled) {
            (bool ok,) = reentrancyTarget.call(reentrancyPayload);
            // Result intentionally ignored; the test asserts on the outer call.
            ok;
        }
    }
}
