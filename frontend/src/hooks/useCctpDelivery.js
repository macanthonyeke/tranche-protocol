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
export function useCctpDelivery(txHash, isCrossChain) {
  const [phase, setPhase]           = useState('idle')
  const [deliveries, setDeliveries] = useState([])
  const intervalRef = useRef(null)
  const doneRef     = useRef(false)

  const poll = useCallback(async () => {
    if (!txHash || !isCrossChain || doneRef.current) return
    try {
      const messages = await fetchIrisMessages(txHash)

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

      const parsed = messages.map((m) => ({
        message:          m.message,
        attestation:      m.attestation,
        destinationDomain: m.destinationDomain ?? null,
        destinationTxHash: m.forward?.destinationTxHash ?? null,
        forwardState:      m.forward?.forwardState ?? null,
        errorCode:         m.forward?.forwardErrorCode ?? null,
      }))
      setDeliveries(parsed)

      const anyFailed   = parsed.some((m) => m.forwardState === 'FAILED')
      const allDelivered = parsed.every((m) => m.forwardState === 'COMPLETE')
      const anyPending   = parsed.some(
        (m) => !m.forwardState || m.forwardState === 'PENDING'
      )

      if (allDelivered) {
        setPhase('delivered')
        doneRef.current = true
        clearInterval(intervalRef.current)
      } else if (anyFailed && !anyPending) {
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
  }, [txHash, isCrossChain])

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
