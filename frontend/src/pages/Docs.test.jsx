import { describe, it, expect } from 'vitest'

/* Round 17 Phase B: a fifth Codex pass found the public glossary still
   carrying #11's original unsupported-outcome phrasing — "each on their
   own chain" reads as a claim that every configured recipient's payout
   actually lands on their own chain, which rounding and the CCTP
   forwarding-fee floor can both make false (see payoutLines' and
   resolveDisputeConfirm's own caveats in EscrowDetail.jsx / ArbiterPanel.jsx).
   Three prior rounds fixed this exact pattern on the confirm screens
   themselves; this is the second time it has surfaced somewhere else
   entirely (a static glossary entry, not a signing screen), found only by
   grepping non-descriptor files for the same shape. First test file for
   this page — GLOSSARY exported for it. */
import { GLOSSARY } from './Docs.jsx'

const splitRecipient = GLOSSARY.find((g) => g.term === 'Split recipient')

describe('Docs glossary — "Split recipient" entry', () => {
  it('exists', () => {
    expect(splitRecipient).toBeDefined()
  })

  it('describes the CONFIGURATION (each recipient has its own share/chain), not an outcome', () => {
    expect(splitRecipient.def).not.toMatch(/each on (their|its) own chain/i)
    expect(splitRecipient.def).toContain('each with their own share and chain')
  })

  it('does not claim delivery happened or will happen for every recipient', () => {
    // "pay out to" describes what the escrow is configured to do, not what a
    // specific transaction delivered — never "delivers"/"pays"/"sends" paired
    // with "each".
    expect(splitRecipient.def).not.toMatch(/\b(delivers?|pays?|sends?)\b.{0,20}\beach\b/i)
  })
})
