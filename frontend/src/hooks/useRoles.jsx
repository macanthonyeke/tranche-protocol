import { createContext, useContext, useMemo } from 'react'
import { useAccount } from 'wagmi'
import { useAllCallerRoles } from './useArbiter.js'

const EMPTY_ROLES = {
  isDefaultAdmin: false,
  isArbiter: false,
  isPauser: false,
  isDomainManager: false,
  isFeeManager: false,
  isRecoveryManager: false
}

const RoleContext = createContext({
  address: undefined,
  isConnected: false,
  roles: EMPTY_ROLES,
  isArbiter: false,
  isAdmin: false,
  isStandardUser: true,
  isLoading: false,
  refetch: () => {}
})

export function RoleProvider({ children }) {
  const { address, isConnected } = useAccount()
  const { roles, isLoading, refetch } = useAllCallerRoles(address)

  const value = useMemo(() => {
    const safeRoles = roles ?? EMPTY_ROLES
    const isArbiter = !!safeRoles.isArbiter
    const isAdmin =
      !!safeRoles.isDefaultAdmin ||
      !!safeRoles.isFeeManager ||
      !!safeRoles.isDomainManager ||
      !!safeRoles.isRecoveryManager ||
      !!safeRoles.isPauser
    // Until we've resolved roles, treat the wallet as standard so we don't
    // flash admin-only nav. The auto-redirect waits on isLoading separately.
    const isStandardUser = !isLoading && !isArbiter && !isAdmin
    return {
      address,
      isConnected,
      roles: safeRoles,
      isArbiter,
      isAdmin,
      isStandardUser,
      isLoading,
      refetch
    }
  }, [address, isConnected, roles, isLoading, refetch])

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export function useRoles() {
  return useContext(RoleContext)
}
