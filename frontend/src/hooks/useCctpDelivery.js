import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchIrisMessages } from '../utils/irisDelivery'

const POLL_MS = 15_000

// Poll Circle's Iris API for cross-chain delivery status of a burn tx.
// Only activates when the settlement is cross-chain at all. Stops polling
// once every message has reached a terminal forwardState.
//
// Returns:
//   phase: 'idle' | 'polling' | 'delivered' | 'failed' | 'unavailable'
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
export function useCctpDelivery(txHash, isCrossChain, expectedOrdinals, expectedTotalMessages) {
  const [phase, setPhase]           = useState('idle')
  const [deliveries, setDeliveries] = useState([])
  const intervalRef = useRef(null)
  const doneRef     = useRef(false)
  const expectedOrdinalsKey = expectedOrdinals == null ? null : expectedOrdinals.join(',')

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
        setPhase('polling')
        return
      }

      const messages = expectedOrdinals.map((ord) => allMessages[ord]).filter(Boolean)

      if (messages.length < expectedOrdinals.length) {
        setPhase('polling')
        return
      }

      // Circle returns attestation: "PENDING" (string) while still confirming.
      const allAttested = messages.every(
        (m) => m.attestation && m.attestation !== 'PENDING'
      )
      if (!allAttested) {
        setPhase('polling')
        return
      }

      // Round 21 Phase A: the real Iris response nests destinationDomain
      // under decodedMessage (as a string) and puts forwardState/
      // forwardTxHash/forwardErrorCode flat on the message itself — there is
      // no `forward` wrapper object at all. Verified against real captured
      // responses for actual Arc-testnet burns.
      const parsed = messages.map((m) => ({
        message:          m.message,
        attestation:      m.attestation,
        destinationDomain: m.decodedMessage?.destinationDomain != null ? Number(m.decodedMessage.destinationDomain) : null,
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
        setPhase('polling')
      }
    } catch {
      // Network error or unexpected shape — show unavailable but keep polling
      // so a transient outage doesn't permanently block status.
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
    // unambiguous equality key for otherwise-identical content.
  }, [txHash, isCrossChain, expectedOrdinalsKey, expectedTotalMessages])

  useEffect(() => {
    if (!txHash || !isCrossChain) {
      setPhase('idle')
      return
    }
    doneRef.current = false
    setPhase('polling')
    setDeliveries([])
    poll()
    intervalRef.current = setInterval(poll, POLL_MS)
    return () => clearInterval(intervalRef.current)
  }, [txHash, isCrossChain, poll])

  return { phase, deliveries }
}
