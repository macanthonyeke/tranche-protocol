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
