import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchIrisMessages } from '../utils/irisDelivery'
import { ARC_DOMAIN } from '../config/chains'

const POLL_MS = 15_000

// Poll Circle's Iris API for cross-chain delivery status of a burn tx.
// Only activates for non-Arc destinations. Stops polling on success or failure.
//
// Returns:
//   phase: 'idle' | 'polling' | 'delivered' | 'failed' | 'unavailable'
//   deliveries: parsed message objects with destinationTxHash, message,
//               attestation, errorCode, forwardState per CCTP message
//               (one per milestone for plain releases; one per split recipient
//               for split milestones).
export function useCctpDelivery(txHash, destinationDomain) {
  const [phase, setPhase]           = useState('idle')
  const [deliveries, setDeliveries] = useState([])
  const intervalRef = useRef(null)
  const doneRef     = useRef(false)

  const poll = useCallback(async () => {
    if (!txHash || Number(destinationDomain) === ARC_DOMAIN || doneRef.current) return
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
        destinationDomain: m.destinationDomain ?? Number(destinationDomain),
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
  }, [txHash, destinationDomain])

  useEffect(() => {
    if (!txHash || Number(destinationDomain) === ARC_DOMAIN) {
      setPhase('idle')
      return
    }
    doneRef.current = false
    setPhase('polling')
    setDeliveries([])
    poll()
    intervalRef.current = setInterval(poll, POLL_MS)
    return () => clearInterval(intervalRef.current)
  }, [txHash, destinationDomain, poll])

  return { phase, deliveries }
}
