import { describe, it, expect } from 'vitest'
import { encodeEventTopics, encodeAbiParameters } from 'viem'

/* mutualSettlementExecuted — Round 21 Phase D.

   SettlementPanel.propose used to decide whether to start delivery tracking
   from a PRE-SUBMISSION `theirs` proposal snapshot, checked via
   mutualSettleExecutes(theirs, bps) right after useTx's run() resolved. But
   run() resolves once the wallet BROADCASTS, not once the transaction is
   MINED (useTx.js: the receipt arrives later via a separate
   useWaitForTransactionReceipt effect) — so that snapshot could be stale by
   the time the transaction actually lands, in either direction: the other
   party changes their proposal in that window, and the contract's real
   dep.bps == rec.bps outcome (TrancheProtocol.sol:549) disagrees with what
   the snapshot predicted.

   mutualSettlementExecuted decodes the CONFIRMED receipt's own logs for a
   real MutualSettlementExecuted event instead — ground truth, not a guess.
   These tests build REAL ABI-encoded log fixtures against the actual
   ESCROW_ABI (not hand-rolled objects), so a fixture only passes if it would
   actually decode correctly against the real contract ABI. The contract
   always emits MutualSettlementProposed unconditionally on every mutualSettle
   call (TrancheProtocol.sol:544), and ADDITIONALLY emits
   MutualSettlementExecuted only when the proposals matched — so a
   "proposed but not executed" receipt (just the Proposed log) and an
   "executed" receipt (both logs) are the two real shapes this function has
   to tell apart. */
import { mutualSettlementExecuted, mutualSettleExecutes, mutualSettlementCreatedCctpMessage } from './EscrowDetail.jsx'
import { cctpMessageFingerprint } from '../utils/irisDelivery.js'
import { ESCROW_ABI, CONTRACT_ADDRESS } from '../config/contract.js'

const ESCROW_ID = 7n
const MILESTONE_INDEX = 1n
const PROPOSER = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const OTHER_CONTRACT = '0x3600000000000000000000000000000000000000' // USDC precompile, a real different address

const buildLog = (logIndex, eventName, args, address = CONTRACT_ADDRESS) => {
  const abiItem = ESCROW_ABI.find((i) => i.type === 'event' && i.name === eventName)
  const topics = encodeEventTopics({ abi: ESCROW_ABI, eventName, args })
  const nonIndexed = abiItem.inputs.filter((i) => !i.indexed)
  const data = nonIndexed.length > 0
    ? encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name]))
    : '0x'
  return { address, logIndex, topics, data }
}

const proposedLog = (logIndex, bps) => buildLog(logIndex, 'MutualSettlementProposed', {
  escrowId: ESCROW_ID, milestoneIndex: MILESTONE_INDEX, proposer: PROPOSER, bps: BigInt(bps)
})
const executedLog = (logIndex, bps) => buildLog(logIndex, 'MutualSettlementExecuted', {
  escrowId: ESCROW_ID, milestoneIndex: MILESTONE_INDEX, bps: BigInt(bps)
})

// Round 26: a real, offset-correct, fully-authentic CCTP V2 message —
// receiptEmittedCctpMessageForMilestone now requires the full chain
// (verifiedOwnCctpMessage in utils/irisDelivery.js), not just a
// well-formed MessageSent log, so these fixtures build genuine header
// (TOKEN_MESSENGER_V2_ARC sender, version 1) and body (CONTRACT_ADDRESS
// sender, version 1) fields, not just the body sender Round 25 checked.
const MESSAGE_TRANSMITTER_V2_ARC = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
const TOKEN_MESSENGER_V2_ARC = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
const MESSAGE_SENT_ABI = [
  { name: 'MessageSent', type: 'event', inputs: [{ name: 'message', type: 'bytes', indexed: false }], anonymous: false }
]
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
const CCTP_FORWARD_HOOK_HEX = asciiHex('cctp-forward') + '00'.repeat(32 - 'cctp-forward'.length)
const buildCctpMessage = () =>
  '0x' +
  '00000001' +                                                          // header version 1
  '00'.repeat(4 + 4 + 32) +                                              // sourceDomain, destinationDomain, nonce
  TOKEN_MESSENGER_V2_ARC.slice(2).toLowerCase().padStart(64, '0') +      // header sender
  '00'.repeat(32 + 32 + 4 + 4) +                                         // recipient, destinationCaller, finality fields
  '00000001' +                                                          // body version 1
  '00'.repeat(32 + 32 + 32) +                                            // burnToken, mintRecipient, amount
  CONTRACT_ADDRESS.slice(2).toLowerCase().padStart(64, '0') +            // body messageSender
  '00'.repeat(32 + 32 + 32) +                                            // maxFee, feeExecuted, expirationBlock
  CCTP_FORWARD_HOOK_HEX                                                  // hookData
const messageSentLog = (logIndex) => ({
  address: MESSAGE_TRANSMITTER_V2_ARC,
  logIndex,
  topics: encodeEventTopics({ abi: MESSAGE_SENT_ABI, eventName: 'MessageSent' }),
  data: encodeAbiParameters([{ type: 'bytes' }], [buildCctpMessage()])
})
// Round 33: the fingerprint every message built by buildCctpMessage() above
// produces. Computed via the real cctpMessageFingerprint (not hand-typed) —
// the redesign returns a single sanitized-message hash with no named
// fields, so there is nothing left to reconstruct field-by-field.
const DEFAULT_FP = cctpMessageFingerprint(buildCctpMessage())

describe('mutualSettlementExecuted — decodes the real receipt, not a snapshot', () => {
  it('is false for a receipt that only proposed (the contract always emits this log, executed or not)', () => {
    const receipt = { transactionHash: '0xtx1', logs: [proposedLog(0, 6000)] }
    expect(mutualSettlementExecuted(receipt)).toBe(false)
  })

  it('is true for a receipt whose logs include a real MutualSettlementExecuted event', () => {
    const receipt = { transactionHash: '0xtx2', logs: [proposedLog(0, 6000), executedLog(1, 6000)] }
    expect(mutualSettlementExecuted(receipt)).toBe(true)
  })

  it('skips logs from a different contract address entirely (would throw decoding against this ABI, or worse, false-match)', () => {
    // A real mutualSettle-that-executes receipt also contains USDC Transfer
    // logs from the burn/credit — a log from a different address must not
    // be mistaken for (or crash while checking) MutualSettlementExecuted.
    const foreignLog = { address: OTHER_CONTRACT, logIndex: 0, topics: ['0xdeadbeef'], data: '0x' }
    const receipt = { transactionHash: '0xtx3', logs: [foreignLog, executedLog(1, 6000)] }
    expect(mutualSettlementExecuted(receipt)).toBe(true)
  })

  it('returns false, not throws, for an empty logs array', () => {
    expect(mutualSettlementExecuted({ transactionHash: '0xtx4', logs: [] })).toBe(false)
  })
})

describe('the actual race: ground truth (receipt) vs. the stale pre-submission snapshot (theirs) disagree', () => {
  /* Both directions matter, and they fail differently:
     - snapshot says NO match, receipt says EXECUTED: the dangerous
       direction — a real cross-chain burn would go untracked, with no
       recovery path ever shown to the user.
     - snapshot says MATCH, receipt says NOT executed: the stale-tracker
       bug Round 20 Phase B already closed once, reintroduced via a
       different path (a proposal call that never actually settled). */
  it('the snapshot predicts no match, but the confirmed receipt shows the settlement actually executed', () => {
    const theirs = { exists: true, bps: 4000n } // other side proposed 40%
    const bps = 6000                            // this call proposes 60% — mismatch per the snapshot
    expect(mutualSettleExecutes(theirs, bps)).toBe(false)

    // But the other side updated their proposal to 60% in the window before
    // this transaction landed — the REAL on-chain outcome executed.
    const receipt = { transactionHash: '0xtx5', logs: [proposedLog(0, bps), executedLog(1, bps)] }
    expect(mutualSettlementExecuted(receipt)).toBe(true)
  })

  it('the snapshot predicts a match, but the confirmed receipt shows the settlement did NOT execute', () => {
    const theirs = { exists: true, bps: 6000n } // other side's last-known proposal: 60%, matching
    const bps = 6000
    expect(mutualSettleExecutes(theirs, bps)).toBe(true)

    // But the other side changed their proposal away from 60% before this
    // transaction landed — the REAL on-chain call only recorded a proposal,
    // dep.bps != rec.bps, no execution.
    const receipt = { transactionHash: '0xtx6', logs: [proposedLog(0, bps)] }
    expect(mutualSettlementExecuted(receipt)).toBe(false)
  })

  /* Regression guard: mutualSettleExecutes (used only by mutualSettleConfirm,
     for the confirm SCREEN's copy) and mutualSettlementExecuted (used only
     by SettlementPanel's onConfirmed, for the TRACKER decision) answer
     genuinely different questions and must stay allowed to disagree. If a
     future edit "helpfully" made mutualSettleConfirm call
     mutualSettlementExecuted instead — impossible today without inventing a
     receipt at signing time, but a plausible refactor mistake — the confirm
     screen would either lose its pre-submission prediction entirely or
     require a receipt that doesn't exist yet. This fixture is constructed so
     the two functions give OPPOSITE answers for the same conceptual
     settlement, which is only possible if they stay independent. */
  it('the two functions can disagree on the exact same settlement, proving they are not interchangeable', () => {
    const theirs = { exists: true, bps: 5000n }
    const bps = 5000
    const receiptShowingNoExecution = { transactionHash: '0xtx7', logs: [proposedLog(0, bps)] }

    expect(mutualSettleExecutes(theirs, bps)).toBe(true)
    expect(mutualSettlementExecuted(receiptShowingNoExecution)).toBe(false)
  })
})

/* mutualSettlementCreatedCctpMessage — Round 22 Phase A.

   mutualSettlementExecuted alone proves the SETTLEMENT happened, not that
   it happened cross-chain — a partial settlement can round every leg's
   share to zero, or divert every cross-chain leg to an Arc credit, and
   still fire MutualSettlementExecuted with no CCTP message ever created.
   SettlementPanel's tracker write requires BOTH facts, wrapped into this
   one composite check — kept separate from receiptEmittedCctpMessage itself
   (used directly, unwrapped, by MilestoneAction and DisputeBlock, whose
   actions either revert or fully execute with no two-sided-match ambiguity)
   so a regression in EITHER site's gate is caught by tests specific to that
   site, not a shared one that can't tell them apart. */
describe('mutualSettlementCreatedCctpMessage — requires BOTH facts, not just one', () => {
  /* The one test that guards the property the component actually branches
     on: SettlementPanel's write is gated purely on `emitted`
     (`if (emitted) { ...write tracker... }`) — a mutation that drops the
     message-check and derives `emitted` from mutualSettlementExecuted alone
     flips this specific assertion's `emitted` from false to true, verified
     directly (not assumed) by running exactly that mutation in isolation. */
  it('is false when the settlement executed but every leg rounded to zero or diverted to Arc — no MessageSent at all', () => {
    // MutualSettlementExecuted fires unconditionally on a matching
    // settlement — it does not by itself mean a burn happened.
    const receipt = { transactionHash: '0xtx8', logs: [proposedLog(0, 6000), executedLog(1, 6000)] }
    expect(mutualSettlementExecuted(receipt)).toBe(true)
    expect(mutualSettlementCreatedCctpMessage(receipt, ESCROW_ID, MILESTONE_INDEX)).toEqual({ emitted: false, count: 0, messages: [], ordinals: [], totalMessages: 0, fingerprints: [] })
  })

  /* Verified independently of the test above: a mutation that drops ONLY
     the executed short-circuit (leaving the message-detection and emitted
     derivation otherwise correct) still matches this test's `emitted`
     expectation exactly (false either way, since no execution ever
     happened) — it only diverges on `count` (a leaked 1 instead of the
     correct 0, since the real function never even attempts to count once
     it knows nothing executed). That divergence has NO production
     consequence — SettlementPanel never reads `count` when `emitted` is
     false, the write is skipped entirely — so this test documents a real
     internal-correctness property (don't compute or leak a count for a
     call that didn't execute), not a second independent guard against the
     same regression the test above already covers. */
  it('is false when a real MessageSent-shaped log is present but the settlement never executed (proposals never matched)', () => {
    // Should never happen in a real receipt (mutualSettle can't burn without
    // executing), but proves the executed check is genuinely required, not
    // redundant with the message check.
    const receipt = { transactionHash: '0xtx9', logs: [proposedLog(0, 6000), messageSentLog(1)] }
    expect(mutualSettlementExecuted(receipt)).toBe(false)
    expect(mutualSettlementCreatedCctpMessage(receipt, ESCROW_ID, MILESTONE_INDEX)).toEqual({ emitted: false, count: 0, messages: [], ordinals: [], totalMessages: 0, fingerprints: [] })
  })

  /* Independently verified to catch a real bug the two tests above cannot
     reach: a mutation that keeps the executed-gate and emitted-derivation
     completely correct, but hardcodes `count` to 1 whenever `emitted` is
     true (instead of the real message count), is caught by THIS test alone
     — run in isolation against that exact mutation, 1 of 10 tests failed,
     and it was this one. Neither test above can catch it: the first has no
     real message at all (count stays 0 either way), the second short-
     circuits to count 0 before any counting happens. Only a fixture with
     `emitted: true` AND more than one real message (this one has two)
     exercises count propagation through the true branch at all — this is
     that fixture, not a restatement of "requires both facts". */
  it('is true, with the real count, only when the settlement executed AND a real message was sent', () => {
    // Real on-chain ordering (Round 24): the burn(s) happen strictly BEFORE
    // the terminal MutualSettlementExecuted event, not after — so the two
    // MessageSent logs sit at indices 1-2, executedLog last at index 3.
    const receipt = {
      transactionHash: '0xtx10',
      logs: [proposedLog(0, 6000), messageSentLog(1), messageSentLog(2), executedLog(3, 6000)]
    }
    expect(mutualSettlementCreatedCctpMessage(receipt, ESCROW_ID, MILESTONE_INDEX)).toEqual({
      emitted: true, count: 2, messages: [buildCctpMessage(), buildCctpMessage()], ordinals: [0, 1], totalMessages: 2, fingerprints: [DEFAULT_FP, DEFAULT_FP]
    })
  })

  /* Round 26 finding 3: this device's own submitted transaction is not
     guaranteed to be a single-purpose receipt. Circle-managed wallets are
     ERC-4337 smart accounts, and a bundler's handleOps can pack a foreign
     UserOperation's logs into the SAME receipt this device's own mutualSettle
     call produced — a burn from an entirely different application, or a
     different user's TrancheProtocol call, batched adjacent to this
     settlement with no relationship to it at all. SettlementPanel used to
     call the bare, unscoped receiptEmittedCctpMessage here (Round 22),
     trusting that "this device only submitted one call" meant "this receipt
     only contains one call's logs" — which a bundler breaks. */
  it('finding 3: does not attribute a foreign UserOperation\'s burn (no relationship to this escrow/milestone, present earlier in the same bundled receipt) to this settlement', () => {
    const foreignBurn = {
      address: MESSAGE_TRANSMITTER_V2_ARC,
      logIndex: 0,
      topics: encodeEventTopics({ abi: MESSAGE_SENT_ABI, eventName: 'MessageSent' }),
      data: encodeAbiParameters([{ type: 'bytes' }], [
        '0x00000001' + '00'.repeat(4 + 4 + 32) +
        TOKEN_MESSENGER_V2_ARC.slice(2).toLowerCase().padStart(64, '0') +
        '00'.repeat(32 + 32 + 4 + 4) + '00000001' + '00'.repeat(32 + 32 + 32) +
        '9999999999999999999999999999999999999999'.padStart(64, '0') // a different app's own address, not CONTRACT_ADDRESS
      ])
    }
    const receipt = {
      transactionHash: '0xtx11',
      logs: [foreignBurn, proposedLog(1, 6000), messageSentLog(2), executedLog(3, 6000)]
    }
    // Round 27: the foreign UserOperation's burn still occupies ordinal 0 of
    // the 2-message universe (it's a real MessageTransmitterV2 log, just not
    // OUR message) — this milestone's own genuine message is correctly at
    // ordinal 1, not 0.
    expect(mutualSettlementCreatedCctpMessage(receipt, ESCROW_ID, MILESTONE_INDEX)).toEqual({
      emitted: true, count: 1, messages: [buildCctpMessage()], ordinals: [1], totalMessages: 2, fingerprints: [DEFAULT_FP]
    })
  })
})
