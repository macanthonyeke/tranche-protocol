import { describe, it, expect, afterEach } from 'vitest'

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
import { shouldClearCctpTrack, readCctpTrack } from './EscrowDetail.jsx'
import { cctpTrackKey } from '../utils/irisDelivery.js'

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

/* readCctpTrack — Round 27 (fixing the Round 26 review's Medium finding).

   The old design let a malformed/legacy localStorage record (Round 26's
   raw-hex expectedMessages array, or the earlier Round 22 bare numeric
   count) fall all the way through to CrossChainDelivery's render site,
   where Array.isArray(...) ? ... : undefined turned it into "no identity
   constraint at all" for the record's remaining 24h lifetime — the exact
   unfiltered-Iris gap Round 26 as a whole was built to close, reopened by
   its own legacy data. readCctpTrack now validates the shape itself and
   discards anything unusable, the same way it already discards an aged-out
   record — so it returns null exactly like "no local record", and
   MilestoneRow's existing `!cctpTrack` fallback to FallbackCrossChainDelivery
   naturally reverifies from the receipt instead of ever handing out a
   record with no usable ordinal data. */
describe('readCctpTrack', () => {
  const ESCROW_ID = 7
  const MILESTONE_INDEX = 1
  const KEY = cctpTrackKey(ESCROW_ID, MILESTONE_INDEX)

  afterEach(() => {
    localStorage.clear()
  })

  it('returns null when no record exists at all', () => {
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
  })

  it('returns a well-formed Round 27 record unchanged', () => {
    const record = { txHash: '0xtx', ts: Date.now(), expectedOrdinals: [0, 1], expectedTotalMessages: 2 }
    localStorage.setItem(KEY, JSON.stringify(record))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toEqual(record)
  })

  it('discards and removes an aged-out record (older than 24h), same as before this round', () => {
    const record = { txHash: '0xtx', ts: Date.now() - 25 * 60 * 60 * 1000, expectedOrdinals: [0], expectedTotalMessages: 1 }
    localStorage.setItem(KEY, JSON.stringify(record))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards and removes a Round 26 legacy record — expectedMessages (raw hex array), no expectedOrdinals at all — rather than treating it as usable', () => {
    const legacy = { txHash: '0xtx', ts: Date.now(), expectedMessages: ['0xdeadbeef'] }
    localStorage.setItem(KEY, JSON.stringify(legacy))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards and removes a pre-Round-26 legacy record — expectedMessages as a bare numeric count — rather than treating it as usable', () => {
    const legacy = { txHash: '0xtx', ts: Date.now(), expectedMessages: 2 }
    localStorage.setItem(KEY, JSON.stringify(legacy))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards a record whose expectedOrdinals is an array but expectedTotalMessages is missing/non-numeric', () => {
    const malformed = { txHash: '0xtx', ts: Date.now(), expectedOrdinals: [0] }
    localStorage.setItem(KEY, JSON.stringify(malformed))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('returns null (not a throw) on unparseable JSON', () => {
    localStorage.setItem(KEY, 'not json')
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
  })
})
