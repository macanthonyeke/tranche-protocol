# Handoff: Tranche Protocol — Complete Logo System
**Project:** Tranche Protocol / CrossChainEscrow frontend  
**Fidelity:** High-fidelity — use SVGs exactly as provided  
**Scope:** Every logo variant, colorway, usage context, and decision rule

---

## Overview

This bundle contains every finalized logo asset for Tranche Protocol — 34 SVG source files, 20 PNG exports at 512px, and 4 social/profile photo exports. This README tells you exactly which file to use where, how to inline the mark as a React component, and what the concept differences are between the four families.

**The canonical mark family is Golden Split.** When in doubt, use it. The other three families (Centered Cut, Tapered Split, Tight Notch) are approved alternates — use them only if you have a specific reason.

---

## 1. Canonical Mark: Golden Split

Three stacked bars of decreasing opacity. The top bar is split off-center at a golden ratio (~62.5/37.5% split), creating a visual "tranche" — funds divided into structured slices.

### What makes it canonical

- The split in the top bar is asymmetric (golden ratio), giving the mark a sense of motion and direction — left to right, like a ledger entry.
- The three bars echo the product: payer → escrow → freelancer, three parties, three slices.
- Opacity steps (100% → 70% → 40%) reinforce the "layered" concept and give the mark depth without color complexity.

### The four colorways

| Colorway | File | Use |
|---|---|---|
| **light** | `logo-golden-split-light.svg` | Default. Light/paper backgrounds. The product's primary light-mode appearance. |
| **dark** | `logo-golden-split-dark.svg` | Dark/ink backgrounds. The product's primary dark-mode appearance. |
| **mono** | `logo-golden-split-mono.svg` | Single-color dark ink (`#1a1714`). Use on white/light backgrounds when color is unavailable — print on paper, engraving, embossing, favicon at tiny sizes. |
| **mono-inv** | `logo-golden-split-mono-inv.svg` | Single-color warm white (`#f0ede8`). Use on dark/black backgrounds when color is unavailable — reverse print, dark embossing. |

### Exact SVG geometry

```svg
<!-- LIGHT (clay on paper/transparent bg) -->
<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
  <!-- Top bar LEFT segment -->
  <rect x="5" y="8" width="17.64" height="5.2" rx="1.2" fill="oklch(58% 0.165 38)"/>
  <!-- Top bar RIGHT segment (gap = 24.44 - 22.64 = 1.8px) -->
  <rect x="24.44" y="8" width="10.56" height="5.2" rx="1.2" fill="oklch(58% 0.165 38)"/>
  <!-- Middle bar (full width, 70% opacity) -->
  <rect x="7" y="16.5" width="26" height="5.2" rx="1.2" fill="oklch(58% 0.165 38)" opacity="0.7"/>
  <!-- Bottom bar (full width, 40% opacity) -->
  <rect x="9" y="25" width="22" height="5.2" rx="1.2" fill="oklch(58% 0.165 38)" opacity="0.4"/>
</svg>

<!-- DARK (light clay on dark/transparent bg) -->
<!-- Same geometry; change fill to oklch(72% 0.155 38) -->

<!-- MONO (dark ink, light bg) -->
<!-- Same geometry; change fill to #1a1714; opacities: 1 / 0.75 / 0.45 -->

<!-- MONO-INV (warm white, dark bg) -->
<!-- Same geometry; change fill to #f0ede8; opacities: 1 / 0.75 / 0.45 -->
```

### Key measurements

| Property | Value |
|---|---|
| ViewBox | `0 0 40 40` |
| Bar height | 5.2px |
| Bar radius | 1.2px |
| Top bar left width | 17.64px (62.5% of 30px total bar span minus gap) |
| Top bar right width | 10.56px (37.5% remainder) |
| Gap between top bar segments | 1.8px |
| Row spacing (top of each bar) | y=8, y=16.5, y=25 |
| Left inset per row | x=5, x=7, x=9 (2px more inset each row) |
| Width shrink per row | 30px, 26px, 22px (4px narrower each row) |

---

## 2. Alternate Mark Families

These are approved alternates. The geometry concepts differ only in the top-bar split style. All share the same middle and bottom bar geometry. Use when you have a creative reason (e.g., a specific campaign, a secondary product line, or if the team selects one of these as the final mark after review).

### 2a. Centered Cut

The top bar is split at the center (50/50): two equal halves with a 1.6px gap between them.

**Top bar geometry:**
- Left: `x=5, y=8, width=14.2, height=5.2, rx=1.2`
- Right: `x=20.8, y=8, width=14.2, height=5.2, rx=1.2`
- Gap: 20.8 - 19.2 = 1.6px

**Files:** `logo-centered-cut-{light/dark/mono/mono-inv}.svg`  
**Fill colors:** identical to Golden Split by colorway.

### 2b. Tapered Split

Same golden-ratio split as Golden Split, but bars taper in height: top=6px, middle=4.6px, bottom=3.2px. Gives a more structured, descending weight.

**Top bar geometry:**
- Left: `x=5, y=7.5, width=17.64, height=6, rx=1.2`
- Right: `x=24.44, y=7.5, width=10.56, height=6, rx=1.2`
- Middle: `x=7, y=16.5, width=26, height=4.6, rx=1.2, opacity=0.7`
- Bottom: `x=9, y=24.5, width=22, height=3.2, rx=1.2, opacity=0.4`

**Files:** `logo-tapered-split-{light/dark/mono/mono-inv}.svg`

### 2c. Tight Notch

Same three-bar structure, but the top-bar split is tighter — the left segment is slightly wider (17.99px vs 17.64px in Golden Split), closing the gap to 1.1px. The subtlest of the four concepts.

**Top bar geometry:**
- Left: `x=5, y=8, width=17.99, height=5.2, rx=1.2`
- Right: `x=24.09, y=8, width=10.91, height=5.2, rx=1.2`
- Gap: 24.09 - 22.99 = 1.1px

**Files:** `logo-tight-notch-{light/dark/mono/mono-inv}.svg`

---

## 3. Full Lockups (Mark + Wordmark)

### Full wordmark lockup

A 220×40 SVG containing the mark (identical to `logo-final.svg`) + "Tranche" in Fraunces 420 weight + "PROTOCOL" in Switzer 600 small-caps below.

| File | Background | Text fill |
|---|---|---|
| `logo-wordmark-light.svg` | Light/paper | Ink `oklch(22% 0.020 40)` |
| `logo-wordmark-dark.svg` | Dark/ink | Paper `oklch(94% 0.008 40)` |

**SVG geometry:**
```svg
<!-- Mark: 3-bar stacked (logo-final geometry) at left -->
<!-- "Tranche" text: x=48, y=23, font-size=22, letter-spacing=-0.5 -->
<!-- "PROTOCOL" text: x=48, y=33, font-size=7.5, letter-spacing=1.8 -->
```

**When to use:**
- Marketing pages, landing page footer, social card headers
- Any context wide enough to show the word "Tranche" at ≥16px
- Email headers, press kit PDFs

**When NOT to use:**
- Nav bars narrower than 200px — use mark-only tile instead
- Favicons — use mark-only PNG

### Mark-only (no wordmark)

`logo-mark-light.svg` / `logo-mark-dark.svg` — identical to `logo-final.svg` / `logo-final-dark.svg`. Same 3-bar geometry, equal-width bars (no top-bar split). This is the simplified mark used at small sizes and in the nav tile.

**Note:** `logo-final.svg` and `logo-mark-light.svg` are the same file — both are the equal-bar simplified mark (NOT the Golden Split). Use Golden Split SVGs when you want the split top bar.

---

## 4. The Nav Tile (In-App Usage)

The in-app nav logo is always the mark inlined as SVG inside a 32×32 clay-colored tile. Do not use an `<img>` tag for the nav mark — inline it so it picks up `var(--paper)` for the bar color and adapts to theme.

### React / JSX — nav tile

```jsx
// Mark tile: 32×32 clay rounded square, 20px mark inside
// Use inside TopNav and mobile header
<span style={{
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 32,
  width: 32,
  borderRadius: 'var(--radius-md)', // 8px
  background: 'var(--clay)',
  flexShrink: 0,
}}>
  <svg width="20" height="20" viewBox="0 0 40 40" fill="none" aria-hidden="true">
    {/* Golden Split mark — paper-colored bars on clay tile */}
    <rect x="5" y="8" width="17.64" height="5.2" rx="1.2" fill="var(--paper)"/>
    <rect x="24.44" y="8" width="10.56" height="5.2" rx="1.2" fill="var(--paper)"/>
    <rect x="7" y="16.5" width="26" height="5.2" rx="1.2" fill="var(--paper)" opacity="0.78"/>
    <rect x="9" y="25" width="22" height="5.2" rx="1.2" fill="var(--paper)" opacity="0.55"/>
  </svg>
</span>
```

> **Note on the nav tile mark:** The bars use `var(--paper)` fill (not a fixed hex) so they automatically invert between light and dark themes. The opacities are slightly higher (0.78 / 0.55) than the standalone SVG (0.7 / 0.4) because the clay tile background makes them read lighter than a white canvas.

### Full nav block (mark tile + wordmark text)

```jsx
// TopNav — desktop: tile + "Tranche" wordmark text
// TopNav — mobile: tile only (wordmark hidden)
<Link to="/" className="flex items-center gap-2.5" aria-label="Tranche Protocol home">
  {/* Mark tile — always visible */}
  <span style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    height: 32, width: 32, borderRadius: 'var(--radius-md)', background: 'var(--clay)', flexShrink: 0,
  }}>
    <svg width="20" height="20" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="5"      y="8"    width="17.64" height="5.2" rx="1.2" fill="var(--paper)"/>
      <rect x="24.44"  y="8"    width="10.56" height="5.2" rx="1.2" fill="var(--paper)"/>
      <rect x="7"      y="16.5" width="26"    height="5.2" rx="1.2" fill="var(--paper)" opacity="0.78"/>
      <rect x="9"      y="25"   width="22"    height="5.2" rx="1.2" fill="var(--paper)" opacity="0.55"/>
    </svg>
  </span>
  {/* Wordmark — hidden on mobile, shown on lg+ */}
  <span className="hidden lg:inline display" style={{ fontSize: 22, letterSpacing: '-0.022em', lineHeight: 1 }}>
    Tranche
  </span>
</Link>
```

---

## 5. Decision Tree: Which File to Use

```
Q: Is this inside the app (nav, UI chrome)?
  YES → Inline SVG in a clay tile. See Section 4 above. Do not use an <img>.
  NO → Continue below.

Q: Is it on a light background?
  YES → Use golden-split-light.svg (or wordmark-light if you need the text lockup)
  NO (dark bg) → Use golden-split-dark.svg (or wordmark-dark)
  NOT SURE / could be either → Use golden-split-mono.svg (works on light) or mono-inv (works on dark)

Q: Is it a favicon / app icon?
  → Use exports/png/logo-golden-split-{light/dark}-512.png at the appropriate size
  → For 32px favicon: use logo-golden-split-mono-128.png (sharper at small sizes than color)

Q: Is it a social media profile photo (Twitter/X, GitHub, Discord)?
  → Use exports/pfp/logo-pfp-dark.png (dark bg, for most platforms)
  → OR exports/pfp/logo-pfp-light.png (light bg, if the platform crops to circle)
  → 1000px versions: mark-clay-on-paper-1000.png / mark-white-on-ink-1000.png

Q: Is it on a printed document / email / PDF where CSS colors may not render?
  → Use logo-golden-split-mono.svg (on white/light) or logo-golden-split-mono-inv.svg (on dark)

Q: Does it need to be a file reference (not inline SVG)?
  → Use the SVG from assets/ (preferred, scalable)
  → PNG fallback from exports/png/ at the size closest to your render target

Q: Should I use an alternate concept family?
  → Only if the product team has reviewed and selected one. Default: Golden Split.
  → Centered Cut: more balanced, symmetric feel. Use if Golden Split feels too asymmetric for context.
  → Tapered Split: more structured/hierarchical. Use in print contexts or marketing material with a "descending" visual motif.
  → Tight Notch: most subtle split. Use if Golden Split gap appears too prominent at very small sizes.
```

---

## 6. React `<Logo>` Component

The file `Logo.jsx` in this bundle exports a single `<Logo>` component that covers every use case. Import it and use `variant` + `theme` props to get the right mark.

```jsx
import { Logo } from './Logo';

// Nav tile (mark only, inside clay square, theme-adaptive)
<Logo variant="nav-tile" />

// Nav tile + wordmark text (desktop nav)
<Logo variant="nav-full" />

// Standalone mark (no tile, SVG only)
<Logo variant="mark" theme="light" />
<Logo variant="mark" theme="dark" />
<Logo variant="mark" theme="mono" />
<Logo variant="mark" theme="mono-inv" />

// Full wordmark lockup (mark + "Tranche" + "PROTOCOL")
<Logo variant="wordmark" theme="light" />
<Logo variant="wordmark" theme="dark" />

// Specific concept family
<Logo variant="mark" concept="centered-cut" theme="light" />
<Logo variant="mark" concept="tapered-split" theme="dark" />
<Logo variant="mark" concept="tight-notch" theme="mono" />
```

See `Logo.jsx` for full source.

---

## 7. File Reference

### SVG Source (`assets/`)

| File | Concept | Colorway | Background |
|---|---|---|---|
| `logo-golden-split-light.svg` | Golden Split ★ | Color clay | Light |
| `logo-golden-split-dark.svg` | Golden Split ★ | Color clay (light) | Dark |
| `logo-golden-split-mono.svg` | Golden Split ★ | Ink `#1a1714` | Light |
| `logo-golden-split-mono-inv.svg` | Golden Split ★ | Paper `#f0ede8` | Dark |
| `logo-centered-cut-light.svg` | Centered Cut | Color clay | Light |
| `logo-centered-cut-dark.svg` | Centered Cut | Color clay (light) | Dark |
| `logo-centered-cut-mono.svg` | Centered Cut | Ink `#1a1714` | Light |
| `logo-centered-cut-mono-inv.svg` | Centered Cut | Paper `#f0ede8` | Dark |
| `logo-tapered-split-light.svg` | Tapered Split | Color clay | Light |
| `logo-tapered-split-dark.svg` | Tapered Split | Color clay (light) | Dark |
| `logo-tapered-split-mono.svg` | Tapered Split | Ink `#1a1714` | Light |
| `logo-tapered-split-mono-inv.svg` | Tapered Split | Paper `#f0ede8` | Dark |
| `logo-tight-notch-light.svg` | Tight Notch | Color clay | Light |
| `logo-tight-notch-dark.svg` | Tight Notch | Color clay (light) | Dark |
| `logo-tight-notch-mono.svg` | Tight Notch | Ink `#1a1714` | Light |
| `logo-tight-notch-mono-inv.svg` | Tight Notch | Paper `#f0ede8` | Dark |
| `logo-final.svg` | Simplified (equal bars) | Color clay | Light |
| `logo-final-dark.svg` | Simplified (equal bars) | Color clay (light) | Dark |
| `logo-mark-light.svg` | Simplified (equal bars) | Color clay | Light |
| `logo-mark-dark.svg` | Simplified (equal bars) | Color clay (light) | Dark |
| `logo-wordmark-light.svg` | Full lockup | Color + ink text | Light |
| `logo-wordmark-dark.svg` | Full lockup | Color + paper text | Dark |
| `logo-tranche-mark.svg` | Tranche stacked (legacy) | Color | Light |
| `logo-tranche-mark-dark.svg` | Tranche stacked (legacy) | Color | Dark |
| `logo-ledger-t.svg` | Ledger T concept (archived) | — | — |
| `logo-step.svg` | Ascending steps concept (archived) | — | Light |
| `logo-step-dark.svg` | Ascending steps concept (archived) | — | Dark |
| `logo-split.svg` | Circle split concept (archived) | — | — |
| `logo-v2-equal.svg` | V2 equal bars (archived) | — | Light |
| `logo-v2-equal-dark.svg` | V2 equal bars (archived) | — | Dark |
| `logo-v2-gapped.svg` | V2 gapped bars (archived) | — | Light |
| `logo-v2-gapped-dark.svg` | V2 gapped bars (archived) | — | Dark |
| `logo-v2-offset.svg` | V2 offset bars (archived) | — | Light |
| `logo-v2-offset-dark.svg` | V2 offset bars (archived) | — | Dark |

> ★ = canonical family. Archived concepts are included for reference — do not use them in production UI.

### PNG Exports (`exports/png/`) — 512px

Four families × four colorways = 16 files at 512px. Same naming pattern as SVGs: `logo-{concept}-{colorway}-512.png`.

Full set at 128px, 256px, 512px, 1024px is in the main project's `exports/png/` folder.

### Profile Photos (`exports/pfp/`)

| File | Description | Use |
|---|---|---|
| `logo-pfp-dark.png` | Mark on dark background | Twitter/X, GitHub, Discord, Telegram |
| `logo-pfp-light.png` | Mark on light background | Platforms with light-mode avatar frames |
| `mark-clay-on-paper-1000.png` | 1000px, clay mark on warm paper bg | High-res profile photo, press kit |
| `mark-white-on-ink-1000.png` | 1000px, white mark on warm ink bg | High-res dark-bg version, press kit |

---

## 8. Color Values

| Token | Light value | Dark value | Hex approx |
|---|---|---|---|
| Clay (light bg) | `oklch(58% 0.165 38)` | — | `#c1603a` |
| Clay (dark bg) | — | `oklch(72% 0.155 38)` | `#d98460` |
| Ink (mono) | `#1a1714` | — | Warm near-black |
| Paper (mono-inv) | `#f0ede8` | — | Warm near-white |

These values are already in `globals.css` as `--clay`, `--paper`, `--ink`. The nav tile mark uses `var(--clay)` and `var(--paper)` directly.

---

## 9. Rules

1. **One logo per surface.** Never show two logo lockups on the same view.
2. **No recoloring.** Do not change the fill colors. The four colorways cover every legitimate case.
3. **No stretching.** Always preserve the SVG aspect ratio. Scale uniformly.
4. **Minimum size.** The mark should never render smaller than 16px. Below that, use a favicon PNG.
5. **Clear space.** Maintain at least 0.5× the mark's height as clear space on all sides.
6. **No effects.** No drop shadows, glows, gradients, or filters on the logo.
7. **In-app = inline SVG.** Always inline the SVG in nav and UI chrome so it inherits CSS token values and reacts to theme. Never `<img src="logo.svg">` inside the app shell.
8. **Archived concepts stay archived.** `logo-ledger-t`, `logo-step`, `logo-split`, `logo-v2-*` are concept explorations. Do not use in production.
