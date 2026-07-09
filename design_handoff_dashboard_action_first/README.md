# Handoff: Dashboard Redesign — Direction A (Action-First Ledger)

## Overview
A redesign of the Tranche Protocol app **Dashboard** page (the escrow home view at `/dashboard`). The goal is to make the page action-oriented rather than a passive report: surface what the user must decide on *first*, give the account a single clear financial headline instead of four equal-weight tiles, and let power users scan many escrows quickly.

This replaces the current layout in `frontend/src/pages/Dashboard.jsx`:
- 4 identical stat tiles (USDC Balance / Active / Open Disputes / Claimable)
- "Your Escrows" heading + tab filter + refresh
- 3-column `PremiumEscrowCard` grid + pagination

## About the Design Files
The file in this bundle (`Dashboard Wireframe.html`) is a **design reference created in HTML** — a low-fidelity, structural prototype showing intended layout, hierarchy, and responsive reflow. It is **not production code to copy**. The task is to **recreate Direction A inside the existing Tranche Protocol React codebase** (`frontend/`, Vite + React + Tailwind + framer-motion, with the design tokens in `frontend/src/styles/globals.css`), reusing its established components and patterns. Only **Direction A** is in scope; directions B and C in the wireframe are alternatives that were not chosen.

## Fidelity
**Low-fidelity (structure & flow).** The wireframe communicates layout, component hierarchy, responsive behavior, and interaction intent — not final pixels. **Apply the existing design system for all styling.** Exact token values are documented below (Design Tokens) so there is no ambiguity about colors, type, spacing, or radii — use the CSS variables / Tailwind theme already in the repo, never the greyscale placeholder colors from the wireframe.

The wireframe uses a warm placeholder palette purely to read as a "sketch." In the real build every surface, border, and text color must come from the token set below.

---

## Screens / Views

There is one screen: **Dashboard (`/dashboard`)**, gated by the existing `<ConnectGate>` and the arbiter/admin redirect logic already in `Dashboard.jsx` (keep both — see State Management).

Top to bottom the page is: **App nav → Page header → Financial Position band → Needs-Action queue → Escrow list (table on desktop / cards on mobile) → Pagination.**

### 1. App nav (unchanged)
Keep the existing `<AppShell currentPage="dashboard">`. Do not rebuild it. Nav links: Dashboard (active), Create, History, Settings; network badge; wallet button; theme toggle; mobile bottom tab bar. All already implemented.

### 2. Page header
- **Layout:** flex row, space-between, `align-items: flex-start`. Stacks to column below `sm`.
- **Left:** `<h1>` "Dashboard" (`.headline` type — Fraunces 420, ~1.75rem, tracking −0.015em) + one supporting line "Your deposits, incoming payments, and refunds." in `.body` at `--ink-2`.
- **Right:** primary CTA `.btn-primary` "+ New Escrow" → links to `/create`. Height 2.5rem, `--clay` bg, `--paper` text, radius 8px.

### 3. Financial Position band  *(replaces the 4-tile grid)*
A single `.panel-sunk` block (`--sunk` bg, `1px --rule` border, 8px radius). Padding ~16px mobile → 20–24px desktop.
- **Layout:** column on mobile; row with `justify-content: space-between; align-items: center` at ≥900px.
- **Primary (left):**
  - Eyebrow `.eyebrow` (uppercase, 0.18em tracking, `--ink-3`): "In escrow — across N contracts"
  - Figure: large `.num` (Geist Mono, tabular slashed-zero), ~30px mobile → ~38px desktop, weight 600, tracking −0.02em, color `--ink`. Example: `42,500` with a trailing `USDC locked` in `--ink-2` at ~13px, normal weight.
- **Secondary (right):** an inline row (gap ~22px, wraps) of 3 mini-metrics, each a stacked pair:
  - key `.eyebrow`-scale label (`--ink-3`) / value ~16px weight 600 (`.num`).
  - "Wallet balance" `12,340` · "Claimable" `1,200 →` (value in `--clay`, this one is a link to `/settings` when > 0) · "Active" `6`.
- **Rationale:** the in-escrow total is the headline number; balance/claimable/active are supporting, not co-equal tiles. The Claimable value keeps the current "link only when withdrawable" behavior (see existing `ClaimableTile`).

### 4. Needs-Action queue  *(new component)*
A bordered panel that only renders when there is ≥1 actionable item. Border color `--warn`, radius 8px, overflow hidden.
- **Header strip:** `--warn-soft` bg, ~10px/14px padding. Text: "⚠ Needs your attention" (weight 600, color `--warn`, ~11px) + right-aligned count "N items".
- **Rows:** each row `border-top: 1px --rule`, ~11px/14px padding.
  - Grid: `1fr auto` on mobile; `120px 1fr auto` at ≥900px (leading escrow-id column appears at desktop).
  - Escrow id (`.num`/`.seq`, `--ink-2`, ~11px) · title (weight 600, ~12px, `--ink`) + one muted sub-line · trailing action button.
  - Action button is `.btn-primary` for "release due" items ("Review & Release"), `.btn-secondary` for dispute items ("Open Dispute" / "Submit Evidence").
- **Item sources (from existing dashboard data):** reuse the current `isActionNeeded(e)` predicate in `Dashboard.jsx`:
  - `e.disputedMilestoneCount > 0` → dispute item (dot/badge `--warn`)
  - freelancer with `releasedMilestoneCount === 0` (or a delivered-but-unreleased milestone) → "release due" item.
- **Rationale:** this is the load-bearing change — action items are lifted out of the flat list to the top of the page.

### 5. Escrow list — responsive: TABLE on desktop, CARDS on mobile
- **List header:** flex row space-between (wraps). Left `<h2>` "All escrows" (`.headline`-ish, smaller ~16px). Right: pill-segmented filter `<TabBar>` — reuse the existing tab control. Tabs: All · Paying · Receiving · Completed (map to existing `LEDGER_TABS` filters; you may keep the fuller current tab set).
- **Below ≥900px → TABLE (`<= 899px hidden`):**
  - Header row `.eyebrow`-scale column labels on `--sunk`: Invoice · Counterparty · Amount · Progress · Status · (chevron).
  - Grid template: `90px 1fr 110px 130px 90px 40px`, gap ~14px, `align-items:center`, ~11px/16px row padding, `border-top: 1px --rule` per row.
  - Cells: invoice id `.num` `--ink-2`; counterparty = avatar dot (20px circle) + name; amount `.num` weight 600; progress = 5px track (`--sunk`) with `--clay` fill (`--warn` fill if disputed); status = `.status` pill; trailing `›` chevron `--ink-3`. Whole row links to `/escrow/:id`, hover uses `.card-clickable` treatment (`--sunk` bg / `--rule-2` border).
- **Below <900px → CARDS (table hidden):**
  - Reuse the existing `PremiumEscrowCard`. Grid: 1 col mobile, 2 cols ≥640px. (The desktop 3-col grid is retired in favor of the table.)
- **Status → pill mapping** (reuse existing `deriveStatus`): Active → `.status-active` (`--clay`, pulsing dot); Disputed → `.status-warn` (`--warn`); Completed → `.status-ok` (`--ok`); Cancelled → `.status-muted` (`--ink-3`).
- **Empty state:** reuse existing `LedgerEmptyState` / `<EmptyState>` when a filter yields zero rows.

### 6. Pagination (unchanged)
Keep the existing pagination footer: hairline rule, "Showing X–Y of N escrows" (`.num`, `--ink-3`), Prev / page-count / Next buttons. `PAGE_SIZE = 9`.

---

## Interactions & Behavior
- **Row / card click:** navigate to `/escrow/:id` (React Router `<Link>`), same as today.
- **Attention action buttons:** "Review & Release" and dispute actions route to the escrow detail (or open the existing `<TxModal>` release flow) — wire to the same handlers the detail page uses; do not invent a new release path.
- **Claimable link:** links to `/settings` only when `refundBalance > 0n` (existing `ClaimableTile` logic).
- **Filter tabs:** live-filter the list client-side (existing `LEDGER_TABS` + `activeTab` state). Reset page to 0 on tab change (existing effect).
- **Refresh:** keep the existing refresh button + `refetch()` behavior; place it in the list header next to the tabs.
- **List transitions:** keep `framer-motion` `AnimatePresence` + `layout` enter/exit (opacity/y, 0.2s, ease `[0.22, 1, 0.36, 1]`) for rows/cards.
- **Responsive breakpoints** (the wireframe demonstrates all four): Mobile 390 (single column, cards, bottom tab bar) · Tablet 768 (2-col cards, position band still stacked) · Laptop 1280 (position band goes horizontal, table appears, attention rows gain id column) · Desktop 1600 (max-width `--max-page` 1320px, centered).
- **Loading:** reuse existing `Skeleton` / `DashboardSkeleton`; the position band and attention queue should also show width-pegged skeletons so the layout doesn't reflow when data lands.
- **Reduced motion:** the global `prefers-reduced-motion` reset already neutralizes animations — keep the pulse dots gated by it.

## State Management
Preserve everything already in `Dashboard.jsx`:
- `<ConnectGate>` wrapper; the `useRoles()` arbiter/admin redirect effect (arbiter → `/arbiter`, admin → `/protocol`); suppress-grid-while-resolving guard.
- Data: `useDashboard(address)` → `{ asPayer, asFreelancer, activeEscrowCount, openDisputeCount, refundBalance }`; `useUsdcBalance(address)`.
- Derived: `mySummaries` (deduped payer+freelancer list with `isPayer`), `filteredEscrows` (by active tab), pagination (`page`, `PAGE_SIZE = 9`), `isRefreshing`.
- **New derived value:** `actionItems = mySummaries.filter(isActionNeeded)` → drives the Needs-Action queue. `isActionNeeded` already exists in the file.
- **New derived value:** `inEscrowTotal` = sum of `totalAmount` for active escrows → the position-band headline figure. Compute from existing summary data; no new fetch.

## Design Tokens
Use the repo's CSS variables (`frontend/src/styles/globals.css`) / Tailwind theme. Values (light mode; dark mode is independently tuned in the same file — do not invert):

**Color**
- `--paper` `oklch(97% 0.008 60)` — page/surface
- `--sunk` `oklch(94% 0.012 60)` — recessed panels, position band, table header, progress track
- `--ink` `oklch(22% 0.020 40)` — primary text
- `--ink-2` `oklch(44% 0.018 40)` — secondary text
- `--ink-3` `oklch(52% 0.016 40)` — labels / eyebrows / chevrons
- `--rule` `oklch(88% 0.012 50)` — hairline borders
- `--rule-2` `oklch(78% 0.018 50)` — stronger borders / hover
- `--clay` `oklch(58% 0.165 38)` — accent: primary buttons, active status, progress fill, claimable
- `--clay-hover` `oklch(52% 0.175 38)`
- `--clay-soft` `oklch(92% 0.040 38)`
- `--ok` `oklch(50% 0.13 155)` — completed
- `--warn` `oklch(68% 0.165 60)` — disputes / attention (border + text); soft fill `--clay-soft`-analog is `--warn` at low alpha in the codebase (`bg-warn/10`, `border-warn/20`)
- `--bad` `oklch(54% 0.20 25)` — destructive only (not used here)
- Pure `#000`/`#fff` are forbidden.

**Type** (fonts already loaded in repo: Fraunces / Switzer / Geist Mono)
- Display/headline: Fraunces (`--font-display`), weight 420, tracking −0.015 to −0.022em. `.headline` = 1.75rem/1.15.
- Body/UI: Switzer (`--font-sans`), 0.9375rem/1.55.
- Eyebrow: Switzer 500, 0.65625rem, uppercase, 0.18em tracking, `--ink-3`.
- Figures/ids/amounts: Geist Mono (`--font-mono`) via `.num` (tabular, slashed-zero) or `.seq`.

**Spacing:** `--space-xs` 4 · `--space-sm` 8 · `--space-md` 16 · `--space-lg` 24 · `--space-xl` 40 · `--space-section` 80 (px). Page container padding scales 20px → 32px → 40px across breakpoints; page `max-width: var(--max-page)` = 1320px.

**Radius (flat, capped 8px):** `--radius-xs` 4px (status pills) · `--radius-sm` 6px (skeleton, hash chips) · `--radius-md` 8px (cards, panels, buttons).

**Elevation:** almost flat. `--shadow-lift-sm/md` only for hover-lift on clickable cards. No heavy shadows.

**Motion:** transitions 200ms `cubic-bezier(0.22, 1, 0.36, 1)`; list enter/exit 0.2s same easing.

## Components to reuse vs. build
**Reuse (already in `frontend/src` / `ui_kits/app/Components.jsx`):** `AppShell`, `ConnectGate`, `Skeleton`/`DashboardSkeleton`, `TabBar` (pill filter), `PremiumEscrowCard` (mobile cards), `EmptyState`/`LedgerEmptyState`, `Pagination` footer, status pill styles (`.status*`), `.btn-*`, `.panel`/`.panel-sunk`, `TxModal` (release flow), the `useDashboard`/`useUsdcBalance`/`useRoles` hooks, `isActionNeeded`/`deriveStatus`/`formatUSDCNumber`.
**Build new:**
1. `PositionBand` — the financial headline panel (§3).
2. `AttentionQueue` + `AttentionRow` — the pinned action list (§4).
3. `EscrowTable` + `EscrowTableRow` — the desktop table (§5); render `PremiumEscrowCard` grid below the `md`/`lg` breakpoint instead.

## Assets
No new image assets. Icons (dashboard/create/history/settings, chevrons, inbox, refresh, arrow) already exist as inline SVGs in `Components.jsx` / `Dashboard.jsx` — reuse them. Avatar/counterparty marks are placeholder dots; use the existing `<AddressDisplay>` / identicon pattern if the codebase has one, otherwise a neutral `--sunk` circle.

## Files
- `Dashboard Wireframe.html` — the design reference (this bundle). Direction A is the **first** row ("Action-First Ledger"); ignore directions B and C.
- Target file to modify: `frontend/src/pages/Dashboard.jsx`.
- Tokens: `frontend/src/styles/globals.css` (mirrored in this repo as `colors_and_type.css`).
- Component library: `frontend/src/components/*`, `ui_kits/app/Components.jsx`.
- Full system reference: `DESIGN_SYSTEM_GUIDE.md` (see §"`<DashboardPage>`").
