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
      //
      // 5s (vs. the 15s/30s polls elsewhere) because this one gates whether
      // Create Escrow can be used at all, not just refreshing an
      // already-usable view -- worth retrying sooner. Backs off on
      // consecutive failures (5s -> 10s -> 20s -> ... capped at 60s) so a
      // sustained outage doesn't turn into indefinite hammering of an
      // already-struggling endpoint; resets to 5s once data lands.
      refetchInterval: (query) => {
        if (query.state.data) return false
        // fetchFailureCount is at least 1 here (the initial mount fetch
        // already failed by the time this callback runs) -- offset so the
        // first retry is 5s, not 10s.
        const failures = Math.max(query.state.fetchFailureCount - 1, 0)
        return Math.min(5_000 * 2 ** failures, 60_000)
      },
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
