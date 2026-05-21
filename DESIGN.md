---
name: CrossChainEscrow
description: Editorial-typographic, primitive-grade design system for milestone-based USDC escrow.
colors:
  paper:        "oklch(97% 0.008 60)"
  sunk:         "oklch(94% 0.012 60)"
  ink:          "oklch(22% 0.020 40)"
  ink-2:        "oklch(44% 0.018 40)"
  ink-3:        "oklch(52% 0.016 40)"
  rule:         "oklch(88% 0.012 50)"
  rule-2:       "oklch(78% 0.018 50)"
  clay:         "oklch(58% 0.165 38)"
  clay-hover:   "oklch(52% 0.175 38)"
  clay-soft:   "oklch(92% 0.040 38)"
  ok:           "oklch(50% 0.13  155)"
  warn:         "oklch(68% 0.165 60)"
  bad:          "oklch(54% 0.20  25)"
  paper-dark:   "oklch(15% 0.010 40)"
  sunk-dark:    "oklch(19% 0.012 40)"
  ink-dark:     "oklch(94% 0.008 40)"
  clay-dark:    "oklch(72% 0.155 38)"
typography:
  display:
    fontFamily: "Instrument Serif, ui-serif, Georgia, serif"
    fontSize:   "clamp(2.25rem, 6vw, 4.5rem)"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Instrument Serif, ui-serif, Georgia, serif"
    fontSize:   "1.75rem"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize:   "1.0625rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize:   "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
    fontFeature: "'ss01', 'cv11'"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize:   "0.78125rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.005em"
  eyebrow:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize:   "0.65625rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.18em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize:   "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
    fontVariation: "tabular-nums"
rounded:
  xs: "0.25rem"
  sm: "0.375rem"
  md: "0.5rem"
spacing:
  hairline: "1px"
  xs:       "0.25rem"
  sm:       "0.5rem"
  md:       "1rem"
  lg:       "1.5rem"
  xl:       "2.5rem"
  section:  "5rem"
components:
  button-primary:
    backgroundColor: "{colors.clay}"
    textColor:       "{colors.paper}"
    rounded:         "{rounded.md}"
    padding:         "0 1rem"
    height:          "2.5rem"
  button-primary-hover:
    backgroundColor: "{colors.clay-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor:       "{colors.ink}"
    rounded:         "{rounded.md}"
    padding:         "0 1rem"
    height:          "2.5rem"
  button-secondary-hover:
    backgroundColor: "{colors.sunk}"
  button-quiet:
    backgroundColor: "transparent"
    textColor:       "{colors.ink-2}"
    rounded:         "{rounded.md}"
    padding:         "0 1rem"
    height:          "2.5rem"
  button-danger:
    backgroundColor: "{colors.bad}"
    textColor:       "{colors.paper}"
    rounded:         "{rounded.md}"
    padding:         "0 1rem"
    height:          "2.5rem"
  input:
    backgroundColor: "{colors.sunk}"
    textColor:       "{colors.ink}"
    rounded:         "{rounded.md}"
    padding:         "0 0.75rem"
    height:          "2.75rem"
  input-focus:
    backgroundColor: "{colors.paper}"
  panel:
    backgroundColor: "{colors.paper}"
    rounded:         "{rounded.md}"
    padding:         "1.5rem"
  panel-sunk:
    backgroundColor: "{colors.sunk}"
    rounded:         "{rounded.md}"
    padding:         "1.5rem"
  status-pill:
    backgroundColor: "{colors.paper}"
    textColor:       "{colors.ink-2}"
    rounded:         "{rounded.xs}"
    padding:         "0 0.5rem"
    height:          "1.5rem"
---

# Design System: CrossChainEscrow

## 1. Overview

**Creative North Star: "The Ledger Sheet"**

CrossChainEscrow reads like a primary-source financial document, not a SaaS app. Warm paper, decisive serif headlines, monospaced figures in tabular columns, hairline rules separating sections instead of card chrome. The system shows the *mechanism* of the escrow — milestone state, dispute windows, CCTP path, protocol fees — in the same way a printed ledger or a type specimen shows its own structure: composed, legible, nothing decorative.

The product is on-chain financial infrastructure for two parties moving real USDC. Confidence is the conversion. The visual register has to earn that confidence on first paint, before the user has done anything, then sustain it across every operator surface (dashboard, detail, arbiter queue, protocol settings). Editorial confidence beats decorative reassurance every time.

This system explicitly rejects the four anti-references in PRODUCT.md: neon-on-black DeFi casino, generic SaaS dashboard, web3 dev-tools clone (lime/cyan terminal on black), and bank/legacy fintech (navy/gold). If a viewer could guess the aesthetic from the category alone ("on-chain escrow → black + neon green terminal"), the spec has failed.

**Key Characteristics:**
- Warm paper canvas (`oklch(97% 0.008 60)`), never pure white. Dark mode is a tinted near-black, never `#000`.
- One committed accent — terracotta clay (`oklch(58% 0.165 38)`) — used sparingly, never as gradient or glow.
- Editorial type pairing: Instrument Serif display + Inter body + JetBrains Mono for figures.
- Flat by default. Borders and hairlines do the work shadows usually do.
- Mechanism on display: states, windows, fees, paths shown as data, not hidden behind progress bars.

## 2. Colors

The palette is a single saturated terracotta accent committed against a warm tinted-neutral paper. Every neutral carries a faint warm hue (chroma 0.008–0.018 at the 40 hue family); pure black and pure white are forbidden by token. The light/dark split is independently tuned — dark mode is not lightness-inverted; it's reauthored with its own chroma curve so the warmth survives.

### Primary
- **Terracotta Clay** (`oklch(58% 0.165 38)` light / `oklch(72% 0.155 38)` dark): The one saturated color in the system. Applied to primary CTAs, the focus-ring color, the "active" tab indicator, totals in the live ledger, the underline accent in the hero headline, and milestone progress fill. Carries ≤10% of any given screen on product surfaces and up to ~20% on the landing-page hero only.
- **Terracotta Deep** (`oklch(52% 0.175 38)`): Hover state for the primary button.
- **Clay Wash** (`oklch(92% 0.040 38)` light / `oklch(30% 0.080 38)` dark): The accent's pale companion. Selection background, lead-feature icon container, hover halo on contract-pill external-link button.

### Neutral
- **Warm Paper Cream** (`oklch(97% 0.008 60)`): The primary canvas. Walls of the app.
- **Sunken Bone** (`oklch(94% 0.012 60)`): One step darker than Paper. Form-input fill, code-editor chrome, status pill background, hover-row background.
- **Deep Ink** (`oklch(22% 0.020 40)`): Headlines, primary body text, total-amount figures.
- **Mid Ink** (`oklch(44% 0.018 40)`): Secondary text, helper copy under inputs, ledger labels.
- **Faint Ink** (`oklch(52% 0.016 40)`): The "deemphasize" rung. Eyebrows, placeholders, empty-value glyphs, supplementary metadata. Held at ~52% L so small text still clears WCAG AA contrast against Paper.
- **Rule Hairline** (`oklch(88% 0.012 50)`) and **Rule Hairline 2** (`oklch(78% 0.018 50)`): The two stroke weights that replace card chrome. Use Rule for ambient section separation, Rule 2 for emphasized borders (input focus, ledger total separator).

### Status
- **Verdant Approval** (`oklch(50% 0.13 155)`): Released milestones, approved states, "Active" pause status.
- **Cautionary Amber** (`oklch(68% 0.165 60)`): In-review states, warnings that don't block.
- **Signal Red** (`oklch(54% 0.20 25)`): Disputes, destructive confirmations, paused state.

### Named Rules

**The Tinted-Neutral Rule.** No pure black, no pure white, ever. Every neutral carries chroma between 0.008 and 0.018 in the 40-hue family. `#000` and `#fff` are bugs in the design tokens, not options.

**The One Accent Rule.** Terracotta Clay is the only saturated color. Status colors (ok/warn/bad) appear in narrow contexts — pills, state markers, totals — and never compete with Clay for emphasis. Stacking accents (Clay + green + amber in the same composition) is forbidden.

**The Independent Theme Rule.** Light and dark mode are separately tuned palettes, not lightness inversions. When a token's light-mode value changes, its dark-mode counterpart is re-evaluated on its own merits, not derived by formula.

## 3. Typography

**Display Font:** Instrument Serif (with ui-serif, Georgia, serif fallback)
**Body / UI Font:** Inter (with ui-sans-serif, system-ui, sans-serif fallback)
**Mono Font:** JetBrains Mono (with ui-monospace, SFMono-Regular, Menlo fallback)

**Character:** Instrument Serif carries the editorial-primitive voice — it's the brand moment, applied sparingly to landing hero, page titles, and section numerals. Inter is the workhorse for all body, UI, and form copy. JetBrains Mono handles every figure that needs to align in columns: USDC amounts, addresses, hashes, escrow IDs, step counters.

### Hierarchy

- **Display** (400, clamped 2.25rem–4.5rem, line-height 1.04, letter-spacing -0.02em): Landing hero, page titles, modal titles, single-feature lead lines. Instrument Serif.
- **Headline** (400, 1.75rem, line-height 1.15): Section heads inside operator workspaces (Protocol Settings sub-sections, Arbiter resolution headings). Instrument Serif.
- **Title** (500 Inter, 1.0625rem): Step titles inside the create-escrow flow, primary list-item labels. Sans, not serif.
- **Body** (400 Inter, 0.9375rem, line-height 1.55): All prose, helper text, descriptions. Capped at 65–75ch via the `prose` max-width.
- **Label** (500 Inter, 0.78125rem / 12.5px, letter-spacing 0.005em): Form-control labels. Mixed case, not uppercase. Use `.field-label` class.
- **Eyebrow** (500 Inter, 0.65625rem / 10.5px, uppercase, letter-spacing 0.18em): Section eyebrows in marketing and dashboard surfaces, ledger-row labels. Never on transactional form inputs.
- **Mono** (400 JetBrains Mono, 0.875rem, tabular figures): All figures, addresses, hashes, escrow IDs. Use the `.num` utility.

### Named Rules

**The Sparse Serif Rule.** Instrument Serif appears only at the four moments it earns: hero headlines, page titles, modal titles, and section numerals (e.g. the "01 / 05" step counters). Body, UI, helper text, and form labels are always Inter. Decorative serif elsewhere is forbidden.

**The Tabular Figures Rule.** Any number that could ever sit in a column — USDC amounts, fees, milestone counts, escrow IDs, percentages, deadlines — is rendered with `font-variant-numeric: tabular-nums`. Use the `.tabular` or `.num` utility. Proportional figures in tables are a bug.

**The No Gradient Text Rule.** Headlines never use `background-clip: text`. Emphasis comes from weight, size, or the `.underline-clay` accent line (a 2px solid clay rule sitting under the text, not a gradient).

**The Mixed-Case Label Rule.** Form input labels use `.field-label` (mixed-case 12.5px Inter), not `.eyebrow` (uppercase 10.5px Inter). Eyebrows belong on sections and marketing; labels on inputs.

## 4. Elevation

This system is flat by default. Depth is conveyed through hairline rules, surface-color stepping (Paper → Sunken Bone), and decisive typography hierarchy — not shadows. The shadow vocabulary exists but is held in reserve for elements that genuinely *float* (modal panels, sticky nav).

### Shadow Vocabulary

- **Lift Small** (`0 1px 2px color-mix(in oklch, var(--ink) 6%, transparent)`): Almost imperceptible. Sticky-nav under-shadow on scroll if needed; rarely used.
- **Lift Medium** (`0 2px 6px color-mix(in oklch, var(--ink) 7%, transparent)`): Hover lift on interactive cards; not a default.
- **Lift Large** (`0 6px 18px color-mix(in oklch, var(--ink) 9%, transparent)`): Modal dialog panels; the only place "lift" reads as obvious depth.
- **Glow Accent** (`0 0 14px color-mix(in oklch, var(--clay) 55%, transparent)`): Single use — the animated route-ball on the landing hero visual. Never on text, buttons, or interactive controls.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Cards have hairline borders, not shadows. Shadow appears only on modal dialogs and (sparingly) on hover-lift cards. A shadow on a button or a static section is a bug.

**The Hairline-Over-Card Rule.** When two regions need separation, use a 1px Rule line. When a region needs containment, use a 1px border on a Paper or Sunken Bone fill. Nested cards (a card inside a card) are forbidden. If you find yourself reaching for one, restructure into hairline-separated sections.

## 5. Components

### Buttons
- **Shape:** Gently rounded corners (0.5rem / `rounded-md`).
- **Height:** 2.5rem (`h-10`) at default, 3rem (`h-12`) at `btn-lg`.
- **Primary (`.btn-primary`):** Terracotta Clay fill, Paper text. Used once per primary action context. Hover deepens to Terracotta Deep.
- **Secondary (`.btn-secondary`):** Transparent fill, Deep Ink text, 1px Rule 2 border. Hover fills with Sunken Bone.
- **Quiet (`.btn-quiet`):** Transparent fill, Mid Ink text, no border. Used for tertiary actions (Back, Cancel, Refresh).
- **Danger (`.btn-danger`):** Signal Red fill, Paper text. Used only on destructive confirmation actions (Pause, Refund, Confirm execution).
- **Active state:** All buttons scale to 0.99 on press, ease-out-quart, 200ms.
- **Focus:** 2px Clay ring with 2px Paper offset (`focus-visible:ring-2 ring-clay ring-offset-2 ring-offset-paper`).

### Icon Buttons
- **Shape:** 0.5rem radius, square.
- **Size:** 2.75rem (44px) at `md` — the WCAG 2.5.5 touch-target floor. 2.25rem (36px) at `sm` only inside dense desktop UIs (popovers, dropdowns).
- **Tones:** `ghost`, `bordered`, `danger`, `ghost-danger` (Faint Ink → Signal Red on hover).
- **Always carries `aria-label`** — this is the labelled affordance, no exceptions.

### Inputs / Fields
- **Style:** Sunken Bone fill, 1px Rule border, 0.5rem radius. Height 2.75rem.
- **Focus:** Border switches to Clay, fill swaps to Paper. 200ms ease-out-quart transition on border and background only.
- **Select:** Same chassis as text input, with a token-tinted SVG chevron painted on at `right 0.85rem center`. Native chrome is stripped; the chevron is mandatory.
- **Error:** Field error message uses Signal Red, 12.5px, prefixed with a circle-exclamation glyph, marked `role="alert"`.
- **Disabled:** Opacity 0.5, no pointer events. Border and fill do not change.

### Panels / Surfaces
- **Style:** Paper or Sunken Bone fill, 1px Rule border, 0.5rem radius.
- **Padding:** 1.5rem default; transactional panels (modal body, ledger) may scale to 1.25rem or 2rem as the layout warrants.
- **Use sparingly.** Most regions in this system are not paneled — they're hairline-separated. Reach for a panel only when the content genuinely needs containment (live ledger, modal body, escrow card preview).

### Status Pills
- **Shape:** 0.25rem radius (`rounded-sm`), height 1.5rem.
- **Style:** Paper fill, 1px Rule 2 border, 0.65625rem uppercase letter-spaced 0.12em label.
- **Always includes a leading dot** in `currentColor` (the color that conveys state). The dot reinforces the state but the text label is what carries meaning — color never carries meaning alone.

### Navigation
- **Top nav:** Sticky, 4rem tall, Paper-with-85%-opacity backdrop with 4px blur. Wordmark left (Instrument Serif), nav links center (Inter 14px 500), utility/wallet right.
- **Active link:** Deep Ink color. Inactive: Mid Ink with hover to Deep Ink. No underline, no pill, no background.
- **Mobile bottom nav:** 4rem tall, full-width fixed, icon-over-label. Active item gets a 2px Clay top-border indicator.

### Live Ledger (Signature Component)
The right-pane ledger on the Create Escrow flow is the system's signature surface. It mirrors what the contract sees — payer, freelancer, amount, deadline, windows, milestones, fees, total — and updates as the user fills in the left-pane form. Built as a Paper panel with rows of `label : value` separated by hairline rules. Empty values render as italic Faint Ink placeholders showing the source step ("— step 01 / Parties"). Total is the only place Clay appears in the ledger, set at 22px JetBrains Mono with `USDC` rendered in Faint Ink Inter alongside. This component is the proof of "show the mechanism, don't hide it."

## 6. Do's and Don'ts

### Do:
- **Do** use Terracotta Clay as the only saturated color. One accent, ≤10% of any product surface.
- **Do** use hairline Rule lines to separate sections; reach for a panel only when content needs containment.
- **Do** render every figure with tabular numerals (use `.num` or `.tabular` utilities). USDC columns must align.
- **Do** use `.field-label` (12.5px mixed-case) for form input labels. `.eyebrow` is for sections and marketing only.
- **Do** wrap every form control in `<Field>` so labels, helpers, errors, and aria attributes wire up correctly.
- **Do** use `<IconButton size="md">` (44px) for every icon-only trigger. The component enforces WCAG 2.5.5.
- **Do** pair every state color with a text label. Color never carries meaning alone.
- **Do** respect `prefers-reduced-motion` via `MotionConfig reducedMotion="user"` and `useReducedMotion()` on every infinite animation.
- **Do** default the theme to dark per PRODUCT.md ("dark by default"); honor stored user preference when present.

### Don't:
- **Don't** use `#000` or `#fff`. Every neutral must carry chroma 0.008–0.018 in the 40-hue family.
- **Don't** use gradient text (`background-clip: text` over a gradient). Emphasis comes from weight, size, or the `.underline-clay` solid accent.
- **Don't** use glassmorphism as decoration. The single permitted blur is the 4px sticky-nav backdrop.
- **Don't** ship the hero-metric template (big-number + small-label + supporting-stats card grid). Asymmetric editorial layout instead.
- **Don't** ship identical card grids (icon + heading + text, repeated). Use typographic two-column lists separated by hairlines.
- **Don't** nest cards. A card inside a card is always a structural failure — restructure into hairline-separated sections.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent stripe on cards, list items, or alerts.
- **Don't** use bounce or elastic motion curves. Ease-out-quart / quint / expo only. Overshoot animations (scale > 1.0 settling back) are forbidden.
- **Don't** use em dashes (`—`) in user-facing prose. Comma, colon, semicolon, period, or parentheses. The `—` glyph is permitted only as an empty-value placeholder in tables and ledgers.
- **Don't** use exclamation marks in toasts, error messages, or operator copy. PRODUCT voice is "calm under pressure," not consumer-app enthusiasm.
- **Don't** ship the neon-on-black DeFi casino aesthetic, the generic SaaS-indigo dashboard, the lime/cyan web3 dev-tools clone, or the navy/gold legacy-fintech look. All four are explicit anti-references in PRODUCT.md.
- **Don't** strip native form chrome without replacement. Selects must always carry the token-tinted chevron.
- **Don't** use Instrument Serif on body copy, helper text, or form labels. The serif appears only at hero headlines, page titles, modal titles, and section numerals.
