import { MILESTONE_LABELS, ESCROW_LABELS } from '../utils/format'

const BASE = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border'

const MILESTONE_STYLE = {
  0: 'bg-background-tertiary text-text-secondary border-border-subtle',
  1: 'bg-accent-muted text-accent border-accent/30',
  2: 'bg-status-warning/10 text-status-warning border-status-warning/30',
  3: 'bg-status-success/10 text-status-success border-status-success/30',
  4: 'bg-background-tertiary text-text-tertiary border-border-subtle'
}

const ESCROW_STYLE = {
  0: 'bg-accent-muted text-accent border-accent/30',
  1: 'bg-status-success/10 text-status-success border-status-success/30',
  2: 'bg-background-tertiary text-text-tertiary border-border-subtle'
}

export function MilestoneBadge({ state }) {
  const s = Number(state ?? 0)
  return <span className={`${BASE} ${MILESTONE_STYLE[s]}`}>{MILESTONE_LABELS[s]}</span>
}

export function EscrowBadge({ state }) {
  const s = Number(state ?? 0)
  return <span className={`${BASE} ${ESCROW_STYLE[s]}`}>{ESCROW_LABELS[s]}</span>
}

export function RoleBadge({ role }) {
  if (role === 'payer')
    return <span className={`${BASE} bg-background-tertiary text-text-secondary border-border-subtle`}>You're Paying</span>
  if (role === 'freelancer')
    return <span className={`${BASE} bg-background-tertiary text-text-secondary border-border-subtle`}>You're Receiving</span>
  return null
}
