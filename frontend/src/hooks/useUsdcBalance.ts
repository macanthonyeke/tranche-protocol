import { useReadContract } from "wagmi";
import type { Address } from "viem";
import { USDC_ADDRESS } from "../lib/config";
import { usdcAbi } from "../lib/usdcAbi";

export function useUsdcBalance(address: Address | undefined) {
  return useReadContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 12_000 },
  });
}
