import { useToast } from '../hooks/useToast.jsx'

const STYLES = {
  success: 'border-status-success/30 bg-background-secondary text-text-primary',
  error: 'border-status-error/30 bg-background-secondary text-text-primary',
  info: 'border-border-subtle bg-background-secondary text-text-primary',
  pending: 'border-border-subtle bg-background-secondary text-text-primary'
}

const ICON_COLOR = {
  success: 'text-status-success',
  error: 'text-status-error',
  info: 'text-accent',
  pending: 'text-accent'
}

export default function ToastViewport() {
  const { toasts, remove } = useToast()
  if (!toasts.length) return null

  return (
    <div className="fixed top-4 right-4 z-[1000] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-3 rounded-xl border p-3 shadow-lg ${STYLES[t.type] || STYLES.info}`}
        >
          <span className={`mt-0.5 ${ICON_COLOR[t.type] || ICON_COLOR.info}`}>
            {t.type === 'success' && (
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none"><path d="M3 7.5l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
            {t.type === 'error' && (
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none"><path d="M4 4l6 6M10 4L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            )}
            {t.type === 'info' && (
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/><path d="M7 6.5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            )}
            {t.type === 'pending' && (
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 10" /></svg>
            )}
          </span>
          <div className="flex-1 min-w-0">
            {t.title && <div className="text-sm font-medium">{t.title}</div>}
            <div className="text-sm text-text-secondary break-words">{t.message}</div>
          </div>
          <button
            onClick={() => remove(t.id)}
            aria-label="Close"
            className="text-text-tertiary hover:text-text-primary"
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          </button>
        </div>
      ))}
    </div>
  )
}
