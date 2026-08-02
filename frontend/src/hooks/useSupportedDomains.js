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
    })),
    query: {
      // Unlike the app's other reads (useEscrows.js, EscrowDetail.jsx),
      // this one had no self-healing path: a single RPC failure during page
      // load (the shared Arc Testnet RPC 429s under any burst -- see
      // config/wagmi.js) left `data` undefined forever, permanently
      // blocking Create Escrow behind the manual Retry button in Advanced
      // settings. Same poll-until-it-lands pattern as useEscrowInvoice.
      refetchInterval: (query) => (query.state.data ? false : 5_000),
      refetchIntervalInBackground: false
    }
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
