import type { Address } from "viem";

export const ESCROW_ADDRESS =
  "0xcc539393dd59ded32d65b537a77515f59b760aa3" as Address;

export const USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as Address;

export const USDC_DECIMALS = 6;

export const EXPLORER = "https://testnet.arcscan.app";

export interface ChainOption {
  id: number;
  name: string;
  short: string;
  color: string;
  logo: string;
}

export const ARC_DOMAIN = 26;

// Full CCTP domain catalog. All known domain IDs mapped to human-readable chain
// info. ChainSelect filters this list to only show contract-enabled domains.
export const CCTP_DOMAINS: ChainOption[] = [
  { id: 26, name: "Arc Testnet",      short: "ARC",  color: "#00e5ff", logo: "ARC" },
  { id: 0,  name: "Ethereum",         short: "ETH",  color: "#627eea", logo: "ETH" },
  { id: 1,  name: "Avalanche",        short: "AVAX", color: "#e84142", logo: "AVA" },
  { id: 2,  name: "OP Mainnet",       short: "OP",   color: "#ff0420", logo: "OP"  },
  { id: 3,  name: "Arbitrum",         short: "ARB",  color: "#28a0f0", logo: "ARB" },
  { id: 5,  name: "Solana",           short: "SOL",  color: "#9945ff", logo: "SOL" },
  { id: 6,  name: "Base",             short: "BASE", color: "#0052ff", logo: "BSE" },
  { id: 7,  name: "Polygon PoS",      short: "POL",  color: "#7B3FE4", logo: "POL" },
  { id: 10, name: "Unichain",         short: "UNI",  color: "#ff007a", logo: "UNI" },
  { id: 11, name: "Linea",            short: "LINEA",color: "#121212", logo: "LNA" },
  { id: 12, name: "Codex",            short: "CDX",  color: "#4f9cf9", logo: "CDX" },
  { id: 13, name: "Sonic",            short: "SON",  color: "#fc7823", logo: "SON" },
  { id: 14, name: "World Chain",      short: "WLD",  color: "#00d1ae", logo: "WLD" },
  { id: 15, name: "Monad",            short: "MON",  color: "#7b2fff", logo: "MON" },
  { id: 16, name: "Sei",              short: "SEI",  color: "#9c1f31", logo: "SEI" },
  { id: 17, name: "BNB Smart Chain",  short: "BNB",  color: "#f0b90b", logo: "BNB" },
  { id: 18, name: "XDC",              short: "XDC",  color: "#2a9ee0", logo: "XDC" },
  { id: 19, name: "HyperEVM",         short: "HYPE", color: "#00cfbf", logo: "HYP" },
  { id: 21, name: "Ink",              short: "INK",  color: "#1a1a2e", logo: "INK" },
  { id: 22, name: "Plume",            short: "PLM",  color: "#a78bfa", logo: "PLM" },
  { id: 25, name: "Starknet",         short: "STRK", color: "#ec796b", logo: "STK" },
  { id: 27, name: "Stellar",          short: "XLM",  color: "#00b4d8", logo: "XLM" },
  { id: 28, name: "EDGE",             short: "EDGE", color: "#3ecf8e", logo: "EDG" },
  { id: 29, name: "Injective",        short: "INJ",  color: "#00b5d8", logo: "INJ" },
  { id: 30, name: "Morph",            short: "MRPH", color: "#4ade80", logo: "MRP" },
  { id: 31, name: "Pharos",           short: "PHR",  color: "#818cf8", logo: "PHR" },
];

export function chainForDomain(domain: number): ChainOption {
  return (
    CCTP_DOMAINS.find((c) => c.id === domain) ?? {
      id: domain,
      name: `Unknown Domain (${domain})`,
      short: "?",
      color: "#64748b",
      logo: "?",
    }
  );
}

export const DISPUTE_WINDOW_PRESETS = [
  { label: "24 hours", seconds: 24 * 60 * 60 },
  { label: "48 hours", seconds: 48 * 60 * 60 },
  { label: "72 hours", seconds: 72 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
];

export const DELIVERY_NOTICE_WINDOW_PRESETS = [
  { label: "1 day", seconds: 86400 },
  { label: "2 days", seconds: 172800 },
  { label: "3 days", seconds: 259200 },
  { label: "5 days", seconds: 432000 },
  { label: "7 days", seconds: 604800 },
  { label: "10 days", seconds: 864000 },
  { label: "14 days", seconds: 1209600 },
];

export const MILESTONE_TITLES = [
  "Upfront Payment",
  "Project Kickoff",
  "First Draft / Initial Delivery",
  "Revision Round",
  "Design Deliverable",
  "Development Deliverable",
  "Testing & QA",
  "Content Delivery",
  "Final Delivery",
  "Post-Launch Support",
  "Custom",
];

export const PROTOCOL_FEE_BPS = 199; // displayed only; on-chain reads it live
