import { toast as sonnerToast } from 'sonner'
import { explorerTx, truncateAddr } from '../utils/format'

/* Thin adapter so existing call sites (toast.success/error/info/pending) keep
   working unchanged while the underlying toaster is Sonner. */

function explorerLink(hash) {
  if (!hash) return null
  return {
    label: `View ${truncateAddr(hash)} ↗`,
    onClick: () => window.open(explorerTx(hash), '_blank', 'noopener')
  }
}

const api = {
  success: (msg, opts = {}) => sonnerToast.success(msg, withAction(opts)),
  error:   (msg, opts = {}) => sonnerToast.error(msg, withAction(opts)),
  info:    (msg, opts = {}) => sonnerToast(msg, withAction(opts)),
  pending: (msg, opts = {}) => sonnerToast.loading(msg, { duration: Infinity, ...withAction(opts) }),
  message: (msg, opts = {}) => sonnerToast(msg, withAction(opts)),
  loading: (msg, opts = {}) => sonnerToast.loading(msg, withAction(opts)),
  dismiss: (id) => sonnerToast.dismiss(id),
  remove:  (id) => sonnerToast.dismiss(id)
}

function withAction(opts = {}) {
  const { txHash, action, ...rest } = opts
  if (txHash && !action) {
    return { ...rest, action: explorerLink(txHash) }
  }
  return { ...rest, action }
}

/* ToastProvider is now a no-op — Sonner's <Toaster /> lives in main.jsx. */
export function ToastProvider({ children }) {
  return children
}

export function useToast() {
  return api
}

/* Lifecycle helper: drive a single toast through loading → success / error.
   Returns the toast id so callers can dismiss it manually if needed. */
export function txToast({ id, loading = 'Submitting transaction…' } = {}) {
  const toastId = id ?? sonnerToast.loading(loading, { duration: Infinity })

  return {
    id: toastId,
    update: (message, opts = {}) =>
      sonnerToast.loading(message, { id: toastId, duration: Infinity, ...opts }),
    success: (message = 'Confirmed.', { hash, ...rest } = {}) =>
      sonnerToast.success(message, { id: toastId, action: hash ? explorerLink(hash) : undefined, ...rest }),
    error: (message = 'Transaction failed.', { hash, ...rest } = {}) =>
      sonnerToast.error(message, { id: toastId, action: hash ? explorerLink(hash) : undefined, ...rest }),
    dismiss: () => sonnerToast.dismiss(toastId)
  }
}
