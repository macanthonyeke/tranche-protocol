import { describe, it, expect } from 'vitest'

/* The three field-level actions on an escrow's terms: accept the invoice,
   change the invoice link, extend the deadline.

   All three move no money, so none carries a Total. What makes them worth
   descriptors is that each one closes a door, and in two cases the door being
   closed is not the one the button is about:

   - acknowledgeInvoice is the gate on claimDelivery (the only ack-gated call
     in the contract) AND it locks the payer out of updateInvoiceURI forever
     (:376). The banner's own copy mentions neither.
   - updateInvoiceURI does not touch invoiceHash and never did — SE-6. There
     is no on-chain mismatch to detect afterwards, so the screen must not
     imply the terms were re-committed.
   - extendDeadline is one-way (:1055), and the date that actually governs
     the payer's refund is 72 hours after the deadline, not the deadline
     (:703). */
import {
  acknowledgeInvoiceConfirm,
  updateInvoiceURIConfirm,
  extendDeadlineConfirm
} from './EscrowDetail.jsx'
import { buildContractInteraction } from '../utils/circleTheme.js'
import { NO_ATTACHMENT_URI } from '../utils/format.js'

const escrow = {
  id: 7,
  milestoneCount: 3,
  totalAmount: 750000000n,
  deadline: 1767225600n, // 1 Jan 2026
  invoiceURI: 'https://old.example/invoice.pdf'
}

const DAY = 86400
const paramText = (d) => (d.parameters || []).join('\n')

describe('all three terms actions move no money', () => {
  const cases = [
    ['acknowledgeInvoice', acknowledgeInvoiceConfirm({ escrow })],
    ['updateInvoiceURI', updateInvoiceURIConfirm({ escrow, newURI: 'https://new.example/v2.pdf' })],
    ['extendDeadline', extendDeadlineConfirm({ escrow, newDeadline: Number(escrow.deadline) + 30 * DAY })]
  ]

  it.each(cases)('%s carries no amount and renders no currency row', (_n, d) => {
    expect(d).not.toHaveProperty('amount')
    expect(buildContractInteraction(d)).not.toHaveProperty('mainCurrency')
  })

  it.each(cases)('%s says so in words', (_n, d) => {
    expect(paramText(d)).toContain('No funds move on this transaction.')
  })

  it.each(cases)('%s names the real function', (name, d) => {
    expect(d.functionName).toBe(name)
  })
})

describe('acknowledgeInvoiceConfirm', () => {
  const d = () => acknowledgeInvoiceConfirm({ escrow })

  /* The reason to sign, which the banner never states: without acknowledging,
     claimDelivery is unreachable and the recipient cannot be paid at all. */
  it('says acceptance is what unlocks getting paid', () => {
    expect(paramText(d())).toContain('Until you accept, you cannot claim delivery or be paid.')
  })

  /* The other half, and the one a recipient has no way to guess: accepting
     takes updateInvoiceURI away from the payer permanently (:376). */
  it('says acceptance locks the invoice link', () => {
    expect(paramText(d())).toContain('the payer can no longer change it once you accept')
  })

  it('flags that this is the last chance to check the document', () => {
    expect(paramText(d())).toContain('last point at which it can still be corrected')
  })

  /* InvoiceAlreadyAcknowledged (:366); no un-acknowledge exists. */
  it('says it cannot be undone', () => {
    expect(d().subtitle).toContain('cannot be undone')
    expect(d().subtitle).toContain('no way to un-accept')
  })

  it('shows what is being agreed to, not just an escrow id', () => {
    expect(paramText(d())).toContain('Escrow #7 — 750.00 USDC across 3 milestones')
  })

  it('does not mis-pluralise a single milestone', () => {
    const one = acknowledgeInvoiceConfirm({ escrow: { ...escrow, milestoneCount: 1 } })
    expect(paramText(one)).toContain('across 1 milestone')
    expect(paramText(one)).not.toContain('1 milestones')
  })
})

describe('updateInvoiceURIConfirm', () => {
  const NEW = 'https://new.example/v2.pdf'
  const d = (over = {}) => updateInvoiceURIConfirm({ escrow: { ...escrow, ...over }, newURI: NEW })

  it('shows the link as old → new', () => {
    expect(paramText(d())).toContain(`Link: ${escrow.invoiceURI} → ${NEW}`)
  })

  /* SE-6: invoiceHash never covered invoiceURI, so nothing is re-committed
     and no mismatch is detectable on-chain. The screen must not suggest
     otherwise. */
  it('is explicit that the on-chain fingerprint does not change', () => {
    expect(paramText(d())).toContain('The on-chain invoice fingerprint is not recalculated.')
    expect(d().subtitle).toContain('do not change')
  })

  /* InvoiceURIUpdated carries old and new (:380) and the subgraph keeps them,
     so a payer should not read this as a quiet edit. */
  it('says the change is publicly logged with both links', () => {
    expect(paramText(d())).toContain('logged publicly with both the old and new link')
  })

  it('names the window that closes at acknowledgement', () => {
    expect(paramText(d())).toContain('Only possible until the freelancer accepts the terms.')
  })

  it('handles an escrow that never had a link', () => {
    expect(paramText(d({ invoiceURI: '' }))).toContain(`New link: ${NEW}`)
    expect(paramText(d({ invoiceURI: '' }))).not.toContain('→')
  })

  /* The sentinel means "no attachment", not a URL — rendering it as the old
     value would show the user a placeholder string as though it were a link. */
  it('treats the no-attachment sentinel as no previous link', () => {
    expect(paramText(d({ invoiceURI: NO_ATTACHMENT_URI }))).toContain(`New link: ${NEW}`)
    expect(paramText(d({ invoiceURI: NO_ATTACHMENT_URI }))).not.toContain(NO_ATTACHMENT_URI)
  })
})

describe('extendDeadlineConfirm', () => {
  const next = Number(escrow.deadline) + 30 * DAY
  const d = () => extendDeadlineConfirm({ escrow, newDeadline: next })

  it('shows the deadline as old → new', () => {
    expect(paramText(d())).toContain('Deadline: 1 Jan 2026 → 31 Jan 2026')
  })

  /* The point of the descriptor. refundAfterDeadline opens at deadline + 72h
     (:703), not at the deadline — the row's own help text says "past the
     deadline", which is 72 hours optimistic. */
  it('states the refund date as 72 hours after the new deadline, not the deadline', () => {
    expect(paramText(d())).toContain('refundable to you from 3 Feb 2026')
    expect(paramText(d())).toContain('72 hours after the new deadline')
  })

  it('says the direction is one-way', () => {
    expect(d().subtitle).toContain('can only ever move later')
    expect(d().subtitle).toContain('cannot be shortened or reverted')
  })

  it('says the freelancer does not have to agree', () => {
    expect(paramText(d())).toContain('Their consent is not required.')
  })

  /* Guards the arithmetic itself: a wrong grace constant would still produce
     a plausible-looking date, so pin the offset rather than the string. */
  it('derives the refund date from the NEW deadline plus exactly 72 hours', () => {
    const far = extendDeadlineConfirm({ escrow, newDeadline: Number(escrow.deadline) + 365 * DAY })
    // 1 Jan 2026 + 365d = 1 Jan 2027; + 72h = 4 Jan 2027.
    expect(paramText(far)).toContain('refundable to you from 4 Jan 2027')
  })
})
