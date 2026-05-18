import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { explorerTx, truncateAddr } from '../utils/format'
import { parseRevertReason } from '../utils/errors'

export default function TxModal({
  status,
  txHash,
  error,
  title,
  onClose,
  onRetry
}) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (status === 'success' || status === 'error') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, onClose])

  if (status === 'idle' || !status) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return
        if (status === 'success' || status === 'error') onClose?.()
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={status}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: -4 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="card-surface w-full max-w-md p-8 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          {(status === 'confirming' || status === 'pending') && (
            <PendingState status={status} title={title} txHash={txHash} />
          )}
          {status === 'success' && (
            <SuccessState title={title} txHash={txHash} onClose={onClose} />
          )}
          {status === 'error' && (
            <ErrorState error={error} onClose={onClose} onRetry={onRetry} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/* Pending — active, in-motion. Dual-ring spinner with a pulsing core gives it
   more presence than a flat spinner. */
function PendingState({ status, title, txHash }) {
  return (
    <>
      <div className="mx-auto mb-5 relative h-14 w-14">
        <span className="absolute inset-0 rounded-full border-2 border-border-subtle" aria-hidden />
        <span
          className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent border-r-accent animate-spin"
          aria-hidden
        />
        <span
          className="absolute inset-2 rounded-full bg-accent-muted animate-pulse"
          aria-hidden
        />
      </div>
      <h3 className="text-lg font-semibold mb-1.5 text-text-primary">
        {status === 'confirming' ? 'Check your wallet' : 'Transaction sent'}
      </h3>
      <p className="text-sm text-text-secondary leading-relaxed">
        {status === 'confirming'
          ? (title || 'Open your wallet app and approve the transaction.')
          : 'Waiting for the transaction to confirm on Arc.'}
      </p>
      {status === 'pending' && txHash && (
        <a
          className="hash inline-block mt-4 hover:text-accent transition-colors"
          href={explorerTx(txHash)} target="_blank" rel="noreferrer"
        >
          {truncateAddr(txHash)} ↗
        </a>
      )}
    </>
  )
}

/* Success — should feel like a payoff. Animated checkmark with a soft ring
   pulse so the confirmation has a brief moment of presence. */
function SuccessState({ title, txHash, onClose }) {
  return (
    <>
      <div className="mx-auto mb-5 relative h-14 w-14">
        {/* Expanding ring — fires once on mount */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-status-success/20 tx-success-ring"
        />
        <div className="tx-success-pop relative h-14 w-14 rounded-full bg-status-success/15 text-status-success inline-flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 22 22" fill="none">
            <path d="M6 11.5l3.5 3.5L17 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
      <h3 className="text-lg font-semibold mb-1.5 text-text-primary">Success</h3>
      <p className="text-sm text-text-secondary leading-relaxed">{title || 'Confirmed.'}</p>
      {txHash && (
        <a
          className="hash inline-block mt-4 hover:text-accent transition-colors"
          href={explorerTx(txHash)} target="_blank" rel="noreferrer"
        >
          View on Arc Explorer ↗
        </a>
      )}
      <button className="btn-primary w-full mt-6" onClick={onClose}>Done</button>
    </>
  )
}

/* Error — clear and actionable, not alarming. Soft red badge, the parsed
   message in normal weight, primary action is the retry. */
function ErrorState({ error, onClose, onRetry }) {
  return (
    <>
      <div className="mx-auto mb-5 h-14 w-14 rounded-full bg-status-error/12 text-status-error inline-flex items-center justify-center border border-status-error/30">
        <svg width="26" height="26" viewBox="0 0 22 22" fill="none">
          <path d="M6 6l10 10M16 6L6 16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
        </svg>
      </div>
      <h3 className="text-lg font-semibold mb-1.5 text-text-primary">Transaction failed</h3>
      <p className="text-sm text-text-secondary break-words leading-relaxed">{parseRevertReason(error)}</p>
      <div className="flex gap-3 mt-6">
        {onRetry && <button className="btn-primary flex-1" onClick={onRetry}>Try again</button>}
        <button className="btn-secondary flex-1" onClick={onClose}>Close</button>
      </div>
    </>
  )
}
