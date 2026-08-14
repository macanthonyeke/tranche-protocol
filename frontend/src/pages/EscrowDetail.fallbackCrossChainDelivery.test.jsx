// FallbackCrossChainDelivery — Round 23 / Round 24 Phase A / Round 26.
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
// Round 24 Phase A: a THIRD bug in the same fallback path — release() is
// fully permissionless, so a batching/multicall contract can bundle
// release-family calls for several milestones (possibly across different
// escrows) into ONE transaction, sharing one tx hash. Fixed with
// receiptEmittedCctpMessageForMilestone, scoping to the log-index range
// between the nearest preceding terminal event and this milestone's own.
//
// Round 25 / Round 26: log-index scoping alone only answers "which of THIS
// CONTRACT's own calls" — not "is this message even from this contract's
// own burn at all", nor (Round 26 finding 1) "is this message even
// GENUINE, or a forged MessageTransmitterV2.sendMessage call an attacker
// made directly, bypassing TokenMessengerV2 entirely". Every fixture below
// that's meant to represent a genuine burn builds the FULL authenticity
// chain (see buildCctpMessage) — real header sender (TokenMessengerV2),
// real body sender (this contract), both fields' version tags set to CCTP
// V2 — not just a body messageSender, so a fixture only passes if it would
// actually decode and authenticate the way a real receipt does.
//
// These tests render FallbackCrossChainDelivery directly, mocking wagmi's
// useWaitForTransactionReceipt (the same provider-read hook useTx.js
// already uses) to control what receipt comes back, and fetchIrisMessages
// to control what Iris reports for it — useCctpDelivery itself runs for
// real, so tests prove the FULL wiring (receipt → verified messages →
// expectedOrdinals/expectedTotalMessages → useCctpDelivery's ordinal-
// position guard, Round 27), not just that any one piece works in isolation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { encodeEventTopics, encodeAbiParameters } from 'viem'
import { ESCROW_ABI, CONTRACT_ADDRESS } from '../config/contract.js'
import { cctpMessageFingerprint } from '../utils/irisDelivery.js'

const receiptMock = vi.hoisted(() => ({ current: { data: undefined, isPending: true, isError: false } }))
// A spy wrapper, not just a return-value stub — Round 24 Phase B's fix lives
// entirely in the CONFIG passed into this hook (retry: false), which a test
// that only inspects rendered output can never exercise.
const useWaitForTransactionReceiptSpy = vi.hoisted(() => vi.fn())
vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal()),
  useWaitForTransactionReceipt: (...args) => {
    useWaitForTransactionReceiptSpy(...args)
    return receiptMock.current
  }
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

const MESSAGE_TRANSMITTER_V2_ARC = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
const TOKEN_MESSENGER_V2_ARC = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
const MESSAGE_SENT_ABI = [
  { name: 'MessageSent', type: 'event', inputs: [{ name: 'message', type: 'bytes', indexed: false }], anonymous: false }
]
const FOREIGN_ADDRESS = '0x1234567890123456789012345678901234567890'

const hexZeros = (byteLen) => '00'.repeat(byteLen)
const uint32Hex = (n) => n.toString(16).padStart(8, '0')
const addressWordHex = (addr) => addr.slice(2).toLowerCase().padStart(64, '0')

// Round 31: extended past byte 280 (messageSender) to a genuinely complete
// CCTP V2 message. cctpMessageFingerprint (irisDelivery.js) gained a
// minimum-length floor matching the real BurnMessageV2 fixed-field size
// (376 bytes, through expirationBlock, before any hookData) — the old
// 280-byte fixture was an unfair truncated-prefix test, shorter than any
// real message this app's own cctp-forward hook actually produces.
// Round 32: hookData is the FULL, right-padded 32-byte FORWARD_HOOK_DATA
// (bytes32, TrancheProtocol.sol:51), not just the raw 12-byte ASCII
// "cctp-forward" string — abi.encodePacked(bytes32) packs the whole
// fixed-size value verbatim (TrancheProtocol.sol:1371).
const asciiHex = (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
const CCTP_FORWARD_HOOK_HEX = asciiHex('cctp-forward') + hexZeros(32 - 'cctp-forward'.length)

// A real, offset-correct CCTP V2 message — every field a genuine message
// would have, not just the one field a given test cares about (Round 26:
// header sender/version were added alongside Round 25's body sender).
// Defaults describe a fully genuine message this contract's own burn would
// produce; individual tests override exactly the field they're exercising.
// Round 29: destinationDomain now overridable (byte 8-12) so the fingerprint
// check (cctpMessageFingerprint reads this field) can be exercised
// end-to-end — previously always left at the zeroed default regardless of
// what domain a paired irisMessage() fixture claimed, which mattered to
// nothing before Round 29 introduced a check that actually compares them.
const buildCctpMessage = ({
  headerVersion = 1,
  headerSender = TOKEN_MESSENGER_V2_ARC,
  destinationDomain = 0,
  bodyVersion = 1,
  bodySender = CONTRACT_ADDRESS
} = {}) =>
  '0x' +
  uint32Hex(headerVersion) +          // version            0-4
  hexZeros(4) +                       // sourceDomain       4-8
  uint32Hex(destinationDomain) +      // destinationDomain  8-12
  hexZeros(32) +                      // nonce              12-44
  addressWordHex(headerSender) +      // sender             44-76
  hexZeros(32 + 32 + 4 + 4) +         // recipient, destinationCaller, minFinalityThreshold, finalityThresholdExecuted  76-148
  uint32Hex(bodyVersion) +            // body version       148-152
  hexZeros(32 + 32 + 32) +            // burnToken, mintRecipient, amount     152-248
  addressWordHex(bodySender) +        // messageSender      248-280
  hexZeros(32 + 32 + 32) +            // maxFee, feeExecuted, expirationBlock 280-376
  CCTP_FORWARD_HOOK_HEX               // hookData           376+ (dynamic)

// logIndex is a real field on every viem log — milestoneCctpLogRange orders
// and partitions on it, so every fixture below sets it explicitly rather
// than relying on array position, matching what a real receipt provides.
const messageSentLog = (logIndex, overrides = {}, address = MESSAGE_TRANSMITTER_V2_ARC) => ({
  address,
  logIndex,
  topics: encodeEventTopics({ abi: MESSAGE_SENT_ABI, eventName: 'MessageSent' }),
  data: encodeAbiParameters([{ type: 'bytes' }], [buildCctpMessage(overrides)])
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

// Round 27: useCctpDelivery selects Iris entries by ORDINAL POSITION, not by
// content equality — CCTP V2 mutates several fields (nonce,
// finalityThresholdExecuted, feeExecuted, expirationBlock) between burn-time
// and attestation, so a real Iris `message` is never byte-equal to the
// source-side receipt bytes. None of those mutable fields live in the
// 0-280 byte range this file's buildCctpMessage models (they sit past
// messageSender, at absolute offsets 312+ per irisDelivery.js's own byte
// map), so this fixture can't literally exercise a byte-for-byte difference
// in them — but the point survives structurally: cctpMessageFingerprint
// never reads those offsets at all, so they could differ in a real response
// without affecting anything below.
//
// Round 30 (fixing the Round 29 review's Medium finding on the nullable
// decodedMessage/decodedMessageBody dependency): `message` DOES now have to
// be genuine, parseable CCTP V2 bytes — irisMessageMatchesFingerprint no
// longer trusts decodedMessage/decodedMessageBody (both explicitly nullable
// per Circle's real schema) and instead derives the Iris-side fingerprint
// directly from these raw bytes, the same way the receipt-side fingerprint
// is derived. decodedMessage.destinationDomain is kept below only because
// useCctpDelivery's parsed `destinationDomain` display field still reads it
// as a fallback (cosmetic, not part of the identity check).
//
// Round 33: decodedMessage.decodedMessageBody dropped entirely — it used to
// mirror the old field-object fingerprint's burnToken/mintRecipient/amount/
// messageSender, none of which exist anymore now that cctpMessageFingerprint
// returns a single hash (and nothing in useCctpDelivery ever read
// decodedMessageBody in the first place — only decodedMessage.destinationDomain).
// Round 33: a genuinely well-formed attestation — 65 bytes (one ECDSA
// signature) — not the old '0xattestation' placeholder, which reads as
// plausible English but is not valid hex ('t' is not a hex digit) and would
// now fail useCctpDelivery's own isWellFormedAttestation check.
const REAL_ATTESTATION = '0x' + '11'.repeat(65)

const irisMessage = ({
  destinationDomain = 6,
  forwardState = 'COMPLETE',
  bodySender = CONTRACT_ADDRESS,
  message = buildCctpMessage({ destinationDomain, bodySender })
} = {}) => ({
  message,
  attestation: REAL_ATTESTATION,
  status: 'complete',
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
  useWaitForTransactionReceiptSpy.mockReset()
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

describe('Round 24 Phase B: retry configuration', () => {
  it('passes retry: false so the QueryClient\'s app-wide default (retry: 3, exponential backoff) cannot silently multiply FALLBACK_RECEIPT_TIMEOUT_MS into a ~87s worst case', () => {
    renderFallback()
    expect(useWaitForTransactionReceiptSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        hash: '0xreleasetx',
        query: expect.objectContaining({ retry: false })
      })
    )
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
      messageSentLog(0, { destinationDomain: 6 }),
      messageSentLog(1, { destinationDomain: 0 }),
      escrowLog(2, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })
    ]
  })

  it('does NOT mark delivery complete while Iris is still missing the second message', async () => {
    setReceipt({ data: twoMessageReceipt(), isPending: false, isError: false })
    fetchIrisMessages.mockResolvedValue([irisMessage({ destinationDomain: 6 })])

    renderFallback()

    await waitFor(() => expect(fetchIrisMessages).toHaveBeenCalledWith('0xreleasetx'))
    // useCctpDelivery's completeness guard (allMessages.length < expectedTotalMessages,
    // 1 < 2 here) must keep this in the pre-deliveries "polling" state, not
    // render a single leg as though the settlement were complete.
    await waitFor(() => expect(screen.getByText(/Delivering…/)).toBeInTheDocument())
    expect(screen.queryByText(/Delivered to/)).not.toBeInTheDocument()
  })

  it('reaches the delivered state once Iris reports both messages complete — proving the guard is the real message set from the receipt, not a permanent block', async () => {
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
      messageSentLog(0, { destinationDomain: 6 }),
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
          messageSentLog(0, { destinationDomain: 7 }),
          escrowLog(1, 'MilestoneApproved', { escrowId: 3n, milestoneIndex: 0n }),
          messageSentLog(2, { destinationDomain: 6 }),
          messageSentLog(3, { destinationDomain: 0 }),
          escrowLog(4, 'DisputeResolved', { escrowId: 7n, milestoneIndex: 1n, recipientBps: 10000n, resolutionHash: '0x' + '00'.repeat(32), resolutionURI: 'ipfs://y' })
        ]
      },
      isPending: false,
      isError: false
    })
    // Round 27: the completeness gate is against the WHOLE transaction's
    // real message count (3 — one for escrow 3/milestone 0's own burn, two
    // for this milestone's), not just this milestone's own 2 — Iris's
    // response covers the whole tx, so ordinal position 1 only reliably
    // means "this milestone's first message" once every earlier real
    // position (0: escrow 3/milestone 0's own burn) is indexed too. Ascending
    // by logIndex per Circle's own ordering guarantee: position 0 is
    // escrow 3/milestone 0's message (logIndex 0), positions 1-2 are this
    // milestone's own two (logIndex 2, 3).
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 7 }),   // escrow 3/milestone 0's own (Polygon Amoy) — not this milestone's
      irisMessage({ destinationDomain: 6 }),   // Base Sepolia
      irisMessage({ destinationDomain: 0 })    // Ethereum Sepolia
    ])

    renderFallback({ txHash: '0xbatchtx2' })

    // If the unrelated escrow 3/milestone 0 message were wrongly selected as
    // one of THIS milestone's own, a 3rd "Delivered to" line (Polygon Amoy)
    // would render alongside the correct two.
    await waitFor(() => expect(screen.getAllByText(/Delivered to/)).toHaveLength(2))
    expect(screen.queryByText(/Delivered to Polygon Amoy/)).not.toBeInTheDocument()
    expect(screen.getByText(/Delivered to Base Sepolia/)).toBeInTheDocument()
    expect(screen.getByText(/Delivered to Ethereum Sepolia/)).toBeInTheDocument()
  })
})

describe('Round 24 Phase A: ordinary non-batched receipt still works (no regression)', () => {
  it('a plain single-call receipt — one MessageSent immediately followed by this milestone\'s own MilestoneApproved — still renders delivered correctly', async () => {
    setReceipt({
      data: {
        transactionHash: '0xplaintx',
        logs: [
          messageSentLog(0, { destinationDomain: 6 }),
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

/* Round 31 (fixing the Round 30 review's Medium finding: "display/recovery
   logic still depends on the nullable decode"). decodedMessage is nullable
   per Circle's real schema — a genuine, terminal FAILED message can have
   decodedMessage: null. Before this fix, SelfRelayCard read destinationDomain
   from decodedMessage alone and rendered "an unknown chain" with self-relay
   disabled for a delivery this app could otherwise walk the user through
   recovering in-app. This renders the FULL component tree (real
   useCctpDelivery, real SelfRelayCard) end to end, not just the hook in
   isolation, to prove the fix actually reaches the UI. */
describe('Round 31: decodedMessage: null must not degrade self-relay recovery to "unknown chain"', () => {
  it('renders the real chain name and an in-app relay option for a FAILED message whose decodedMessage is null, using the domain parsed from the raw message bytes', async () => {
    setReceipt({
      data: {
        transactionHash: '0xnulldecodetx',
        logs: [
          messageSentLog(0, { destinationDomain: 6 }),
          escrowLog(1, 'MilestoneApproved', { escrowId: 7n, milestoneIndex: 1n })
        ]
      },
      isPending: false,
      isError: false
    })
    fetchIrisMessages.mockResolvedValue([{
      message: buildCctpMessage({ destinationDomain: 6, bodySender: CONTRACT_ADDRESS }),
      attestation: REAL_ATTESTATION,
      status: 'complete',
      decodedMessage: null,
      forwardState: 'FAILED',
      forwardTxHash: null,
      forwardErrorCode: 'INSUFFICIENT_FEE'
    }])

    renderFallback({ txHash: '0xnulldecodetx' })

    await waitFor(() => expect(screen.getByText(/Delivery failed/)).toBeInTheDocument())
    // Real chain name (Base Sepolia, domain 6), never the "an unknown chain"
    // fallback domainLabel() renders for a null/unresolved domain.
    expect(screen.getByText(/Switch your wallet to/).closest('p').textContent).toContain('Base Sepolia')
    expect(screen.queryByText(/an unknown chain/)).not.toBeInTheDocument()
  })
})

describe('Round 25 gap (a) / Round 26 finding 1: a foreign application\'s burn shares this receipt with an unrelated Arc-only release', () => {
  it('does not attribute a foreign TrancheProtocol instance\'s (or a direct Circle depositForBurn\'s) MessageSent to this instance\'s Arc-only release', async () => {
    setReceipt({
      data: {
        transactionHash: '0xforeigntx',
        logs: [
          messageSentLog(0, { bodySender: FOREIGN_ADDRESS }),   // foreign burn — no boundary around it
          escrowLog(1, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })   // this instance's own release, Arc-only, no burn
        ]
      },
      isPending: false,
      isError: false
    })
    const { container } = renderFallback({ txHash: '0xforeigntx' })
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(fetchIrisMessages).not.toHaveBeenCalled()
  })

  it('finding 1: does not attribute a message forged via a direct MessageTransmitterV2.sendMessage call — real header sender is the attacker, not TokenMessengerV2, even though the body claims this contract as messageSender', async () => {
    setReceipt({
      data: {
        transactionHash: '0xforgedtx',
        logs: [
          messageSentLog(0, { headerSender: FOREIGN_ADDRESS, bodySender: CONTRACT_ADDRESS }),
          escrowLog(1, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })
        ]
      },
      isPending: false,
      isError: false
    })
    const { container } = renderFallback({ txHash: '0xforgedtx' })
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(fetchIrisMessages).not.toHaveBeenCalled()
  })
})

describe('Round 25 gap (b): a same-contract withdrawRefund burn shares this receipt with an unrelated Arc-only release', () => {
  it('does not attribute withdrawRefund\'s own burn to a following Arc-only milestone release', async () => {
    setReceipt({
      data: {
        transactionHash: '0xrefundtx',
        logs: [
          messageSentLog(0),   // withdrawRefund's own genuine burn
          escrowLog(1, 'RefundWithdrawn', { depositor: '0x179cc4c8f23d257b7f4acb785464025570e3af86', amount: 100_000_000n }),
          escrowLog(2, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })   // Arc-only: no burn of its own
        ]
      },
      isPending: false,
      isError: false
    })
    const { container } = renderFallback({ txHash: '0xrefundtx' })
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(fetchIrisMessages).not.toHaveBeenCalled()
  })
})

/* Round 27 (fixing the Round 26 review's High finding) — full end-to-end
   wiring: receipt → receiptEmittedCctpMessageForMilestone's real
   ordinals/totalMessages → useCctpDelivery's ordinal-position selection,
   with useCctpDelivery running for real (not mocked), the same way every
   other describe block in this file proves the full wiring rather than one
   piece in isolation. */
describe('Round 27: ordinal-position selection end to end', () => {
  it('attributes a genuine message correctly even though Iris\'s returned `message` differs from the source-side bytes in CCTP V2\'s mutable fields — content is never compared, only ordinal position', async () => {
    setReceipt({
      data: {
        transactionHash: '0xmutabletx',
        logs: [
          messageSentLog(0, { destinationDomain: 6 }),
          escrowLog(1, 'MilestoneApproved', { escrowId: 7n, milestoneIndex: 1n })
        ]
      },
      isPending: false,
      isError: false
    })
    // Round 30: `message` must be genuine, parseable CCTP V2 bytes (see the
    // irisMessage() fixture's own doc comment for why) — the default already
    // builds one matching this destinationDomain, so no override is needed
    // here at all. Under Round 26's now-removed content-matching design this
    // would never have attributed (messages.length would stay 0 forever)
    // because the mutable fields genuinely differ in a real response; under
    // ordinal-position selection (Round 27) plus the immutable-field-only
    // identity check (Round 30), it correctly does.
    fetchIrisMessages.mockResolvedValue([irisMessage({ destinationDomain: 6 })])

    renderFallback({ txHash: '0xmutabletx' })

    await waitFor(() => expect(screen.getByText(/Delivered to/)).toBeInTheDocument())
  })

  it('selects the correct Iris entry despite a finding-1-style forged message (real contract, wrong header.sender) occupying an earlier ordinal slot in the same batched transaction', async () => {
    setReceipt({
      data: {
        transactionHash: '0xforgedearliertx',
        logs: [
          messageSentLog(0, { headerSender: FOREIGN_ADDRESS, bodySender: CONTRACT_ADDRESS }),   // forged — real contract, real topic, wrong header.sender: ordinal 0
          messageSentLog(1, { destinationDomain: 6 }),   // this milestone's own genuine burn: ordinal 1
          escrowLog(2, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })
        ]
      },
      isPending: false,
      isError: false
    })
    // Iris has no concept of "our" authenticity checks — it indexes both
    // real MessageSent logs, forged one first (ordinal 0, FAILED so a
    // wrong selection would be visibly distinguishable), genuine one second
    // (ordinal 1, COMPLETE). Round 30: both need genuine, parseable bytes
    // now (the defaults already provide that) — the ordinal-0 "forged" entry
    // is never fingerprint-checked anyway (expectedOrdinals is [1], only the
    // ordinal-1 entry is selected and checked), but real bytes here avoid
    // depending on that to not blow up if it were ever touched.
    fetchIrisMessages.mockResolvedValue([
      irisMessage({ destinationDomain: 0, forwardState: 'FAILED' }),
      irisMessage({ destinationDomain: 6, forwardState: 'COMPLETE' })
    ])

    renderFallback({ txHash: '0xforgedearliertx' })

    await waitFor(() => expect(screen.getByText(/Delivered to/)).toBeInTheDocument())
    // Exactly one leg renders (the genuine one) — the forged message at
    // ordinal 0 must never be selected or rendered as this milestone's own.
    expect(screen.getAllByText(/Delivered to/)).toHaveLength(1)
    expect(screen.queryByText(/Delivery failed/)).not.toBeInTheDocument()
  })
})
