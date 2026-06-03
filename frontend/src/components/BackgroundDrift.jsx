import { useReducedMotion } from 'framer-motion'

// --op on each element points to the right per-mode token so bg-breathe
// can read it via var(--op) without needing separate light/dark keyframes.
// Negative animation-delay drops each mark into a different phase on load
// so they never drift or breathe in sync.
const GROUPS = [
  {
    // Large, top-left
    style: {
      position: 'absolute',
      left: '-4%',
      top: '8%',
      width: 'clamp(180px, 55vw, 460px)',
      height: 'clamp(180px, 55vw, 460px)',
      '--op': 'var(--drift-op-1)',
      animation: 'bg-drift-1 62s ease-in-out -10s infinite, bg-breathe 28s ease-in-out -8s infinite',
    },
  },
  {
    // Medium, bottom-right
    style: {
      position: 'absolute',
      right: '-6%',
      bottom: '10%',
      width: 'clamp(130px, 38vw, 310px)',
      height: 'clamp(130px, 38vw, 310px)',
      '--op': 'var(--drift-op-2)',
      animation: 'bg-drift-2 78s ease-in-out -22s infinite, bg-breathe 35s ease-in-out -14s infinite',
    },
  },
  {
    // Small, top-center
    style: {
      position: 'absolute',
      left: '40%',
      top: '-5%',
      width: 'clamp(90px, 22vw, 200px)',
      height: 'clamp(90px, 22vw, 200px)',
      '--op': 'var(--drift-op-3)',
      animation: 'bg-drift-3 50s ease-in-out -35s infinite, bg-breathe 22s ease-in-out -3s infinite',
    },
  },
  {
    // Smallest, bottom-center-right
    style: {
      position: 'absolute',
      right: '24%',
      bottom: '-3%',
      width: 'clamp(70px, 16vw, 155px)',
      height: 'clamp(70px, 16vw, 155px)',
      '--op': 'var(--drift-op-4)',
      animation: 'bg-drift-4 95s ease-in-out -55s infinite, bg-breathe 42s ease-in-out -20s infinite',
    },
  },
]

export default function BackgroundDrift() {
  const reduce = useReducedMotion()
  if (reduce) return null

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {GROUPS.map((g, i) => (
        <div key={i} style={g.style}>
          <svg
            viewBox="0 0 40 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ width: '100%', height: '100%' }}
          >
            {/* Golden Split — bars use var(--clay) so they adapt to light/dark */}
            <rect x="5"     y="8"    width="17.64" height="5.2" rx="1.2" fill="var(--clay)" />
            <rect x="24.44" y="8"    width="10.56" height="5.2" rx="1.2" fill="var(--clay)" />
            <rect x="7"     y="16.5" width="26"    height="5.2" rx="1.2" fill="var(--clay)" opacity="0.78" />
            <rect x="9"     y="25"   width="22"    height="5.2" rx="1.2" fill="var(--clay)" opacity="0.55" />
          </svg>
        </div>
      ))}
    </div>
  )
}
