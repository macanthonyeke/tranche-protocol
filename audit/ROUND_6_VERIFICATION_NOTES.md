# Round 6 Verification Notes

## Deployed vs Audited — Read First

- Live contract: `0xe27e0b1aba2ff3ef95bac061e36283c544d78503` (Arc testnet), deployed by commit `600f611`.
- The live bytecode is **NOT** identical to the audited tree (branch `audit/round-6`, HEAD `6f58254` at time of writing). One material difference: the live contract carries the DR-2 bug (`_assertCrossChainFee` only inspects `splits[0]`); the audited tree has the fix. See DR-2 below. A redeploy ships the fix.
- All other differences between deployed and audited are the intended Round 6 changes (invoice ack rebuild, `getDisputedEscrows` removal, Finding 3 divert, recovery expiry, high-bits guards, SE-1 / SE-5 fixes).

---

## Round 6 Verification Phase — Summary

Four Trail of Bits plugins were run in order against the Round 6 surface, followed by a post-verification confirmation pass with variant-analysis:

| Phase | Plugin | Result |
|-------|--------|--------|
| 1 | dimensional-analysis | 0 findings |
| 2 | sharp-edges | 6 findings — SE-1 / SE-5 fixed; SE-2 / SE-3 / SE-4 / SE-6 accepted as intentional |
| 3 | spec-to-code-compliance | Fully compliant; 5 coverage gaps closed (CF-1..CF-5) |
| 4 | differential-review | 2 off-manifest changes surfaced (DR-1, DR-2) |
| post | variant-analysis | 0 untreated variants across all 3 seeds; 1 by-design asymmetry (VA-1) accepted |

Final state: **264/264 tests, 14 suites, 23,722 bytes runtime, 854 under the 24,576 EIP-170 limit.**

---

## DR-1 — `withdrawRefund` full-amount burn (deliberate Round 6 fix, was undocumented)

- **Location:** `withdrawRefund` cross-chain path, `src/TrancheProtocol.sol`.
- **Change:** burn changed from `amount - maxFee` to full `amount`, with `maxFee` as a cap only (`RefundBelowMaxFee` guards `amount <= maxFee`, so `maxFee < amount` holds; H-04 satisfied).
- **Why:** the old form double-counted the CCTP forwarding fee (CCTP also deducts it on the destination) **and** stranded `maxFee` worth of USDC in the contract — the balance was zeroed but only `amount - maxFee` left. The new form mirrors the release path.
- **Lineage:** the `amount - maxFee` form dated to `acd18111` (Jun 2, original cross-chain `withdrawRefund` feature). Fixed in `6c3b55f` (Round 6). Deliberate and correct; simply not named in that commit's message.
- **Status:** fixed at HEAD, ships on next redeploy.

---

## DR-2 — `_assertCrossChainFee` split-scan (forge fmt 1.5.1 bug, LIVE in deployment)

- **Location:** `_assertCrossChainFee` split loop, `src/TrancheProtocol.sol`.
- **The bug:** forge fmt 1.5.1 (SHA `b0a9dd9`), run in commit `a4be251` ("style: forge fmt", the Round 6 baseline), stripped the braces off a single-line multi-statement if-body `if (cond) { crossChain = true; break; }`, hoisting `break;` **out** of the conditional. Result: the loop broke on iteration 0 unconditionally and `_assertCrossChainFee` only ever inspected `splits[0]`.
- **Reproduced deterministically:** running forge fmt 1.5.1 on the correct braced form (from `284fcd5`) produces the broken form byte-for-byte. This is a formatter bug — brace removal is only sound for single-statement bodies — **not** a developer edit. `a4be251` was a clean, honest fmt commit; the tool changed semantics under a formatting label.
- **Consequence:** a split escrow with an Arc leg **first** and a cross-chain leg **later** would skip the `maxFee >= escrowCctpForwardFee` floor check on `approveRelease` / `release`. A caller could pass an under-floor `maxFee`; the genuine cross-chain leg burns under-quoted, gets attested but never minted (`INSUFFICIENT_FEE`), stranding that leg (self-relayable but a real footgun).
- **Lineage:** correct at `284fcd5` → broken by forge fmt at `a4be251` → DEPLOYED by `600f611` to `0xe27e0b1aba2ff3ef95bac061e36283c544d78503` (the live contract carries the bug) → fixed in `6c3b55f` (explicit multi-line braces), committed but **not yet deployed**.
- **Blast radius:** verified two ways — the fmt commit `a4be251` contained exactly one multi-statement single-line block, and HEAD has exactly one `break` and zero hoisted conditionals. DR-2 is the **sole** victim of this formatter incident. No second latent victim in the tree or the deployed bytecode.
- **Status:** fixed at HEAD, **MUST ship on next redeploy** (this is the one live-contract bug fix in the round).

---

## forge fmt 1.5.1 hazard + mitigation

- forge fmt 1.5.1 can change control-flow semantics when stripping braces from a single-line multi-statement if-body. **Mitigation adopted:** never write `if (c) { A; B; }` on one line in this codebase — always use multi-line braces, leaving the formatter nothing to mis-strip. As of HEAD, `src/` contains zero at-risk blocks.
- **Process:** "style: forge fmt" / chore commits that touch control-flow lines get the same diff review as any other commit. A formatting label is not a semantics-preserving guarantee for this tool version.

---

## SE-2 note for AuditBase (cross-reference)

The `maxFee` split-vs-no-split asymmetry (no-split honors caller `maxFee` for H-04; split uses the `escrowCctpForwardFee` snapshot) is deliberate and pre-documented. See the existing `maxFee` asymmetry design note before the AuditBase call so it is not flagged as a fresh finding.

---

## VA-1 — resolveDispute vs mutualSettle maxFee asymmetry (variant-analysis, accepted)

Surfaced by variant-analysis (SEED 2). resolveDispute forwards the arbiter-supplied
maxFee into _assertCrossChainFee and _executePartialRelease; mutualSettle
deliberately substitutes the snapshot e.escrowCctpForwardFee instead. This
asymmetry is intentional, not an oversight:

- The arbiter value is bounded [snapshot, burnAmount): floored by _assertCrossChainFee
  (no under-quote) and capped below burn by H-04 (no full-payout consumption). It
  only reaches _approveAndBurn in the no-split case; the split branch ignores it and
  burns each leg at the snapshot.
- ARBITER_ROLE already sets _recipientBps directly (0..10000) and can route 100% away
  from the recipient. Any harm reachable via maxFee is strictly dominated by that
  existing intended power. A compromised arbiter is out-of-model by design.
- mutualSettle hardens against maxFee because its two completing parties are
  mutually-distrusting counterparties, either of whom could grief the other via fee
  choice — a real conflict of interest the snapshot neutralizes. resolveDispute has
  a single trusted neutral, so the substitution is unnecessary. Each path's maxFee
  treatment correctly reflects its own trust model.

Verdict: accepted, no code change.
