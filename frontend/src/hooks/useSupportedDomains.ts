import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { ESCROW_ADDRESS, CCTP_DOMAINS, type ChainOption } from "../lib/config";
import { escrowAbi } from "../lib/escrowAbi";

export function useSupportedDomains(): {
  domains: ChainOption[];
  isLoading: boolean;
  refetch: () => void;
} {
  const calls = useMemo(
    () =>
      CCTP_DOMAINS.map((c) => ({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: "supportedDomains" as const,
        args: [c.id] as const,
      })),
    [],
  );

  const result = useReadContracts({ contracts: calls, allowFailure: true });

  const domains = useMemo(() => {
    if (!result.data) return [];
    return CCTP_DOMAINS.filter((_, i) => {
      const r = result.data![i];
      return r.status === "success" && r.result === true;
    });
  }, [result.data]);

  return { domains, isLoading: result.isLoading, refetch: result.refetch };
}
