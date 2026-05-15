import { useEffect } from 'react'
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
      <div className="card-surface w-full max-w-md p-8 text-center" onClick={(e) => e.stopPropagation()}>
        {(status === 'confirming' || status === 'pending') && (
          <>
            <div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-border-subtle border-t-accent animate-spin" />
            <h3 className="text-lg font-semibold mb-1">
              {status === 'confirming' ? 'Confirm in wallet' : 'Transaction submitted'}
            </h3>
            <p className="text-sm text-text-secondary">
              {status === 'confirming'
                ? (title || 'Approve the transaction in your wallet.')
                : 'Waiting for confirmation on Arc Testnet.'}
            </p>
            {status === 'pending' && txHash && (
              <a
                className="hash inline-block mt-3 hover:text-accent"
                href={explorerTx(txHash)} target="_blank" rel="noreferrer"
              >
                {truncateAddr(txHash)} ↗
              </a>
            )}
          </>
        )}
        {status === 'success' && (
          <>
            <div className="mx-auto mb-4 h-10 w-10 rounded-full bg-status-success/15 text-status-success inline-flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M6 11.5l3.5 3.5L17 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <h3 className="text-lg font-semibold mb-1">Success</h3>
            <p className="text-sm text-text-secondary">{title || 'Transaction confirmed.'}</p>
            {txHash && (
              <a className="hash inline-block mt-3 hover:text-accent" href={explorerTx(txHash)} target="_blank" rel="noreferrer">
                View on Arc Explorer ↗
              </a>
            )}
            <button className="btn-primary w-full mt-6" onClick={onClose}>Done</button>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="mx-auto mb-4 h-10 w-10 rounded-full bg-status-error/15 text-status-error inline-flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M6 6l10 10M16 6L6 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            </div>
            <h3 className="text-lg font-semibold mb-1">Transaction failed</h3>
            <p className="text-sm text-text-secondary break-words">{parseRevertReason(error)}</p>
            <div className="flex gap-3 mt-6">
              {onRetry && <button className="btn-primary flex-1" onClick={onRetry}>Retry</button>}
              <button className="btn-secondary flex-1" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
