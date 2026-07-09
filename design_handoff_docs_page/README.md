# Handoff: Tranche Protocol — Docs Page

## Overview
A single documentation page for Tranche Protocol: what the product is, how the escrow loop works, a glossary, guides for payers and recipients, cross-chain payout notes, dispute handling, fees, an FAQ, a trust/security note, and a minimal "about" credit line. Audience is a first-time visitor who may not be crypto-native — the page must read plainly, and it sits alongside (not inside) the wallet-connected app.

## About the Design Files
The file in this bundle (`Docs Page Wireframe.html`) is a **low-fidelity wireframe** — a structure-and-flow reference, not a visual mock. It is a static HTML sketch (hand-drawn font, gray placeholder lines, dashed annotation callouts) built to communicate layout, content order, and interaction intent only. **Do not port its fonts, colors, or box styling into the product.** Rebuild the page as a real route in the existing frontend (React + Vite, Tailwind, react-router) using the production design system described below and in the attached `colors_and_type.css`.

## Fidelity
**Low-fidelity.** Treat every box, dashed line, and handwritten annotation in the wireframe as a note about structure and behavior, not final appearance. All visual styling (color, type, spacing, radii, shadows, component chrome) comes from the Tranche Protocol design system, not from the wireframe file.

## Where this lives in the codebase
Repo: `macanthonyeke/tranche-protocol`, frontend at `frontend/`.
- Add `frontend/src/pages/Docs.jsx` and route it in `frontend/src/App.jsx` as `<Route path="/docs" element={<Docs />} />`, **outside** the `<Shelled>` wrapper — same tier as `Home` (`/`). Docs is a public, no-wallet-required surface; it should not force the wallet-connected app chrome (top nav with Dashboard/Create/History/Settings) on a first-time reader.
- Give it its own lightweight header (logo + wordmark + "Open app" link back to `/dashboard`) rather than reusing `<AppShell>`. Link to `/docs` from `Home.jsx`'s footer nav.
- Lazy-load it the same way other routes are lazy-loaded in `App.jsx` (`const Docs = lazy(() => import('./pages/Docs.jsx'))`).

## Screens / Views

### Docs page (single route, 11 sections, one long scroll)

**Layout**
- Two-column shell: left sidebar (fixed width, ~260px, `position: sticky; top: 0; height: 100vh`) + main content column (`max-width: 920–1000px`, generous side padding, matches `--max-prose`/`--max-content` tokens).
- Below `860px` viewport width, collapse to a single column: sidebar becomes a normal (non-sticky) block above the content, or a collapsible drawer — developer's call, but content order must not change.
- Sidebar contains: logo mark + wordmark, a search input (visual only unless search is in scope — confirm with product before wiring), then the nav list grouped into three unlabeled-vs-labeled clusters as shown in the wireframe (`Guides`, `Reference` group labels as `.eyebrow`-style small caps), one link per section.
- **Scroll-spy:** the nav link for the section currently in viewport gets the active treatment (clay background fill, per `.status-active`/`.btn-primary` color logic — see Design Tokens). Use an `IntersectionObserver` keyed to each `<section id="...">`.
- Anchor targets: `#s1`…`#s11` matching the section order below (the wireframe uses these ids directly — keep them, they're already wired to the sidebar hrefs).

**Mobile (< 860px), per the wireframe's working breakpoint:**
- Sidebar is hidden by default and replaced by a slim sticky top bar: logo + wordmark (left), a hamburger button (right).
- Tapping the hamburger slides the sidebar in from the left as a fixed drawer (~82% width, max 320px) over a dark scrim, with its own close (✕) button at the top.
- Tapping any nav link, the close button, or the scrim closes the drawer. No scroll-spy needed while the drawer is closed; re-open it any time to jump sections.
- Two-column sections (Key terms glossary; For payers / For recipients) stack to a single column.
- The wireframe file implements this drawer with plain CSS + a few lines of vanilla JS (`transform: translateX`, a `.open` class, click listeners) — copy the *behavior*, not the markup, into the real component (e.g. local `isDrawerOpen` state in React).

**Sections, in order** (content per the product's plain-language docs spec; see Interactions for behavior notes):

1. **What is Tranche** — eyebrow + one Fraunces `.display`-style headline + a single simplified paragraph (`.body`). No CTA needed.
2. **How it works** — 5-step horizontal stepper: Lock funds → Define milestones → Recipient delivers → Review window → Funds release, with a branch note off step 5 for "or a dispute." Each step: numeral badge, short title (`.title`), one-line description (`.body`).
3. **Key terms** — 2-column glossary (1 column on mobile) covering: Escrow, Milestone, Review window, Silent approval, Split recipient, Arbiter. Term in `.title`, definition in `.body`/`.eyebrow`-adjacent secondary color.
4. **For payers** — vertical accordion list: Creating an escrow, Acknowledgment step, Marking work fulfilled, Extending a deadline, What happens if you go silent, Mutual settlement/cancel, Refunds.
5. **For recipients** — vertical accordion list, side-by-side with section 4 on desktop (two-column grid, stacks on mobile): Acknowledging an invoice (and what declining does), Claiming delivery, What "silent approval" means for you, Disputing, Receiving cross-chain.
6. **Cross-chain payouts** — short paragraph noting recipients can be paid on other chains + the small fee, stated plainly and inline (not fine print). Below it, a callout box: "What to do if a payment seems stuck" — self-relay recovery worded as a support/troubleshooting step, never as audit/protocol jargon.
7. **Disputes, plainly explained** — 4-step flow: Raise a dispute → Submit evidence → Arbiter reviews → Ruling + release. Plus a plain-language note on timeout protection (what happens if nobody acts).
8. **Fees** — ledger-style rows (label : value, tabular numerals) for protocol fee %, when it's taken, and the cross-chain fee. Nothing hidden or asterisked.
9. **FAQ** — accordion: "Is this audited?", "Is my money safe if the other party disappears?", "What if I send to the wrong chain?", "Can I cancel?" All collapsed by default.
10. **Trust & security** — three stat pills (6 audit rounds, 0 critical, 0 high) + one short paragraph + a link to audit reports. No findings table or CVE-level detail on this page.
11. **About** — one line: "Built by MacAnthony Eke" + link to `x.com/macanthonyeke`. No bio, no photo, no mission statement.

**Components** (map to existing design-system pieces, don't rebuild from scratch):
- Stepper (sections 2, 7): new component, but reuse `.title`/`.body`/`.num` classes and `--rule` hairline connectors between steps (arrows are simple hairline + chevron, not icon illustrations).
- Accordion rows (sections 4, 5, 9): new `<Accordion>`/`<AccordionRow>` component — chevron rotates 180° on open, content slides via height transition, 200ms ease-out-quart per the motion system.
- Glossary (section 3): plain grid, no new component needed.
- Ledger rows (section 8): reuse the existing `<Ledger>` component/pattern (`Components.jsx`) — it already renders label:value rows with a totals-style hairline.
- Stat pills (section 10): reuse `<StatTile>` pattern from the Dashboard, or a lighter 3-up variant.
- Callout (section 6): new lightweight component — `--rule-2` or `--clay` border, `--sunk`/`--clay-soft` fill, no exclamation marks or alarm styling per brand voice rules.

## Interactions & Behavior
- **Scroll-spy nav:** active section link highlighted as user scrolls; smooth-scroll on click (respect `prefers-reduced-motion` — jump instantly, no smooth scroll, if set).
- **Accordions:** sections 4, 5, 9 are collapsible. Default state: first row open in each of sections 4 and 5 (so the page doesn't read as fully collapsed/empty on load); all of section 9 (FAQ) collapsed by default.
- **Sticky sidebar:** pins on desktop; on mobile, replaced by the hamburger-triggered slide-in drawer described above (not a normal in-flow block — see the Mobile note in Screens / Views).
- **No entrance animations required** beyond the standard page transition (`opacity 0→1`, `y 10→0`, 300ms) already used elsewhere in the app. Do not add scroll-triggered reveal animations to this page — it's a reference document, not a marketing moment.
- **Links:** `x.com/macanthonyeke` opens in a new tab (`target="_blank" rel="noopener"`).

## State Management
- `activeSection` (string, one of the 11 section ids) — driven by `IntersectionObserver`, read by the sidebar to apply the active link style.
- `isDrawerOpen` (boolean, mobile only) — toggled by the hamburger button, closed on link click / close button / scrim click.
- Per-accordion `open` boolean state, local to each row (no need to lift to page level unless product wants "expand all" later).
- No data fetching — this page is fully static content, no chain reads.

## Design Tokens
Full token set lives in the attached `colors_and_type.css` (identical to `frontend/src/styles/globals.css`, the canonical source — use that file in the real codebase, not the copy in this handoff). Key ones relevant to this page:

- Surfaces: `--paper` (page bg), `--sunk` (recessed/accordion-open fill)
- Text: `--ink` (headings/body), `--ink-2` (secondary/definitions), `--ink-3` (placeholders)
- Borders: `--rule` (hairlines between rows/steps), `--rule-2` (emphasized/hover)
- Accent: `--clay` (active nav link, stepper numerals, links) — one accent only, ≤10% of the surface
- Status-adjacent: `--ok` for any "0 critical / 0 high" positive framing in the trust section (or just `--ink` if that reads calmer)
- Radii: cap at `--radius-md` (8px) everywhere, `--radius-xs` (4px) for stat pills
- Shadows: none by default (flat hairline-bordered cards); do not add card shadows to accordions or steppers
- Type: Fraunces `.display`/`.headline` only for the page title and section numerals/titles; Switzer `.body`/`.title`/`.field-label`/`.eyebrow` for everything else; Geist Mono `.num` for the fee percentages and stat numbers
- Motion: `cubic-bezier(0.22, 1, 0.36, 1)`, 200ms for accordion/hover, 300ms for page transition, no bounce/overshoot

## Voice & Copy Rules (apply throughout)
- Second person ("Your escrow"), plain language over jargon, no exclamation marks, no em dashes in prose (commas/colons/periods only), sentence case body copy, ALL CAPS reserved for eyebrows/status pills only, no emoji.
- Section 6's "stuck payment" note and section 7's "timeout protection" note should both read as calm, reassuring support copy — never alarmed.

## Assets
- No new icons or illustrations required beyond what's already in the system (chevrons for accordions can be simple inline SVGs at 1.4 stroke, matching the existing icon house style).
- Logo mark: use the existing D1 Golden Split mark (`assets/logo-golden-split-light.svg` or the sidebar's 32×32 clay tile pattern already used in `<AppShell>`).

## Files
- `Docs Page Wireframe.html` — the low-fi structural wireframe (this handoff's primary reference for layout/flow; do not copy its visual styling)
- Design tokens: this bundle does not include a copy of the CSS (to avoid a stale duplicate). Use `frontend/src/styles/globals.css` in the live repo — the canonical, authoritative source. The design-system project's `styles.css` / `colors_and_type.css` mirror it 1:1 for reference only.
- Full design system context (voice, color, type, component inventory) lives in the design system project's `README.md` and `DESIGN_SYSTEM_GUIDE.md`, and in the live repo's `DESIGN.md` / `PRODUCT.md` at the repo root
