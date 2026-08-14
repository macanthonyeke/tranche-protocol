import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchIrisMessages, irisMessageMatchesFingerprint, cctpMessageFingerprint } from '../utils/irisDelivery'

const POLL_MS = 15_000

// Round 29 (Low finding): distinguishes "still catching up" from "stuck".
// Every non-terminal poll outcome below (count mismatch — including the
// Round 28 overflow case, incomplete ordinal selection, a fingerprint
// mismatch, or an in-flight-but-not-yet-terminal forwardState) is
// legitimately transient on its own — Iris can take real time to index a
// message, per this file's own IRIS_MESSAGES_TIMEOUT_MS doc comment,
// sometimes over a minute for a single call. What distinguishes normal
// catching-up from a stuck delivery isn't which branch fires, it's whether
// the SAME outcome keeps repeating with no change: real indexing progress
// changes the signature every poll (allMessages.length growing, a
// forwardState advancing PENDING -> CONFIRMED, etc), while a permanent
// overflow or a persistent fingerprint mismatch produces the identical
// signature forever. 8 consecutive unchanged polls at POLL_MS=15s is 2
// minutes — long enough that a handful of genuinely slow-but-progressing
// polls (or one hung request retried past IRIS_MESSAGES_TIMEOUT_MS) won't
// false-positive, short enough that a user watching "Delivering…" gets an
// honest signal well before they'd give up and leave anyway.
const STALE_POLL_THRESHOLD = 8

// Poll Circle's Iris API for cross-chain delivery status of a burn tx.
// Only activates when the settlement is cross-chain at all. Stops polling
// once every message has reached a terminal forwardState.
//
// Returns:
//   phase: 'idle' | 'polling' | 'stale' | 'delivered' | 'failed' | 'unavailable'
//   deliveries: parsed message objects with destinationTxHash, message,
//               attestation, errorCode, forwardState, destinationDomain per
//               CCTP message (one per milestone for plain releases; one per
//               split recipient for split milestones) — each carrying its
//               OWN real domain from Iris, never a caller-supplied guess.
//
// Round 20 Phase D: `destinationDomain` replaced with a plain `isCrossChain`
// boolean. The old single-domain parameter did two things — gated whether to
// poll at all, and silently filled in any message Iris didn't label with a
// domain — but a mixed split settlement can burn to several DIFFERENT chains
// in one transaction (bounded by MAX_SPLITS = 10, TrancheProtocol.sol:31),
// so "the caller's one domain" was never a safe stand-in for a message's own
// domain. The gate only ever needed a boolean; the fallback risked
// mislabeling a message as a chain it was never actually sent to. Iris
// reliably reports each message's own domain in practice — if it ever
// doesn't, `destinationDomain` now comes through as `null` (rendered as an
// unknown chain downstream) rather than a wrong guess.
//
// Round 27 (fixing the Round 26 review's High finding): `expectedMessages`
// (Round 22/26 — a raw hex identity to content-match against Iris's own
// `message` field) is GONE. CCTP V2 mutates several message fields between
// burn-time and attestation — nonce, finalityThresholdExecuted, and
// feeExecuted are all zero/empty in the source-side log and only filled in
// once Iris attests the message, and expirationBlock can change too — so a
// real message's source-side bytes and Iris's returned bytes for the SAME
// delivery are simply never equal. Every real poll under the old design had
// `messages.length === 0` forever; confirmed live against a real
// Arc-testnet burn (byte-diff against a real captured Iris response), not
// assumed from the docs alone.
//
// Replaced with `expectedOrdinals` (this milestone's own verified messages'
// 0-indexed positions among every real MessageTransmitterV2 MessageSent log
// in the WHOLE receipt — see irisDelivery.js's
// receiptEmittedCctpMessageForMilestone) and `expectedTotalMessages` (that
// universe's own size). Circle's GET /v2/messages API reference states
// "Each message for a given transaction hash is ordered by ascending log
// index" — so once Iris has indexed EVERY real message in the transaction,
// `allMessages[ordinal]` is guaranteed to be the same entry the receipt
// proved belongs to this milestone, no content comparison needed.
//
// The "once" matters: `allMessages.length === expectedTotalMessages` is the
// completeness gate below, and it has to be checked against the FULL
// universe size, not just "enough entries to cover this milestone's own
// ordinals". Circle's ordering guarantee only says messages actually
// PRESENT in a response are sorted by log index — it does not say a
// still-partial response is a stable PREFIX of the final ordering (e.g. if
// Iris indexes/exposes a later-log-index message before an earlier one,
// a 1-entry partial response could be that later message sitting at
// position 0, not the earlier one this milestone might actually need).
// Waiting for the full count first means the two orderings (this app's
// receipt-derived one, Iris's own) are provably the same set, sorted the
// same way, before any position is ever trusted.
//
// Round 28: exact equality, not `>=`. Nothing in Circle's API reference
// rules out Iris ever returning MORE entries than the receipt's real count,
// and an overflow occurring anywhere before or between the ordinals being
// selected would shift indexing and select the wrong message — the same
// misattribution risk the ordinal scheme above exists to prevent. `!==`
// fails closed (stays polling) on an overflow instead of silently risking a
// wrong selection on the (unconfirmed) assumption that overflow can't
// happen.
//
// Round 22 Phase A: expectedMessages/expectedOrdinals only exists for a
// receipt-verified local track or fallback (see irisDelivery.js) — a
// subgraph-sourced txHash from a different device without either falls
// back to treating this as nothing to track (see the null-guard below),
// same spirit as before this existed, but never the fully-unfiltered
// "trust whatever Iris returns" branch Round 26's review found unsafe.
//
// Round 22 Phase B: terminality used to be inferred as "no message is
// PENDING or missing a forwardState" — anything else (i.e. not PENDING) was
// treated as done. Circle's forwardState is not a small closed enum; it is
// an open string field, and CONFIRMED is a real, directly observed,
// NON-terminal value (a live Arc-testnet tx was seen transitioning
// CONFIRMED -> COMPLETE between two Iris polls). A mixed FAILED + CONFIRMED
// response used to satisfy the old check (no PENDING present) and stop
// polling with phase 'failed', even though the CONFIRMED message could
// still resolve to COMPLETE. Terminality now requires every message to be
// EXPLICITLY 'COMPLETE' or 'FAILED' — anything else (PENDING, CONFIRMED, or
// any value Circle adds later) keeps polling, which is the safe default for
// an open-ended field.
export function useCctpDelivery(txHash, isCrossChain, expectedOrdinals, expectedTotalMessages, expectedFingerprints) {
  const [phase, setPhase]           = useState('idle')
  const [deliveries, setDeliveries] = useState([])
  const intervalRef = useRef(null)
  const doneRef     = useRef(false)
  // Round 29: staleCountRef counts CONSECUTIVE polls whose outcome signature
  // is identical to the previous poll's — see STALE_POLL_THRESHOLD above.
  // lastSignatureRef holds that previous signature to compare against.
  const staleCountRef = useRef(0)
  const lastSignatureRef = useRef(null)
  const expectedOrdinalsKey = expectedOrdinals == null ? null : expectedOrdinals.join(',')
  // Round 29: same reasoning as expectedOrdinalsKey above — a stable string
  // key, not the array/object references themselves, since
  // FallbackCrossChainDelivery recomputes expectedFingerprints fresh on
  // every render (new object references each time even when the content is
  // identical), and depending on the objects directly would recreate `poll`
  // every render and reset phase/deliveries in a loop.
  const expectedFingerprintsKey = expectedFingerprints == null ? null : JSON.stringify(expectedFingerprints)

  // Round 29: called from every non-terminal poll outcome in place of a bare
  // setPhase('polling'). `signature` is a short string summarizing what THIS
  // poll actually saw for that specific branch — genuine progress (a
  // changing message count, an advancing forwardState) always changes it,
  // so the counter only advances when the exact same ambiguous/anomalous
  // outcome repeats with nothing new to show for it.
  const markUnresolved = (signature) => {
    if (signature === lastSignatureRef.current) {
      staleCountRef.current += 1
    } else {
      staleCountRef.current = 0
      lastSignatureRef.current = signature
    }
    setPhase(staleCountRef.current >= STALE_POLL_THRESHOLD ? 'stale' : 'polling')
  }

  const poll = useCallback(async () => {
    if (!txHash || !isCrossChain || doneRef.current) return
    try {
      // Round 27: no expectedOrdinals means nothing reliable to attribute —
      // every real call site (a receipt-verified local track or
      // FallbackCrossChainDelivery's live receipt refetch) always has this
      // by the time it mounts a tracker at all, so this should be
      // unreachable in practice. Staying in 'polling' forever here is the
      // safe default: this used to fall through to trusting Iris's
      // response unfiltered, which is the exact identity gap Round 26 was
      // built to close — silently-forever is much safer than silently-wrong.
      if (expectedOrdinals == null) {
        setPhase('polling')
        return
      }

      const allMessages = await fetchIrisMessages(txHash)

      if (allMessages.length !== expectedTotalMessages) {
        // Round 29: the signature includes the actual count, not just "not
        // equal" — an UNDER-count that's genuinely growing poll to poll
        // (Iris still indexing) keeps producing a new signature and never
        // goes stale; an OVER-count (Round 28's overflow case) or an
        // under-count stuck at the same number both repeat the identical
        // signature and correctly go stale after the threshold.
        markUnresolved(`count:${allMessages.length}`)
        return
      }

      const selectedByOrdinal = expectedOrdinals.map((ord) => allMessages[ord])
      const messages = selectedByOrdinal.filter(Boolean)

      if (messages.length < expectedOrdinals.length) {
        // Round 30 (Low finding): signature includes WHICH expected ordinals
        // came back empty, not just how many — two different missing
        // ordinals at the same count would otherwise produce an identical
        // signature and be indistinguishable from each other going stale.
        const missingOrdinals = expectedOrdinals.filter((_, i) => selectedByOrdinal[i] == null)
        markUnresolved(`selected:${messages.length}:${missingOrdinals.join(',')}`)
        return
      }

      // Round 29 (fixing the Round 29 review's Medium finding): ordinal
      // position alone (Round 27) proves WHERE a message sits in Iris's
      // response, not that its CONTENT is genuinely this milestone's own
      // real burn. Verify each selected entry's immutable fields
      // (irisMessageMatchesFingerprint) against the receipt-derived
      // fingerprint before ever trusting the selection. A mismatch fails the
      // same way an incomplete/ambiguous response already does — stays
      // 'polling' — since a genuine mismatch should be exceedingly rare
      // (Iris's own ordering guarantee, plus the count gate above, plus
      // Phase C's sourceTxHash filter, would all have to be wrong or
      // bypassed at once) and there is no safe alternative message to fall
      // back to selecting instead.
      if (expectedFingerprints != null) {
        // Round 30 (Low finding): signature includes WHICH selected index
        // mismatched, not just that one did — a mismatch moving between
        // ordinals poll to poll would otherwise look identical to the same
        // ordinal being stuck.
        const mismatchedIndexes = messages
          .map((m, i) => (irisMessageMatchesFingerprint(m, expectedFingerprints[i]) ? null : i))
          .filter((i) => i !== null)
        if (mismatchedIndexes.length > 0) {
          markUnresolved(`fingerprint-mismatch:${mismatchedIndexes.join(',')}`)
          return
        }
      }

      // Circle returns attestation: "PENDING" (string) while still confirming.
      // Round 30 (Low finding): signature includes WHICH selected index is
      // still unattested, not just that one is — same reasoning as the
      // fingerprint-mismatch signature above.
      const notAttestedIndexes = messages
        .map((m, i) => (m.attestation && m.attestation !== 'PENDING' ? null : i))
        .filter((i) => i !== null)
      if (notAttestedIndexes.length > 0) {
        markUnresolved(`unattested:${notAttestedIndexes.join(',')}`)
        return
      }

      // Round 21 Phase A: the real Iris response nests destinationDomain
      // under decodedMessage (as a string) and puts forwardState/
      // forwardTxHash/forwardErrorCode flat on the message itself — there is
      // no `forward` wrapper object at all. Verified against real captured
      // responses for actual Arc-testnet burns.
      //
      // Round 31 (fixing the Round 30 review's Medium finding:
      // "display/recovery logic still depends on the nullable decode").
      // decodedMessage is nullable per Circle's real schema (Round 30's own
      // doc comment on irisMessageMatchesFingerprint) — a genuine message
      // can have decodedMessage: null and still be fully real and even
      // terminal (FAILED), so reading destinationDomain from it ALONE left
      // EscrowDetail.jsx's SelfRelayCard rendering "Unknown chain" and
      // disabling self-relay for a delivery this app could otherwise recover
      // in-app. The raw message bytes (m.message) are already being parsed
      // for the identity check above (irisMessageMatchesFingerprint calls
      // cctpMessageFingerprint internally) whenever expectedFingerprints is
      // available — this reuses that SAME parser directly rather than
      // rebuilding domain-extraction logic a second way, and works
      // regardless of whether the fingerprint check ran, so it's the
      // primary source; decodedMessage is only a fallback for the
      // (should-be-unreachable) case where the raw message itself can't be
      // parsed (missing/"0x"/malformed).
      const domainFromRawMessage = (raw) => {
        if (typeof raw !== 'string' || raw === '0x') return null
        try {
          return cctpMessageFingerprint(raw).destinationDomain
        } catch {
          return null
        }
      }
      const parsed = messages.map((m) => ({
        message:          m.message,
        attestation:      m.attestation,
        destinationDomain: domainFromRawMessage(m.message) ??
          (m.decodedMessage?.destinationDomain != null ? Number(m.decodedMessage.destinationDomain) : null),
        destinationTxHash: m.forwardTxHash ?? null,
        forwardState:      m.forwardState ?? null,
        errorCode:         m.forwardErrorCode ?? null,
      }))
      setDeliveries(parsed)

      const allDelivered = parsed.every((m) => m.forwardState === 'COMPLETE')
      const allTerminal  = parsed.every(
        (m) => m.forwardState === 'COMPLETE' || m.forwardState === 'FAILED'
      )
      const anyFailed    = parsed.some((m) => m.forwardState === 'FAILED')

      if (allDelivered) {
        setPhase('delivered')
        doneRef.current = true
        clearInterval(intervalRef.current)
      } else if (allTerminal && anyFailed) {
        setPhase('failed')
        doneRef.current = true
        clearInterval(intervalRef.current)
      } else {
        // Round 29: signature includes each message's own forwardState — a
        // real transition (e.g. PENDING -> CONFIRMED) changes it and resets
        // the counter; forwardState stuck on the exact same value(s) poll
        // after poll (e.g. Circle's forwarding service silently never
        // advancing past PENDING) is precisely the "wrong for a while"
        // scenario this mechanism exists to surface.
        markUnresolved(`forward:${parsed.map((m) => m.forwardState).join(',')}`)
      }
    } catch {
      // Network error or unexpected shape — show unavailable but keep polling
      // so a transient outage doesn't permanently block status.
      //
      // Round 30 (Low finding): reset the stale-signature tracking here too.
      // Previously only the mount effect did this, so an exception sitting
      // between two otherwise-identical unresolved signatures didn't break
      // the "unchanged" streak at all — the count would silently keep
      // accumulating across the outage as though nothing had interrupted it.
      // A transient failure is itself a distinct, genuinely different event
      // from "the same ambiguous outcome repeating"; it shouldn't be
      // invisible to the mechanism that exists to detect exactly that.
      staleCountRef.current = 0
      lastSignatureRef.current = null
      setPhase('unavailable')
    }
    // Round 27: depends on expectedOrdinalsKey (a stable string), not
    // expectedOrdinals itself. FallbackCrossChainDelivery recomputes its
    // verified ordinals array fresh on every render (a new array reference
    // each time, even when the content is identical) — depending on the
    // array directly would recreate `poll` every render, which would then
    // retrigger the effect below and reset phase/deliveries in a loop. The
    // joined integers can never collide across genuinely different ordinal
    // sets in a way that matters here (same array, same key), so this is an
    // unambiguous equality key for otherwise-identical content. Round 29:
    // expectedFingerprintsKey follows the exact same reasoning.
  }, [txHash, isCrossChain, expectedOrdinalsKey, expectedTotalMessages, expectedFingerprintsKey])

  useEffect(() => {
    if (!txHash || !isCrossChain) {
      setPhase('idle')
      return
    }
    doneRef.current = false
    staleCountRef.current = 0
    lastSignatureRef.current = null
    setPhase('polling')
    setDeliveries([])
    poll()
    intervalRef.current = setInterval(poll, POLL_MS)
    return () => clearInterval(intervalRef.current)
  }, [txHash, isCrossChain, poll])

  return { phase, deliveries }
}
