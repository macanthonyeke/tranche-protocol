import { useCallback, useEffect, useRef, useState } from 'react'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'

import { txToast } from './useToast.jsx'
import { parseRevertReason } from '../utils/errors'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract'

/* Drives a single write transaction with:
   - optimistic onSign callback (instant UI feedback the moment the user signs)
   - Sonner loading toast that flips to success / error
   - onConfirmed / onReverted lifecycle hooks
   - rollback hook so callers can revert local state on revert */
export function useTx({ onSign, onConfirmed, onReverted, onSettled } = {}) {
  const { writeContractAsync } = useWriteContract()
  const [status, setStatus] = useState('idle')   // idle | confirming | pending | success | error
  const [hash, setHash] = useState(null)
  const [error, setError] = useState(null)
  const toastRef = useRef(null)
  const callbacksRef = useRef({ onSign, onConfirmed, onReverted, onSettled })

  useEffect(() => {
    callbacksRef.current = { onSign, onConfirmed, onReverted, onSettled }
  }, [onSign, onConfirmed, onReverted, onSettled])

  const { data: receipt, isError: receiptIsError, error: receiptError } =
    useWaitForTransactionReceipt({ hash, query: { enabled: !!hash } })

  // When the receipt arrives, finalize the toast and dispatch lifecycle.
  useEffect(() => {
    if (!hash) return
    if (receipt) {
      if (receipt.status === 'reverted') {
        setStatus('error')
        toastRef.current?.error('Transaction reverted on-chain.', { hash })
        callbacksRef.current.onReverted?.(receipt)
      } else {
        setStatus('success')
        toastRef.current?.success('Transaction confirmed.', { hash })
        callbacksRef.current.onConfirmed?.(receipt)
      }
      callbacksRef.current.onSettled?.(receipt)
    } else if (receiptIsError && receiptError) {
      setStatus('error')
      const msg = parseRevertReason(receiptError)
      toastRef.current?.error(msg, { hash })
      callbacksRef.current.onReverted?.(receiptError)
      callbacksRef.current.onSettled?.(null)
    }
  }, [receipt, receiptIsError, receiptError, hash])

  const run = useCallback(async (args, { loadingMessage = 'Awaiting wallet signature…' } = {}) => {
    setError(null)
    setStatus('confirming')
    toastRef.current = txToast({ loading: loadingMessage })
    try {
      const tx = await writeContractAsync(args)
      setHash(tx)
      setStatus('pending')
      toastRef.current.update('Submitted. Waiting for confirmation…')
      // Fire the optimistic-update callback once the user has signed.
      callbacksRef.current.onSign?.(tx)
      return tx
    } catch (err) {
      setError(err)
      setStatus('error')
      const msg = parseRevertReason(err)
      toastRef.current?.error(msg)
      callbacksRef.current.onReverted?.(err)
      callbacksRef.current.onSettled?.(null)
      throw err
    }
  }, [writeContractAsync])

  const reset = useCallback(() => {
    setStatus('idle'); setHash(null); setError(null)
    toastRef.current = null
  }, [])

  return { run, status, hash, error, reset, isBusy: status === 'confirming' || status === 'pending' }
}

/* Convenience: a writeContract for the escrow contract with shared addr+abi. */
export function escrowWrite(functionName, args) {
  return { address: CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName, args }
}
