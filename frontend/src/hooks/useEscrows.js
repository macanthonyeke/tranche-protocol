import { useEffect, useMemo, useState } from 'react'
import { useReadContract, useReadContracts } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract'
import {
  GOLDSKY_ENABLED,
  fetchDashboard,
  fetchEscrowsByRole,
  fetchDisputedEscrows,
  fetchEscrowInvoice,
  fetchAccountActivity
} from '../lib/goldsky'

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
    reviewWindow: raw.reviewWindow,
    depositorApproveCancel: raw.depositorApproveCancel,
    recipientApproveCancel: raw.recipientApproveCancel,
    invoiceHash: raw.invoiceHash,
    invoiceURI: raw.invoiceURI,
    deadline: raw.deadline,
    milestoneCount: Number(raw.milestoneCount),
    state: Number(raw.state),
    escrowCctpForwardFee: raw.escrowCctpForwardFee
  }
}

function normaliseMilestone(raw, index) {
  if (!raw) return null
  return {
    index,
    amount: raw.amount,
    // Timestamp the recipient claimed delivery (claimDelivery); 0 while PENDING.
    claimedAt: raw.claimedAt,
    state: Number(raw.state)
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

export function useDisputeConfig() {
  return {
    arbiterWindow: 1_209_600n,
    bpsDenominator: 10_000n,
    isLoading: false
  }
}

// A single SettlementProposal getter returns (bool exists, uint256 bps). viem
// hands multi-output getters back as a positional array; normalise to an object.
function normaliseProposal(result) {
  if (!result) return { exists: false, bps: 0n }
  if (Array.isArray(result)) return { exists: !!result[0], bps: result[1] ?? 0n }
  return { exists: !!result.exists, bps: result.bps ?? 0n }
}

// Both parties' mutual-settlement proposals for one disputed milestone, read in
// a single multicall. `bps` is in basis points (0–10,000).
export function useSettlementProposals(escrowId, milestoneIndex, depositor, recipient) {
  const enabled =
    escrowId !== undefined && escrowId !== null &&
    milestoneIndex !== undefined && milestoneIndex !== null &&
    !!depositor && !!recipient
  const base = { address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'settlementProposals' }
  const { data, isLoading, refetch } = useReadContracts({
    contracts: enabled
      ? [
          { ...base, args: [BigInt(escrowId), BigInt(milestoneIndex), depositor] },
          { ...base, args: [BigInt(escrowId), BigInt(milestoneIndex), recipient] }
        ]
      : [],
    query: { enabled }
  })
  const depositorProposal = useMemo(() => normaliseProposal(data?.[0]?.result), [data])
  const recipientProposal = useMemo(() => normaliseProposal(data?.[1]?.result), [data])
  return { depositorProposal, recipientProposal, isLoading, refetch }
}

// Single-call payload for the escrow detail page: escrow + milestones +
// disputes + splits + derived flags + caller role.
// `pollMs` enables periodic refetch so the Workroom updates when the
// counterparty acts on another device.
export function useEscrowDetail(escrowId, caller, { pollMs } = {}) {
  const enabled = escrowId !== undefined && escrowId !== null && !!caller
  const { data, isLoading, error, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getEscrowDetail',
    args: enabled ? [BigInt(escrowId), caller] : undefined,
    query: {
      enabled,
      refetchInterval: pollMs ?? false,
      refetchIntervalInBackground: false
    }
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
      reviewWindowExpired: data.reviewWindowExpired || [],
      claimed: data.claimed || [],
      reviewDeadlines: data.reviewDeadlines || [],
      isPayer: !!data.isPayer,
      isFreelancer: !!data.isFreelancer,
      isArbiter: !!data.isArbiter
    }
  }, [data])

  return { detail, isLoading, error, refetch }
}

// ---------------------------------------------------------------------------
// Bulk / list reads. All backed by the Goldsky subgraph — the contract's
// looping view functions (getDashboard, getEscrowsFor*) have been removed.
// Single-escrow reads above stay on-chain (bounded/O(1)).
// ---------------------------------------------------------------------------

// --- Dashboard ---
function useDashboardGoldsky(address, active) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['gs-dashboard', address?.toLowerCase()],
    queryFn: () => fetchDashboard(address),
    enabled: active,
    // Auto-poll so newly created escrows (e.g. an incoming request to a
    // recipient) surface on their own once the subgraph indexes them, without
    // requiring a manual refresh.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false
  })
  return { dashboard: data ?? null, isLoading, error: error ?? null, refetch }
}

export function useDashboard(address) {
  if (!GOLDSKY_ENABLED) throw new Error('Subgraph endpoint required (VITE_GOLDSKY_ENDPOINT not set)')
  return useDashboardGoldsky(address, !!address)
}

// --- Escrows by participant role ---
function useEscrowsByRoleGoldsky(role, address, active) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['gs-escrows', role, address?.toLowerCase()],
    queryFn: () => fetchEscrowsByRole(role, address),
    enabled: active
  })
  return { escrows: data ?? [], isLoading, error: error ?? null, refetch }
}

export function useEscrowsForPayer(address) {
  if (!GOLDSKY_ENABLED) throw new Error('Subgraph endpoint required (VITE_GOLDSKY_ENDPOINT not set)')
  return useEscrowsByRoleGoldsky('payer', address, !!address)
}

export function useEscrowsForFreelancer(address) {
  if (!GOLDSKY_ENABLED) throw new Error('Subgraph endpoint required (VITE_GOLDSKY_ENDPOINT not set)')
  return useEscrowsByRoleGoldsky('freelancer', address, !!address)
}

// --- All disputed escrows across the protocol (arbiter panel) ---
function useDisputedEscrowsGoldsky(active) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['gs-disputed'],
    queryFn: () => fetchDisputedEscrows(),
    enabled: active
  })
  return { escrows: data ?? [], isLoading, error: error ?? null, refetch }
}

export function useDisputedEscrows() {
  return useDisputedEscrowsGoldsky(GOLDSKY_ENABLED)
}

// --- Account-wide activity timeline (Dashboard ActivityRail) ---
function useAccountActivityGoldsky(address, active) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['gs-account-activity', address?.toLowerCase()],
    queryFn: () => fetchAccountActivity(address),
    enabled: active,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false
  })
  return { items: data ?? [], isLoading, error: error ?? null, refetch }
}

export function useAccountActivity(address) {
  return useAccountActivityGoldsky(address, GOLDSKY_ENABLED && !!address)
}

export function useRefundBalance(address) {
  const enabled = !!address
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'refundBalances',
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

// Invoice data (invoiceData JSON + ack timestamp) from the subgraph.
// Separate from useEscrowDetail because it's only needed where InvoiceCard is rendered.
export function useEscrowInvoice(escrowId) {
  const { data, refetch } = useQuery({
    queryKey: ['invoice', escrowId],
    queryFn: () => fetchEscrowInvoice(escrowId),
    enabled: GOLDSKY_ENABLED && escrowId != null,
    // invoiceData is immutable, but invoiceAcknowledgedAt flips when the
    // recipient acknowledges. Poll until that's indexed, then stop.
    refetchInterval: (query) => (query.state.data?.invoiceAcknowledgedAt ? false : 15_000),
    refetchIntervalInBackground: false
  })
  return {
    invoiceData: data?.invoiceData ?? null,
    invoiceAcknowledgedAt: data?.invoiceAcknowledgedAt ?? null,
    refetch
  }
}

// Periodic re-render for live countdowns.
export function useTick(intervalMs = 30_000) {
  const [, set] = useState(0)
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
}
