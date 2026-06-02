import { CONTRACT_ADDRESS, USDC_ADDRESS } from './wagmi'
import TrancheProtocolAbi from '../abi/TrancheProtocol.json'

export { CONTRACT_ADDRESS, USDC_ADDRESS }

// Minimal ERC20 ABI we need
export const USDC_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }
]

// TrancheProtocol ABI — the single source of truth for every contract
// interaction in the frontend.
//
// Generated from src/TrancheProtocol.sol with `forge build` and copied to
// src/abi/TrancheProtocol.json (see scripts/gen-abi or the build pipeline).
// Do NOT hand-edit function signatures here or anywhere else: regenerate the
// JSON from the compiled artifact instead so the frontend can never drift from
// the deployed contract.
export const ESCROW_ABI = TrancheProtocolAbi
