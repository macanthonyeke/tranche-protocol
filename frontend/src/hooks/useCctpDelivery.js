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
// Round 22 Phase A: `expectedMessages`, optional — originally a bare count
// of real MessageSent events the confirming receipt proved should exist
// for this tx, now (Round 26) the actual verified message identities
// themselves (see receiptEmittedCctpMessageForMilestone /
// verifiedOwnCctpMessage), persisted by the submitting device alongside
// the tracked txHash. A mixed split can burn several legs to different
// chains in one transaction, and Iris indexes each message independently —
// a partial response (fewer messages than the receipt proved) is "not
// fully indexed yet", not "this is the complete set". Only the submitting
// device has this; a subgraph-sourced txHash from a different device falls
// back to the messages.length === 0 heuristic below, same as before this
// existed.
//
// Round 26 finding 2: a bare count was never enough once Iris's response
// can contain messages belonging to a DIFFERENT milestone under the same
// tx hash — Iris has no concept of "milestone", only tx hash. A batch with
// 2 total messages where only 1 is genuinely this milestone's own used to
// pass `messages.length(2) >= expectedMessageCount(1)` and then render
// BOTH — a foreign message's failure could make this milestone look
// failed, or its success could look like this milestone's own delivery.
// expectedMessages is now the exact set of raw message hex strings this
// milestone's own receipt verified (see verifiedOwnCctpMessage's full
// authenticity chain) — Iris's response is filtered to ONLY the entries
// whose own `message` field byte-matches one of them (case-insensitive
// string equality; these are short, few-per-receipt hex strings, so a
// hash comparison would add a step for no real benefit) before anything
// else in this function ever looks at it.
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
export function useCctpDelivery(txHash, isCrossChain, expectedMessages) {
  const [phase, setPhase]           = useState('idle')
  const [deliveries, setDeliveries] = useState([])
  const intervalRef = useRef(null)
  const doneRef     = useRef(false)
  const expectedMessagesKey = expectedMessages == null ? null : expectedMessages.join(',')

  const poll = useCallback(async () => {
    if (!txHash || !isCrossChain || doneRef.current) return
    try {
      const allMessages = await fetchIrisMessages(txHash)

      // Identity-based, not count-based (Round 26 finding 2) — see the
      // doc comment above for why a bare length check let a foreign
      // milestone's own genuine Iris message through undetected.
      const messages = expectedMessages != null
        ? allMessages.filter((m) => expectedMessages.some((em) => em.toLowerCase() === m.message?.toLowerCase()))
        : allMessages

      if (expectedMessages != null && messages.length < expectedMessages.length) {
        setPhase('polling')
        return
      }

      if (messages.length === 0) {
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
      // responses for actual Arc-testnet burns (see fetchIrisMessages).
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
    // Round 26: depends on expectedMessagesKey (a stable string), not
    // expectedMessages itself. FallbackCrossChainDelivery recomputes its
    // verified message array fresh on every render (a new array reference
    // each time, even when the content is identical) — depending on the
    // array directly would recreate `poll` every render, which would then
    // retrigger the effect below and reset phase/deliveries in a loop. The
    // joined hex strings can never contain a comma, so this is an
    // unambiguous equality key for otherwise-identical content.
  }, [txHash, isCrossChain, expectedMessagesKey])

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
