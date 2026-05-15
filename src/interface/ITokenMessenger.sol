// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ITokenMessenger (CCTP V2)
/// @notice Minimal interface for Circle's CCTP V2 TokenMessenger.
///         Reference: depositForBurn signature on TokenMessengerV2.
///         https://developers.circle.com/stablecoins/cctp-v2
///         https://developers.circle.com/cctp/howtos/transfer-usdc-with-forwarding-service
///
/// @dev    The plain `depositForBurn` overload has been intentionally omitted:
///         this contract only ever uses the hook-aware variant so that
///         Circle's Forwarding Service auto-delivers on the destination chain.
///         Auto-delivery only happens when the burn carries the
///         `cctp-forward` hook data, which is exclusive to
///         `depositForBurnWithHook`.
interface ITokenMessenger {
    /// @notice depositForBurn variant that includes hook data. The
    ///         CrossChainEscrow uses this overload to attach Circle's
    ///         forwarding-service hook so the destination-chain mint is
    ///         submitted automatically. The forwarding fee is deducted from
    ///         the minted amount on the destination domain.
    /// @param amount                 Amount of burnToken to burn.
    /// @param destinationDomain      CCTP destination domain id.
    /// @param mintRecipient          Recipient on destination domain (bytes32).
    /// @param burnToken              Address of token to burn on source domain.
    /// @param destinationCaller      Caller authorized to call receiveMessage on
    ///                               destination (bytes32(0) = anyone).
    /// @param maxFee                 Max fee depositor is willing to pay for the
    ///                               forwarding service (in burnToken units).
    /// @param minFinalityThreshold   Minimum finality threshold required for
    ///                               the attestation. Per Circle CCTP V2:
    ///                                 - 1000 = Fast Transfer
    ///                                 - 2000 = Standard Transfer (finalized)
    /// @param hookData               Arbitrary calldata appended to the burn
    ///                               message. For Circle's forwarding service
    ///                               this MUST be the 32-byte ASCII tag
    ///                               "cctp-forward" (right-padded with zeros).
    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;

    /// @notice Returns the minimum fee Circle currently charges for a
    ///         forwarded burn of `amount` USDC. Off-chain operators read this
    ///         to keep `cctpForwardFee` set to a value that won't cause
    ///         under-fee reverts on the destination chain.
    function getMinFeeAmount(uint256 amount) external view returns (uint256);
}
