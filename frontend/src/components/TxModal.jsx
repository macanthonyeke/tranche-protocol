import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { explorerTx, truncateAddr } from '../utils/format'
import { parseRevertReason, getRawErrorDetails } from '../utils/errors'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export default function TxModal({
  status,
  txHash,
  error,
  title,
  onClose,
  onRetry
}) {
  const dialogRef = useRef(null)
  const titleId = useId()
  const isOpen = status && status !== 'idle'
  // Pending/confirming surfaces are signing the user out to their wallet —
  // dismissal mid-flight would orphan the in-flight transaction in the UI,
  // so we suppress Escape and the backdrop click until the txn resolves.
  const dismissible = status === 'success' || status === 'error'

  useEffect(() => {
    if (!isOpen) return

    const root = document.getElementById('root')
    const hadInert = root?.hasAttribute('inert')
    const prevAriaHidden = root?.getAttribute('aria-hidden')
    root?.setAttribute('inert', '')
    root?.setAttribute('aria-hidden', 'true')

    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (dismissible) onClose?.()
        return
      }
      if (e.key !== 'Tab') return
      const container = dialogRef.current
      if (!container) return
      const nodes = Array.from(container.querySelectorAll(FOCUSABLE))
      if (nodes.length === 0) { e.preventDefault(); container.focus(); return }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !container.contains(active))) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && (active === last || !container.contains(active))) {
        e.preventDefault(); first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    const prevFocus = document.activeElement
    setTimeout(() => {
      const container = dialogRef.current
      const firstFocusable = container?.querySelector(FOCUSABLE)
      ;(firstFocusable ?? container)?.focus()
    }, 0)

    return () => {
      document.removeEventListener('keydown', onKey)
      if (!hadInert) root?.removeAttribute('inert')
      if (prevAriaHidden === null || prevAriaHidden === undefined) {
        root?.removeAttribute('aria-hidden')
      } else {
        root?.setAttribute('aria-hidden', prevAriaHidden)
      }
      try { prevFocus?.focus?.() } catch {}
    }
  }, [isOpen, dismissible, onClose])

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: 'color-mix(in oklch, var(--ink) 55%, transparent)' }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return
        if (dismissible) onClose?.()
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={status}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: -4 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          ref={dialogRef}
          className="card-surface w-full max-w-md p-8 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          {(status === 'confirming' || status === 'pending') && (
            <PendingState titleId={titleId} status={status} title={title} txHash={txHash} />
          )}
          {status === 'success' && (
            <SuccessState titleId={titleId} title={title} txHash={txHash} onClose={onClose} />
          )}
          {status === 'error' && (
            <ErrorState titleId={titleId} error={error} onClose={onClose} onRetry={onRetry} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body
  )
}

function PendingState({ titleId, status, title, txHash }) {
  return (
    <>
      <div className="mx-auto mb-5 relative h-14 w-14">
        <span className="absolute inset-0 rounded-full border-2 border-rule" aria-hidden />
        <span
          className="absolute inset-0 rounded-full border-2 border-transparent border-t-clay border-r-clay animate-spin"
          aria-hidden
        />
        <span
          className="absolute inset-2 rounded-full bg-clay-soft animate-pulse"
          aria-hidden
        />
      </div>
      <h3 id={titleId} className="text-lg font-semibold mb-1.5 text-ink">
        {status === 'confirming' ? 'Check your wallet' : 'Transaction sent'}
      </h3>
      <p className="text-sm text-ink-2 leading-relaxed">
        {status === 'confirming'
          ? (title || 'Open your wallet app and approve the transaction.')
          : 'Waiting for the transaction to confirm on Arc.'}
      </p>
      {status === 'pending' && txHash && (
        <a
          className="hash inline-block mt-4 hover:text-clay transition-colors"
          href={explorerTx(txHash)} target="_blank" rel="noreferrer"
        >
          {truncateAddr(txHash)} ↗
        </a>
      )}
    </>
  )
}

function SuccessState({ titleId, title, txHash, onClose }) {
  return (
    <>
      <div className="mx-auto mb-5 relative h-14 w-14">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-ok/20 tx-success-ring"
        />
        <div className="tx-success-pop relative h-14 w-14 rounded-full bg-ok/15 text-ok inline-flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 22 22" fill="none">
            <path d="M6 11.5l3.5 3.5L17 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
      <h3 id={titleId} className="text-lg font-semibold mb-1.5 text-ink">Success</h3>
      <p className="text-sm text-ink-2 leading-relaxed">{title || 'Confirmed.'}</p>
      {txHash && (
        <a
          className="hash inline-block mt-4 hover:text-clay transition-colors"
          href={explorerTx(txHash)} target="_blank" rel="noreferrer"
        >
          View on Arc Explorer ↗
        </a>
      )}
      <button className="btn-primary w-full mt-6" onClick={onClose}>Done</button>
    </>
  )
}

function ErrorState({ titleId, error, onClose, onRetry }) {
  const [showDetails, setShowDetails] = useState(false)
  const details = getRawErrorDetails(error)
  return (
    <>
      <div className="mx-auto mb-5 h-14 w-14 rounded-full bg-bad/12 text-bad inline-flex items-center justify-center border border-bad/30">
        <svg width="26" height="26" viewBox="0 0 22 22" fill="none">
          <path d="M6 6l10 10M16 6L6 16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
        </svg>
      </div>
      <h3 id={titleId} className="text-lg font-semibold mb-1.5 text-ink">Transaction failed</h3>
      <p className="text-sm text-ink-2 break-words leading-relaxed">{parseRevertReason(error)}</p>
      {details && (
        <div className="mt-3 text-left">
          <button
            type="button"
            className="text-xs text-ink-3 hover:text-ink-2 transition-colors flex items-center gap-1"
            onClick={() => setShowDetails((v) => !v)}
          >
            <span>{showDetails ? '▾' : '▸'}</span>
            <span>Technical details</span>
          </button>
          {showDetails && (
            <p className="mt-2 text-[11px] font-mono text-ink-3 break-all bg-sunk rounded-lg px-3 py-2">
              {details}
            </p>
          )}
        </div>
      )}
      <div className="flex gap-3 mt-6">
        {onRetry && <button className="btn-primary flex-1" onClick={onRetry}>Try again</button>}
        <button className="btn-secondary flex-1" onClick={onClose}>Close</button>
      </div>
    </>
  )
}
