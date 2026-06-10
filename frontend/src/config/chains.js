export const CCTP_DOMAINS = {
  0:  'Ethereum Sepolia',
  1:  'Avalanche Fuji',
  2:  'OP Sepolia',
  3:  'Arbitrum Sepolia',
  5:  'Solana Devnet',
  6:  'Base Sepolia',
  7:  'Polygon Amoy',
  10: 'Unichain Sepolia',
  11: 'Linea Sepolia',
  12: 'Codex Testnet',
  13: 'Sonic Blaze',
  14: 'World Chain Sepolia',
  15: 'Monad Testnet',
  16: 'Sei Testnet',
  17: 'BNB Smart Chain Testnet',
  18: 'XDC Apothem',
  19: 'HyperEVM Testnet',
  21: 'Ink Sepolia',
  22: 'Plume Testnet',
  25: 'Starknet Sepolia',
  26: 'Arc Testnet',
  27: 'Stellar Testnet',
  28: 'EDGE Testnet',
  29: 'Injective Testnet',
  30: 'Morph Holesky',
  31: 'Pharos Testnet'
}

export const ALL_DOMAIN_NUMBERS = Object.keys(CCTP_DOMAINS).map(Number)

export const getDomainName = (domain) =>
  CCTP_DOMAINS[Number(domain)] ?? `Chain ${domain}`

export const ARC_DOMAIN = 26

// CCTP V2 domains whose destination address is NOT a 20-byte EVM address.
// Our mintRecipient encoder + address validator only handles EVM, so these
// are hidden from the create-escrow chain dropdown until non-EVM encoding
// is built out.
export const NON_EVM_DOMAINS = new Set([
  5,  // Solana Devnet
  25, // Starknet Sepolia
  27, // Stellar Testnet
  29  // Injective Testnet
])

export const isEvmDomain = (domain) => !NON_EVM_DOMAINS.has(Number(domain))

// Block explorers for CCTP destination domains (testnet).
// Used to link to the destination transaction after delivery.
export const CHAIN_EXPLORER_TX = {
  0:  (tx) => `https://sepolia.etherscan.io/tx/${tx}`,
  1:  (tx) => `https://testnet.snowtrace.io/tx/${tx}`,
  2:  (tx) => `https://sepolia-optimism.etherscan.io/tx/${tx}`,
  3:  (tx) => `https://sepolia.arbiscan.io/tx/${tx}`,
  6:  (tx) => `https://sepolia.basescan.org/tx/${tx}`,
  7:  (tx) => `https://amoy.polygonscan.com/tx/${tx}`,
  10: (tx) => `https://unichain-sepolia.blockscout.com/tx/${tx}`,
  17: (tx) => `https://testnet.bscscan.com/tx/${tx}`,
}

export const getChainExplorerTx = (domain, txHash) => {
  const fn = CHAIN_EXPLORER_TX[Number(domain)]
  return fn && txHash ? fn(txHash) : null
}

// MessageTransmitterV2 contract addresses on EVM destination chains (testnet).
// Source: https://developers.circle.com/stablecoins/docs/evm-smart-contracts
// Add entries here to enable one-click self-relay for that chain.
// An absent entry degrades to showing the raw calldata for manual relay.
export const MESSAGE_TRANSMITTER_V2 = {
  // 0: '0x...', // Ethereum Sepolia — fill from Circle's developer portal
  // 6: '0x...', // Base Sepolia
}

// EIP-3085 params for wallet_addEthereumChain on each destination domain.
// Only needed for chains not already in the user's wallet.
export const EVM_CHAIN_PARAMS = {
  0:  { chainId: '0xaa36a7', chainName: 'Ethereum Sepolia',   nativeCurrency: { name: 'ETH',  symbol: 'ETH',  decimals: 18 }, rpcUrls: ['https://rpc.sepolia.org'],                     blockExplorerUrls: ['https://sepolia.etherscan.io'] },
  1:  { chainId: '0xa869',   chainName: 'Avalanche Fuji',     nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 }, rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'], blockExplorerUrls: ['https://testnet.snowtrace.io'] },
  2:  { chainId: '0xaa37dc', chainName: 'OP Sepolia',         nativeCurrency: { name: 'ETH',  symbol: 'ETH',  decimals: 18 }, rpcUrls: ['https://sepolia.optimism.io'],                 blockExplorerUrls: ['https://sepolia-optimism.etherscan.io'] },
  3:  { chainId: '0x66eee',  chainName: 'Arbitrum Sepolia',   nativeCurrency: { name: 'ETH',  symbol: 'ETH',  decimals: 18 }, rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],      blockExplorerUrls: ['https://sepolia.arbiscan.io'] },
  6:  { chainId: '0x14a34',  chainName: 'Base Sepolia',       nativeCurrency: { name: 'ETH',  symbol: 'ETH',  decimals: 18 }, rpcUrls: ['https://sepolia.base.org'],                    blockExplorerUrls: ['https://sepolia.basescan.org'] },
  7:  { chainId: '0x13882',  chainName: 'Polygon Amoy',       nativeCurrency: { name: 'POL',  symbol: 'POL',  decimals: 18 }, rpcUrls: ['https://rpc-amoy.polygon.technology'],         blockExplorerUrls: ['https://amoy.polygonscan.com'] },
}
