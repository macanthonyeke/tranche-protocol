import { useLayoutEffect, useRef, useState } from 'react'

/* ClayBar — a live, read-only picture of the milestone allocation. Typing in
   the milestone amount fields drives the bar; the bar itself is not
   draggable (a draggable version was explored and deliberately removed —
   do not reintroduce drag). Milestones pay out in order, left to right,
   and that order is enforced on-chain (TrancheProtocol.claimDelivery checks
   the previous milestone index), so slice position must always match
   array order. */

const GAP = 3 // px between slices — the deliberate split
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const OVER_GUTTER = 88 // px the bar pushes past its edge when over-allocated
const OPACITY_RAMP = [1, 0.84, 0.7, 0.6, 0.52, 0.46]

export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
const pctLabel = (p) => {
  const r = Math.round(p * 10) / 10
  return (Number.isInteger(r) ? r : r.toFixed(1)) + '%'
}
export const parseAmt = (v) => {
  const n = parseFloat(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
export const round2 = (n) => Math.round(n * 100) / 100
const fmtMoney = (n) => {
  if (!Number.isFinite(n)) n = 0
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
// Trim trailing zeros for compact contexts (bar labels).
const fmtCompact = (n) => {
  if (!Number.isFinite(n)) n = 0
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export default function ClayBar({ milestones, total, hoverIdx, setHoverIdx, flashIds, compact = false }) {
  const trackRef = useRef(null)
  const [barPx, setBarPx] = useState(600)

  useLayoutEffect(() => {
    if (!trackRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setBarPx(entry.contentRect.width)
    })
    ro.observe(trackRef.current)
    setBarPx(trackRef.current.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  const amounts = milestones.map((m) => parseAmt(m.amount))
  const allocated = amounts.reduce((a, b) => a + b, 0)
  const remaining = Math.round((total - allocated) * 100) / 100
  const over = total > 0 && allocated - total > 0.005
  const balanced = total > 0 && Math.abs(remaining) < 0.005
  const overAmt = over ? Math.round((allocated - total) * 100) / 100 : 0

  // When over, the track shrinks to reveal an overflow gutter the bar spills into.
  const trackW = Math.max(60, barPx - (over ? OVER_GUTTER : 0))
  const ppu = total > 0 ? trackW / total : 0 // px per USDC (total maps to the track box)
  const H = compact ? 50 : 62

  const cum = []
  amounts.reduce((a, v, i) => { cum[i] = a; return a + v }, 0)

  const opacityFor = (i) => OPACITY_RAMP[Math.min(i, OPACITY_RAMP.length - 1)]
  const segTransition = `left 320ms ${EASE}, width 320ms ${EASE}, opacity 160ms ${EASE}`

  return (
    <div className="flex flex-col gap-2.5 select-none">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Payment schedule</span>
        {total > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
            Released in order
            <svg width="26" height="8" viewBox="0 0 26 8" fill="none" aria-hidden>
              <path d="M0 4h23M20 1l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </div>

      <div ref={trackRef} className="relative w-full" style={{ height: H }}>
        <div
          className="absolute rounded-md bg-sunk overflow-hidden"
          style={{
            left: 0, top: 0, height: H, width: trackW,
            border: `1px solid ${over ? 'var(--bad)' : 'var(--rule)'}`,
            transition: `width 320ms ${EASE}, border-color 200ms ${EASE}`
          }}
        >
          {total <= 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-3 px-3 text-center">
              Set a total amount above to start dividing it
            </div>
          )}
        </div>

        {over && (
          <div
            className="absolute pointer-events-none border-t border-r border-b border-bad rounded-r-md"
            style={{
              left: trackW, top: 0, height: H, width: barPx - trackW,
              background: 'repeating-linear-gradient(135deg, color-mix(in oklch, var(--bad) 22%, transparent) 0 6px, transparent 6px 12px)'
            }}
          />
        )}

        {total > 0 && milestones.map((m, i) => {
          const a = amounts[i]
          if (a <= 0) return null
          const rawLeft = cum[i] * ppu
          let w = a * ppu - GAP
          const rightPx = rawLeft + a * ppu
          // Gated on `over`, not just edge-proximity: a perfectly, correctly
          // fully-allocated bar's last slice also sits flush against the right
          // edge, and torn/zigzag there would falsely read as "something's
          // wrong" on a bar that is exactly right. Torn must mean over-allocated,
          // nothing else.
          const torn = over && rightPx > barPx - 2
          // Clamp so a slice pushed fully past the total (extreme over-allocation,
          // e.g. two milestones both beyond the target) still renders as a thin
          // torn sliver at the bar's edge instead of an invisible stub floating
          // outside the container.
          const left = Math.min(rawLeft, barPx - 2)
          if (left + w > barPx) w = Math.max(2, barPx - left - 2)
          const dim = hoverIdx != null && hoverIdx !== i
          const flash = flashIds && flashIds.has(m.id)
          const title = m.title === 'Custom' ? (m.customTitle || `Milestone ${i + 1}`) : m.title
          const pct = (a / total) * 100
          const tier = w >= 80 ? 3 : w >= 46 ? 2 : 1

          return (
            <div
              key={m.id}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              className="absolute flex flex-col justify-center overflow-hidden rounded-[3px] bg-clay"
              style={{
                left, top: 0, height: H, width: Math.max(0, w),
                paddingLeft: tier === 1 ? 4 : 10, paddingRight: 6,
                opacity: dim ? opacityFor(i) * 0.5 : opacityFor(i),
                boxShadow: (hoverIdx === i || flash) ? 'inset 0 0 0 2px var(--paper)' : 'none',
                clipPath: torn
                  ? 'polygon(0 0, calc(100% - 7px) 0, 100% 14%, calc(100% - 7px) 28%, 100% 42%, calc(100% - 7px) 56%, 100% 70%, calc(100% - 7px) 84%, 100% 100%, 0 100%)'
                  : 'none',
                transition: segTransition
              }}
              title={`${title} — ${fmtMoney(a)} USDC (${pctLabel(pct)})`}
            >
              {tier === 3 && (
                <>
                  <span className="text-[9.5px] leading-none text-paper" style={{ opacity: 0.82 }}>Paid {ordinal(i + 1)}</span>
                  <span className="num text-[12.5px] leading-tight text-paper mt-[3px]">{fmtCompact(a)}</span>
                  <span className="num text-[9.5px] leading-none text-paper mt-[2px]" style={{ opacity: 0.72 }}>{pctLabel(pct)}</span>
                </>
              )}
              {tier === 2 && (
                <>
                  <span className="num text-[11px] leading-tight text-paper">{fmtCompact(a)}</span>
                  <span className="num text-[9px] leading-none text-paper mt-[1px]" style={{ opacity: 0.72 }}>{pctLabel(pct)}</span>
                </>
              )}
              {tier === 1 && <span className="num text-[9px] leading-none text-paper">{i + 1}</span>}
            </div>
          )
        })}

        {total > 0 && remaining > 0.005 && (() => {
          const left = allocated * ppu
          const w = remaining * ppu - GAP
          const pct = (remaining / total) * 100
          return (
            <div
              className="absolute flex flex-col items-center justify-center rounded-[3px] border-[1.5px] border-dashed border-clay"
              style={{
                left: left + GAP / 2, top: 0, height: H, width: Math.max(0, w),
                background: 'repeating-linear-gradient(135deg, color-mix(in oklch, var(--clay) 15%, transparent) 0 5px, transparent 5px 11px)',
                transition: segTransition
              }}
            >
              {w >= 76 ? (
                <>
                  <span className="text-[9.5px] leading-none text-clay font-medium">Unallocated</span>
                  <span className="num text-[12px] leading-tight text-clay mt-[3px]">{fmtCompact(remaining)}</span>
                  <span className="num text-[9.5px] leading-none text-clay mt-[2px]" style={{ opacity: 0.8 }}>{pctLabel(pct)}</span>
                </>
              ) : w >= 30 ? (
                <span className="num text-[10px] text-clay">{fmtCompact(remaining)}</span>
              ) : null}
            </div>
          )
        })()}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-ink-3">
          {total > 0 ? <>Total budget <span className="num text-ink-2">{fmtMoney(total)}</span></> : 'No total set'}
        </span>
        {total > 0 && (
          balanced ? (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ok">
              <CheckIcon /> Fully allocated
            </span>
          ) : over ? (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-bad">
              <WarnIcon /> Over by <span className="num font-medium">{fmtMoney(overAmt)}</span>
              <span className="num opacity-70">({pctLabel((overAmt / total) * 100)})</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-clay">
              <span className="num font-medium">{fmtMoney(remaining)}</span> unallocated
              <span className="num text-ink-3">({pctLabel((remaining / total) * 100)})</span>
            </span>
          )
        )}
      </div>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2.5 7.5l3 3 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function WarnIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 1.5l6 10.5H1L7 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M7 5.5v3M7 10.5v0.05" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
