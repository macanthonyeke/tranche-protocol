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
import { mutualSettlementExecuted, mutualSettleExecutes } from './EscrowDetail.jsx'
import { ESCROW_ABI, CONTRACT_ADDRESS } from '../config/contract.js'

const ESCROW_ID = 7n
const MILESTONE_INDEX = 1n
const PROPOSER = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const OTHER_CONTRACT = '0x3600000000000000000000000000000000000000' // USDC precompile, a real different address

const buildLog = (eventName, args, address = CONTRACT_ADDRESS) => {
  const abiItem = ESCROW_ABI.find((i) => i.type === 'event' && i.name === eventName)
  const topics = encodeEventTopics({ abi: ESCROW_ABI, eventName, args })
  const nonIndexed = abiItem.inputs.filter((i) => !i.indexed)
  const data = nonIndexed.length > 0
    ? encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name]))
    : '0x'
  return { address, topics, data }
}

const proposedLog = (bps) => buildLog('MutualSettlementProposed', {
  escrowId: ESCROW_ID, milestoneIndex: MILESTONE_INDEX, proposer: PROPOSER, bps: BigInt(bps)
})
const executedLog = (bps) => buildLog('MutualSettlementExecuted', {
  escrowId: ESCROW_ID, milestoneIndex: MILESTONE_INDEX, bps: BigInt(bps)
})

describe('mutualSettlementExecuted — decodes the real receipt, not a snapshot', () => {
  it('is false for a receipt that only proposed (the contract always emits this log, executed or not)', () => {
    const receipt = { transactionHash: '0xtx1', logs: [proposedLog(6000)] }
    expect(mutualSettlementExecuted(receipt)).toBe(false)
  })

  it('is true for a receipt whose logs include a real MutualSettlementExecuted event', () => {
    const receipt = { transactionHash: '0xtx2', logs: [proposedLog(6000), executedLog(6000)] }
    expect(mutualSettlementExecuted(receipt)).toBe(true)
  })

  it('skips logs from a different contract address entirely (would throw decoding against this ABI, or worse, false-match)', () => {
    // A real mutualSettle-that-executes receipt also contains USDC Transfer
    // logs from the burn/credit — a log from a different address must not
    // be mistaken for (or crash while checking) MutualSettlementExecuted.
    const foreignLog = { address: OTHER_CONTRACT, topics: ['0xdeadbeef'], data: '0x' }
    const receipt = { transactionHash: '0xtx3', logs: [foreignLog, executedLog(6000)] }
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
    const receipt = { transactionHash: '0xtx5', logs: [proposedLog(bps), executedLog(bps)] }
    expect(mutualSettlementExecuted(receipt)).toBe(true)
  })

  it('the snapshot predicts a match, but the confirmed receipt shows the settlement did NOT execute', () => {
    const theirs = { exists: true, bps: 6000n } // other side's last-known proposal: 60%, matching
    const bps = 6000
    expect(mutualSettleExecutes(theirs, bps)).toBe(true)

    // But the other side changed their proposal away from 60% before this
    // transaction landed — the REAL on-chain call only recorded a proposal,
    // dep.bps != rec.bps, no execution.
    const receipt = { transactionHash: '0xtx6', logs: [proposedLog(bps)] }
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
    const receiptShowingNoExecution = { transactionHash: '0xtx7', logs: [proposedLog(bps)] }

    expect(mutualSettleExecutes(theirs, bps)).toBe(true)
    expect(mutualSettlementExecuted(receiptShowingNoExecution)).toBe(false)
  })
})
