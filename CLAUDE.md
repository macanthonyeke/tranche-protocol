# Tranche Protocol — Claude Context

## What this project is

Tranche Protocol V2 is an on-chain escrow protocol on Circle's Arc Testnet. Payments are milestone-based USDC escrows with an optimistic release flow, arbiter dispute resolution, and CCTP V2 cross-chain refunds. The stack is: Solidity (Foundry), a Node.js bot, a Vite/React frontend, and a Goldsky subgraph indexer.

---

## Current deployment

| Key | Value |
|-----|-------|
| Contract address | `0x5e477f506aac4c2b422e769fdfbffafa939f5107` |
| Deploy block | `46357272` |
| Chain | Arc Testnet (chain ID 5042002) |
| USDC | `0x3600000000000000000000000000000000000000` |
| TokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| Deployer | `0x179cc4c8f23d257b7f4acb785464025570e3af86` |
| Arbiter / Pauser / Treasury | `0x2Fcbb92566C51E92c1353d0a6a9AC86f10bb1a03` |
| Explorer | https://testnet.arcscan.app |
| Contract on explorer | https://testnet.arcscan.app/address/0x5e477f506aac4c2b422e769fdfbffafa939f5107 |
| Source verified | Yes (Blockscout, 2026-06-09) |

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
EIP-170 limit is **24,576 bytes**. **The contract currently exceeds this limit: runtime size is 25,689 bytes (1,113 bytes over).** Arc Testnet does not enforce EIP-170 at the chain level — deployment succeeds via `npm run full-gas` because Circle's `eth_estimateGas` enforcement is bypassed by the explicit-gas script. **Do not rely on Circle's estimation path (`npm run full`) for this contract.** To bring the contract back under the limit, options include: removing the `splitsLength` view (duplicates `getSplits(id).length`), making additional constants `internal`, or inlining small helpers. The contract is at `optimizer_runs = 1` and `via_ir = true` — both already at maximum size-reduction settings.

Constants that are `internal` (no public getter, not readable via RPC):
`MAX_PROTOCOL_FEE`, `MAX_MILESTONES`, `MAX_SPLITS`, `MAX_CCTP_FORWARD_FEE`, `FORWARD_HOOK_DATA`, `CCTP_MIN_FINALITY_THRESHOLD`, `MIN_REVIEW_WINDOW`, `MAX_REVIEW_WINDOW`, `DELIVERY_GRACE_PERIOD`, `RECOVERY_MANAGER_ROLE`

`RECOVERY_MANAGER_ROLE` is internal — its keccak256 hash (`0x926fb51ac9583c9ff853ed9f763f17034aa5e977d332565b8a7360cd393448b1`) is hardcoded directly in `deploy/setup.js` and `deploy/verify.js`.

Constants that must stay `public` (read by setup/verify scripts or frontend):
`ARBITER_ROLE`, `PAUSER_ROLE`, `DOMAIN_MANAGER_ROLE`, `FEE_MANAGER_ROLE`, `ARC_DOMAIN`, `BPS_DENOMINATOR`, `ARBITER_WINDOW`.

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
test/                         — Foundry test suite (237 tests)
deploy/                       — Node.js deploy/setup/verify scripts
  deploy-explicit-gas.mjs     — bypasses Circle estimation (use this)
  setup.js                    — grants roles, adds domain, sets fee
  verify.js                   — reads and prints full contract state
frontend/                     — Vite + React + wagmi UI
bot/                          — Node.js listener/alerting bot
indexer/                      — Goldsky subgraph
```

---

## Subgraph (Goldsky)

| Key | Value |
|-----|-------|
| Endpoint | `https://api.goldsky.com/api/public/project_cmpuerrux1uoo01x8gljs18vq/subgraphs/tranche-protocol/0.4.0/gn` |
| Goldsky project | `project_cmpuerrux1uoo01x8gljs18vq` |
| Subgraph name/version | `tranche-protocol/0.4.0` |
| Network slug | `arc-testnet` |
| goldsky CLI | `~/.local/bin/goldsky` (not on PATH — use full path) |

The frontend reads from the subgraph only when `VITE_GOLDSKY_ENDPOINT` is set in `frontend/.env`; it falls back to on-chain reads otherwise. The endpoint is currently set.

### Event handlers (current mapping)

| Event | Handler | Effect |
|-------|---------|--------|
| `EscrowCreated` | `handleEscrowCreated` | Creates Escrow entity |
| `MilestoneTitles` | `handleMilestoneTitles` | Sets Escrow.titles (string[] of per-milestone titles) |
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

Note: `EscrowReleased` and `EscrowRefunded` are in the ABI but never emitted by the current contract — their handlers were removed.

---

## Key design notes

- **Optimistic release**: recipient calls `claimDelivery`, depositor has a review window to dispute; after the window anyone can permissionlessly `release`.
- **CCTP V2 cross-chain**: releases/refunds to non-Arc addresses use Circle's Forwarding Service (the `cctp-forward` hook auto-mints on the destination). `cctpForwardFee` is the on-chain **floor**; it is currently set to `200000` (0.20 USDC). It is *not* the real fee — see the live-fee note below.
- **Cross-chain `maxFee` must be a live Circle quote** (critical): a burn whose `maxFee` is below Circle's live forwarding fee is *attested but never minted* — Iris returns `forwardState: FAILED / forwardErrorCode: INSUFFICIENT_FEE`. The on-chain `cctpForwardFee` is only the floor `_assertCrossChainFee` enforces. The frontend quotes the real fee immediately before `approveRelease`/`release`/`mutualSettle`/`resolveDispute` via `frontend/src/utils/cctpFee.js` (`resolveMaxFee`), calling `GET https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/{src}/{dst}?forward=true` and taking the `finalityThreshold: 2000` tier's `forwardFee.high`. Never pass the static `config.cctpForwardFee` as `maxFee`. Caveat: permissionless `release()` ignores the caller's `maxFee` and burns at the deposit-time `escrowCctpForwardFee` snapshot, so the global floor must stay ≥ Circle's live fee for that path to auto-deliver. A burn stranded by an under-quote is recoverable by self-relaying `receiveMessage(message, attestation)` on the destination's MessageTransmitterV2 (`destinationCaller = 0x0`, so anyone can relay).
- **Fee snapshot**: `escrowFeeBps`, `escrowTreasury`, and `escrowCctpForwardFee` are snapshotted at deposit so admin changes don't retroactively affect in-flight escrows.
- **`DELIVERY_GRACE_PERIOD` = 72 hours**: recipient can still claim delivery up to 72 h after the nominal deadline; depositor's `refundAfterDeadline` only opens after this grace period elapses.
