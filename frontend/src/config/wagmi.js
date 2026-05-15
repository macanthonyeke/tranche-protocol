import { createConfig, http } from 'wagmi'
import { defineChain } from 'viem'
import { injected } from 'wagmi/connectors'

export const arcTestnet = defineChain({
  id: 1516,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.network' }
  }
})

export const config = createConfig({
  chains: [arcTestnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [arcTestnet.id]: http() }
})

export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000'
export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS
