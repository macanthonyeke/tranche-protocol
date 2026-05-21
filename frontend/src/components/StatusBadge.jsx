import { MILESTONE_LABELS, ESCROW_LABELS } from '../utils/format'

const BASE = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border'

const MILESTONE_STYLE = {
  0: 'bg-sunk text-ink-2 border-rule',
  1: 'bg-clay-soft text-clay border-clay/30',
  2: 'bg-warn/10 text-warn border-warn/30',
  3: 'bg-ok/10 text-ok border-ok/30',
  4: 'bg-sunk text-ink-3 border-rule'
}

const ESCROW_STYLE = {
  0: 'bg-clay-soft text-clay border-clay/30',
  1: 'bg-ok/10 text-ok border-ok/30',
  2: 'bg-sunk text-ink-3 border-rule'
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
    return <span className={`${BASE} bg-sunk text-ink-2 border-rule`}>You're Paying</span>
  if (role === 'freelancer')
    return <span className={`${BASE} bg-sunk text-ink-2 border-rule`}>You're Receiving</span>
  return null
}
