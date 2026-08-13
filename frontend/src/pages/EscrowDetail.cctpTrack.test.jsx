import { describe, it, expect, afterEach, vi } from 'vitest'

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
import { CONTRACT_ADDRESS } from '../config/contract.js'

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
  // Round 29: a real tx hash shape — isValidCctpTrackRecord now checks this.
  const REAL_TX_HASH = '0x' + '1234abcd'.repeat(8)
  // Round 29: a valid cctpMessageFingerprint shape — a well-formed record
  // now requires one per ordinal.
  const FINGERPRINT = { destinationDomain: 6, burnToken: '0x' + '1'.repeat(40), mintRecipient: '0x' + '2'.repeat(40), amount: '100', messageSender: '0x' + '3'.repeat(40) }

  afterEach(() => {
    localStorage.clear()
  })

  it('returns null when no record exists at all', () => {
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
  })

  it('returns a well-formed Round 29 record unchanged', () => {
    const record = { txHash: REAL_TX_HASH, ts: Date.now(), expectedOrdinals: [0, 1], expectedTotalMessages: 2, expectedFingerprints: [FINGERPRINT, FINGERPRINT] }
    localStorage.setItem(KEY, JSON.stringify(record))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toEqual(record)
  })

  it('discards and removes an aged-out record (older than 24h), same as before this round', () => {
    const record = { txHash: REAL_TX_HASH, ts: Date.now() - 25 * 60 * 60 * 1000, expectedOrdinals: [0], expectedTotalMessages: 1 }
    localStorage.setItem(KEY, JSON.stringify(record))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards and removes a Round 26 legacy record — expectedMessages (raw hex array), no expectedOrdinals at all — rather than treating it as usable', () => {
    const legacy = { txHash: REAL_TX_HASH, ts: Date.now(), expectedMessages: ['0xdeadbeef'] }
    localStorage.setItem(KEY, JSON.stringify(legacy))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards and removes a pre-Round-26 legacy record — expectedMessages as a bare numeric count — rather than treating it as usable', () => {
    const legacy = { txHash: REAL_TX_HASH, ts: Date.now(), expectedMessages: 2 }
    localStorage.setItem(KEY, JSON.stringify(legacy))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards a record whose expectedOrdinals is an array but expectedTotalMessages is missing/non-numeric', () => {
    const malformed = { txHash: REAL_TX_HASH, ts: Date.now(), expectedOrdinals: [0] }
    localStorage.setItem(KEY, JSON.stringify(malformed))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  // Round 28 — coherence, not just shape. A record can be the right TYPES
  // (array, number) and still be nonsense: empty, out of range, negative,
  // fractional, or duplicated. Any of these would previously pass through to
  // useCctpDelivery, which has no way to detect an incoherent ordinal set on
  // its own.
  it('discards a vacuous record — expectedOrdinals empty, expectedTotalMessages zero', () => {
    const vacuous = { txHash: REAL_TX_HASH, ts: Date.now(), expectedOrdinals: [], expectedTotalMessages: 0 }
    localStorage.setItem(KEY, JSON.stringify(vacuous))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards a record with an out-of-range ordinal (ordinal 3 against a total of 2)', () => {
    const outOfRange = { txHash: REAL_TX_HASH, ts: Date.now(), expectedOrdinals: [1, 3], expectedTotalMessages: 2 }
    localStorage.setItem(KEY, JSON.stringify(outOfRange))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards a record with a negative ordinal', () => {
    const negative = { txHash: REAL_TX_HASH, ts: Date.now(), expectedOrdinals: [-1], expectedTotalMessages: 2 }
    localStorage.setItem(KEY, JSON.stringify(negative))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards a record with a fractional ordinal', () => {
    const fractional = { txHash: REAL_TX_HASH, ts: Date.now(), expectedOrdinals: [0.5], expectedTotalMessages: 2 }
    localStorage.setItem(KEY, JSON.stringify(fractional))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards a record with a duplicate ordinal', () => {
    const duplicate = { txHash: REAL_TX_HASH, ts: Date.now(), expectedOrdinals: [0, 0], expectedTotalMessages: 2 }
    localStorage.setItem(KEY, JSON.stringify(duplicate))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  // Round 29 — Medium finding (fingerprints): a pre-Round-29 legacy record
  // has no expectedFingerprints at all — discarded the same way Round 27's
  // own legacy shapes are, so readCctpTrack returns null and the fallback
  // reverifies from the receipt instead of trusting a record with nothing
  // to check ordinal-selected Iris entries against.
  it('discards a record missing expectedFingerprints entirely', () => {
    const legacy = { txHash: REAL_TX_HASH, ts: Date.now(), expectedOrdinals: [0], expectedTotalMessages: 1 }
    localStorage.setItem(KEY, JSON.stringify(legacy))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards a record whose expectedFingerprints length does not match expectedOrdinals', () => {
    const mismatched = { txHash: REAL_TX_HASH, ts: Date.now(), expectedOrdinals: [0, 1], expectedTotalMessages: 2, expectedFingerprints: [FINGERPRINT] }
    localStorage.setItem(KEY, JSON.stringify(mismatched))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards a record with a malformed fingerprint (bad address shape)', () => {
    const malformed = { txHash: REAL_TX_HASH, ts: Date.now(), expectedOrdinals: [0], expectedTotalMessages: 1, expectedFingerprints: [{ ...FINGERPRINT, burnToken: 'not-an-address' }] }
    localStorage.setItem(KEY, JSON.stringify(malformed))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards a record with a malformed fingerprint (non-numeric amount)', () => {
    const malformed = { txHash: REAL_TX_HASH, ts: Date.now(), expectedOrdinals: [0], expectedTotalMessages: 1, expectedFingerprints: [{ ...FINGERPRINT, amount: '12.5' }] }
    localStorage.setItem(KEY, JSON.stringify(malformed))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards a record with a malformed fingerprint (negative destinationDomain)', () => {
    const malformed = { txHash: REAL_TX_HASH, ts: Date.now(), expectedOrdinals: [0], expectedTotalMessages: 1, expectedFingerprints: [{ ...FINGERPRINT, destinationDomain: -1 }] }
    localStorage.setItem(KEY, JSON.stringify(malformed))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  // Round 29 — Medium finding: a valid-shaped record wasn't actually bound
  // to its context. isValidCctpTrackRecord checked types/ranges but not
  // whether txHash is a real tx hash shape, or whether ts is finite/past.
  it('discards a record with an empty-string txHash', () => {
    const malformed = { txHash: '', ts: Date.now(), expectedOrdinals: [0], expectedTotalMessages: 1 }
    localStorage.setItem(KEY, JSON.stringify(malformed))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards a record with a malformed txHash (right prefix, wrong length)', () => {
    const malformed = { txHash: '0xdeadbeef', ts: Date.now(), expectedOrdinals: [0], expectedTotalMessages: 1 }
    localStorage.setItem(KEY, JSON.stringify(malformed))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards a record with a txHash missing the 0x prefix', () => {
    const malformed = { txHash: REAL_TX_HASH.slice(2), ts: Date.now(), expectedOrdinals: [0], expectedTotalMessages: 1 }
    localStorage.setItem(KEY, JSON.stringify(malformed))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards a record with a future timestamp', () => {
    const future = { txHash: REAL_TX_HASH, ts: Date.now() + 24 * 60 * 60 * 1000, expectedOrdinals: [0], expectedTotalMessages: 1 }
    localStorage.setItem(KEY, JSON.stringify(future))
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('discards a record with a non-finite ts (a JSON number literal large enough to overflow to Infinity — valid JSON syntax, but typeof "number" alone would have let it through)', () => {
    localStorage.setItem(KEY, `{"txHash":"${REAL_TX_HASH}","ts":1e400,"expectedOrdinals":[0],"expectedTotalMessages":1}`)
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
  })

  it('returns null and removes the entry on unparseable JSON — discarded the same way as any other invalid record, not left behind', () => {
    localStorage.setItem(KEY, 'not json')
    expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  // Round 29 — Medium finding: readCctpTrack's own catch block called
  // localStorage.removeItem unguarded. If localStorage itself is throwing
  // (privacy settings, a SecurityError on a denied origin), that removeItem
  // could throw a SECOND time and escape the catch entirely — readCctpTrack
  // runs inside MilestoneRow's useState initializer, so an escaped throw
  // there breaks render, not just the tracker. Now routed through
  // safeStorage, which swallows internally at every step.
  describe('storage itself throwing', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('does not throw, and returns null, when getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError')
      })
      expect(() => readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).not.toThrow()
      expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    })

    it('does not throw when the record is aged-out AND removeItem itself throws', () => {
      const record = { txHash: REAL_TX_HASH, ts: Date.now() - 25 * 60 * 60 * 1000, expectedOrdinals: [0], expectedTotalMessages: 1 }
      localStorage.setItem(KEY, JSON.stringify(record))
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError')
      })
      expect(() => readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).not.toThrow()
      expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    })

    it('does not throw when the record is malformed AND removeItem itself throws', () => {
      localStorage.setItem(KEY, 'not json')
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError')
      })
      expect(() => readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).not.toThrow()
      expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()
    })
  })

  // Round 29 — Medium finding: cctpTrackKey namespaced only by
  // escrowId+milestoneIndex, not by deployment. A redeploy (routine in this
  // repo — see CLAUDE.md's deployment history) reuses the same escrow ID
  // space from scratch, so a coherent-looking leftover record from a
  // PREVIOUS contract's escrow #7 milestone #1 would collide on the exact
  // same key as the current contract's own escrow #7 milestone #1.
  describe('cctpTrackKey namespacing by CONTRACT_ADDRESS', () => {
    it('includes the current CONTRACT_ADDRESS in the key', () => {
      expect(cctpTrackKey(ESCROW_ID, MILESTONE_INDEX)).toContain(CONTRACT_ADDRESS.toLowerCase())
    })

    it('two records with the same escrowId/milestoneIndex but different CONTRACT_ADDRESS do not collide', () => {
      // Simulates a leftover record from a previous deployment: same
      // escrowId/milestoneIndex tail, a different contract address swapped
      // into the key where CONTRACT_ADDRESS.toLowerCase() would sit.
      const otherDeploymentKey = KEY.replace(CONTRACT_ADDRESS.toLowerCase(), '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead')
      expect(otherDeploymentKey).not.toBe(KEY)

      const otherDeploymentRecord = { txHash: REAL_TX_HASH, ts: Date.now(), expectedOrdinals: [0], expectedTotalMessages: 1 }
      localStorage.setItem(otherDeploymentKey, JSON.stringify(otherDeploymentRecord))

      // Nothing under the CURRENT deployment's key yet — the other
      // deployment's record must not leak into this read.
      expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toBeNull()

      // Writing the CURRENT deployment's own record still works normally,
      // independent of the other key's presence.
      const ownRecord = { txHash: REAL_TX_HASH, ts: Date.now(), expectedOrdinals: [1], expectedTotalMessages: 2, expectedFingerprints: [FINGERPRINT] }
      localStorage.setItem(KEY, JSON.stringify(ownRecord))
      expect(readCctpTrack(ESCROW_ID, MILESTONE_INDEX)).toEqual(ownRecord)
      // The other deployment's key is untouched by that read.
      expect(localStorage.getItem(otherDeploymentKey)).not.toBeNull()
    })
  })
})
