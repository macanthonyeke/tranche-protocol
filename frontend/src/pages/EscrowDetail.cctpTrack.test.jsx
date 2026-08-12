import { describe, it, expect } from 'vitest'

/* shouldClearCctpTrack — Round 20 Phase D.
   The old design cleared the shared cctpTrackKey entry the instant ANY
   single relay succeeded, even if the same tx had another message still
   FAILED (or still pending) — a mixed split can burn to several different
   chains in one transaction, and one leg's fix has nothing to do with
   another's status. This is the pure decision extracted from
   CrossChainDelivery's cleanup effect: only clear once every known message
   has genuinely reached COMPLETE per Iris.

   Critically, a message the user has already self-relayed by hand does NOT
   flip to COMPLETE here — Iris's own forwardState bookkeeping only tracks
   its OWN Forwarding Service, not an out-of-band relay a user submitted
   directly to the destination chain's MessageTransmitterV2. So "two failed
   legs, one relayed" is indistinguishable from "two failed legs, neither
   relayed" from this function's point of view — deliberately, since that's
   exactly what keeps the tracker (and the other leg's recovery card)
   alive. */
import { shouldClearCctpTrack } from './EscrowDetail.jsx'

const complete = (overrides = {}) => ({ forwardState: 'COMPLETE', destinationDomain: 6, ...overrides })
const failed = (overrides = {}) => ({ forwardState: 'FAILED', destinationDomain: 6, ...overrides })
const pending = (overrides = {}) => ({ forwardState: null, destinationDomain: 6, ...overrides })

describe('shouldClearCctpTrack', () => {
  it('does not clear when nothing is known yet (deliveries empty)', () => {
    expect(shouldClearCctpTrack([])).toBe(false)
  })

  it('clears once the single message is COMPLETE', () => {
    expect(shouldClearCctpTrack([complete()])).toBe(true)
  })

  it('clears once every message across a multi-leg split is COMPLETE', () => {
    expect(shouldClearCctpTrack([complete({ destinationDomain: 6 }), complete({ destinationDomain: 0 })])).toBe(true)
  })

  it('does not clear when one message is FAILED, even if every other message is COMPLETE', () => {
    expect(shouldClearCctpTrack([complete(), failed()])).toBe(false)
  })

  it('does not clear when two legs are FAILED — self-relaying one of them does not change Iris\'s own record for it, so this stays false regardless of which one (or whether either) was manually relayed', () => {
    expect(shouldClearCctpTrack([failed({ destinationDomain: 6 }), failed({ destinationDomain: 0 })])).toBe(false)
  })

  it('does not clear while any message is still pending', () => {
    expect(shouldClearCctpTrack([complete(), pending()])).toBe(false)
  })
})
