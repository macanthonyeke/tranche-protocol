import { useState } from 'react'
import { truncateAddr } from '../utils/format'

export default function AddressDisplay({ address, full = false, size = 'md', className = '' }) {
  const [copied, setCopied] = useState(false)
  if (!address) return null

  const display = full ? address : truncateAddr(address)
  const sizeCls = size === 'sm' ? 'text-xs px-1.5 py-0.5' : size === 'lg' ? 'text-base px-2.5 py-1' : 'text-sm px-2 py-1'

  const onClick = async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {}
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono rounded-md bg-background-tertiary text-text-secondary hover:text-text-primary cursor-pointer transition-colors ${sizeCls} ${className}`}
      onClick={onClick}
      title={address}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(e) }}
    >
      <span>{display}</span>
      {copied && <span className="text-status-success text-xs">Copied</span>}
    </span>
  )
}
