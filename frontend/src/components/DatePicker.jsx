import { useEffect, useRef, useState } from 'react'
import IconButton from './IconButton.jsx'

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatDisplay(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

export default function DatePicker({
  value,
  onChange,
  placeholder = 'Select a date',
  id,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const today = startOfDay(new Date())
  const initial = value ? startOfDay(value) : today
  const [cursor, setCursor] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1))

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const startDow = (firstOfMonth.getDay() + 6) % 7
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()

  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d))

  const goto = (n) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1))

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        id={id}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`input-field flex items-center justify-between text-left font-mono ${open ? 'border-border-focused' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={value ? 'text-text-primary' : 'text-text-tertiary'}>
          {value ? formatDisplay(startOfDay(value)) : placeholder}
        </span>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="2" y="3" width="10" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M2 6h10M5 1.5v2M9 1.5v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 left-0 top-[calc(100%+4px)] card-surface p-3 w-[280px]">
          <div className="flex items-center justify-between mb-3">
            <IconButton size="sm" label="Previous month" onClick={() => goto(-1)}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M7.5 3l-3 3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </IconButton>
            <div className="text-sm font-medium">
              {cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
            </div>
            <IconButton size="sm" label="Next month" onClick={() => goto(1)}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M4.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </IconButton>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-text-tertiary mb-1">
            {DOW.map((d) => <span key={d}>{d}</span>)}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <span key={i} />
              const isPast = d < today
              const isToday = sameDay(d, today)
              const isSelected = value && sameDay(d, startOfDay(value))
              return (
                <button
                  key={i}
                  type="button"
                  className={`h-8 text-xs font-mono rounded-md transition-colors ${
                    isPast
                      ? 'text-text-tertiary cursor-not-allowed'
                      : isSelected
                      ? 'bg-accent text-white'
                      : isToday
                      ? 'border border-accent text-accent hover:bg-accent-muted'
                      : 'text-text-primary hover:bg-background-tertiary'
                  }`}
                  disabled={isPast}
                  onClick={() => { onChange(d); setOpen(false) }}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
