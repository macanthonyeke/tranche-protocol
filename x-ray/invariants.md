# Invariant Map

> Tranche Protocol | 14 guards | 13 inferred | 2 not enforced on-chain

---

## 1. Enforced Guards (Reference)

Per-call preconditions. Heading IDs below (`G-N`) are anchor targets from x-ray.md attack surfaces.

#### G-1
`if (sum != _totalAmount) revert MilestoneAmountMismatch()` · `TrancheProtocol.sol:262` · Pins the principal: the milestone schedule must add up to the USDC actually pulled in, so no path can release/refund more than was deposited.

#### G-2
`if (_newFeeBps > MAX_PROTOCOL_FEE) revert FeeTooHigh()` · `TrancheProtocol.sol:185` · Caps the protocol fee at 5% so a fee manager cannot confiscate releases via an arbitrary fee.

#### G-3
`if (fee > MAX_CCTP_FORWARD_FEE) revert CctpForwardFeeTooHigh()` · `TrancheProtocol.sol:202` · Bounds the forwarding fee (≤100 USDC) so a fat-finger/compromised fee manager cannot set a fee that bricks the permissionless release paths.

#### G-4
`if (_recipientBps > BPS_DENOMINATOR) revert InvalidBps()` · `TrancheProtocol.sol:446` (also `:473`) · Keeps a dispute settlement split within 0–100%, so recipient + refund shares of a milestone never exceed its amount.

#### G-5
`if (sumBps != BPS_DENOMINATOR) revert BpsSumMismatch()` · `TrancheProtocol.sol:1359` · Forces split recipients to cover exactly 100% of a release, preventing under/over-distribution of milestone funds.

#### G-6
`if (_reviewWindow < MIN_REVIEW_WINDOW) ... > MAX_REVIEW_WINDOW` · `TrancheProtocol.sol:228-229` · Bounds the optimistic review window to [1d, 7d] so neither party can configure an abusive dispute timer.

#### G-7
`if (_milestoneAmounts.length > MAX_MILESTONES) ... _splits.length > MAX_SPLITS` · `TrancheProtocol.sol:237-238` · Caps the iterated arrays (20 / 10) so no release/completion loop can be pushed past the block gas limit and strand the escrow.

#### G-8
`if (prev.state != RELEASED && prev.state != REFUNDED) revert PreviousMilestoneNotComplete()` · `TrancheProtocol.sol:351` (also `:642`, `:725`) · Enforces forward-only, one-terminal-at-a-time milestone ordering across claim / refund / cancel paths.

#### G-9
`if (cctpMaxFee >= burnAmount) revert MaxFeeExceedsBurnAmount()` · `TrancheProtocol.sol:1285` · Bounds the per-burn maxFee strictly below the amount so Circle's forwarder cannot consume the entire payout.

#### G-10
`if (maxFee < e.escrowCctpForwardFee) revert MaxFeeBelowFloor()` (and `if (e.escrowCctpForwardFee == 0) revert CctpForwardFeeNotSet()`) · `TrancheProtocol.sol:1319-1320` · Cross-chain releases must clear the per-escrow forwarding-fee floor, or the burn is attested but never auto-minted.

#### G-11
`if (msg.sender != e.recipient) revert NotRecipient()` · `TrancheProtocol.sol:342` · Only the recipient can start a milestone's review clock via claimDelivery.

#### G-12
`if (msg.sender != e.depositor) revert NotEscrowOwner()` · `TrancheProtocol.sol:378` (raiseDispute), `:571` (approveRelease) · Only the depositor can object to or instantly approve a claimed milestone.

#### G-13
`if (_milestoneAmounts[i] <= cctpForwardFee) revert MilestoneBelowForwardFee()` · `TrancheProtocol.sol:272` · For cross-chain escrows every milestone must out-size the forwarding fee, or its burn share could never satisfy the `fee ≤ maxFee < burnAmount` band.

#### G-14
`if (amount <= maxFee) revert RefundBelowMaxFee()` · `TrancheProtocol.sol:789` · A cross-chain refund withdrawal must exceed the forwarding fee so a positive amount actually mints on the destination.

---

## 2. Inferred Invariants (Single-Contract)

#### I-1

`Conservation` · On-chain: **Yes**

> For every escrow, `Σ milestones[id][i].amount == escrows[id].totalAmount`.

**Derivation** — guard-lift: `if (sum != _totalAmount) revert MilestoneAmountMismatch()` (`:262`) over the loop `sum += _milestoneAmounts[i]` (`:257-261`); `milestone.amount` is written only at deposit (`:301`) and never mutated thereafter (only `.state` / `.claimedAt` change).

**If violated** — total disbursable across milestones would diverge from locked principal, breaking solvency.

---

#### I-2

`Bound` · On-chain: **Yes**

> `protocolFeeBps ∈ [0, MAX_PROTOCOL_FEE]` (≤500 bps).

**Derivation** — guard-lift: `if (_newFeeBps > MAX_PROTOCOL_FEE) revert FeeTooHigh()` (`setProtocolFee:185`); only other write site is the constructor (`:152`, sets 199). Both writers respect the bound.

**If violated** — releases could pay an arbitrary protocol fee.

---

#### I-3

`Bound` · On-chain: **Yes**

> `cctpForwardFee ∈ [0, MAX_CCTP_FORWARD_FEE]` (≤100e6).

**Derivation** — guard-lift: `if (fee > MAX_CCTP_FORWARD_FEE) revert CctpForwardFeeTooHigh()` (`setCctpForwardFee:202`); the only writer (constructor leaves it 0). 

**If violated** — a fee above a milestone's burn share would brick the permissionless release paths.

---

#### I-4

`Bound` · On-chain: **Yes**

> For any escrow with splits, `Σ splits[id][i].bps == BPS_DENOMINATOR` (10000).

**Derivation** — guard-lift: `if (sumBps != BPS_DENOMINATOR) revert BpsSumMismatch()` (`_validateSplits:1359`) at deposit; `splits[].bps` is never mutated afterward (`updateSplitReceivingAddress` rewrites only `mintRecipient`/`destinationDomain`, `:934-935`).

**If violated** — a release would distribute more or less than the milestone's net amount.

---

#### I-5

`Bound` · On-chain: **Yes**

> A dispute/mutual settlement recipient share `recipientBps ≤ BPS_DENOMINATOR`.

**Derivation** — guard-lift: `if (_recipientBps > BPS_DENOMINATOR) revert InvalidBps()` (`resolveDispute:446`, `mutualSettle:473`); consumed immediately by `_executePartialRelease` (`recipientAmount = amount*bps/DENOM`, `:1188`).

**If violated** — recipient + refund shares could exceed the milestone amount.

---

#### I-6

`StateMachine` · On-chain: **Yes**

> Milestone state is forward-only: `PENDING → IN_REVIEW → {RELEASED | DISPUTED | REFUNDED}`, `DISPUTED → {RELEASED | REFUNDED}`; `RELEASED` / `REFUNDED` are terminal with no out-edges.

**Derivation** — edge: `require(m.state == PENDING); m.state = IN_REVIEW` (`claimDelivery:344,357`); `IN_REVIEW → DISPUTED` (`raiseDispute:379,398`); `IN_REVIEW → RELEASED` (`approveRelease:572,575` / `release:597,610`); `DISPUTED → RELEASED|REFUNDED` (`_executePartialRelease:1191-1194`); `PENDING/IN_REVIEW → REFUNDED` (cancel/refund paths). No edge writes a terminal state back to a live one.

**If violated** — a milestone could be paid out more than once.

---

#### I-7

`StateMachine` · On-chain: **Yes**

> Escrow state: `ACTIVE → {COMPLETED | CANCELLED}`, both terminal.

**Derivation** — edge: `_checkEscrowCompletion` sets `COMPLETED` only when all milestones are terminal (`:660-665`); `mutualCancel` sets `CANCELLED` (`:696`) guarded by `e.state == ACTIVE` (`:672`). No path leaves a terminal escrow.

**If violated** — a completed/cancelled escrow could re-enter active flows.

---

#### I-8

`Temporal` · On-chain: **No**

> The review window should partition dispute vs. permissionless release: a milestone is disputable until `claimedAt + reviewWindow` and releasable after it — with no instant where both are open.

**Derivation** — temporal: `raiseDispute` reverts only when `block.timestamp > m.claimedAt + e.reviewWindow` (`:383`); `release` reverts only when `block.timestamp < m.claimedAt + e.reviewWindow` (`:598`). At `block.timestamp == claimedAt + reviewWindow` **both** predicates pass.

**If violated** — at the exact boundary timestamp a depositor `raiseDispute` and a permissionless `release` are simultaneously callable in the same block.

---

#### I-9

`Temporal` · On-chain: **Yes**

> Delivery grace partition: a milestone is claimable until `deadline + DELIVERY_GRACE_PERIOD` and deadline-refundable only strictly after it.

**Derivation** — temporal: `claimDelivery` reverts when `block.timestamp > e.deadline + DELIVERY_GRACE_PERIOD` (`:347`); `refundAfterDeadline` reverts when `block.timestamp <= e.deadline + DELIVERY_GRACE_PERIOD` (`:636`). The strict `<=` on the refund side makes the two windows disjoint.

**If violated** — a depositor could front-run a still-valid late delivery claim with a deadline refund.

---

#### I-10

`Conservation` · On-chain: **Yes**

> `escrowFeeBps[id]` and `escrowTreasury[id]` equal the global fee/treasury at deposit and are immutable thereafter (≤ MAX via I-2).

**Derivation** — Δ-pair: snapshot writes at `:319-320` inside `deposit`; no other write site for either mapping. Releases read the snapshot (`_executeCCTPReleaseAmount:1225-1226`), never the live global.

**If violated** — an admin fee/treasury change would retroactively alter in-flight escrow economics.

---

#### I-11

`StateMachine` · On-chain: **Yes**

> `pendingRefundRecovery[wallet]` is a propose→claim latch: set by a recovery manager, consumed only by the proposed address.

**Derivation** — edge: `pendingRefundRecovery[blacklistedWallet] = newOwner` (`proposeRefundCreditTransfer:844`) → `require(msg.sender == proposed); delete pendingRefundRecovery[...]` (`claimRefundCreditTransfer:857,864`). Re-proposing overwrites; only the proposed wallet can complete.

**If violated** — a recovery manager could unilaterally redirect and withdraw another wallet's credit (the M-03 single-step bug).

---

**Categories:**
- **Conservation**: equal-and-opposite (or snapshot-and-freeze) storage writes implying `A == Σ B[key]` / `A = const`.
- **Bound**: a guard on a storage variable lifted to a global property and enforced at every write site.
- **Ratio**: a storage variable defined as a formula of other storage variables.
- **StateMachine**: discrete transitions with no reverse path.
- **Temporal**: a condition tied to `block.timestamp` / a stored deadline or window.

---

## 3. Inferred Invariants (Cross-Contract)

No in-scope cross-contract invariants. Tranche Protocol is a single contract; its only external calls are to the Arc **USDC** precompile (`transfer` / `transferFrom` / raw `approve`) and Circle's **TokenMessengerV2** (`depositForBurnWithHook`), both outside the scope files. The trust assumptions on those callees are documented in x-ray.md §2 *Composability & Dependency Risks* rather than as `X-N` blocks (per the both-sides-in-scope rule).

---

## 4. Economic Invariants

#### E-1

On-chain: **No**

> Protocol solvency: `usdc.balanceOf(TrancheProtocol) ≥ Σ refundBalances + Σ (amount of every non-terminal milestone)`.

**Follows from** — `I-1` (milestone sum = principal) + `I-6` (each milestone disbursed once) + refund-credit accounting (`refundBalances += ...` on every refund/partial path).

**If violated** — the contract could not honor all outstanding refund credits and undelivered milestones simultaneously.

*(Not asserted in contract; covered by the 6 Foundry invariant handlers — see x-ray.md §5.)*

---

#### E-2

On-chain: **Yes**

> Each milestone's principal is disbursed at most once across all release/refund/cancel paths.

**Follows from** — `I-6` (terminal `RELEASED`/`REFUNDED` states have no out-edge) + the entry-state guards on every settlement path (`m.state == IN_REVIEW` / `== DISPUTED` / `== PENDING`).

**If violated** — double-spend of a single milestone's funds.

---

#### E-3

On-chain: **Yes**

> The protocol fee is charged only on the recipient's released portion, never on refunds.

**Follows from** — `I-1` + fee math in `_executeCCTPReleaseAmount:1227` (fee on `releaseAmount` only) and `resolveDisputeByTimeout:516` (fee on `recipientShare` only); all refund paths credit `refundBalances` with no fee deduction.

**If violated** — depositors would be charged a fee on returned funds.
