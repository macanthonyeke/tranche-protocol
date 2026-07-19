import { createConfig, http } from 'wagmi'
import { defineChain } from 'viem'
import { injected, mock } from 'wagmi/connectors'

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://testnet.arcscan.app' }
  },
  // Without this, wagmi's useReadContracts (useSupportedDomains,
  // useEscrows, useArbiter) can't batch reads via multicall and instead
  // fires one eth_call per read — e.g. ~25 individual requests just to
  // check supportedDomains for every CCTP domain on /create. That flood
  // trips the public RPC's rate limit (verified: 37/41 requests came back
  // 429 on a single /create load), which is what actually produces "No
  // chains available" / "Couldn't reach the contract." The canonical
  // Multicall3 deployment is present on Arc Testnet (verified via
  // eth_getCode, live since at least block 1) — declaring it here lets
  // wagmi collapse all of those into one multicall.
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 1
    }
  }
})

// E2E hook: a Playwright addInitScript can set globalThis.__MOCK_WALLET__ to
// a 0x address before app boot. When present in a dev build, we prepend the
// mock connector with that address so wagmi reconnects to it automatically.
// Gated on import.meta.env.DEV so the branch is dead code in production.
const mockAddr = import.meta.env.DEV ? globalThis.__MOCK_WALLET__ : undefined

const connectors = mockAddr
  ? [
      mock({ accounts: [mockAddr], features: { defaultConnected: true, reconnect: true } }),
      injected({ shimDisconnect: true })
    ]
  : [injected({ shimDisconnect: true })]

export const config = createConfig({
  chains: [arcTestnet],
  connectors,
  transports: { [arcTestnet.id]: http() }
})

// Programmatically connect the mock connector once wagmi has registered it.
// defaultConnected alone doesn't drive wagmi's reconnect path — an explicit
// connect() call is what flips the WagmiProvider into the connected state.
if (mockAddr) {
  import('wagmi/actions').then(({ connect }) => {
    connect(config, { connector: config.connectors[0] }).catch(() => {})
  })
}

export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000'
export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS
