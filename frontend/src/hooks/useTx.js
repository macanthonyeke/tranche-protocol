import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'

import { txToast } from './useToast.jsx'
import { useAuth } from './useAuth.jsx'
import { parseRevertReason } from '../utils/errors'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract'
import { arcTestnet } from '../config/wagmi'

// How long to wait for Circle to broadcast an approved challenge. Generous:
// by this point the user has already approved with their PIN and the
// transaction is in flight, so giving up early would report a failure for
// something that is about to succeed.
const SCA_POLL_INTERVAL_MS = 2000
const SCA_POLL_TIMEOUT_MS = 120000

/* Poll tx-status until Circle reports a hash for the challenge's transaction.
   Throws if Circle reports the transaction failed, or on timeout. */
async function awaitScaTxHash({ challengeId, userToken }) {
  const deadline = Date.now() + SCA_POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const res = await fetch('/api/wallet/tx-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, userToken })
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      if (data.failed) throw new Error(data.errorReason || 'The network rejected this transaction.')
      // A hash is all that's needed — the shared receipt wait below takes it
      // from here, so there's no reason to also wait on Circle's own
      // terminal state.
      if (data.txHash) return data.txHash
    }
    await new Promise((r) => setTimeout(r, SCA_POLL_INTERVAL_MS))
  }
  throw new Error('Timed out waiting for the transaction to be submitted.')
}

/* Drives a single write transaction with:
   - optimistic onSign callback (instant UI feedback the moment the user signs)
   - Sonner loading toast that flips to success / error
   - onConfirmed / onReverted lifecycle hooks
   - rollback hook so callers can revert local state on revert

   Handles both wallet types behind one API, so the ~25 call sites that do
   tx.run(escrowWrite(fn, args)) need no branching and were not touched when
   email sign-in landed. The paths differ only in how a hash is obtained: an
   EOA returns one from writeContract, a Circle SCA must be polled for one
   after the user approves in Circle's hosted PIN dialog. Once a hash exists
   both converge on the same receipt wait below, so onConfirmed always gets a
   real on-chain receipt with real logs — CreateEscrow depends on that, since
   it reads the new escrow id out of receipt.logs. */
export function useTx({ onSign, onConfirmed, onReverted, onSettled } = {}) {
  const { writeContractAsync } = useWriteContract()
  const { executeContractCall, isSca } = useAuth()
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
      // Circle SCA path. Deliberately ahead of the network-switch block: a
      // Circle wallet has no injected connector and no "current chain" to
      // switch — Circle broadcasts to Arc directly, and useAccount().chainId
      // is undefined for these users, so running the switch would prompt a
      // wallet that isn't there and fail every write.
      if (isSca) {
        const pending = await executeContractCall(args)
        if (!pending) throw new Error('Could not reach your wallet. Please sign in again.')
        // The user has approved in Circle's dialog; from here it behaves like
        // a submitted transaction.
        toastRef.current.update('Approved. Submitting…')
        const tx = await awaitScaTxHash(pending)
        setHash(tx)
        setStatus('pending')
        toastRef.current.update('Submitted. Waiting for confirmation…')
        callbacksRef.current.onSign?.(tx)
        return tx
      }

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
  }, [writeContractAsync, chainId, switchChainAsync, isSca, executeContractCall])

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
