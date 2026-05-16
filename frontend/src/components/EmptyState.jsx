import { Link } from 'react-router-dom'

const DEFAULT_ICON = (
  <svg
    width="56"
    height="56"
    viewBox="0 0 56 56"
    fill="none"
    aria-hidden="true"
    className="text-text-tertiary"
  >
    <rect x="8" y="14" width="40" height="32" rx="4" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 22h40" stroke="currentColor" strokeWidth="1.5" />
    <path d="M18 30h12M18 36h20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="40" cy="14" r="6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M40 11v6M37 14h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

export default function EmptyState({
  icon = DEFAULT_ICON,
  title = 'No active escrows yet.',
  message = "Let's lock in your first contract.",
  ctaLabel = 'Create Escrow',
  ctaTo = '/create'
}) {
  return (
    <div className="card-surface p-12 flex flex-col items-center text-center gap-4">
      <div className="text-text-tertiary">{icon}</div>
      <div className="flex flex-col gap-1 max-w-sm">
        <h3 className="text-base font-medium text-text-primary">{title}</h3>
        <p className="text-sm text-text-secondary">{message}</p>
      </div>
      {ctaTo && (
        <Link to={ctaTo} className="btn-primary text-sm py-2.5 mt-2">
          {ctaLabel}
        </Link>
      )}
    </div>
  )
}
