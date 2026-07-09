# Handoff: Dashboard Redesign — Direction A+ (merged)

## Overview
A redesign of the Tranche Protocol app **Dashboard** page (the escrow home at `/dashboard`). Direction **A+** merges the strongest pieces of three explored directions into one:
- **Needs-Action queue** pinned at the top of the working column *(from A)*
- **Compact one-line metric summary** strip instead of a 4-tile grid or a big position band *(from B)*
- **Live activity feed** in a sticky right rail *(from B)*
- **Escrow list** as a dense table on laptop/desktop, cards on phone/tablet *(from A)*

This replaces the current layout in `frontend/src/pages/Dashboard.jsx`:
- 4 identical stat tiles (USDC Balance / Active / Open Disputes / Claimable)
- "Your Escrows" heading + tab filter + refresh
- 3-column `PremiumEscrowCard` grid + pagination

> **Note if you already built plain Direction A:** the diff from A → A+ is (1) the big **PositionBand** is replaced by a compact **SummaryBar** one-liner, and (2) a two-column **workspace** wraps the list, adding a sticky **ActivityRail** on the right. The AttentionQueue and the EscrowTable/cards from A are unchanged. See "Delta from Direction A" at the bottom.

## About the Design Files
The file in this bundle (`Dashboard Wireframe A+.html`) is a **design reference created in HTML** — a low-fidelity, structural prototype showing layout, hierarchy, and responsive reflow. It is **not production code to copy**. The task is to **recreate Direction A+ inside the existing Tranche Protocol React codebase** (`frontend/`, Vite + React + Tailwind + framer-motion, tokens in `frontend/src/styles/globals.css`), reusing established components and patterns. Each block in the wireframe is tagged **A** or **B** to show its origin — that tagging is documentation, not UI to ship.

## Fidelity
**Low-fidelity (structure & flow).** The wireframe communicates layout, component hierarchy, responsive behavior, and interaction intent — not final pixels. **Apply the existing design system for all styling.** Exact token values are in "Design Tokens" below — use the repo's CSS variables / Tailwind theme, never the warm greyscale placeholder palette from the wireframe (it only exists to read as a sketch).

---

## Screens / Views

One screen: **Dashboard (`/dashboard`)**, gated by the existing `<ConnectGate>` and the arbiter/admin redirect logic already in `Dashboard.jsx` (keep both — see State Management).

Top to bottom: **App nav → Page header → Summary bar → Workspace { main: Attention queue + Escrow list + Pagination · rail: Live activity }.**

### 1. App nav (unchanged)
Keep the existing `<AppShell currentPage="dashboard">`. Nav links, network badge, wallet button, theme toggle, mobile bottom tab bar are all already implemented. Do not rebuild.

### 2. Page header
- Flex row, space-between, `align-items: flex-start`; stacks to column below `sm`.
- **Left:** `<h1>` "Dashboard" (`.headline` — Fraunces 420, ~1.75rem, tracking −0.015em).
- **Right:** `.btn-primary` "+ New Escrow" → `/create`. Height 2.5rem, `--clay` bg, `--paper` text, radius 8px.

### 3. Summary bar  *(from B — replaces the 4-tile grid AND A's position band)*
A single horizontal `.panel-sunk` strip: `--sunk` bg, `1px --rule` border, 8px radius, ~13px/16px padding.
- **Layout:** `display:flex; flex-wrap:wrap; align-items:baseline; gap:10px 24px`. Items separated by 1px `--rule` vertical dividers (hide dividers when wrapped on mobile — see `.sum-sep` `display:none` below 640px).
- **Items** (each = inline `key` + `value`):
  - key: `.eyebrow` scale (uppercase, 0.12em tracking, `--ink-3`, ~9px)
  - value: ~15px, weight 600, `.num` (Geist Mono tabular).
  - Content: "In escrow **42,500**" · "Balance **12,340**" · "Claimable **1,200 →**" (value `--clay`, links to `/settings` only when `refundBalance > 0n`) · "Active **6**".
- **Rationale:** metrics become a scannable single line, not four equal-weight cards competing for attention. In-escrow leads by reading order, not by size.

### 4. Workspace (two-column split)
Below the summary bar, wrap the rest in a `.workspace` grid:
- `grid-template-columns: 1fr` (mobile/tablet, single column — rail drops **below** the list).
- `grid-template-columns: 1fr 300px` at ≥1000px; `1fr 340px` at ≥1400px. `align-items: start`.
- Left = **main column** (§5–§7). Right = **rail** (§8), `position: sticky; top: 20px` at ≥1000px.

### 5. Needs-Action queue  *(from A — first thing in the main column)*
A bordered panel that renders only when there is ≥1 actionable item. Border `--warn`, radius 8px, overflow hidden, `margin-bottom` ~22px.
- **Header strip:** `--warn-soft` bg, ~10px/14px padding. "⚠ Needs your attention" (weight 600, `--warn`, ~11px) + right-aligned count "N items".
- **Rows:** `border-top: 1px --rule`, ~11px/14px padding.
  - Grid `1fr auto` below 760px; `110px 1fr auto` at ≥760px (leading escrow-id column appears).
  - id (`.num`/`.seq`, `--ink-2`, ~11px) · title (weight 600, ~12px) + one muted sub-line · trailing action button.
  - Action button: `.btn-primary` for release-due ("Review & Release"), `.btn-secondary` for dispute ("Submit Evidence" / "Open Dispute").
- **Item sources:** reuse the existing `isActionNeeded(e)` predicate in `Dashboard.jsx` — `disputedMilestoneCount > 0` → dispute item; freelancer with a delivered-but-unreleased milestone → release-due item.
- **Rationale:** load-bearing change — action items lifted out of the flat list to the top.

### 6. Escrow list — TABLE on desktop, CARDS on mobile  *(from A)*
- **List header:** flex row, space-between (wraps). Left `<h2>` "All escrows" (~16px). Right group: pill-segmented filter `<TabBar>` (All · Paying · Receiving · Done — map to existing `LEDGER_TABS`) + the existing refresh button (28px square, `--rule-2` border).
- **≥900px → TABLE** (cards hidden):
  - Header row of `.eyebrow`-scale labels on `--sunk`: Invoice · Counterparty · Amount · Progress · Status · (chevron).
  - Grid `78px 1fr 90px 96px 84px 30px`, gap ~12px, `align-items:center`, ~11px/14px padding, `border-top: 1px --rule` per row. (Columns are tighter than plain A because the rail claims ~320px — verify widths against real content.)
  - Cells: invoice id `.num` `--ink-2`; counterparty = 20px avatar dot + name; amount `.num` weight 600; progress = 5px `--sunk` track, `--clay` fill (`--warn` fill if disputed); status = `.status` pill; trailing `›` `--ink-3`. Whole row links to `/escrow/:id`, hover uses `.card-clickable` (`--sunk` bg / `--rule-2` border).
- **<900px → CARDS** (table hidden): reuse existing `PremiumEscrowCard`. Grid 1 col mobile, 2 cols ≥640px. (The old desktop 3-col card grid is retired in favor of the table.)
- **Status → pill mapping** (reuse `deriveStatus`): Active → `.status-active` (`--clay`, pulsing dot) · Disputed → `.status-warn` (`--warn`) · Completed → `.status-ok` (`--ok`) · Cancelled → `.status-muted` (`--ink-3`).
- **Empty state:** reuse `LedgerEmptyState` / `<EmptyState>` when a filter yields zero rows.

### 7. Pagination (unchanged)
Keep the existing footer inside the main column: hairline rule, "Showing X–Y of N escrows" (`.num`, `--ink-3`), Prev / page-count / Next. `PAGE_SIZE = 9`.

### 8. Activity rail  *(from B — new component)*
A `.rail-card` (`1px --rule`, radius 10px, overflow hidden) holding a **live activity feed** of the account's real on-chain events.
- **Header:** `--sunk` bg, ~11px/14px, `border-bottom: 1px --rule`. Dot + "Live activity" (~11px).
- **Feed rows:** grid `auto 1fr` (timeline gutter + text). Gutter = an 8px node dot + a 1px `--rule` connector stem (omit the stem on the last item). Node color encodes event type: `--clay` funded/created, `--warn` disputed, `--ok` released/completed, `--ink-3` other. Text = uppercase `--ink-3` relative timestamp ("2 min ago") + one/two lines of event copy. Row `border-top: 1px --rule` (none on first).
- **Footer:** "View all activity ›" link → `/history` (or an activity route if one exists).
- **Data:** derive from the same event/log source the escrow detail timeline uses; **cap to the ~6 most recent** and de-dupe across payer/freelancer roles. If there is no existing account-wide event feed hook, this is the one net-new data dependency — flag it and wire it to the subgraph/log query the detail page already uses rather than inventing an endpoint.
- **Placement:** sticky right rail at ≥1000px; full-width block **below the pagination** at <1000px (still inside `.workspace`, natural grid flow).
- **Scope note:** only the activity feed was pulled from B — **not** B's quick-actions block. Do not add quick-actions.
- **Rationale:** gives the page a reason to return to it (a pulse of what's happening) using real data, filling the right-side whitespace productively.

---

## Interactions & Behavior
- **Row / card click:** navigate to `/escrow/:id` (`<Link>`), as today.
- **Attention action buttons:** route to escrow detail or open the existing `<TxModal>` release flow — wire to the same handlers the detail page uses; don't invent a new release path.
- **Claimable link:** links to `/settings` only when `refundBalance > 0n` (existing `ClaimableTile` logic), applied to the summary-bar Claimable value.
- **Filter tabs:** live client-side filter (existing `LEDGER_TABS` + `activeTab`). Reset page to 0 on change (existing effect).
- **Refresh:** keep existing refresh button + `refetch()`; place it next to the tabs in the list header.
- **Activity "View all":** link to history.
- **List transitions:** keep framer-motion `AnimatePresence` + `layout` (opacity/y, 0.2s, ease `[0.22, 1, 0.36, 1]`) on rows/cards.
- **Responsive breakpoints** (wireframe shows all four): Mobile 390 (single col; cards; rail below; bottom tab bar) · Tablet 768 (2-col cards; rail below; summary dividers hidden) · Laptop 1280 (table appears; workspace splits 1fr/300px; sticky rail; attention rows gain id col) · Desktop 1600 (workspace 1fr/340px; page `max-width --max-page` 1320px, centered).
- **Loading:** reuse `Skeleton` / `DashboardSkeleton`; summary bar, attention queue, and rail should show width-pegged skeletons so layout doesn't reflow when data lands.
- **Reduced motion:** global `prefers-reduced-motion` reset already neutralizes animations — keep pulse dots gated by it.

## State Management
Preserve everything in `Dashboard.jsx`:
- `<ConnectGate>`; `useRoles()` arbiter/admin redirect (arbiter → `/arbiter`, admin → `/protocol`); suppress-grid-while-resolving guard.
- Data: `useDashboard(address)` → `{ asPayer, asFreelancer, activeEscrowCount, openDisputeCount, refundBalance }`; `useUsdcBalance(address)`.
- Derived: `mySummaries` (deduped payer+freelancer, `isPayer`), `filteredEscrows` (by tab), pagination (`page`, `PAGE_SIZE = 9`), `isRefreshing`.
- **New derived:** `actionItems = mySummaries.filter(isActionNeeded)` → Attention queue. `inEscrowTotal` = Σ `totalAmount` of active escrows → summary-bar headline. Both computed from existing data, no new fetch.
- **New data dependency (only one):** account-wide **activity feed** for the rail (§8) — reuse the detail page's event/log source; cap ~6, newest first.

## Design Tokens
Use the repo's CSS variables (`frontend/src/styles/globals.css`) / Tailwind theme. Light-mode values (dark mode independently tuned in the same file — do not invert):

**Color**
- `--paper` `oklch(97% 0.008 60)` — page/surface
- `--sunk` `oklch(94% 0.012 60)` — recessed panels, summary bar, table header, progress track, rail/feed headers
- `--ink` `oklch(22% 0.020 40)` — primary text
- `--ink-2` `oklch(44% 0.018 40)` — secondary text
- `--ink-3` `oklch(52% 0.016 40)` — labels / eyebrows / timestamps / chevrons
- `--rule` `oklch(88% 0.012 50)` — hairlines
- `--rule-2` `oklch(78% 0.018 50)` — stronger borders / hover
- `--clay` `oklch(58% 0.165 38)` — accent: primary buttons, active status, progress fill, claimable, "funded" feed nodes
- `--clay-hover` `oklch(52% 0.175 38)` · `--clay-soft` `oklch(92% 0.040 38)`
- `--ok` `oklch(50% 0.13 155)` — completed / released
- `--warn` `oklch(68% 0.165 60)` — disputes / attention (border + text); soft fills use `bg-warn/10`, `border-warn/20` in the codebase
- `--bad` `oklch(54% 0.20 25)` — destructive only (unused here)
- Pure `#000`/`#fff` forbidden.

**Type** (Fraunces / Switzer / Geist Mono already loaded)
- Display/headline: Fraunces (`--font-display`), 420, tracking −0.015 to −0.022em. `.headline` = 1.75rem/1.15.
- Body/UI: Switzer (`--font-sans`), 0.9375rem/1.55.
- Eyebrow/labels: Switzer 500, 0.65625rem, uppercase, 0.12–0.18em tracking, `--ink-3`.
- Figures/ids/amounts/timestamps: Geist Mono (`--font-mono`) via `.num` (tabular, slashed-zero) / `.seq`.

**Spacing:** `--space-xs` 4 · `sm` 8 · `md` 16 · `lg` 24 · `xl` 40 · `section` 80 (px). Page padding 20 → 32 → 40px across breakpoints; page `max-width var(--max-page)` = 1320px. Workspace gap ~20px; rail 300px (≥1000px) / 340px (≥1400px).

**Radius (flat, capped 8px):** `xs` 4px (status pills) · `sm` 6px (skeleton, chips, buttons) · `md` 8px (cards, panels, rail).

**Elevation:** near-flat. `--shadow-lift-sm/md` only for clickable-card hover. No heavy shadows.

**Motion:** transitions 200ms `cubic-bezier(0.22, 1, 0.36, 1)`; list enter/exit 0.2s same easing.

## Components to reuse vs. build
**Reuse** (`frontend/src` / `ui_kits/app/Components.jsx`): `AppShell`, `ConnectGate`, `Skeleton`/`DashboardSkeleton`, `TabBar`, `PremiumEscrowCard` (mobile cards), `EmptyState`/`LedgerEmptyState`, `Pagination`, status pill styles, `.btn-*`, `.panel`/`.panel-sunk`, `TxModal`, hooks `useDashboard`/`useUsdcBalance`/`useRoles`, helpers `isActionNeeded`/`deriveStatus`/`formatUSDCNumber`.
**Build new:**
1. `SummaryBar` — one-line metric strip (§3).
2. `AttentionQueue` + `AttentionRow` — pinned action list (§5).
3. `EscrowTable` + `EscrowTableRow` — desktop table (§6); render `PremiumEscrowCard` grid below the breakpoint.
4. `Workspace` layout wrapper — the two-column grid (§4).
5. `ActivityRail` + `ActivityFeedItem` — sticky feed (§8).

## Delta from Direction A (if A is already built)
1. **Remove** `PositionBand`; **add** `SummaryBar` in the same slot (§3).
2. **Wrap** the attention queue + list + pagination in a `Workspace` grid and **add** `ActivityRail` as the second column (§4, §8).
3. AttentionQueue, EscrowTable, mobile cards, pagination: **unchanged** (table column widths may need tightening now that the rail takes ~320px — see §6).
4. One net-new data dependency: the account activity feed (§8 / State Management).

## Assets
No new image assets. Icons (nav, chevrons, inbox, refresh, arrow, activity/clock) already exist as inline SVGs in `Components.jsx` / `Dashboard.jsx` — reuse. Counterparty marks are neutral `--sunk` circles; use the existing `<AddressDisplay>` / identicon pattern if present.

## Files
- `Dashboard Wireframe A+.html` — the design reference (this bundle). Blocks tagged **A** / **B** show provenance.
- Target to modify: `frontend/src/pages/Dashboard.jsx`.
- Tokens: `frontend/src/styles/globals.css` (mirrored here as `colors_and_type.css`).
- Component library: `frontend/src/components/*`, `ui_kits/app/Components.jsx`.
- System reference: `DESIGN_SYSTEM_GUIDE.md` (§"`<DashboardPage>`").
