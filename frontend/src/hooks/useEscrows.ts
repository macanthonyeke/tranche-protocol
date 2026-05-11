import { useMemo } from "react";
import { useReadContract, useReadContracts, useAccount } from "wagmi";
import { escrowAbi } from "../lib/escrowAbi";
import { ESCROW_ADDRESS } from "../lib/config";
import {
  type Escrow,
  type Milestone,
  EscrowState,
  MilestoneState,
} from "../lib/types";

export function useEscrowCount() {
  return useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "escrowCount",
    query: { refetchInterval: 8_000 },
  });
}

function decodeEscrow(id: bigint, raw: readonly unknown[]): Escrow {
  // Tuple order matches the auto-generated getter for the public mapping:
  // depositor, recipient, refundTo, totalAmount, destinationDomain,
  // mintRecipient, disputeWindow, depositorApproveCancel, recipientApproveCancel,
  // invoiceHash, invoiceURI, deadline, milestoneCount, state, deliveryNoticeWindow
  const [
    depositor,
    recipient,
    refundTo,
    totalAmount,
    destinationDomain,
    mintRecipient,
    disputeWindow,
    depositorApproveCancel,
    recipientApproveCancel,
    invoiceHash,
    invoiceURI,
    deadline,
    milestoneCount,
    state,
    deliveryNoticeWindow,
  ] = raw as [
    `0x${string}`,
    `0x${string}`,
    `0x${string}`,
    bigint,
    number,
    `0x${string}`,
    bigint,
    boolean,
    boolean,
    `0x${string}`,
    string,
    bigint,
    bigint,
    number,
    bigint,
  ];

  return {
    id,
    depositor,
    recipient,
    refundTo,
    totalAmount,
    destinationDomain,
    mintRecipient,
    disputeWindow,
    depositorApproveCancel,
    recipientApproveCancel,
    invoiceHash,
    invoiceURI,
    deadline,
    milestoneCount,
    state: state as EscrowState,
    deliveryNoticeWindow,
  };
}

function decodeMilestone(index: number, raw: readonly unknown[]): Milestone {
  const [amount, conditionMetTimestamp, state, deliveredAt] = raw as [
    bigint,
    bigint,
    number,
    bigint,
  ];
  return {
    index,
    amount,
    conditionMetTimestamp,
    state: state as MilestoneState,
    deliveredAt,
  };
}

export function useAllEscrows() {
  const { data: countData } = useEscrowCount();
  const count = countData ? Number(countData) : 0;

  const ids = useMemo(() => Array.from({ length: count }, (_, i) => BigInt(i + 1)), [count]);

  const calls = useMemo(
    () =>
      ids.map((id) => ({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: "escrows" as const,
        args: [id] as const,
      })),
    [ids],
  );

  const result = useReadContracts({
    contracts: calls,
    allowFailure: true,
    query: { enabled: count > 0, refetchInterval: 12_000 },
  });

  const escrows = useMemo(() => {
    if (!result.data) return [];
    return result.data
      .map((r, i) => {
        if (r.status !== "success" || !r.result) return null;
        const arr = r.result as unknown as readonly unknown[];
        // The first field is depositor; if zero address, escrow doesn't exist
        if ((arr[0] as string).toLowerCase() === "0x0000000000000000000000000000000000000000") {
          return null;
        }
        return decodeEscrow(ids[i], arr);
      })
      .filter((x): x is Escrow => x !== null);
  }, [result.data, ids]);

  return {
    escrows,
    isLoading: result.isLoading,
    refetch: result.refetch,
  };
}

export function useUserEscrows() {
  const { address } = useAccount();
  const { escrows, isLoading, refetch } = useAllEscrows();

  const filtered = useMemo(() => {
    if (!address) return [];
    const lower = address.toLowerCase();
    return escrows.filter(
      (e) =>
        e.depositor.toLowerCase() === lower ||
        e.recipient.toLowerCase() === lower,
    );
  }, [escrows, address]);

  return { escrows: filtered, isLoading, refetch };
}

export function useEscrow(escrowId: bigint | undefined) {
  const result = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "escrows",
    args: escrowId !== undefined ? [escrowId] : undefined,
    query: { enabled: escrowId !== undefined, refetchInterval: 8_000 },
  });

  const escrow = useMemo(() => {
    if (!result.data || escrowId === undefined) return undefined;
    const arr = result.data as unknown as readonly unknown[];
    if ((arr[0] as string).toLowerCase() === "0x0000000000000000000000000000000000000000") {
      return undefined;
    }
    return decodeEscrow(escrowId, arr);
  }, [result.data, escrowId]);

  return { escrow, isLoading: result.isLoading, refetch: result.refetch };
}

export function useMilestones(escrowId: bigint | undefined, milestoneCount: bigint | undefined) {
  const count = milestoneCount ? Number(milestoneCount) : 0;
  const calls = useMemo(
    () =>
      escrowId !== undefined
        ? Array.from({ length: count }, (_, i) => ({
            address: ESCROW_ADDRESS,
            abi: escrowAbi,
            functionName: "milestones" as const,
            args: [escrowId, BigInt(i)] as const,
          }))
        : [],
    [escrowId, count],
  );

  const result = useReadContracts({
    contracts: calls,
    allowFailure: true,
    query: { enabled: count > 0 && escrowId !== undefined, refetchInterval: 8_000 },
  });

  const milestones = useMemo(() => {
    if (!result.data) return [];
    return result.data
      .map((r, i) => {
        if (r.status !== "success" || !r.result) return null;
        return decodeMilestone(i, r.result as unknown as readonly unknown[]);
      })
      .filter((m): m is Milestone => m !== null);
  }, [result.data]);

  return { milestones, isLoading: result.isLoading, refetch: result.refetch };
}

export function useDispute(escrowId: bigint | undefined, milestoneIndex: number | undefined) {
  return useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "disputes",
    args:
      escrowId !== undefined && milestoneIndex !== undefined
        ? [escrowId, BigInt(milestoneIndex)]
        : undefined,
    query: {
      enabled: escrowId !== undefined && milestoneIndex !== undefined,
      refetchInterval: 8_000,
    },
  });
}

export function useRefundBalance(address: `0x${string}` | undefined) {
  return useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "refundBalances",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });
}

export function useArbiterRoleHash() {
  return useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "ARBITER_ROLE",
  });
}

export function useHasArbiterRole(address: `0x${string}` | undefined) {
  const { data: roleHash } = useArbiterRoleHash();
  return useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "hasRole",
    args: roleHash && address ? [roleHash, address] : undefined,
    query: { enabled: !!roleHash && !!address },
  });
}
