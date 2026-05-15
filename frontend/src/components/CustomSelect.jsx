import { useEffect, useRef, useState, useMemo } from 'react'

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchable = false,
  disabled = false,
  className = ''
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const wrapRef = useRef(null)

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options
    const q = query.trim().toLowerCase()
    return options.filter((o) => String(o.label).toLowerCase().includes(q))
  }, [options, query, searchable])

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false); setQuery('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => { setActive(0) }, [query, open])

  const selected = options.find((o) => o.value === value)

  const handleKey = (e) => {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = filtered[active]
      if (o) { onChange(o.value); setOpen(false); setQuery('') }
    } else if (e.key === 'Escape') {
      setOpen(false); setQuery('')
    }
  }

  return (
    <div className={`relative ${className}`} ref={wrapRef} onKeyDown={handleKey}>
      <button
        type="button"
        className={`input-field flex items-center justify-between text-left ${open ? 'border-border-focused' : ''}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
      >
        <span className={selected ? '' : 'text-text-tertiary'}>
          {selected ? selected.label : placeholder}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 top-[calc(100%+4px)] card-surface p-2 max-h-72 overflow-y-auto">
          {searchable && (
            <div className="mb-2">
              <input
                autoFocus
                type="text"
                placeholder="Search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="input-field"
              />
            </div>
          )}
          <ul role="listbox" className="flex flex-col gap-0.5">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-text-tertiary">No matches</li>
            )}
            {filtered.map((o, idx) => {
              const isSel = o.value === value
              const isActive = idx === active
              return (
                <li
                  key={String(o.value)}
                  role="option"
                  aria-selected={isSel}
                  className={`flex items-center justify-between px-3 py-2 rounded-md cursor-pointer text-sm transition-colors ${
                    isSel ? 'text-accent' : 'text-text-primary'
                  } ${isActive ? 'bg-background-tertiary' : ''}`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => { onChange(o.value); setOpen(false); setQuery('') }}
                >
                  <span>{o.label}</span>
                  {isSel && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M3 7.5l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
