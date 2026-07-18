import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'

import { txToast } from './useToast.jsx'
import { parseRevertReason } from '../utils/errors'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract'
import { arcTestnet } from '../config/wagmi'

/* Drives a single write transaction with:
   - optimistic onSign callback (instant UI feedback the moment the user signs)
   - Sonner loading toast that flips to success / error
   - onConfirmed / onReverted lifecycle hooks
   - rollback hook so callers can revert local state on revert */
export function useTx({ onSign, onConfirmed, onReverted, onSettled } = {}) {
  const { writeContractAsync } = useWriteContract()
  // useAccount().chainId, NOT wagmi's useChainId(): useChainId() reads a
  // top-level state value that wagmi's syncConnectedChain subscriber only
  // updates when the wallet's real chain is in config.chains. Our config
  // only registers arcTestnet, so a wallet on any other chain (e.g. mainnet)
  // never syncs — useChainId() keeps reporting the arcTestnet default
  // forever, even though the wallet never left mainnet. useAccount().chainId
  // reads the connector's real per-connection value, unfiltered. Verified
  // empirically: a mock wallet left on mainnet made useChainId() report
  // 5042002 immediately after connect, while useAccount().chainId correctly
  // reported 1.
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
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
      // Auto-switch strategy: gate every write on Arc Testnet, prompting a
      // switch rather than just disabling the action. switchChainAsync's
      // injected-connector implementation already falls back to
      // wallet_addEthereumChain automatically when the wallet has never
      // added Arc Testnet (verified empirically against @wagmi/core, not
      // assumed) — sourcing chainId/rpcUrls/nativeCurrency/blockExplorerUrls
      // from the arcTestnet config in config/wagmi.js. No manual fallback
      // needed here.
      if (chainId !== arcTestnet.id) {
        try {
          await switchChainAsync({ chainId: arcTestnet.id })
        } catch (switchErr) {
          // wagmi collapses every decline point (switch prompt, add-chain
          // prompt, post-add re-switch) into the same error shape — there's
          // no reliable field to tell them apart (verified empirically), so
          // one message covers all of them. Original error kept for
          // debugging, not shown to the user.
          console.error('Arc Testnet network switch failed:', switchErr)
          const err = new Error('NETWORK_SWITCH_FAILED')
          err.cause = switchErr
          throw err
        }
      }
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
      const msg = err.message === 'NETWORK_SWITCH_FAILED'
        ? "Couldn't switch to Arc Testnet — please approve the network prompt in your wallet."
        : parseRevertReason(err)
      toastRef.current?.error(msg)
      callbacksRef.current.onReverted?.(err)
      callbacksRef.current.onSettled?.(null)
      throw err
    }
  }, [writeContractAsync, chainId, switchChainAsync])

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
