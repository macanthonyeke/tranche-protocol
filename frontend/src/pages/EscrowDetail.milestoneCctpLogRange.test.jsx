// milestoneCctpLogRange / receiptEmittedCctpMessageForMilestone — Round 24
// Phase A / Round 25.
//
// Direct, unit-level coverage of the correlation function itself (no
// rendering, no wagmi/query mocking) — the component-level tests in
// EscrowDetail.fallbackCrossChainDelivery.test.jsx exercise the full
// pipeline, this file pins down the pure log-partitioning logic in
// isolation, matching this file's existing convention for exported pure
// decision functions (mutualSettlementExecuted, shouldClearCctpTrack,
// payoutChainLabel, etc — each gets its own direct describe block).
//
// See milestoneCctpLogRange's own doc comment in EscrowDetail.jsx for the
// on-chain proof this partition is a hard boundary (every CCTP-relevant
// release-family call emits its own MessageSent logs strictly BEFORE its
// own terminal escrowId+milestoneIndex event, and nothing after it), not a
// best-effort heuristic.
//
// Round 25: Round 24 answered "which of THIS CONTRACT's own calls does a
// message belong to" but never "is this message even from this contract's
// own burn at all" — receiptEmittedCctpMessage matches on the MessageSent
// event signature alone, regardless of emitting application, which a
// permissionless-caller batch can exploit two ways: (a) a foreign
// TrancheProtocol instance's (or a direct Circle depositForBurn's) burn
// with no recognized boundary around it at all, and (b) withdrawRefund —
// a genuine same-contract burn whose RefundWithdrawn event was never in
// CCTP_TERMINAL_EVENTS, so it delimited nothing. Both are covered below:
// messageSentLog's `sender` param builds a real, offset-correct
// messageSender word (verified against Circle's own CCTP V2 technical
// guide — see messageSenderOf's doc comment in utils/irisDelivery.js) so a
// fixture only passes the filter if it would actually decode to the right
// address, and CCTP_BOUNDARY_ONLY_EVENTS is exercised directly via
// RefundWithdrawn fixtures.

import { describe, it, expect } from 'vitest'
import { encodeEventTopics, encodeAbiParameters } from 'viem'
import { ESCROW_ABI, CONTRACT_ADDRESS } from '../config/contract.js'
import { milestoneCctpLogRange, receiptEmittedCctpMessageForMilestone } from './EscrowDetail.jsx'

const escrowLog = (logIndex, eventName, args, address = CONTRACT_ADDRESS) => {
  const abiItem = ESCROW_ABI.find((i) => i.type === 'event' && i.name === eventName)
  const topics = encodeEventTopics({ abi: ESCROW_ABI, eventName, args })
  const nonIndexed = abiItem.inputs.filter((i) => !i.indexed)
  const data = nonIndexed.length > 0
    ? encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name]))
    : '0x'
  return { address, logIndex, topics, data }
}

const MESSAGE_TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
const MESSAGE_SENT_ABI = [
  { name: 'MessageSent', type: 'event', inputs: [{ name: 'message', type: 'bytes', indexed: false }], anonymous: false }
]
const FOREIGN_ADDRESS = '0x1234567890123456789012345678901234567890'

// A real, offset-correct CCTP V2 message: 248 zero bytes (header +
// burnToken/mintRecipient/amount, irrelevant here) followed by the
// 32-byte messageSender word at the real documented offset (248-280).
// messageSenderOf only ever reads that one word, so the leading zeros
// stand in for fields this test never needs to be realistic.
const buildCctpMessage = (sender = CONTRACT_ADDRESS) =>
  '0x' + '00'.repeat(248) + sender.slice(2).toLowerCase().padStart(64, '0')

const messageSentLog = (logIndex, sender = CONTRACT_ADDRESS) => ({
  address: MESSAGE_TRANSMITTER,
  logIndex,
  topics: encodeEventTopics({ abi: MESSAGE_SENT_ABI, eventName: 'MessageSent' }),
  data: encodeAbiParameters([{ type: 'bytes' }], [buildCctpMessage(sender)])
})

describe('milestoneCctpLogRange', () => {
  it('finds the [start, end] range as [-1, ownLogIndex] for the FIRST call in a receipt', () => {
    const receipt = {
      logs: [
        messageSentLog(0),
        escrowLog(1, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })
      ]
    }
    expect(milestoneCctpLogRange(receipt, 7, 1)).toEqual({ start: -1, end: 1 })
  })

  it('finds the range as [previous milestone\'s boundary, own boundary] for a LATER call in a batched receipt', () => {
    const receipt = {
      logs: [
        messageSentLog(0),
        escrowLog(1, 'MilestoneReleased', { escrowId: 3n, milestoneIndex: 0n }),
        messageSentLog(2),
        escrowLog(3, 'DisputeResolved', { escrowId: 7n, milestoneIndex: 1n, recipientBps: 10000n, resolutionHash: '0x' + '00'.repeat(32), resolutionURI: 'ipfs://x' })
      ]
    }
    expect(milestoneCctpLogRange(receipt, 7, 1)).toEqual({ start: 1, end: 3 })
  })

  it('returns null when this milestone\'s own terminal event is not present at all', () => {
    const receipt = {
      logs: [
        messageSentLog(0),
        escrowLog(1, 'MilestoneReleased', { escrowId: 3n, milestoneIndex: 0n })
      ]
    }
    expect(milestoneCctpLogRange(receipt, 7, 1)).toBeNull()
  })

  it('distinguishes milestoneIndex within the SAME escrow — a boundary for a different milestone of the same escrow is not a match', () => {
    const receipt = {
      logs: [escrowLog(0, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 0n })]
    }
    expect(milestoneCctpLogRange(receipt, 7, 1)).toBeNull()
  })

  it('ignores DisputeTimedOutSettled as a boundary — it never precedes a CCTP burn (Arc-only credit), so it must not appear in CCTP_TERMINAL_EVENTS matching', () => {
    // If DisputeTimedOutSettled were (wrongly) treated as this milestone's
    // own match target, this would return a range instead of null.
    const receipt = {
      logs: [escrowLog(0, 'DisputeTimedOutSettled', { escrowId: 7n, milestoneIndex: 1n, defaultBps: 5000n })]
    }
    expect(milestoneCctpLogRange(receipt, 7, 1)).toBeNull()
  })

  it('orders by the real logIndex field, not array position — a receipt whose logs array is out of logIndex order still partitions correctly', () => {
    // Deliberately shuffled array order; logIndex is what must matter.
    const receipt = {
      logs: [
        escrowLog(3, 'DisputeResolved', { escrowId: 7n, milestoneIndex: 1n, recipientBps: 10000n, resolutionHash: '0x' + '00'.repeat(32), resolutionURI: 'ipfs://x' }),
        messageSentLog(0),
        messageSentLog(2),
        escrowLog(1, 'MilestoneReleased', { escrowId: 3n, milestoneIndex: 0n })
      ]
    }
    expect(milestoneCctpLogRange(receipt, 7, 1)).toEqual({ start: 1, end: 3 })
  })

  describe('Round 25: RefundWithdrawn as a boundary-only marker', () => {
    const refundWithdrawnLog = (logIndex) =>
      escrowLog(logIndex, 'RefundWithdrawn', { depositor: '0x179cc4c8f23d257b7f4acb785464025570e3af86', amount: 100_000_000n })

    it('delimits a later milestone\'s range from an earlier withdrawRefund call in the same batched receipt', () => {
      const receipt = {
        logs: [
          messageSentLog(0),          // withdrawRefund's own burn
          refundWithdrawnLog(1),
          messageSentLog(2),          // the target milestone's own burn
          escrowLog(3, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })
        ]
      }
      // Without RefundWithdrawn as a boundary this would resolve to
      // { start: -1, end: 3 }, wrongly including withdrawRefund's burn.
      expect(milestoneCctpLogRange(receipt, 7, 1)).toEqual({ start: 1, end: 3 })
    })

    it('is never itself a valid match target, even for a milestoneIndex-less lookup — RefundWithdrawn carries no escrowId/milestoneIndex at all', () => {
      const receipt = { logs: [refundWithdrawnLog(0)] }
      expect(milestoneCctpLogRange(receipt, 7, 1)).toBeNull()
    })
  })
})

describe('receiptEmittedCctpMessageForMilestone', () => {
  it('counts only the MessageSent logs within this milestone\'s own range', () => {
    const receipt = {
      logs: [
        messageSentLog(0),
        escrowLog(1, 'MilestoneReleased', { escrowId: 3n, milestoneIndex: 0n }),
        messageSentLog(2),
        messageSentLog(3),
        escrowLog(4, 'MutualSettlementExecuted', { escrowId: 7n, milestoneIndex: 1n, bps: 6000n })
      ]
    }
    expect(receiptEmittedCctpMessageForMilestone(receipt, 7, 1)).toEqual({ emitted: true, count: 2 })
    expect(receiptEmittedCctpMessageForMilestone(receipt, 3, 0)).toEqual({ emitted: true, count: 1 })
  })

  it('returns emitted:false, count:0 when no terminal event for this milestone is found (defensive — should be unreachable given how releaseTx is indexed)', () => {
    const receipt = { logs: [messageSentLog(0)] }
    expect(receiptEmittedCctpMessageForMilestone(receipt, 7, 1)).toEqual({ emitted: false, count: 0 })
  })

  describe('Round 25 gap (a): a foreign application\'s burn, log-index-adjacent but not this contract\'s own', () => {
    it('excludes a MessageSent log whose own messageSender is a DIFFERENT contract, even though it falls inside this milestone\'s computed range', () => {
      const receipt = {
        logs: [
          messageSentLog(0, FOREIGN_ADDRESS),   // a foreign TrancheProtocol instance's own burn — no boundary of its own
          escrowLog(1, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })
        ]
      }
      expect(receiptEmittedCctpMessageForMilestone(receipt, 7, 1)).toEqual({ emitted: false, count: 0 })
    })

    it('counts only the real, own-sender message when a foreign-sender message shares the same computed range', () => {
      const receipt = {
        logs: [
          messageSentLog(0, FOREIGN_ADDRESS),
          messageSentLog(1),   // this contract's own, real burn
          escrowLog(2, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })
        ]
      }
      expect(receiptEmittedCctpMessageForMilestone(receipt, 7, 1)).toEqual({ emitted: true, count: 1 })
    })
  })

  describe('Round 25 gap (b): a same-contract withdrawRefund burn batched adjacent to an Arc-only milestone release', () => {
    it('does not attribute withdrawRefund\'s own burn to a following Arc-only milestone release', () => {
      const receipt = {
        logs: [
          messageSentLog(0),   // withdrawRefund's own real burn
          escrowLog(1, 'RefundWithdrawn', { depositor: '0x179cc4c8f23d257b7f4acb785464025570e3af86', amount: 100_000_000n }),
          escrowLog(2, 'MilestoneReleased', { escrowId: 7n, milestoneIndex: 1n })   // Arc-only: no burn of its own
        ]
      }
      expect(receiptEmittedCctpMessageForMilestone(receipt, 7, 1)).toEqual({ emitted: false, count: 0 })
    })
  })
})
