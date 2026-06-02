export const formatUSDC = (raw) => {
  if (raw === undefined || raw === null) return '0.00 USDC'
  const n = typeof raw === 'bigint' ? Number(raw) : Number(raw)
  return (n / 1e6).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' USDC'
}

export const formatUSDCNumber = (raw) => {
  if (raw === undefined || raw === null) return '0.00'
  const n = typeof raw === 'bigint' ? Number(raw) : Number(raw)
  return (n / 1e6).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

export const truncateAddr = (addr) =>
  addr ? `${addr.slice(0,6)}...${addr.slice(-4)}` : ''

export const timeAgo = (unixSeconds) => {
  const ts = typeof unixSeconds === 'bigint' ? Number(unixSeconds) : Number(unixSeconds)
  if (!ts) return ''
  const diff = Date.now() - ts * 1000
  if (diff < 0) return 'Just now'
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (days  > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins  > 0) return `${mins}m ago`
  return 'Just now'
}

export const formatDeadline = (unixSeconds) => {
  const ts = typeof unixSeconds === 'bigint' ? Number(unixSeconds) : Number(unixSeconds)
  if (!ts) return ''
  const date = new Date(ts * 1000)
  return date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric'
  })
}

export const formatTimestamp = (unixSeconds) => {
  const ts = typeof unixSeconds === 'bigint' ? Number(unixSeconds) : Number(unixSeconds)
  if (!ts) return ''
  const date = new Date(ts * 1000)
  return date.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

export const formatWindow = (seconds) => {
  const s = typeof seconds === 'bigint' ? Number(seconds) : Number(seconds)
  if (!s) return '0 minutes'
  if (s >= 86400) {
    const d = s / 86400
    return `${d} day${d !== 1 ? 's' : ''}`
  }
  if (s >= 3600)  {
    const h = s / 3600
    return `${h} hour${h !== 1 ? 's' : ''}`
  }
  return `${s / 60} minutes`
}

export const countdown = (targetUnixSeconds) => {
  const ts = typeof targetUnixSeconds === 'bigint' ? Number(targetUnixSeconds) : Number(targetUnixSeconds)
  if (!ts) return ''
  const now = Math.floor(Date.now() / 1000)
  let diff = ts - now
  if (diff <= 0) {
    const overdue = -diff
    if (overdue >= 86400) return `Overdue by ${Math.floor(overdue / 86400)}d`
    if (overdue >= 3600)  return `Overdue by ${Math.floor(overdue / 3600)}h`
    return `Overdue by ${Math.floor(overdue / 60)}m`
  }
  if (diff >= 86400) return `${Math.floor(diff / 86400)}d remaining`
  if (diff >= 3600)  return `${Math.floor(diff / 3600)}h remaining`
  return `${Math.floor(diff / 60)}m remaining`
}

export const MILESTONE_LABELS = {
  0: 'Pending', 1: 'Approved', 2: 'In Dispute',
  3: 'Paid Out', 4: 'Refunded'
}

export const ESCROW_LABELS = {
  0: 'Active', 1: 'Completed', 2: 'Cancelled'
}

export const MILESTONE_BADGE_CLASS = {
  0: 'badge-pending', 1: 'badge-approved', 2: 'badge-disputed',
  3: 'badge-released', 4: 'badge-refunded'
}

export const ESCROW_BADGE_CLASS = {
  0: 'badge-active', 1: 'badge-completed', 2: 'badge-cancelled'
}

export const isValidAddress = (addr) =>
  typeof addr === 'string' && /^0x[a-fA-F0-9]{40}$/.test(addr)

export const isValidUrl = (s) => {
  if (!s || typeof s !== 'string') return false
  try { new URL(s); return true } catch { return false }
}

export const explorerTx = (hash) => `https://testnet.arcscan.app/tx/${hash}`
export const explorerAddr = (addr) => `https://testnet.arcscan.app/address/${addr}`
