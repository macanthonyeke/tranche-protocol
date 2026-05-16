import { useMemo } from 'react'
import { useReadContract, useReadContracts } from 'wagmi'
import { keccak256, toBytes } from 'viem'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract'

const ARBITER_ROLE = keccak256(toBytes('ARBITER_ROLE'))
const ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'
const PAUSER_ROLE = keccak256(toBytes('PAUSER_ROLE'))
const DOMAIN_MANAGER_ROLE = keccak256(toBytes('DOMAIN_MANAGER_ROLE'))
const FEE_MANAGER_ROLE = keccak256(toBytes('FEE_MANAGER_ROLE'))
const RECOVERY_MANAGER_ROLE = keccak256(toBytes('RECOVERY_MANAGER_ROLE'))

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
  PAUSER: PAUSER_ROLE,
  DOMAIN_MANAGER: DOMAIN_MANAGER_ROLE,
  FEE_MANAGER: FEE_MANAGER_ROLE,
  RECOVERY_MANAGER: RECOVERY_MANAGER_ROLE
}

// Full role audit including FEE_MANAGER and RECOVERY_MANAGER, which the
// contract's getCallerRoles helper doesn't return. Uses a single multicall.
export function useAllCallerRoles(address) {
  const enabled = !!address
  const queries = useMemo(
    () =>
      enabled
        ? [
            ADMIN_ROLE,
            ARBITER_ROLE,
            PAUSER_ROLE,
            DOMAIN_MANAGER_ROLE,
            FEE_MANAGER_ROLE,
            RECOVERY_MANAGER_ROLE
          ].map((role) => ({
            address: CONTRACT_ADDRESS,
            abi: ESCROW_ABI,
            functionName: 'hasRole',
            args: [role, address]
          }))
        : [],
    [address, enabled]
  )
  const { data, isLoading, refetch } = useReadContracts({
    contracts: queries,
    query: { enabled }
  })
  const result = useMemo(() => {
    const arr = Array.isArray(data) ? data.map((r) => !!r?.result) : []
    return {
      isDefaultAdmin: !!arr[0],
      isArbiter: !!arr[1],
      isPauser: !!arr[2],
      isDomainManager: !!arr[3],
      isFeeManager: !!arr[4],
      isRecoveryManager: !!arr[5]
    }
  }, [data])
  const hasAny = useMemo(
    () => Object.values(result).some(Boolean),
    [result]
  )
  return { roles: result, hasAny, isLoading, refetch }
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
