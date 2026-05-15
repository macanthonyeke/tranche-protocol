import { useReadContracts } from 'wagmi'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract'
import { ALL_DOMAIN_NUMBERS } from '../config/chains'

export function useSupportedDomains() {
  const { data, isLoading, refetch } = useReadContracts({
    contracts: ALL_DOMAIN_NUMBERS.map((d) => ({
      address: CONTRACT_ADDRESS,
      abi: ESCROW_ABI,
      functionName: 'supportedDomains',
      args: [d]
    }))
  })

  const supported = []
  if (data) {
    data.forEach((res, i) => {
      if (res?.status === 'success' && res.result === true) {
        supported.push(ALL_DOMAIN_NUMBERS[i])
      }
    })
  }
  return { supported, isLoading, refetch }
}
