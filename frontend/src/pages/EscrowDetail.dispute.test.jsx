import { describe, it, expect } from 'vitest'

/* The four EVIDENCE/STATE dispute actions.

   None of them transfers anything except one branch of
   proposeMilestoneCancel, so the first property every descriptor here has to
   satisfy is the negative one: no Total row. Beyond that the properties are
   about disclosure, and they come from the contract rather than from the UI:

   - raiseDispute stores the reason and URI as plain strings (:443-454) and
     has no withdrawal path anywhere in the contract.
   - submitCounterEvidence is one-shot (CounterEvidenceAlreadySubmitted, :479).
   - appendEvidence writes no state at all — it emits and returns (:1098-1106).
   - proposeMilestoneCancel is two different transactions behind one button
     (:799 vs :803-817), and unlike the escrow-wide cancel it is irrevocable:
     retractCancelApproval (:1062) never touches milestoneCancelProposals. */
import {
  raiseDisputeConfirm,
  counterEvidenceConfirm,
  appendEvidenceConfirm,
  proposeMilestoneCancelConfirm
} from './EscrowDetail.jsx'
import { buildContractInteraction } from '../utils/circleTheme.js'

const REFUND_TO = '0x4bdbe608ea998b4822476353df9dd83228ffd503'

const escrow = { id: 7, milestoneCount: 3, refundTo: REFUND_TO }
const milestone = { index: 1, amount: 250000000n, state: 1 }

const URI = 'https://ipfs.io/ipfs/bafyEvidence'
const paramText = (d) => (d.parameters || []).join('\n')

/* Every descriptor in this file describes a call that moves nothing, with the
   single exception of proposeMilestoneCancel's executing branch. Grouping the
   check here keeps that invariant visible as one statement rather than three
   scattered assertions. */
describe('the evidence actions move no money', () => {
  const cases = [
    ['raiseDispute', raiseDisputeConfirm({ escrow, milestone, reason: 'Not delivered', uri: URI })],
    ['submitCounterEvidence', counterEvidenceConfirm({ escrow, milestone, uri: URI })],
    ['appendEvidence', appendEvidenceConfirm({ escrow, milestone, uri: URI })]
  ]

  it.each(cases)('%s carries no amount and renders no currency row', (_name, d) => {
    expect(d).not.toHaveProperty('amount')
    expect(buildContractInteraction(d)).not.toHaveProperty('mainCurrency')
  })

  it.each(cases)('%s says so in words, not only by omission', (_name, d) => {
    expect(paramText(d)).toContain('No funds move on this transaction.')
  })

  it.each(cases)('%s names the real function', (name, d) => {
    expect(d.functionName).toBe(name)
  })
})

describe('raiseDisputeConfirm', () => {
  const d = (over = {}) =>
    raiseDisputeConfirm({ escrow, milestone, reason: 'Work was never delivered', uri: URI, ...over })

  it('frames the milestone as frozen rather than refunded', () => {
    // state -> DISPUTED (:456). Nothing is returned to anyone at this point,
    // and a payer who reads "refunded" will stop chasing the work.
    expect(paramText(d())).toContain('Milestone 2 of 3: 250.00 USDC — frozen, not refunded')
  })

  it('quotes the reason back so the signer sees what is being published', () => {
    expect(paramText(d())).toContain('Reason: "Work was never delivered"')
  })

  it('warns that the reason and link are public and permanent', () => {
    expect(paramText(d())).toContain('stored on-chain in the clear, readable by anyone, permanently')
  })

  /* No withdrawDispute exists; the only exits are the arbiter's resolveDispute
     or resolveDisputeByTimeout. "Flag for review" would be the wrong mental
     model and the subtitle has to close it off. */
  it('says a dispute cannot be withdrawn', () => {
    expect(d().subtitle).toContain('cannot be withdrawn once raised')
  })

  it('does not promise the payer gets their money back', () => {
    expect(paramText(d())).toContain('0 to 100%')
    expect(paramText(d())).toContain('does not guarantee a refund')
  })

  it('truncates a reason too long for a confirm screen', () => {
    const long = 'x'.repeat(400)
    const text = paramText(d({ reason: long }))
    expect(text).toContain('…')
    expect(text).not.toContain('x'.repeat(200))
  })
})

describe('counterEvidenceConfirm', () => {
  const d = () => counterEvidenceConfirm({ escrow, milestone, uri: URI })

  /* :479 rejects a second submission and nothing clears the field, so this is
     the only response the signer will ever get to make. */
  it('states the one-shot rule as a rule, not as advice', () => {
    expect(d().subtitle).toContain('exactly one counter-evidence submission per dispute')
    expect(d().subtitle).toContain('cannot be edited, replaced, or withdrawn')
  })

  it('does not imply responding resolves anything', () => {
    expect(paramText(d())).toContain('waits on the arbiter either way')
  })

  it('keeps describing the milestone as frozen', () => {
    expect(paramText(d())).toContain('still frozen')
  })
})

describe('appendEvidenceConfirm', () => {
  const d = () => appendEvidenceConfirm({ escrow, milestone, uri: URI })

  /* The weakest action in the set: emits and returns (:1098-1106). A signer
     who just paid gas will assume something changed, so the screen has to say
     that nothing did — including the arbiter clock, which keeps running. */
  it('says it is a log entry that changes nothing', () => {
    expect(paramText(d())).toContain('Recorded as a log entry only')
    expect(paramText(d())).toContain("the arbiter's deadline does not move")
  })

  it('distinguishes itself from counter-evidence by being repeatable', () => {
    expect(d().subtitle).toContain('as many as you need')
  })

  it('still warns the entry is permanent and public', () => {
    expect(paramText(d())).toContain('it cannot be deleted or edited')
  })
})

/* The file-vs-link distinction applies to all three evidence calls: a dropped
   file is fingerprinted directly, while a bare link is only keccak256(uri), so
   the hash proves the link text and not the document. */
describe('evidence fingerprint disclosure', () => {
  const builders = [
    ['raiseDispute', (over) => raiseDisputeConfirm({ escrow, milestone, reason: 'r', uri: URI, ...over })],
    ['submitCounterEvidence', (over) => counterEvidenceConfirm({ escrow, milestone, uri: URI, ...over })],
    ['appendEvidence', (over) => appendEvidenceConfirm({ escrow, milestone, uri: URI, ...over })]
  ]

  it.each(builders)('%s names the file when one was dropped', (_n, build) => {
    expect(paramText(build({ fileName: 'report.pdf' })))
      .toContain('Fingerprint: the contents of report.pdf')
  })

  it.each(builders)('%s admits a bare link only hashes the link text', (_n, build) => {
    expect(paramText(build({})))
      .toContain('Fingerprint: a hash of the link text, not of the document it points to.')
  })

  it('shows the evidence link itself', () => {
    expect(paramText(raiseDisputeConfirm({ escrow, milestone, reason: 'r', uri: URI })))
      .toContain(`Evidence link: ${URI}`)
  })
})

describe('proposeMilestoneCancelConfirm — first proposer', () => {
  const d = (role = 'payer') =>
    proposeMilestoneCancelConfirm({ escrow, milestone, role, otherProposed: false })

  /* Same reasoning as cancelEscrowConfirm's unapproved branch: this call
     writes one bool. A Total would put the refund figure on the transaction
     that does not perform the refund. */
  it('carries no amount', () => {
    expect(d()).not.toHaveProperty('amount')
    expect(buildContractInteraction(d())).not.toHaveProperty('mainCurrency')
    expect(paramText(d())).toContain('No funds move on this transaction.')
  })

  it('states the refund as conditional on the other party', () => {
    expect(paramText(d())).toContain(`Would refund 250.00 USDC to ${REFUND_TO} once both parties have proposed.`)
  })

  /* The point of the whole branch. retractCancelApproval (:1062) clears only
     the escrow-level flags, so the neighbouring screen's affordance does not
     exist here. */
  it('says the proposal cannot be taken back', () => {
    expect(paramText(d())).toContain('There is no way to withdraw a milestone cancellation proposal once submitted.')
    expect(d().subtitle).toContain('cannot be taken back')
  })

  it('tells a freelancer they are giving up the payment', () => {
    expect(paramText(d('freelancer'))).toContain('This is your payment for this milestone. Proposing gives it up.')
  })

  it('does not say that to the payer, who is receiving the refund', () => {
    expect(paramText(d('payer'))).not.toContain('This is your payment')
  })
})

describe('proposeMilestoneCancelConfirm — second proposer executes', () => {
  const d = (role = 'payer') =>
    proposeMilestoneCancelConfirm({ escrow, milestone, role, otherProposed: true })

  /* Here the same call falls through to the refund branch (:803-817), so the
     figure is real and belongs in the Total. */
  it('carries the milestone amount as the refund total', () => {
    expect(d().amount).toBe(250000000n)
    expect(d().amountLabel).toBe('Amount refunded')
    expect(buildContractInteraction(d())).toHaveProperty('mainCurrency')
  })

  it('says it happens now and cannot be undone', () => {
    expect(d().subtitle).toContain('already proposed')
    expect(d().subtitle).toContain('cannot be undone')
  })

  it('credits the payer refund address, not the caller', () => {
    expect(paramText(d())).toContain(`Credited to: ${REFUND_TO}`)
  })

  /* refundBalances[e.refundTo] += amount (:809) — a credit, not a transfer.
     Same trap milestoneConfirm's refund branch handles: the payer otherwise
     goes looking in their wallet. */
  it('says credited on Arc rather than sent', () => {
    expect(paramText(d())).toContain('Credited as a withdrawable refund balance on Arc, not sent to a wallet.')
  })

  it('takes no protocol fee', () => {
    expect(paramText(d())).toContain('No protocol fee is taken.')
  })

  it('scopes the damage to this milestone only', () => {
    expect(paramText(d())).toContain('The rest of the escrow carries on')
  })

  it('tells a freelancer they will not be paid for it', () => {
    expect(paramText(d('freelancer'))).toContain('You will not be paid for it.')
  })
})
