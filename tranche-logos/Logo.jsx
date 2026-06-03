/**
 * Tranche Protocol — <Logo> component
 *
 * Single source of truth for every logo usage in the app.
 * All SVG geometry is inline — no external file references needed for in-app use.
 *
 * Usage:
 *   <Logo variant="nav-tile" />                        — 32px clay tile, theme-adaptive (nav)
 *   <Logo variant="nav-full" />                        — tile + "Tranche" wordmark (desktop nav)
 *   <Logo variant="mark" theme="light" />              — standalone mark, no tile
 *   <Logo variant="mark" theme="dark" />
 *   <Logo variant="mark" theme="mono" />               — single ink color (print / no-color)
 *   <Logo variant="mark" theme="mono-inv" />           — single paper color (dark print)
 *   <Logo variant="wordmark" theme="light" />          — mark + "Tranche" + "PROTOCOL"
 *   <Logo variant="wordmark" theme="dark" />
 *   <Logo variant="mark" concept="centered-cut" theme="light" />   — alternate concept
 *   <Logo variant="mark" concept="tapered-split" theme="dark" />
 *   <Logo variant="mark" concept="tight-notch" theme="mono" />
 *
 * Props:
 *   variant   "nav-tile" | "nav-full" | "mark" | "wordmark"   default: "nav-tile"
 *   theme     "light" | "dark" | "mono" | "mono-inv"          default: "light"
 *   concept   "golden-split" | "centered-cut" | "tapered-split" | "tight-notch"
 *             default: "golden-split"  (canonical — use this unless directed otherwise)
 *   size      number  px size of the mark square               default: 40
 *   className string  extra classes on the root element
 */

// ---------------------------------------------------------------------------
// Color values per theme
// ---------------------------------------------------------------------------
const THEME_COLORS = {
  light:    { fill: 'oklch(58% 0.165 38)', op1: 1,    op2: 0.7,  op3: 0.4  },
  dark:     { fill: 'oklch(72% 0.155 38)', op1: 1,    op2: 0.7,  op3: 0.4  },
  mono:     { fill: '#1a1714',             op1: 1,    op2: 0.75, op3: 0.45 },
  'mono-inv': { fill: '#f0ede8',           op1: 1,    op2: 0.75, op3: 0.45 },
};

// ---------------------------------------------------------------------------
// Mark geometry per concept
// (all in a 40×40 viewBox)
// ---------------------------------------------------------------------------
const CONCEPTS = {
  'golden-split': {
    top: [
      { x: 5,     y: 8,    w: 17.64, h: 5.2, rx: 1.2 },  // left segment
      { x: 24.44, y: 8,    w: 10.56, h: 5.2, rx: 1.2 },  // right segment
    ],
    mid:    { x: 7,  y: 16.5, w: 26, h: 5.2, rx: 1.2 },
    bottom: { x: 9,  y: 25,   w: 22, h: 5.2, rx: 1.2 },
  },
  'centered-cut': {
    top: [
      { x: 5,    y: 8, w: 14.2, h: 5.2, rx: 1.2 },
      { x: 20.8, y: 8, w: 14.2, h: 5.2, rx: 1.2 },
    ],
    mid:    { x: 7, y: 16.5, w: 26, h: 5.2, rx: 1.2 },
    bottom: { x: 9, y: 25,   w: 22, h: 5.2, rx: 1.2 },
  },
  'tapered-split': {
    top: [
      { x: 5,     y: 7.5, w: 17.64, h: 6,   rx: 1.2 },
      { x: 24.44, y: 7.5, w: 10.56, h: 6,   rx: 1.2 },
    ],
    mid:    { x: 7, y: 16.5, w: 26, h: 4.6, rx: 1.2 },
    bottom: { x: 9, y: 24.5, w: 22, h: 3.2, rx: 1.2 },
  },
  'tight-notch': {
    top: [
      { x: 5,     y: 8, w: 17.99, h: 5.2, rx: 1.2 },
      { x: 24.09, y: 8, w: 10.91, h: 5.2, rx: 1.2 },
    ],
    mid:    { x: 7, y: 16.5, w: 26, h: 5.2, rx: 1.2 },
    bottom: { x: 9, y: 25,   w: 22, h: 5.2, rx: 1.2 },
  },
};

// ---------------------------------------------------------------------------
// Mark SVG — raw bars, no tile wrapper
// ---------------------------------------------------------------------------
function MarkSVG({ concept = 'golden-split', theme = 'light', size = 40 }) {
  const geo = CONCEPTS[concept] || CONCEPTS['golden-split'];
  const c   = THEME_COLORS[theme] || THEME_COLORS.light;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {geo.top.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx}
              fill={c.fill} opacity={c.op1} />
      ))}
      <rect x={geo.mid.x} y={geo.mid.y} width={geo.mid.w} height={geo.mid.h}
            rx={geo.mid.rx} fill={c.fill} opacity={c.op2} />
      <rect x={geo.bottom.x} y={geo.bottom.y} width={geo.bottom.w} height={geo.bottom.h}
            rx={geo.bottom.rx} fill={c.fill} opacity={c.op3} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Nav tile — 32×32 clay square with theme-adaptive paper bars
// ---------------------------------------------------------------------------
function NavTile({ concept = 'golden-split', tileSize = 32, markSize = 20 }) {
  const geo = CONCEPTS[concept] || CONCEPTS['golden-split'];

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: tileSize,
      width: tileSize,
      borderRadius: 'var(--radius-md, 8px)',
      background: 'var(--clay)',
      flexShrink: 0,
    }}>
      <svg
        width={markSize}
        height={markSize}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Bars use var(--paper) so they auto-adapt to light/dark theme */}
        {geo.top.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx}
                fill="var(--paper)" />
        ))}
        <rect x={geo.mid.x} y={geo.mid.y} width={geo.mid.w} height={geo.mid.h}
              rx={geo.mid.rx} fill="var(--paper)" opacity="0.78" />
        <rect x={geo.bottom.x} y={geo.bottom.y} width={geo.bottom.w} height={geo.bottom.h}
              rx={geo.bottom.rx} fill="var(--paper)" opacity="0.55" />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Wordmark — mark + "Tranche" + "PROTOCOL" in an SVG lockup
// ---------------------------------------------------------------------------
function WordmarkSVG({ theme = 'light', height = 40 }) {
  const markFill   = theme === 'dark' ? 'oklch(72% 0.155 38)' : 'oklch(58% 0.165 38)';
  const textFill   = theme === 'dark' ? 'oklch(94% 0.008 40)' : 'oklch(22% 0.020 40)';
  const subFill    = theme === 'dark' ? 'oklch(56% 0.014 40)' : 'oklch(50% 0.016 40)';
  // Scale the 220×40 viewBox to the requested height
  const width = (220 / 40) * height;

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 220 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Tranche Protocol"
    >
      {/* Mark (equal-bar simplified, no split) */}
      <rect x="4"  y="8"    width="32" height="5.5" rx="1.2" fill={markFill} />
      <rect x="6"  y="16.5" width="28" height="5.5" rx="1.2" fill={markFill} opacity="0.7" />
      <rect x="8"  y="25"   width="24" height="5.5" rx="1.2" fill={markFill} opacity="0.4" />
      {/* "Tranche" in Fraunces */}
      <text
        x="48" y="23"
        fontFamily="Fraunces, Georgia, serif"
        fontWeight="420"
        fontSize="22"
        letterSpacing="-0.5"
        fill={textFill}
      >Tranche</text>
      {/* "PROTOCOL" in Switzer */}
      <text
        x="48" y="33"
        fontFamily="Switzer, system-ui, sans-serif"
        fontWeight="600"
        fontSize="7.5"
        letterSpacing="1.8"
        fill={subFill}
      >PROTOCOL</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main <Logo> component
// ---------------------------------------------------------------------------
export function Logo({
  variant  = 'nav-tile',
  theme    = 'light',
  concept  = 'golden-split',
  size     = 40,
  className = '',
}) {
  if (variant === 'nav-tile') {
    return (
      <span className={className} aria-label="Tranche Protocol">
        <NavTile concept={concept} tileSize={32} markSize={20} />
      </span>
    );
  }

  if (variant === 'nav-full') {
    return (
      <span
        className={className}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}
        aria-label="Tranche Protocol"
      >
        <NavTile concept={concept} tileSize={32} markSize={20} />
        <span style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontWeight: 420,
          fontSize: 22,
          letterSpacing: '-0.022em',
          lineHeight: 1,
          color: 'var(--ink)',
          fontVariationSettings: "'opsz' 72, 'SOFT' 40, 'WONK' 0",
        }}>
          Tranche
        </span>
      </span>
    );
  }

  if (variant === 'wordmark') {
    return (
      <span className={className}>
        <WordmarkSVG theme={theme} height={size} />
      </span>
    );
  }

  // variant === 'mark' — standalone SVG, no tile wrapper
  return (
    <span className={className} aria-label="Tranche Protocol mark">
      <MarkSVG concept={concept} theme={theme} size={size} />
    </span>
  );
}

// Export to window for multi-script Babel environments
if (typeof window !== 'undefined') {
  window.Logo = Logo;
}

export default Logo;
