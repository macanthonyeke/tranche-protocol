import type { Address } from "viem";

export const EscrowState = {
  ACTIVE: 0,
  COMPLETED: 1,
  CANCELLED: 2,
} as const;
export type EscrowState = (typeof EscrowState)[keyof typeof EscrowState];

export const MilestoneState = {
  PENDING: 0,
  FULFILLED: 1,
  DISPUTED: 2,
  RELEASED: 3,
  REFUNDED: 4,
} as const;
export type MilestoneState = (typeof MilestoneState)[keyof typeof MilestoneState];

export interface Escrow {
  id: bigint;
  depositor: Address;
  recipient: Address;
  refundTo: Address;
  totalAmount: bigint;
  destinationDomain: number;
  mintRecipient: `0x${string}`;
  disputeWindow: bigint;
  depositorApproveCancel: boolean;
  recipientApproveCancel: boolean;
  invoiceHash: `0x${string}`;
  invoiceURI: string;
  deadline: bigint;
  milestoneCount: bigint;
  state: EscrowState;
  deliveryNoticeWindow: bigint;
}

export interface Milestone {
  index: number;
  amount: bigint;
  conditionMetTimestamp: bigint;
  state: MilestoneState;
  deliveredAt: bigint;
}

export interface DisputeData {
  disputedBy: Address;
  evidenceHash: `0x${string}`;
  evidenceURI: string;
  reason: string;
  counterEvidenceHash: `0x${string}`;
  counterEvidenceURI: string;
  resolutionHash: `0x${string}`;
  raisedAt: bigint;
}

export type Role = "depositor" | "recipient" | "both" | "none";

export const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export interface MilestoneMeta {
  title: string;
  description?: string;
}

export function getRole(escrow: Escrow, address: Address | undefined): Role {
  if (!address) return "none";
  const isDep = escrow.depositor.toLowerCase() === address.toLowerCase();
  const isRec = escrow.recipient.toLowerCase() === address.toLowerCase();
  if (isDep && isRec) return "both";
  if (isDep) return "depositor";
  if (isRec) return "recipient";
  return "none";
}
