import { useEffect, useMemo, useState } from 'react'
import { useReadContract } from 'wagmi'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract'

// Normalises one Escrow tuple/struct returned by the contract.
function normaliseEscrow(raw, id) {
  if (!raw) return null
  return {
    id: Number(id),
    depositor: raw.depositor,
    recipient: raw.recipient,
    refundTo: raw.refundTo,
    totalAmount: raw.totalAmount,
    destinationDomain: Number(raw.destinationDomain),
    mintRecipient: raw.mintRecipient,
    disputeWindow: raw.disputeWindow,
    depositorApproveCancel: raw.depositorApproveCancel,
    recipientApproveCancel: raw.recipientApproveCancel,
    invoiceHash: raw.invoiceHash,
    invoiceURI: raw.invoiceURI,
    deadline: raw.deadline,
    milestoneCount: Number(raw.milestoneCount),
    state: Number(raw.state),
    deliveryNoticeWindow: raw.deliveryNoticeWindow
  }
}

function normaliseMilestone(raw, index) {
  if (!raw) return null
  return {
    index,
    amount: raw.amount,
    conditionMetTimestamp: raw.conditionMetTimestamp,
    state: Number(raw.state),
    deliveredAt: raw.deliveredAt
  }
}

function normaliseSummary(raw) {
  if (!raw) return null
  return {
    id: Number(raw.escrowId),
    depositor: raw.depositor,
    recipient: raw.recipient,
    totalAmount: raw.totalAmount,
    state: Number(raw.state),
    deadline: raw.deadline,
    milestoneCount: Number(raw.milestoneCount),
    releasedMilestoneCount: Number(raw.releasedMilestoneCount),
    disputedMilestoneCount: Number(raw.disputedMilestoneCount),
    invoiceHash: raw.invoiceHash,
    invoiceURI: raw.invoiceURI
  }
}

export function useEscrowCount() {
  return useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'escrowCount'
  })
}

// Single escrow via the new getEscrow() view (reverts when missing).
export function useEscrow(id) {
  const enabled = id !== undefined && id !== null && !Number.isNaN(Number(id))
  const { data, isLoading, error, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getEscrow',
    args: enabled ? [BigInt(id)] : undefined,
    query: { enabled }
  })
  const escrow = useMemo(() => (data ? normaliseEscrow(data, id) : null), [data, id])
  return { escrow, isLoading, error, refetch }
}

// All milestones for an escrow in a single call.
export function useEscrowMilestones(escrowId) {
  const enabled = escrowId !== undefined && escrowId !== null
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getMilestones',
    args: enabled ? [BigInt(escrowId)] : undefined,
    query: { enabled }
  })
  const milestones = useMemo(() => {
    if (!Array.isArray(data)) return []
    return data.map((m, i) => normaliseMilestone(m, i))
  }, [data])
  return { milestones, isLoading, refetch }
}

// Single dispute record (per-milestone). Unchanged: the auto-generated
// disputes(id, idx) getter is already O(1).
export function useDispute(escrowId, milestoneIndex) {
  const enabled = escrowId !== undefined && milestoneIndex !== undefined
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'disputes',
    args: enabled ? [BigInt(escrowId), BigInt(milestoneIndex)] : undefined,
    query: { enabled }
  })
  return { dispute: data, isLoading, refetch }
}

// Single-call payload for the escrow detail page: escrow + milestones +
// disputes + splits + derived flags + caller role.
export function useEscrowDetail(escrowId, caller) {
  const enabled = escrowId !== undefined && escrowId !== null && !!caller
  const { data, isLoading, error, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getEscrowDetail',
    args: enabled ? [BigInt(escrowId), caller] : undefined,
    query: { enabled }
  })

  const detail = useMemo(() => {
    if (!data) return null
    const milestones = (data.milestones || []).map((m, i) => normaliseMilestone(m, i))
    const escrow = normaliseEscrow(data.escrow, Number(data.escrowId))
    return {
      id: Number(data.escrowId),
      escrow,
      milestones,
      disputes: data.disputes || [],
      splits: data.splits || [],
      disputeWindowExpired: data.disputeWindowExpired || [],
      deliverySignaled: data.deliverySignaled || [],
      effectiveDisputeDeadlines: data.effectiveDisputeDeadlines || [],
      isPayer: !!data.isPayer,
      isFreelancer: !!data.isFreelancer,
      isArbiter: !!data.isArbiter
    }
  }, [data])

  return { detail, isLoading, error, refetch }
}

// Single-call payload for the dashboard.
export function useDashboard(address) {
  const enabled = !!address
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getDashboard',
    args: enabled ? [address] : undefined,
    query: { enabled }
  })

  const dashboard = useMemo(() => {
    if (!data) return null
    return {
      asPayer: (data.asPayer || []).map(normaliseSummary),
      asFreelancer: (data.asFreelancer || []).map(normaliseSummary),
      activeEscrowCount: Number(data.activeEscrowCount),
      openDisputeCount: Number(data.openDisputeCount),
      refundBalance: data.refundBalance ?? 0n
    }
  }, [data])

  return { dashboard, isLoading, refetch }
}

export function useEscrowsForPayer(address) {
  const enabled = !!address
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getEscrowsForPayer',
    args: enabled ? [address] : undefined,
    query: { enabled }
  })
  const escrows = useMemo(() => (Array.isArray(data) ? data.map(normaliseSummary) : []), [data])
  return { escrows, isLoading, refetch }
}

export function useEscrowsForFreelancer(address) {
  const enabled = !!address
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getEscrowsForFreelancer',
    args: enabled ? [address] : undefined,
    query: { enabled }
  })
  const escrows = useMemo(() => (Array.isArray(data) ? data.map(normaliseSummary) : []), [data])
  return { escrows, isLoading, refetch }
}

// All disputed escrows across the protocol (arbiter panel).
export function useDisputedEscrows() {
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getDisputedEscrows'
  })
  const escrows = useMemo(() => (Array.isArray(data) ? data.map(normaliseSummary) : []), [data])
  return { escrows, isLoading, refetch }
}

export function useRefundBalance(address) {
  const enabled = !!address
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getRefundBalance',
    args: enabled ? [address] : undefined,
    query: { enabled }
  })
  return { balance: data ?? 0n, isLoading, refetch }
}

export function useUsdcBalance(address) {
  const enabled = !!address
  const { data, isLoading, refetch } = useReadContract({
    address: '0x3600000000000000000000000000000000000000',
    abi: [{
      type: 'function', name: 'balanceOf', stateMutability: 'view',
      inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }]
    }],
    functionName: 'balanceOf',
    args: enabled ? [address] : undefined,
    query: { enabled }
  })
  return { balance: data ?? 0n, isLoading, refetch }
}

// Periodic re-render for live countdowns.
export function useTick(intervalMs = 30_000) {
  const [, set] = useState(0)
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
}
