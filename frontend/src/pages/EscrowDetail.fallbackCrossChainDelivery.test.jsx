// FallbackCrossChainDelivery — Round 23 / Round 24 Phase A.
//
// MilestoneRow's fallback path (a milestone whose cross-chain release this
// device never submitted itself — known only via the subgraph's
// Milestone.releaseTx) used to activate the delivery tracker on the mere
// presence of an indexed releaseTx plus the escrow's CURRENT cross-chain
// config. Two concrete bugs followed, both traced to the same root cause:
// this path had no receipt to run receiptEmittedCctpMessage against, unlike
// the three Phase A/B write sites.
//
//   (a) The indexer stamps releaseTx for every successful
//       DisputeResolved/MutualSettlementExecuted/etc regardless of whether a
//       CCTP message actually fired (a partial award where every leg rounds
//       to zero, or a divert-to-Arc credit). The old fallback showed
//       "Delivering…" forever for a milestone that never burned anything.
//   (b) This path had no persisted expected-message-count (only the
//       submitting device's own localStorage record carries that), so
//       useCctpDelivery's completeness guard was silently skipped — a burn
//       that emitted 2 messages but Iris had only indexed 1 of could be
//       marked fully delivered early.
//
// Round 24 Phase A: a THIRD bug in the same fallback path, found by the 12th
// Codex review pass — release() is fully permissionless, so a batching /
// multicall contract can bundle release-family calls for several milestones
// (possibly across different escrows) into ONE transaction. The indexer
// stamps that same tx hash as releaseTx on every milestone the batch
// touched, and Circle's Iris API returns every MessageSent in the tx with no
// per-application scoping — so receiptEmittedCctpMessage(receipt) (Round 22
// Phase A, correct for the three write sites, where the receipt is always
// this device's own single-purpose call) would attribute EVERY message in
// the batch to EVERY milestone that shares the hash. Fixed with
// receiptEmittedCctpMessageForMilestone, which scopes to the log-index range
// between the nearest preceding terminal event (any milestone) and this
// milestone's own terminal event — see that function's and
// milestoneCctpLogRange's own doc comments in EscrowDetail.jsx for the proof
// this is a hard boundary, not a heuristic.
//
// These tests render FallbackCrossChainDelivery directly, mocking wagmi's
// useWaitForTransactionReceipt (the same provider-read hook useTx.js already
// uses) to control what receipt comes back. receiptEmittedCctpMessage /
// receiptEmittedCctpMessageForMilestone are left REAL — fixtures build
// genuine MessageSent and TrancheProtocol event logs via viem's
// encodeEventTopics/encodeAbiParameters (same approach as
// irisDelivery.test.js), including real logIndex values, so a fixture only
// passes if it would actually decode and order the way a real receipt does.
// For (b), fetchIrisMessages is the only other mock — useCctpDelivery itself
// runs for real, so the test proves the FULL wiring (receipt → decoded count
// → expectedMessageCount → useCctpDelivery's guard), not just that the guard
// function works in isolation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { encodeEventTopics, encodeAbiParameters } from 'viem'
import { ESCROW_ABI, CONTRACT_ADDRESS } from '../config/contract.js'

const receiptMock = vi.hoisted(() => ({ current: { data: undefined, isPending: true, isError: false } }))
vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal()),
  useWaitForTransactionReceipt: () => receiptMock.current
}))

const fetchIrisMessages = vi.hoisted(() => vi.fn())
vi.mock('../utils/irisDelivery.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchIrisMessages
}))

vi.mock('../hooks/useAuth.jsx', () => ({
  useAuth: () => ({ address: '0x179cc4c8f23d257b7f4acb785464025570e3af86' })
}))

const { FallbackCrossChainDelivery } = await import('./EscrowDetail.jsx')

const MESSAGE_TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
const MESSAGE_SENT_ABI = [
  { name: 'MessageSent', type: 'event', inputs: [{ name: 'message', type: 'bytes', indexed: false }], anonymous: false }
]
// logIndex is a real field on every viem log — milestoneCctpLogRange orders
// and partitions on it, so every fixture below sets it explicitly rather
// than relying on array position, matching what a real receipt provides.
const messageSentLog = (logIndex, messageHex = '0x1234') => ({
  address: MESSAGE_TRANSMITTER,
  logIndex,
  topics: encodeEventTopics({ abi: MESSAGE_SENT_ABI, eventName: 'MessageSent' }),
  data: encodeAbiParameters([{ type: 'bytes' }], [messageHex])
})

// Builds a real TrancheProtocol event log (e.g. MilestoneReleased,
// DisputeResolved) the same way irisDelivery.test.js's escrowLog helper
// does — via the real ESCROW_ABI, not a hand-rolled shape.
const escrowLog = (logIndex, eventName, args, address = CONTRACT_ADDRESS) => {
  const abiItem = ESCROW_ABI.find((i) => i.type === 'event' && i.name === eventName)
  const topics = encodeEventTopics({ abi: ESCROW_ABI, eventName, args })
  const nonIndexed = abiItem.inputs.filter((i) => !i.indexed)
  const data = nonIndexed.length > 0
    ? encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name]))
    : '0x'
  return { address, logIndex, topics, data }
}

const irisMessage = ({ destinationDomain = 6, forwardState = 'COMPLETE' } = {}) => ({
  message: '0xmessage',
  attestation: '0xattestation',
  decodedMessage: { destinationDomain: String(destinationDomain) },
  forwardState,
  forwardTxHash: '0xdesttx',
  forwardErrorCode: null
})

const setReceipt = (value) => { receiptMock.current = value }

const renderFallback = (props = {}) => render(
  <FallbackCrossChainDelivery txHash="0xreleasetx" escrowId={7} milestoneIndex={1} {...props} />
)

beforeEach(() => {
  fetchIrisMessages.mockReset()
  setReceipt({ data: undefined, isPending: true, isError: false })
})

afterEach(() => {
  cleanup()
})

describe('while the receipt fetch is in flight', () => {
  it('shows a distinct "checking" state — never the "Delivering…" copy that implies a transfer is confirmed in progress', () => {
    setReceipt({ data: undefined, isPending: true, isError: false })
    renderFallback()
    expect(screen.getByText(/Checking delivery status/)).toBeInTheDocument()
    expect(screen.queryByText(/Delivering/)).not.toBeInTheDocument()
  })
})

describe('when the receipt fetch fails or the RPC endpoint cannot serve it', () => {
  it('shows an honest "unavailable" state — not silence (implies non-cross-chain) and not "Delivering…" (implies a real burn in progress)', () => {
    setReceipt({ data: undefined, isPending: false, isError: true })
    renderFallback()
    expect(screen.getByText(/Delivery status unavailable/)).toBeInTheDocument()
    expect(screen.queryByText(/Delivering/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Checking delivery status/)).not.toBeInTheDocument()
  })
})

describe('failure mode (a): indexed releaseTx whose receipt emitted zero CCTP messages', () => {
  it('renders nothing once the receipt is in — no permanent "Delivering…" for a milestone that never burned anything', async () => {
    // A real DisputeResolved receipt whose ruling rounded to zero: the
    // milestone's own terminal event exists (so it's genuinely THIS
    // milestone's tx), but no MessageSent precedes it.
    setReceipt({
      data: {
        transactionHash: '0xreleasetx',
        logs: [escrowLog(0, 'DisputeResolved', { escrowId: 7n, milestoneIndex: 1n, recipientBps: 6000n, resolutionHash: '0x' + '00'.repeat(32), resolutionURI: 'ipfs://x' })]
      },
      isPending: false,
      isError: false
    })
    const { container } = renderFallback()
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(screen.queryByText(/Delivering/)).not.toBeInTheDocument()
    expect(fetchIrisMessages).not.toHaveBeenCalled()
  })

  it('also renders nothing for a receipt with no logs at all (e.g. claimDelivery/refundAfterDeadline, which never touch CCTP)', async () => {
    setReceipt({ data: { transactionHash: '0xreleasetx', logs: [] }, isPending: false, isError: false })
    const { container } = renderFallback()
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})

describe('failure mode (b): a receipt proving 2 CCTP messages, Iris initially indexing only 1', () => {
  const twoMessageReceipt = () => ({
    transactionHash: '0xreleasetx',
    logs: [
      messageSentLog(0, '0x0001'),
      messageSentLog(1, '0x0002'),
      escrowLog(2, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })
    ]
  })

  it('does NOT mark delivery complete while Iris is still missing the second message', async () => {
    setReceipt({ data: twoMessageReceipt(), isPending: false, isError: false })
    fetchIrisMessages.mockResolvedValue([irisMessage({ destinationDomain: 6 })])

    renderFallback()

    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalledWith('0xreleasetx'))
    // useCctpDelivery's expectedMessageCount guard (messages.length < 2) must
    // keep this in the pre-deliveries "polling" state, not render a single
    // leg as though the settlement were complete.
    await waitFor(() => expect(screen.getByText(/Delivering…/)).toBeInTheDocument())
    expect(screen.queryByText(/Delivered to/)).not.toBeInTheDocument()
  })

  it('reaches the delivered state once Iris reports both messages complete — proving the guard is the count from the receipt, not a permanent block', async () => {
    setReceipt({ data: twoMessageReceipt(), isPending: false, isError: false })
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6 }),
      irisMessage({ destinationDomain: 0 })
    ])

    renderFallback()

    await waitFor(() => expect(screen.getAllByText(/Delivered to/)).toHaveLength(2))
  })
})

describe('Round 24 Phase A: batched multi-milestone transaction — messages must not cross-attribute', () => {
  // A batching contract calls release() for (escrow 3, milestone 0) — which
  // burns ONE cross-chain message — then mutualSettle for (escrow 7,
  // milestone 1) — which settles with NO CCTP message at all (rounds to
  // zero / diverts to Arc) — in the SAME transaction, sharing one tx hash.
  // The indexer stamps this same hash as releaseTx on BOTH milestones.
  // Rendering milestone 1 (this component's target) must see ZERO messages
  // — not the other milestone's one message — even though the receipt as a
  // whole plainly contains a MessageSent log.
  const batchedReceiptNoMessageForTarget = () => ({
    transactionHash: '0xbatchtx',
    logs: [
      messageSentLog(0, '0xdeadbeef01'),
      escrowLog(1, 'MilestoneReleased', { escrowId: 3n, milestoneIndex: 0n }),
      escrowLog(2, 'MutualSettlementExecuted', { escrowId: 7n, milestoneIndex: 1n, bps: 6000n })
    ]
  })

  it('does not attribute a DIFFERENT milestone\'s MessageSent to this milestone — renders nothing, not "Delivering…"', async () => {
    setReceipt({ data: batchedReceiptNoMessageForTarget(), isPending: false, isError: false })
    const { container } = renderFallback({ txHash: '0xbatchtx' })
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(fetchIrisMessages).not.toHaveBeenCalled()
  })

  it('renders the OTHER milestone (escrow 3, milestone 0) correctly using its own real message — proves this is scoping, not just suppression', async () => {
    setReceipt({ data: batchedReceiptNoMessageForTarget(), isPending: false, isError: false })
    fetchIrisMessages.mockResolvedValue([irisMessage({ destinationDomain: 6 })])

    renderFallback({ txHash: '0xbatchtx', escrowId: 3, milestoneIndex: 0 })

    await waitFor(() => expect(screen.getByText(/Delivered to/)).toBeInTheDocument())
  })

  it('correctly counts only THIS milestone\'s own messages when both milestones in the batch burn — a batch where escrow 3/milestone 0 burns 1 message and escrow 7/milestone 1 burns 2 must report 2, not 3, for milestone 1', async () => {
    setReceipt({
      data: {
        transactionHash: '0xbatchtx2',
        logs: [
          messageSentLog(0, '0xdead0000'),
          escrowLog(1, 'MilestoneApproved', { escrowId: 3n, milestoneIndex: 0n }),
          messageSentLog(2, '0xcafe0001'),
          messageSentLog(3, '0xcafe0002'),
          escrowLog(4, 'DisputeResolved', { escrowId: 7n, milestoneIndex: 1n, recipientBps: 10000n, resolutionHash: '0x' + '00'.repeat(32), resolutionURI: 'ipfs://y' })
        ]
      },
      isPending: false,
      isError: false
    })
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6 }),
      irisMessage({ destinationDomain: 0 })
    ])

    renderFallback({ txHash: '0xbatchtx2' })

    // If the 3rd (unrelated) message were wrongly included, expectedMessageCount
    // would be 3 and this would stay stuck polling forever instead of showing 2
    // delivered legs.
    await waitFor(() => expect(screen.getAllByText(/Delivered to/)).toHaveLength(2))
  })
})

describe('Round 24 Phase A: ordinary non-batched receipt still works (no regression)', () => {
  it('a plain single-call receipt — one MessageSent immediately followed by this milestone\'s own MilestoneApproved — still renders delivered correctly', async () => {
    setReceipt({
      data: {
        transactionHash: '0xplaintx',
        logs: [
          messageSentLog(0, '0xf00d0000'),
          escrowLog(1, 'MilestoneApproved', { escrowId: 7n, milestoneIndex: 1n })
        ]
      },
      isPending: false,
      isError: false
    })
    fetchIrisMessages.mockResolvedValue([irisMessage({ destinationDomain: 6 })])

    renderFallback({ txHash: '0xplaintx' })

    await waitFor(() => expect(screen.getByText(/Delivered to/)).toBeInTheDocument())
  })
})
