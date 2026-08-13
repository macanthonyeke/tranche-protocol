// FallbackCrossChainDelivery — Round 23.
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
// These tests render FallbackCrossChainDelivery directly, mocking wagmi's
// useWaitForTransactionReceipt (the same provider-read hook useTx.js already
// uses) to control what receipt comes back. receiptEmittedCctpMessage is
// left REAL — fixtures build genuine MessageSent logs via viem's
// encodeEventTopics/encodeAbiParameters (same approach as
// irisDelivery.test.js) so a fixture only passes if it would actually decode
// against the real ABI. For (b), fetchIrisMessages is the only other mock —
// useCctpDelivery itself runs for real, so the test proves the FULL wiring
// (receipt → decoded count → expectedMessageCount → useCctpDelivery's guard),
// not just that the guard function works in isolation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { encodeEventTopics, encodeAbiParameters } from 'viem'

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
const messageSentLog = (messageHex = '0x1234') => ({
  address: MESSAGE_TRANSMITTER,
  topics: encodeEventTopics({ abi: MESSAGE_SENT_ABI, eventName: 'MessageSent' }),
  data: encodeAbiParameters([{ type: 'bytes' }], [messageHex])
})

const irisMessage = ({ destinationDomain = 6, forwardState = 'COMPLETE' } = {}) => ({
  message: '0xmessage',
  attestation: '0xattestation',
  decodedMessage: { destinationDomain: String(destinationDomain) },
  forwardState,
  forwardTxHash: '0xdesttx',
  forwardErrorCode: null
})

const setReceipt = (value) => { receiptMock.current = value }

const renderFallback = () => render(
  <FallbackCrossChainDelivery txHash="0xreleasetx" escrowId={7} milestoneIndex={1} />
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
    // A real DisputeResolved receipt whose ruling rounded to zero: the log
    // exists, but no MessageSent among it.
    setReceipt({
      data: { transactionHash: '0xreleasetx', logs: [{ address: '0x3600000000000000000000000000000000000000', topics: ['0xnotmessagesent'], data: '0x' }] },
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
  it('does NOT mark delivery complete while Iris is still missing the second message', async () => {
    setReceipt({
      data: { transactionHash: '0xreleasetx', logs: [messageSentLog('0x0001'), messageSentLog('0x0002')] },
      isPending: false,
      isError: false
    })
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
    setReceipt({
      data: { transactionHash: '0xreleasetx', logs: [messageSentLog('0x0001'), messageSentLog('0x0002')] },
      isPending: false,
      isError: false
    })
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 6 }),
      irisMessage({ destinationDomain: 0 })
    ])

    renderFallback()

    await waitFor(() => expect(screen.getAllByText(/Delivered to/)).toHaveLength(2))
  })
})
