# Product

## Register

product

## Users

Two first-class audiences on a single shell:

- **End users (depositors and recipients).** Crypto-comfortable freelancers, contractors, and clients moving USDC through milestone-based work. They arrive to lock funds, mark milestones fulfilled, signal delivery, raise or counter disputes, and withdraw refunds. Some are first-timers reading for safety before they connect a wallet; others are repeat operators managing several active escrows. They want certainty about *what is locked, when it releases, and what happens if something goes wrong*.
- **Arbiters and protocol admins.** Trusted role-holders resolving disputes, managing supported CCTP domains, adjusting protocol fees, and pausing deposits. They land in `/arbiter` and `/protocol` workspaces and need fast, unambiguous controls over operations that move real money. Role-gating is mechanical, but the surfaces should not feel like afterthoughts.

Context of use: desktop-first, wallet-connected, light by default (dark available via toggle, honoring stored preference). Users often arrive mid-transaction (from a Telegram reminder, an explorer link, or a counterparty's URL) and need to act in a single session.

## Product Purpose

Tranche Protocol is a milestone-based USDC escrow primitive on Arc Testnet, settling cross-chain via Circle CCTP V2. The product exists so that two parties can agree on work, lock funds upfront, and release them milestone-by-milestone with a credible dispute path — without trusting either party with the funds in flight.

The frontend's job is to make that primitive **legible and trustworthy enough to use**. Success is a first-time visitor who reads the landing, connects a wallet, and creates their first escrow with confidence. Every subsequent surface (dashboard, detail, arbiter, settings) should preserve that confidence as a daily operating tool.

This is on-chain financial infrastructure, presented as such. Not a fintech app dressed in crypto chrome, and not a degen UI dressed up as serious.

## Brand Personality

Three words: **bold, opinionated, primitive-grade.**

Voice and tone:

- Carries the weight of being an on-chain primitive. Reads more like Uniswap, Across, or Morpho than a SaaS dashboard.
- Editorial-typographic confidence over decorative chrome. Big, decisive type. Spare ornament. Mechanism on display.
- Plain language for anything involving money: fees, dispute windows, finality, refunds, CCTP path. No jargon used to project authority.
- Calm under pressure. Dispute and arbiter surfaces should feel composed, not alarmed.
- First-person plural is acceptable in marketing copy, but the app itself addresses the user in second person and never overpromises.

## Anti-references

Explicitly does NOT look like:

- **Neon-on-black DeFi casino.** No glow gradients, no animated rainbow accents, no "number go up" pump energy, no degen iconography.
- **Generic SaaS dashboard.** No indigo-accent-on-grey, no identical icon-plus-heading-plus-text card grids, no hero-metric template (big-number-small-label-supporting-stats), no rounded white cards on a soft-grey canvas.
- **Web3 dev-tools clone.** No lime/cyan terminal accents on pure black, no monospace-everything, no brutalist boxed grids posing as "on-chain serious." This aesthetic is currently saturated and would make the product look derivative.
- **Bank / legacy fintech.** No navy-and-gold, no stock-photo handshakes, no compliance-heavy density.

If a viewer could guess our aesthetic from the category alone ("on-chain escrow → black + neon green terminal"), we have failed the brief.

## Design Principles

1. **Primitive-grade, not product-suite.** Design like an on-chain primitive, not a SaaS app. Editorial typography and decisive layout do more work than chrome, illustrations, or gradients. If a screen looks generic with the logo removed, it's wrong.

2. **Trust is the conversion.** Every surface a first-time depositor sees should reduce ambiguity about *what is locked, when it releases, who can move it, and what happens on dispute*. Vague reassurance ("secure", "trusted") is weaker than visible mechanism.

3. **Show the mechanism, don't hide it.** Milestone state, dispute windows, CCTP path, protocol fees — surface them legibly. Progress bars are not a substitute for showing the actual state machine. Users handling money want to see how the gears move.

4. **Two audiences, one shell — both first-class.** End-user and arbiter/admin surfaces share visual language but earn their own affordances. Role-gated pages (`/arbiter`, `/protocol`) are not stripped-down forks of the dashboard; they're operator workspaces designed for the work being done.

5. **Plain language for money moves.** Disputes, fees, finality, refunds, silent approval, mint-recipient updates, CCTP forwarding — written in language a non-crypto-native can follow, without losing precision. Jargon used as a confidence-projection device is the failure mode.

## Accessibility & Inclusion

- **Target: WCAG 2.2 AA.** Full keyboard navigation, focus states visible on every interactive element, semantic landmarks, screen-reader-accurate labels on every form control and status badge.
- **Color never carries meaning alone.** Milestone states (`PENDING` / `FULFILLED` / `DISPUTED` / `RELEASED` / `REFUNDED`) and escrow states (`ACTIVE` / `COMPLETED` / `CANCELLED`) must be readable without color — pair with text labels, icons, or shape.
- **Reduced motion respected.** Honor `prefers-reduced-motion` for page transitions and incidental motion. Critical state changes can remain animated but never required for comprehension.
- **Tabular numerals for amounts.** USDC values, fees, and milestone counts use tabular figures so columns align and screen readers parse cleanly.
- **Wallet and address affordances.** Truncated addresses must remain copyable and screen-reader-readable; tooltips and address displays should not lock information behind hover-only states.
