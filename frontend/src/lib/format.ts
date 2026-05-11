import { formatUnits, parseUnits, keccak256, toBytes, type Address } from "viem";
import { USDC_DECIMALS } from "./config";

export function formatUSDC(amount: bigint | undefined | null, withSymbol = true): string {
  if (amount === undefined || amount === null)
    return withSymbol ? "0.00 USDC" : "0.00";
  const raw = formatUnits(amount, USDC_DECIMALS);
  const num = Number(raw);
  const formatted = num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withSymbol ? `${formatted} USDC` : formatted;
}

export function parseUSDC(input: string): bigint {
  if (!input) return 0n;
  return parseUnits(input.replace(/,/g, ""), USDC_DECIMALS);
}

export function shortAddress(addr: string | undefined | null, head = 6, tail = 4): string {
  if (!addr) return "Not set";
  if (addr.length < head + tail + 2) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function shortHash(hash: string | undefined | null): string {
  return shortAddress(hash, 8, 6);
}

export function addressToBytes32(addr: Address): `0x${string}` {
  // Left-pad an EVM address (20 bytes) to 32 bytes for CCTP mintRecipient.
  return ("0x" + addr.slice(2).padStart(64, "0")) as `0x${string}`;
}

// Decode a bytes32 mintRecipient back to a standard EVM address.
export function bytes32ToAddress(bytes32: `0x${string}`): Address {
  return `0x${bytes32.slice(-40)}` as Address;
}

export function hashString(s: string): `0x${string}` {
  return keccak256(toBytes(s));
}

export function timeUntil(unixSec: bigint | number): { label: string; expired: boolean; ms: number } {
  const target = typeof unixSec === "bigint" ? Number(unixSec) : unixSec;
  const now = Math.floor(Date.now() / 1000);
  const diff = target - now;
  const expired = diff <= 0;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400);
  const hours = Math.floor((abs % 86400) / 3600);
  const mins = Math.floor((abs % 3600) / 60);
  let label: string;
  if (days > 0) label = `${days}d ${hours}h`;
  else if (hours > 0) label = `${hours}h ${mins}m`;
  else label = `${mins}m`;
  return { label: expired ? `${label} ago` : `in ${label}`, expired, ms: diff * 1000 };
}

export function relativeTime(unixSec: bigint | number): string {
  const target = typeof unixSec === "bigint" ? Number(unixSec) : unixSec;
  const now = Math.floor(Date.now() / 1000);
  const diff = now - target;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  const weeks = Math.floor(diff / 604800);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(target * 1000).toLocaleDateString();
}

export function escrowReference(invoiceHash: string, totalAmount: bigint): string {
  // 4-char invoice prefix · amount label
  const prefix = invoiceHash.startsWith("0x") ? invoiceHash.slice(2, 6) : invoiceHash.slice(0, 4);
  return `INV-${prefix} · ${formatUSDC(totalAmount)}`;
}
