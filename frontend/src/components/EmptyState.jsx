import { Link } from 'react-router-dom'

const DEFAULT_ICON = (
  <svg
    width="36"
    height="36"
    viewBox="0 0 32 32"
    fill="none"
    aria-hidden="true"
  >
    <rect x="5" y="8" width="22" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M5 13h22" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10 18h6M10 22h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="23" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M23 6v4M21 8h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

export default function EmptyState({
  icon = DEFAULT_ICON,
  title = 'Nothing here yet.',
  message = 'Create your first escrow and it will show up here.',
  ctaLabel = 'Create Escrow',
  ctaTo = '/create'
}) {
  return (
    <div className="card-surface px-6 py-16 sm:py-20 flex flex-col items-center text-center gap-5">
      <div
        aria-hidden
        className="relative w-20 h-20 rounded-2xl bg-sunk text-ink-2 flex items-center justify-center"
      >
        {/* Soft outer ring to give the icon a deliberate, anchored feel. */}
        <span className="absolute inset-0 rounded-2xl ring-1 ring-rule" />
        {icon}
      </div>
      <div className="flex flex-col gap-2 max-w-sm">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
        <p className="text-sm text-ink-2 leading-relaxed">{message}</p>
      </div>
      {ctaTo && ctaLabel && (
        <Link to={ctaTo} className="btn-primary text-sm py-2.5 mt-2">
          {ctaLabel}
        </Link>
      )}
    </div>
  )
}
