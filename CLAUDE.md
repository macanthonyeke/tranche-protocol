# Tranche Protocol — Claude Context

## What Tranche is

Invoice-based cross-chain USDC escrow on Arc (Circle's EVM L1), using Circle CCTP V2 for cross-chain settlement. Milestone-based trustless payments with on-chain dispute resolution, for freelancers/teams/DAOs. Stack: Solidity + Foundry, React/Vite/wagmi/Tailwind frontend, Goldsky subgraph, Telegram bot (viem/SQLite), Node.js deploy scripts.

---

## README Maintenance

README.md must stay in sync with the codebase. Whenever you 
make changes that affect any of the following, update README.md 
in the same session before committing:

- New or removed contract functions or events
- New or removed npm scripts in any package.json
- New or removed environment variables in any .env.example
- New or removed routes in the frontend
- New or removed directories or key files
- Changes to the deployment process or command names
- Changes to role definitions
- Subgraph version updates
- Test count changes (update the 275 tests figure)
- Contract size changes (update the 23,722 bytes figure)

When updating README.md:
- Check the relevant section and update it precisely
- Do not rewrite sections that were not affected
- Do not add files or directories that are build artifacts, 
  log files, editor config, or internal tooling 
  (.next/, out/, dist/, build/, *.log, .vscode/, etc.)
- Keep the writing style consistent with the existing README

---

## Current state

- Branch audit/round-6. 275 tests passing, 14 suites. Runtime 23,722 bytes (854 under the 24,576 EIP-170 limit).
- via_ir = true, optimizer_runs = 1 (confirmed optimal — runs=200 makes size WORSE via inlining bias).
- Live contract: `0x6bf5e723b5a542b8d49bedab7c8eb2791af00d3d` on Arc testnet (block 48857059). This redeploy ships the DR-2 fix. Supersedes `0xe27e0b1aba2ff3ef95bac061e36283c544d78503` (which carried the DR-2 bug).
- RECOVERY_MANAGER_ROLE hash: `0x926fb51ac9583c9ff853ed9f763f17034aa5e977d332565b8a7360cd393448b1`

---

## Current deployment

| Key | Value |
|-----|-------|
| Contract address | `0x6bf5e723b5a542b8d49bedab7c8eb2791af00d3d` |
| Deploy block | `48857059` |
| Chain | Arc Testnet (chain ID 5042002) |
| USDC | `0x3600000000000000000000000000000000000000` |
| TokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| Deployer | `0x179cc4c8f23d257b7f4acb785464025570e3af86` |
| Arbiter / Pauser / Treasury | `0x2Fcbb92566C51E92c1353d0a6a9AC86f10bb1a03` |
| Explorer | https://testnet.arcscan.app |
| Contract on explorer | https://testnet.arcscan.app/address/0x6bf5e723b5a542b8d49bedab7c8eb2791af00d3d |
| Source verified | Pending — run forge verify-contract for the new address (post-deploy step) |

---

## How to work in this repo

- Claude Code is the execution layer. Workflow on EVERY edit: read-first → show diff → wait for approval → apply → run full suite → report BEFORE any fix. One fix at a time, approval gate between each.
- Redeploy via `npm run full-gas` — NEVER `npm run full`. Deployer is the Circle MPC wallet; forge script cannot be used.
- Communicate tersely. Don't relitigate settled decisions.

---

## Deployment

**Always use `npm run full-gas`, never `npm run full`.**

Circle's API always runs `eth_estimateGas` — Arc Testnet's estimation enforces EIP-170 (24 KB runtime limit) even though the chain does not. The explicit-gas script bypasses estimation.

```sh
forge build
cd deploy
npm run full-gas   # deploy → setup → verify
```

After deploy, verify source on the explorer, sync the subgraph, then redeploy to Goldsky:
```sh
# 1. Verify on arcscan
forge verify-contract <CONTRACT_ADDRESS> src/TrancheProtocol.sol:TrancheProtocol \
  --chain-id 5042002 \
  --etherscan-api-key placeholder \
  --verifier blockscout \
  --verifier-url "https://testnet.arcscan.app/api" \
  --compiler-version "v0.8.24+commit.e11b9ed9" \
  --optimizer-runs 1 \
  --via-ir \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address,address,address)" \
    0x3600000000000000000000000000000000000000 \
    0x2Fcbb92566C51E92c1353d0a6a9AC86f10bb1a03 \
    0x2Fcbb92566C51E92c1353d0a6a9AC86f10bb1a03 \
    0x2Fcbb92566C51E92c1353d0a6a9AC86f10bb1a03 \
    0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA \
    0x2Fcbb92566C51E92c1353d0a6a9AC86f10bb1a03)

# 2. Sync indexer config + ABI, then build and deploy subgraph
cd indexer
npm run sync                                               # updates subgraph.yaml, networks.json, both ABI copies
npm run codegen && npm run build
~/.local/bin/goldsky subgraph deploy tranche-protocol/<next-version> --path .
# Then update VITE_GOLDSKY_ENDPOINT in frontend/.env and CLAUDE.md subgraph section

# 3. Set the CCTP forward fee (resets to 0 on every fresh deploy)
node setFee.js
```

### Bytecode size budget
EIP-170 limit is **24,576 bytes**. Current runtime is **23,722 bytes — 854 bytes under the limit** (as of 2026-06-26). Arc Testnet does not enforce EIP-170 at the chain level, but Circle's `eth_estimateGas` does — always deploy via `npm run full-gas`. The contract is at `optimizer_runs = 1` and `via_ir = true` — both already at maximum size-reduction settings. The bulk-read views (`getDashboard`, `getEscrowsForPayer`, `getEscrowsForFreelancer`) were removed permanently; the Goldsky subgraph is the only bulk-read path.

Every protocol constant is `internal constant` — no auto-generated public getters, none readable as a standalone getter via RPC. Dropping these getters is part of how the contract meets the EIP-170 budget:
`MAX_PROTOCOL_FEE`, `MAX_MILESTONES`, `MAX_SPLITS`, `MAX_CCTP_FORWARD_FEE`, `FORWARD_HOOK_DATA`, `CCTP_MIN_FINALITY_THRESHOLD`, `MIN_REVIEW_WINDOW`, `MAX_REVIEW_WINDOW`, `DELIVERY_GRACE_PERIOD`, `ARBITER_ROLE`, `PAUSER_ROLE`, `DOMAIN_MANAGER_ROLE`, `FEE_MANAGER_ROLE`, `RECOVERY_MANAGER_ROLE`, `ARC_DOMAIN`, `BPS_DENOMINATOR`, `ARBITER_WINDOW`.

How off-chain code reads these now:
- `arcDomain` → `getProtocolConfig().arcDomain` (the same call also returns treasury, protocolFeeBps, cctpForwardFee, escrowCount, paused).
- Role membership → `hasRole(role, account)` / `getCallerRoles(account)`.
- Role hashes → computed locally in tooling with `keccak256` (setup.js / verify.js do this; never read from a getter). `RECOVERY_MANAGER_ROLE` = `0x926fb51ac9583c9ff853ed9f763f17034aa5e977d332565b8a7360cd393448b1`.

Do NOT re-add a public getter without a byte-budget check.

---

## Hard constraints / hazards

- EIP-170: 24,576-byte runtime limit. Track size on EVERY addition.
- Public getters cost bytecode. ARC_DOMAIN, the role constants (ARBITER_ROLE, PAUSER_ROLE, DOMAIN_MANAGER_ROLE, FEE_MANAGER_ROLE), BPS_DENOMINATOR, ARBITER_WINDOW are all `internal constant` — NO auto-getters — to save size. Read arcDomain via getProtocolConfig().arcDomain; check roles via hasRole / getCallerRoles; compute role hashes locally with keccak256 in tooling. Do NOT add public getters back without a byte-budget check.
- forge fmt 1.5.1 HAZARD: deterministically strips braces off single-line multi-statement if-bodies and hoists statements out of the conditional (this caused DR-2). NEVER run forge fmt on this codebase. NEVER write `if (c) { A; B; }` on one line — always multi-line braces. "style/fmt/chore" commits touching control-flow get the same diff review as any other.
- Optimizer gotcha: adding a parameter to a multiply-called internal function (e.g. _executeCCTPReleaseAmount, 3 call sites) can flip the optimizer from share-one-copy to inline-everywhere, ~860 bytes for one bool param. Verify size after any signature change to a shared internal function.
- Arc USDC is a native precompile at 0x3600000000000000000000000000000000000000. SafeERC20 approve does NOT work — use low-level .call for approve. safeTransfer is fine for plain transfers.
- CCTP mintRecipient must be bytes32 left-padded with 12 zero bytes; raw 20-byte address reverts InvalidMintRecipient.

---

## Role assignments (current deploy)

| Role | Holder |
|------|--------|
| `DEFAULT_ADMIN_ROLE` | Deployer wallet |
| `ARBITER_ROLE` | `0x2Fcbb92566...` |
| `PAUSER_ROLE` | `0x2Fcbb92566...` |
| `DOMAIN_MANAGER_ROLE` | `0x2Fcbb92566...` |
| `FEE_MANAGER_ROLE` | Deployer + `0x2Fcbb92566...` |
| `RECOVERY_MANAGER_ROLE` | Deployer + `0x2Fcbb92566...` |

---

## Project structure

```
src/TrancheProtocol.sol       — main contract
src/interface/                — ITrancheProtocol, ITokenMessenger
test/                         — Foundry test suite (275 tests)
deploy/                       — Node.js deploy/setup/verify scripts
  deploy-explicit-gas.mjs     — bypasses Circle estimation (use this)
  setup.js                    — grants roles, adds domain, sets fee
  verify.js                   — reads and prints full contract state
frontend/                     — Vite + React + wagmi UI
bot/                          — Node.js listener/alerting bot
indexer/                      — Goldsky subgraph
```

---

## CCTP integration (selector ground truth, verified live)

- TokenMessenger proxy: `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` (EIP-1967 AdminUpgradableProxy).
- Verified impl: TokenMessengerV2 at `0xF07C0ad13178a9ef5c3fFA0Be69e0BECd452Bf6D`.
- We call exactly ONE CCTP fn: `depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)`, selector `0x779b432d` — byte-identical between our interface and the deployed impl. minFinalityThreshold is param #7, uint32 (NOT uint256). If Circle upgrades the proxy impl, diff the new impl ABI against this before assuming the call still dispatches.

---

## Subgraph (Goldsky)

| Key | Value |
|-----|-------|
| Endpoint | `https://api.goldsky.com/api/public/project_cmpuerrux1uoo01x8gljs18vq/subgraphs/tranche-protocol/0.5.2/gn` |
| Goldsky project | `project_cmpuerrux1uoo01x8gljs18vq` |
| Subgraph name/version | `tranche-protocol/0.5.2` |
| Network slug | `arc-testnet` |
| goldsky CLI | `~/.local/bin/goldsky` (not on PATH — use full path) |

The frontend reads from the subgraph only when `VITE_GOLDSKY_ENDPOINT` is set in `frontend/.env`; bulk reads (dashboard, arbiter queue) require Goldsky and throw if the endpoint is unset — there is no on-chain fallback. The endpoint is currently set.

**Current live version:** 0.5.2 — the new contract (`0x6bf5e723b5a542b8d49bedab7c8eb2791af00d3d`) with full event coverage, including the five gap-fix handlers (`EscrowDeclined`, `DeadlineExtended`, `ReceivingAddressUpdated`, `SplitReceivingAddressUpdated`, `CrossChainLegCreditedOnArc`) and the new `CrossChainLegCredit` entity.

Version lineage (for the record):
- `0.5.0` indexed the OLD contract (superseded; retained for now).
- `0.5.1` indexes the new contract with the pre-gap-fix handler set (retained as rollback fallback).
- `0.5.2` is the new contract with full event coverage — the live endpoint.
- `0.4.0` was deleted to free a Goldsky plan slot for the `0.5.2` deploy.

### Event handlers (live mapping — 0.5.2; rows tagged *(0.5.0)* / *(0.5.2)* mark the version each handler was added in)

| Event | Handler | Effect |
|-------|---------|--------|
| `EscrowCreated` | `handleEscrowCreated` | Creates Escrow entity |
| `EscrowTermsSnapshotted` | `handleEscrowTermsSnapshotted` | Sets fee snapshot |
| `SplitConfigured` / `SplitsConfigured` | split handlers | Creates Split entities |
| `DeliveryClaimed` | `handleDeliveryClaimed` | Milestone → FULFILLED, sets reviewDeadline |
| `MilestoneApproved` | `handleMilestoneApproved` | Milestone → RELEASED, settledVia=APPROVED |
| `MilestoneReleased` | `handleMilestoneReleased` | Milestone → RELEASED, settledVia=RELEASED_NO_DISPUTE |
| `MilestoneCancelled` | `handleMilestoneCancelled` | Milestone → REFUNDED, settledVia=MILESTONE_CANCELLED |
| `RefundedAfterDeadline` | `handleRefundedAfterDeadline` | Milestone → REFUNDED, settledVia=REFUNDED_AFTER_DEADLINE |
| `DisputeRaised` | `handleDisputeRaised` | Milestone → DISPUTED, creates Dispute |
| `CounterEvidenceSubmitted` | `handleCounterEvidenceSubmitted` | Updates Dispute |
| `DisputeResolved` | `handleDisputeResolved` | Milestone → RELEASED, settledVia=DISPUTE_RESOLVED |
| `DisputeTimedOutSettled` | `handleDisputeTimedOutSettled` | Milestone → RELEASED, settledVia=DISPUTE_TIMEOUT |
| `MutualSettlementExecuted` | `handleMutualSettlementExecuted` | Milestone → RELEASED, settledVia=MUTUAL_SETTLEMENT |
| `EscrowRefundedViaMutualCancel` | `handleEscrowRefundedViaMutualCancel` | Escrow → CANCELLED |
| `PartialRefundCredited` | `handlePartialRefundCredited` | Updates RefundBalance + RefundCredit |
| `RefundWithdrawn` | `handleRefundWithdrawn` | Decrements RefundBalance |
| `RefundCreditTransferred` | `handleRefundCreditTransferred` | Moves balance between wallets |
| `EvidenceAppended` | `handleEvidenceAppended` | Creates EvidenceEntry (immutable) |
| `InvoiceSnapshotted` | `handleInvoiceSnapshotted` | Sets Escrow.invoiceData, invoiceNumber, titles |
| `InvoiceAcknowledged` *(0.5.0)* | `handleInvoiceAcknowledged` | Sets Escrow.invoiceAcknowledgedAt + invoiceAcknowledgedBy |
| `InvoiceURIUpdated` *(0.5.0)* | `handleInvoiceURIUpdated` | Creates InvoiceURIUpdate entity, updates Escrow.invoiceURI |
| `EscrowDeclined` *(0.5.2)* | `handleEscrowDeclined` | Escrow → CANCELLED (recipient decline) |
| `DeadlineExtended` *(0.5.2)* | `handleDeadlineExtended` | Sets Escrow.deadline to the new value |
| `ReceivingAddressUpdated` *(0.5.2)* | `handleReceivingAddressUpdated` | Updates Escrow.mintRecipient + destinationDomain (single-recipient redirect) |
| `SplitReceivingAddressUpdated` *(0.5.2)* | `handleSplitReceivingAddressUpdated` | Updates Split.mintRecipient + destinationDomain (split redirect; Split now mutable) |
| `CrossChainLegCreditedOnArc` *(0.5.2)* | `handleCrossChainLegCreditedOnArc` | Creates CrossChainLegCredit (immutable ledger; SE-3 divert-to-Arc) |

Note: `EscrowReleased` and `EscrowRefunded` are in the ABI but never emitted by the current contract — their handlers were removed. Other emitted-but-unindexed events (admin config, role/pause infra, proposal/`ProtocolFeeCollected`) are intentionally not handled.

---

## Key design notes

- **Optimistic release**: recipient calls `claimDelivery`, depositor has a review window to dispute; after the window anyone can permissionlessly `release`.
- **CCTP V2 cross-chain**: releases/refunds to non-Arc addresses use Circle's Forwarding Service (the `cctp-forward` hook auto-mints on the destination). `cctpForwardFee` is the on-chain **floor**; it is currently set to `200000` (0.20 USDC). It is *not* the real fee — see the live-fee note below.
- **Cross-chain `maxFee` must be a live Circle quote** (critical): a burn whose `maxFee` is below Circle's live forwarding fee is *attested but never minted* — Iris returns `forwardState: FAILED / forwardErrorCode: INSUFFICIENT_FEE`. The on-chain `cctpForwardFee` is only the floor `_assertCrossChainFee` enforces. The frontend quotes the real fee immediately before `approveRelease`/`release`/`mutualSettle`/`resolveDispute` via `frontend/src/utils/cctpFee.js` (`resolveMaxFee`), calling `GET https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/{src}/{dst}?forward=true` and taking the `finalityThreshold: 2000` tier's `forwardFee.high`. Never pass the static `config.cctpForwardFee` as `maxFee`. Caveat: permissionless `release()` ignores the caller's `maxFee` and burns at the deposit-time `escrowCctpForwardFee` snapshot, so the global floor must stay ≥ Circle's live fee for that path to auto-deliver. A burn stranded by an under-quote is recoverable by self-relaying `receiveMessage(message, attestation)` on the destination's MessageTransmitterV2 (`destinationCaller = 0x0`, so anyone can relay).
- **Fee snapshot**: `escrowFeeBps`, `escrowTreasury`, and `escrowCctpForwardFee` are snapshotted at deposit so admin changes don't retroactively affect in-flight escrows.
- **`DELIVERY_GRACE_PERIOD` = 72 hours**: recipient can still claim delivery up to 72 h after the nominal deadline; depositor's `refundAfterDeadline` only opens after this grace period elapses.

---

## Settled decisions — DO NOT RELITIGATE

1. Finding 3 divert yardstick = snapshot (e.escrowCctpForwardFee), NEVER caller cctpMaxFee. (Using cctpMaxFee regresses H-04 on full releases.)
2. acknowledgeInvoice deliberately NOT pausable — release precondition, pausing would be a censorship lever.
3. Only claimDelivery is ack-gated. release/approveRelease/dispute/refundAfterDeadline are deliberately NOT ack-gated.
4. Recovery = Option A: authorize-a-destination, full-balance sweep intentional, 14-day expiry is the safety mechanism.
5. Role inheritance / wallet reassignment = rejected. Phase 2 Turnkey solves at the account layer.
6. CCTP forwarding fee = pure snapshot (not hybrid max(snapshot, live)). If Circle fees become volatile, correct fix is an optional refreshEscrowFee(escrowId).
7. maxFee asymmetry (SE-2/VA-1): no-split honors caller cctpMaxFee so H-04 catches abusive fees; split legs + mutualSettle + resolveDispute-on-splits all burn at the e.escrowCctpForwardFee snapshot (F1 per-leg floor). Intentional — different trust models.
8. Fast CCTP transfer not needed for this use case.

---

## Audit status — COMPLETE

Sequence: Pashov → Trail of Bits (6 plugins) → OpenZeppelin (develop-secure-contracts, OZ 5.6.1) → web3-audit pattern DB → live CCTP selector check. ALL clean, zero actionable findings. Full notes: audit/ROUND_6_VERIFICATION_NOTES.md.

---

## Accepted findings (no code change — feed to any future auditor up front)

- SE-2 / VA-1: maxFee split-vs-no-split asymmetry (see settled #7).
- SE-3: Finding 3 silent divert-to-Arc is intentional (the divert IS Finding 3).
- SE-4: split divert credits decoded mintRecipient as an Arc address; non-EVM recipients may strand sub-$0.20 dust. README known-limitation.
- SE-6: no on-chain URI↔invoiceHash binding; not enforceable on-chain. SE-1 freeze covers the post-ack half.
- DR-1: withdrawRefund full-amount burn — deliberate correct fix.
- A-1: single-step DEFAULT_ADMIN_ROLE transfer — accepted per settled #5.
- A-2: renounce-able sole ARBITER_ROLE — cannot strand funds (resolveDisputeByTimeout settles permissionlessly after ARBITER_WINDOW).

---

## Open FRONTEND follow-ups (not contract, not blocking)

- SE-3: frontend should listen for CrossChainLegCreditedOnArc and surface "small leg credited on Arc, withdraw here."
- SE-6: frontend should hash the doc at invoiceURI and verify it equals invoiceHash before letting the recipient acknowledge.
