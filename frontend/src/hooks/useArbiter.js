import { useReadContract } from 'wagmi'
import { keccak256, toBytes } from 'viem'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract'

const ARBITER_ROLE = keccak256(toBytes('ARBITER_ROLE'))
const ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'

export function useIsArbiter(address) {
  const enabled = !!address
  const { data, isLoading } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'hasRole',
    args: enabled ? [ARBITER_ROLE, address] : undefined,
    query: { enabled }
  })
  return { isArbiter: !!data, isLoading }
}

export function useIsAdmin(address) {
  const enabled = !!address
  const { data, isLoading } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'hasRole',
    args: enabled ? [ADMIN_ROLE, address] : undefined,
    query: { enabled }
  })
  return { isAdmin: !!data, isLoading }
}

export const ROLES = {
  ADMIN: ADMIN_ROLE,
  ARBITER: ARBITER_ROLE,
  PAUSER: keccak256(toBytes('PAUSER_ROLE')),
  DOMAIN_MANAGER: keccak256(toBytes('DOMAIN_MANAGER_ROLE'))
}

// One-call audit of the connected wallet's role membership.
// Replaces 4 separate hasRole() reads for nav / settings gating.
export function useCallerRoles(address) {
  const enabled = !!address
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getCallerRoles',
    args: enabled ? [address] : undefined,
    query: { enabled }
  })
  return {
    roles: {
      isDefaultAdmin: !!data?.isDefaultAdmin,
      isArbiter: !!data?.isArbiter,
      isPauser: !!data?.isPauser,
      isDomainManager: !!data?.isDomainManager
    },
    isLoading,
    refetch
  }
}

// Single payload for admin/settings: protocol-wide config snapshot.
export function useProtocolConfig() {
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getProtocolConfig'
  })
  return {
    config: data
      ? {
          usdc: data.usdc,
          tokenMessenger: data.tokenMessenger,
          protocolTreasury: data.protocolTreasury,
          protocolFeeBps: data.protocolFeeBps,
          maxProtocolFeeBps: data.maxProtocolFeeBps,
          cctpForwardFee: data.cctpForwardFee,
          arcDomain: Number(data.arcDomain),
          escrowCount: data.escrowCount,
          paused: !!data.paused
        }
      : null,
    isLoading,
    refetch
  }
}
