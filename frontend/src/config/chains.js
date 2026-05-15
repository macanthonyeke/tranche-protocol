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
