// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {CrossChainEscrow} from "../src/CrossChainEscrow.sol";

/// @notice Deploys CrossChainEscrow to Arc testnet and seeds supported CCTP V2
///         destination domains.
///
/// Required env vars:
///   PRIVATE_KEY              uint256, deployer private key
///   ARBITER_ADDRESS          address with ARBITER_ROLE
///   PAUSER_ADDRESS           address with PAUSER_ROLE
///   DOMAIN_MANAGER_ADDRESS   address with DOMAIN_MANAGER_ROLE
///   PROTOCOL_TREASURY        address that receives protocol fees
///
/// Optional env vars (defaults shown):
///   USDC_ADDRESS             0x3600...0000 (Arc native USDC precompile)
///   TOKEN_MESSENGER          0x8FE6...2DAA (Arc TokenMessengerV2)
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy \
///       --rpc-url $ARC_TESTNET_RPC \
///       --broadcast
contract Deploy is Script {
    address internal constant ARC_USDC_PRECOMPILE = 0x3600000000000000000000000000000000000000;
    address internal constant ARC_TOKEN_MESSENGER_V2 = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;

    // CCTP V2 destination domain ids
    uint32 internal constant DOMAIN_ETHEREUM = 0;
    uint32 internal constant DOMAIN_ARBITRUM = 3;
    uint32 internal constant DOMAIN_BASE = 6;

    function run() external returns (CrossChainEscrow escrow) {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        address pauser = vm.envAddress("PAUSER_ADDRESS");
        address domainManager = vm.envAddress("DOMAIN_MANAGER_ADDRESS");
        address protocolTreasury = vm.envAddress("PROTOCOL_TREASURY");

        address usdc = _envOr("USDC_ADDRESS", ARC_USDC_PRECOMPILE);
        address tokenMessenger = _envOr("TOKEN_MESSENGER", ARC_TOKEN_MESSENGER_V2);

        console.log("Deployer:        ", vm.addr(deployerPk));
        console.log("USDC:            ", usdc);
        console.log("TokenMessengerV2:", tokenMessenger);
        console.log("Arbiter:         ", arbiter);
        console.log("Pauser:          ", pauser);
        console.log("DomainManager:   ", domainManager);
        console.log("ProtocolTreasury:", protocolTreasury);

        vm.startBroadcast(deployerPk);

        escrow = new CrossChainEscrow(usdc, arbiter, pauser, domainManager, tokenMessenger, protocolTreasury);

        vm.stopBroadcast();

        console.log("CrossChainEscrow deployed at:", address(escrow));
        console.log("Supported domains must be seeded by DOMAIN_MANAGER_ADDRESS");
    }

    function _envOr(string memory key, address fallbackAddr) internal view returns (address) {
        try vm.envAddress(key) returns (address v) {
            return v;
        } catch {
            return fallbackAddr;
        }
    }
}
