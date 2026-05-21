import { useState } from 'react'

export default function Tooltip({ content }) {
  const [open, setOpen] = useState(false)
  if (!content) return null
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="More info"
        className="inline-flex items-center justify-center h-4 w-4 ml-1 text-ink-3 hover:text-ink"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o) }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M7 6.2v3.2M7 4.5v0.05" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <span className="absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 card-surface px-3 py-2 text-xs text-ink-2 shadow-lg">
          {content}
        </span>
      )}
    </span>
  )
}
