// milestoneCctpLogRange / receiptEmittedCctpMessageForMilestone — Round 24
// Phase A.
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
const messageSentLog = (logIndex, messageHex = '0x1234') => ({
  address: MESSAGE_TRANSMITTER,
  logIndex,
  topics: encodeEventTopics({ abi: MESSAGE_SENT_ABI, eventName: 'MessageSent' }),
  data: encodeAbiParameters([{ type: 'bytes' }], [messageHex])
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
})
