# X-Ray Report

> Tranche Protocol | 831 nSLOC | d1f4da6 (`main`) | Foundry | 05/06/26

Analyzed branch: `main` at `d1f4da6`.

---

## 1. Protocol Overview

**What it does:** Milestone-based USDC escrow on Arc Testnet with an optimistic release flow, arbiter dispute resolution, and CCTP V2 cross-chain settlement.

- **Users**: A depositor (payer) locks USDC for a recipient (freelancer); an arbiter resolves disputes; admins configure fees/domains/pause.
- **Core flow**: `deposit` → recipient `claimDelivery` → depositor `approveRelease` or, after the review window, anyone `release` → funds burned via CCTP to the recipient's destination domain.
- **Key mechanism**: Per-milestone state machine with an optimistic "silence = consent" review window; cross-chain payout via Circle's CCTP V2 Forwarding Service.
- **Token model**: Single asset — USDC (Arc native precompile `0x3600…0000`). No protocol token, no shares.
- **Admin model**: OZ `AccessControl` with 5 roles (Arbiter, Fee, Domain, Pauser, Recovery) + `DEFAULT_ADMIN_ROLE`; no on-chain timelock or multisig.

For a visual overview of the protocol's architecture, see the [architecture diagram](architecture.svg).

### Contracts in Scope

| Subsystem | Key Contracts | nSLOC | Role |
|-----------|--------------|------:|------|
| Escrow core | TrancheProtocol.sol | 831 | Single monolith: deposit, milestone lifecycle, disputes, splits, refunds, CCTP burn, admin config |

Interfaces (`ITrancheProtocol`, `ITokenMessenger`) are out of scope.

### How It Fits Together

The core trick: each milestone is an independent optimistic-release state machine; the depositor's *silence* during a bounded review window is consent, and after it lapses anyone can permissionlessly settle.

### Deposit & snapshot

```
deposit()
 ├─ validate invoice / deadline / windows / milestone sum (G-1) / splits (G-5)
 ├─ usdc.safeTransferFrom(depositor → contract)   ← USDC locked
 ├─ write escrows / milestones / splits
 └─ snapshot escrowFeeBps, escrowTreasury, escrowCctpForwardFee   ← I-10 freezes economics
```

### Optimistic release

```
claimDelivery() [recipient]  → milestone IN_REVIEW, claimedAt set
 ├─ approveRelease() [depositor]  → instant
 └─ release() [anyone]  ◄── block.timestamp ≥ claimedAt + reviewWindow
        └─ _executeCCTPReleaseAmount()
             ├─ usdc.safeTransfer(treasury, fee)     ← fee on recipient share only (E-3)
             └─ _approveAndBurn() → tokenMessenger.depositForBurnWithHook()
```
*`release` ignores the caller's `maxFee` and burns at the deposit-time `escrowCctpForwardFee` snapshot.*

### Dispute resolution

```
raiseDispute() [depositor, ≤ claimedAt+reviewWindow]  → DISPUTED
 ├─ resolveDispute() [arbiter]      → _executePartialRelease(recipientBps)
 ├─ mutualSettle() [both, equal bps]→ _executePartialRelease(agreedBps)
 └─ resolveDisputeByTimeout() [anyone, ≥ raisedAt+14d] → fixed 50/50 split
```
*`_executePartialRelease` credits the refund portion to `refundBalances` and CCTP-burns the recipient portion.*

### Refund withdrawal

```
refundBalances[user]  (credited by refund / cancel / timeout / partial paths)
 → withdrawRefund()  ── destinationDomain==0 → usdc.safeTransfer (Arc)
                     └─ destinationDomain!=0 → _approveAndBurn (cross-chain)
```

---

## 2. Threat & Trust Model

### Protocol Threat Profile

> Protocol classified as: **Escrow / Milestone Payments (custom)** with **Bridge (CCTP cross-chain settlement)** characteristics.

Signals: deposit/lock + per-milestone release & refund accounting (escrow), a trusted dispute arbiter (role-gated settlement), and `depositForBurnWithHook` burn-and-relay to a destination domain (bridge). No oracle, AMM, lending, or share accounting. The dominant adversaries are the **counterparties themselves** gaming the dispute/release state machine, the **trusted arbiter**, and **CCTP fee/relay** failure modes inherited from the bridge dimension.

### Actors & Adversary Model

| Actor | Trust Level | Capabilities |
|-------|-------------|-------------|
| Depositor | Bounded (own escrows) | `deposit`, `raiseDispute`, `approveRelease`, half of `mutualSettle`/`mutualCancel`/`proposeMilestoneCancel`. Chooses recipient, splits, windows, destination. |
| Recipient | Bounded (own escrows) | `claimDelivery`, `updateReceivingAddress`, counter-evidence, half of mutual paths. |
| Arbiter | Trusted | `resolveDispute` sets any `recipientBps` 0–100% on a DISPUTED milestone, directing principal between CCTP burn and refund. Instant; **not** `whenNotPaused`. |
| Fee Manager | Trusted | `setProtocolFee` (≤5%, I-2), `setProtocolTreasury`, `setCctpForwardFee` (≤100 USDC, I-3). Instant; in-flight escrows protected by deposit snapshots (I-10). |
| Domain Manager | Trusted | `add`/`removeSupportedDomain`. Removal does not re-gate in-flight escrows (I-02 by design). |
| Pauser | Trusted | `pause`/`unpause` — gates `deposit` **only**; all settlement paths stay live during pause. |
| Recovery Manager | Bounded (two-step) | `proposeRefundCreditTransfer` — cannot move funds alone; target must self-claim (I-11). |
| Default Admin | Trusted (apex) | Grants/revokes every role, including granting itself Arbiter/Fee Manager. Single EOA, no timelock/multisig in code. |

**Adversary Ranking** (ordered for this protocol type):

1. **Malicious counterparty** — a depositor or recipient steering the dispute/review/cancel state machine to capture funds or strand the other side.
2. **Compromised/colluding arbiter** — holds unilateral 0–100% split power over any disputed milestone.
3. **CCTP fee griefer / relay failure** — attacks the permissionless release fee path; an under-quoted burn is attested but never minted.
4. **Compromised admin (Default Admin / Fee / Domain)** — role concentration with no timelock.
5. **MEV / boundary front-runner** — races permissionless `release` / `refundAfterDeadline` / timeout against party actions.

See [entry-points.md](entry-points.md) for the full permissionless entry point map.

### Trust Boundaries

- **Arbiter → disputed funds** — `resolveDispute:430` directs an entire milestone's principal by `recipientBps` with no bound beyond 0–100% and no delay/pause; the only floor is the cross-chain fee check. *Git signal: dispute system reworked in 32c4a95 + 5911454.*
- **Default Admin → all roles** — `grantRole` (inherited) lets one EOA assume Arbiter/Fee Manager; the single key is the effective root of trust. No timelock protects any operational action.
- **Deposit snapshots → fee economics** — `escrowFeeBps`/`escrowTreasury`/`escrowCctpForwardFee` freeze at `:297,319-320`, so fee-manager changes cannot rug in-flight escrows; the boundary holds only for already-deposited escrows.
- **Pause → deposits only** — `whenNotPaused` is on `deposit` alone (`:223`); a paused contract still releases/refunds, intentionally preventing censorship of delivered work.

### Key Attack Surfaces

- **Arbiter dispute-resolution authority** &nbsp;&#91;[I-5](invariants.md#i-5), [E-2](invariants.md#e-2)&#93; — `resolveDispute:430` + `_executePartialRelease:1179` let the arbiter split any DISPUTED milestone instantly; worth confirming the trust assumption and that the bps→amount→fee math and refund-credit bookkeeping can't be gamed across splits.

- **Permissionless release fee path** &nbsp;&#91;[I-3](invariants.md#i-3), [G-10](invariants.md#g-10)&#93; — `release:592` discards caller `maxFee` and burns at `escrowCctpForwardFee` (`:607`); worth confirming the snapshot floor stays ≥ Circle's live forwarding fee or the burn strands (recoverable only by self-relaying `receiveMessage`).

- **Review-window boundary race** &nbsp;&#91;[I-8](invariants.md#i-8)&#93; — at `block.timestamp == claimedAt + reviewWindow` both `raiseDispute:383` (`>` strict) and `release:598` (`>=`) pass; worth tracing whether a depositor dispute and a permissionless release can race in one block.

- **Split distribution & per-share fee scaling** &nbsp;&#91;[I-4](invariants.md#i-4), [G-9](invariants.md#g-9)&#93; — `_executeCCTPReleaseAmount:1244-1260` has the last split absorb dust and scales `cctpMaxFee` by each split's bps; worth checking the per-share `maxFee < burnAmount` relation holds for the smallest share.

- **Refund-credit re-keying & recovery** &nbsp;&#91;[I-11](invariants.md#i-11)&#93; — `transferRefundCredit:811`, `claimRefundCreditTransfer:854`, and `withdrawRefund:769` all move `refundBalances` by `msg.sender`; worth tracing that credit can't be double-counted across re-key, recovery, and withdraw.

- **State-machine completeness across cancel/refund paths** &nbsp;&#91;[I-6](invariants.md#i-6), [E-2](invariants.md#e-2)&#93; — `mutualCancel:668`, `proposeMilestoneCancel:713`, `refundAfterDeadline:626`, and the dispute paths all terminalize milestones; worth confirming no milestone reaches both RELEASED and REFUNDED.

- **Admin operational powers without timelock** — Default/Fee/Domain roles execute instantly (`setProtocolFee:184`, `setCctpForwardFee:199`, `removeSupportedDomain:179`, `grantRole`); pure access-control surface — review the off-chain key custody model.

### Protocol-Type Concerns

**As an Escrow / Milestone Payments protocol:**
- Sequential-ordering coupling: every refund/cancel/claim path re-checks `prev.state` terminal (G-8); a logic gap in any one path could let a middle milestone settle out of order — verify all five writers agree.
- `resolveDisputeByTimeout:509-545` hardcodes a 50/50 split and re-implements the split-distribution loop separately from `_executeCCTPReleaseAmount`; worth diffing the two loops for rounding/dust parity.

**As a Bridge (CCTP) protocol:**
- `_approveAndBurn:1270` uses a raw `approve` call (forceApprove is incompatible with the Arc precompile) and decodes the bool; worth confirming the non-standard return handling matches the precompile.
- All cross-chain delivery depends on Circle attestation + Forwarding Service; an under-fee burn (`forwardState: FAILED`) is the chief liveness risk on permissionless paths (see I-3 / G-10).

### Temporal Risk Profile

**Deployment & Initialization:**
- Roles are granted in the constructor (`:154-159`) to constructor args + `msg.sender`; `cctpForwardFee` defaults to **0**, so cross-chain `release` reverts (`CctpForwardFeeNotSet`, G-10) until a fee manager sets it — a benign-but-bricking initial state worth flagging in the runbook.
- Single-EOA `DEFAULT_ADMIN` + `FEE_MANAGER` + `RECOVERY_MANAGER` at deploy; the intended hand-off to the `0x2Fcbb…` operator is off-chain (no two-step transfer in code).

**Market Stress** *(liveness, not price — no oracle):*
- If Circle's live forwarding fee rises above a stale `escrowCctpForwardFee` snapshot, permissionless `release` burns strand mid-flight; the global floor must be kept current for the snapshot path.

### Composability & Dependency Risks

**Dependency Risk Map:**

> **Arc USDC precompile** — via `usdc.safeTransfer` / `safeTransferFrom` / raw `approve` (`_approveAndBurn:1291`)
> - Assumes: 6-decimal ERC-20; `approve` returns bool-or-empty; USDC is the native gas token on Arc.
> - Validates: raw-approve success + decoded bool (`:1294`); `SafeERC20` on transfers.
> - Mutability: upgradeable USDC proxy; can blacklist/freeze addresses (the M-03/M-06 recovery paths exist for exactly this).
> - On failure: revert (`UsdcApproveFailed`) or SafeERC20 revert.

> **Circle TokenMessengerV2** — via `tokenMessenger.depositForBurnWithHook` (`:1296`)
> - Assumes: accepts `maxFee < burnAmount`, finality threshold 2000 (Standard), and the `cctp-forward` hook triggers off-chain relay.
> - Validates: `maxFee < burnAmount` (G-9), non-zero floor for cross-chain (G-10), fixed `CCTP_MIN_FINALITY_THRESHOLD`.
> - Mutability: external Circle contract; behavior/fees governed by Circle.
> - On failure: burn may be attested but not minted (under-fee) — off-chain liveness failure, not an on-chain revert.

**Token Assumptions** *(unvalidated):*
- USDC blacklist/freeze: assumed possible but not preventable on-chain — mitigated only by the refund-credit re-key + two-step recovery paths.
- Fee-on-transfer / rebasing: not handled, but USDC is neither, so low risk for the single supported asset.

---

## 3. Invariants

> ### 📋 Full invariant map: **[invariants.md](invariants.md)**
>
> A dedicated reference file contains the complete invariant analysis — do not look here for the catalog.
>
> - **14 Enforced Guards** (`G-1` … `G-14`) — per-call preconditions with predicate / location / purpose
> - **11 Single-Contract Invariants** (`I-1` … `I-11`) — Conservation, Bound, StateMachine, Temporal
> - **0 Cross-Contract Invariants** — single-contract protocol; external CCTP/USDC trust lives in §2 Composability
> - **3 Economic Invariants** (`E-1` … `E-3`) — solvency, single-payout, fee-on-recipient-only
>
> The **On-chain=No** blocks are the high-signal ones: **I-8** (review-window boundary overlap) and **E-1** (solvency is emergent, not asserted — covered by 6 Foundry invariant handlers). Attack surfaces above cross-link directly into the relevant blocks.

---

## 4. Documentation Quality

| Aspect | Status | Notes |
|--------|--------|-------|
| README | Present | `README.md` — **stale**: describes the pre-redesign API (`fulfillCondition`, `signalDelivery`, `releaseAfterWindow`, `claimSilentApproval`, `FULFILLED` state) that no longer exists in the contract (now `claimDelivery`/`approveRelease`/`release`, `IN_REVIEW`). |
| NatSpec | ~3 tagged + dense inline | Thorough audit-trail comments (H-/M-/L- IDs) on most functions and constants. |
| Spec/Whitepaper | Partial | `DESIGN.md` is a frontend design system, not a protocol spec; `CLAUDE.md` is the de-facto protocol spec (per code). |
| Inline Comments | Thorough | Each guard cites the audit finding it closes; rationale is unusually well documented. |

Spec-derived claims are minimal; nearly all properties here are code-verified `(per code)`. README API names are **not** code-verified — treat as outdated.

---

## 5. Test Analysis

| Metric | Value | Source |
|--------|-------|--------|
| Test files | 13 | File scan (always reliable) |
| Test functions | 171 | File scan (always reliable) |
| Line coverage | 82.72% (src/TrancheProtocol.sol) | `forge coverage` |
| Branch coverage | 58.86% (src/TrancheProtocol.sol) | `forge coverage` |

177 tests pass (0 failed) across 10 suites.

### Test Depth

| Category | Count | Contracts Covered |
|----------|-------|-------------------|
| Unit | ~171 | TrancheProtocol (broad) |
| Stateless Fuzz | 12 | TrancheProtocol |
| Stateful Fuzz (Foundry) | 6 | TrancheProtocol (invariant handlers: monotonic, refundAfterDeadline, release, resolve, withdrawRefund) |
| Stateful Fuzz (Echidna) | 0 | none |
| Stateful Fuzz (Medusa) | 0 | none |
| Formal Verification (Certora/Halmos/HEVM) | 0 | none |
| Fork | 0 | none |

### Gaps

- **Branch coverage 58.9%** — ~41% of branches unexercised; the dispute/split/cross-chain permutations are the likely gap given their density.
- **No formal verification** (Certora/Halmos/HEVM) and **no Echidna/Medusa** — for a fund-custody state machine, encoding E-1 (solvency) and I-6 (one-shot milestone) as formal/long-run properties would raise assurance.
- **No fork tests** — CCTP burn is mocked (`MockTokenMessenger`); real Forwarding-Service fee/relay behavior is untested on-chain (consistent with testnet-only status).

---

## 6. Developer & Git History

> Repo shape: normal_dev — 11 source-touching commits of 61 total over 24 days (2026-05-11 → 2026-06-04); active, single-developer, audit-fix-driven history.

### Contributors

| Author | Commits | Source Lines (+/-) | % of Source Changes |
|--------|--------:|--------------------|--------------------:|
| macanthonyeke | 57 | +2307 / -554 | 100% |
| Macc 🐍 | 4 | (merge/identity alias) | ~0% |

### Review & Process Signals

| Signal | Value | Assessment |
|--------|-------|------------|
| Unique contributors | 2 (effectively 1) | Single-dev |
| Merge commits | 4 of 61 (7%) | PRs exist but self-merged — no independent peer review |
| Repo age | 2026-05-11 → 2026-06-04 | 24 days |
| Recent source activity (30d) | 11 source commits | Active right up to audit window |
| Test co-change rate | 100% | Every source-touching commit also changed tests (co-modification, not coverage) |

### File Hotspots

| File | Modifications | Note |
|------|-------------:|------|
| src/TrancheProtocol.sol | 6 | #1 churn — the entire protocol; prioritize review |
| src/interface/ITrancheProtocol.sol | 5 | Interface co-evolves with the contract |

### Security-Relevant Commits

| SHA | Date | Subject | Score | Key Signal |
|-----|------|---------|------:|------------|
| 5911454 | 2026-06-01 | Redesign post-deposit lifecycle (optimistic) + audit fixes + milestone cancel | 18 | rewrites access control, spans 5 security domains, >500 src lines |
| 8e0a9d7 | 2026-05-15 | Audit fixes: access control, dispute timeout, fee snapshot, CCTP maxFee bounds | 18 | tightens access control, fund_flows + signatures |
| f4a3eae | 2026-05-11 | Initial CrossChainEscrow V2 project | 15 | adds guards + access control, 893 lines |
| be085aa | 2026-05-16 | harden release floor, immutables, deploy polish | 11 | token transfer + accounting |
| acd1811 | 2026-06-02 | cross-chain withdrawRefund via CCTP + 72h grace | 10 | new fund-flow feature, spans 5 domains |
| dd83a86 | 2026-06-02 | Round-3 audit fixes: per-escrow fee snapshot, fee floors, array caps | 10 | bug fix, spans 5 domains |
| 32c4a95 | 2026-05-27 | Rework dispute system: partial resolution, fair timeout, mutual settle | 10 | accounting + 5 domains |

### Dangerous Area Evolution

| Security Area | Commits | Key Files |
|--------------|--------:|-----------|
| fund_flows | 8 | TrancheProtocol.sol, ITokenMessenger, ITrancheProtocol |
| signatures (auth handling) | 8 | TrancheProtocol.sol |
| access_control | 5 | TrancheProtocol.sol, ITrancheProtocol |
| state_machines | 5 | TrancheProtocol.sol |
| oracle_price* | 5 | TrancheProtocol.sol |

*\*The "oracle_price" tag is a heuristic match on fee/amount math; this protocol has no price oracle.*

### Forked Dependencies

| Library | Path | Upstream | Status | Notes |
|---------|------|----------|--------|-------|
| openzeppelin-contracts | lib/openzeppelin-contracts | OpenZeppelin | Submodule (not internalized) | Standard submodule; mixed pragmas are upstream's own — not a divergence to chase. |

### Security Observations

- **Single-developer codebase** — macanthonyeke authored 100% of source lines; bus-factor and review-blind-spot risk.
- **No independent peer review** — 4 merge commits but all self-authored; no second reviewer signal.
- **All churn in one file** — TrancheProtocol.sol is both the entire protocol and the #1 hotspot; defect density concentrates here.
- **Audit-fix-driven history** — three rounds of "audit fixes" (8e0a9d7, dd83a86, 32c4a95) plus a full lifecycle redesign (5911454) land in the 30 days before this scan.
- **Late high-impact change** — acd1811 (cross-chain `withdrawRefund` + 72h grace, 2026-06-02) is a fund-flow feature added days before deploy.
- **Stale README vs. code** — public docs describe a removed API surface; an auditor reading README first will mis-model the lifecycle.

### Cross-Reference Synthesis

- **TrancheProtocol.sol is #1 in churn AND holds every attack surface** → highest-leverage review targets: `resolveDispute`/`_executePartialRelease`, `release` fee path, and the cancel/refund state-machine writers.
- **The optimistic redesign (5911454) is the largest single security delta** → the review-window temporal logic (I-8 boundary overlap) and the new `claimDelivery → IN_REVIEW → release` edges are the freshest, least-settled code.
- **Round-3 snapshot fixes (dd83a86) created I-3/I-10** → per-escrow fee freezing is recent; verify the snapshot is read everywhere a fee/floor is applied (it is, at `:1225-1226`, `:1316-1320`).

---

## X-Ray Verdict

**ADEQUATE** — Roles and boundaries are clearly defined with deposit-time snapshots, and an extensive unit + fuzz + Foundry-invariant suite exists, but access control has no timelock/multisig in code and there is no formal verification.

**Structural facts:**
1. 831 nSLOC in a single contract (TrancheProtocol.sol); no proxy/upgradeability.
2. 25 protocol entry points — 6 permissionless, 10 escrow-party-gated, 9 admin/role — plus 3 inherited AccessControl admin functions.
3. 6 access-control roles + `DEFAULT_ADMIN_ROLE`, all on EOAs with no on-chain timelock or multisig.
4. 13 test files / 171 functions, 12 stateless-fuzz + 6 Foundry invariant handlers; 82.7% line / 58.9% branch coverage; 0 formal-verification specs.
5. Single developer authored 100% of source over 24 days, with 3 audit-fix rounds and a lifecycle redesign in the final month.
