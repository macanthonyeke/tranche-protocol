# Tranche Protocol indexer (Goldsky subgraph)

Indexes Tranche Protocol events on **Arc testnet** and exposes a GraphQL API so
the frontend stops depending on the contract's looping view functions
(`getDashboard`, `getDisputedEscrows`, `getEscrowsForPayer/Freelancer`,
`_collectByParticipant`), which scan every escrow per `eth_call` and will hit the
gas limit as the protocol grows. Single-escrow reads stay on-chain.

Goldsky supports Arc via the Arc Builders Fund (Subgraphs + Turbo).

## Resolved config (already wired into `subgraph.yaml` / `networks.json`)

| Field | Value | Source |
|---|---|---|
| Contract (proxy) | `0xc6dadd5f4df5089ab4878387aaf44e4d42919765` | `deploy/.env` `CONTRACT_ADDRESS` (matches `frontend/.env`) |
| Chain id | `5042002` | `broadcast/`, `deploy/verify.js` |
| Network slug | `arc-testnet` | `deploy/verify.js` — **see caveat below** |
| Start block | `44298133` | on-chain `getCode` binary search |
| RPC | `https://rpc.testnet.arc.network` | `deploy/.env` |

> The task that requested this indexer named `0xFeC679358fe0A48790c1269C78AaBF02a9D20A2B`
> and the `broadcast/` folder still has the pre-rename `CrossChainEscrow` deploy
> `0xe3267d6d61703c0e17284dddaa5b43c1f40dde0c`. **Neither is the live contract** —
> `deploy/.env` is authoritative.

### ⚠ One thing to confirm before deploy: the network slug

`network: arc-testnet` in `subgraph.yaml` is the slug used by `deploy/verify.js`
and by The Graph. Confirm it matches **Goldsky's** slug for Arc testnet:

```bash
goldsky chains list   # or check Goldsky docs / dashboard
```

If Goldsky names it differently (e.g. `arc-sepolia`), update `network:` in
`subgraph.yaml` and the key in `networks.json`.

## Build

```bash
cd indexer
npm install
npm run codegen   # generates ./generated from schema + ABI
npm run build     # compiles mappings to wasm  (verified: builds clean)
```

## Deploy (needs your Goldsky account — cannot be automated here)

```bash
goldsky login
npm run deploy        # = goldsky subgraph deploy tranche-protocol/0.1.0 --path .
```

Copy the GraphQL endpoint Goldsky prints and set it in `frontend/.env`:

```
VITE_GOLDSKY_ENDPOINT=https://api.goldsky.com/api/public/<project>/subgraphs/tranche-protocol/0.1.0/gn
```

The frontend flips to the subgraph automatically once that var is set (empty =
on-chain fallback, so the app works before deploy).

## Entities / supported queries

- `escrows(where: { depositor })` / `(where: { recipient })` — dashboard lists
- `escrows(where: { hasOpenDispute: true })` — arbiter panel
- `escrow(id:)` with `milestones`, `splits`, `disputes` — full detail
- `refundBalance(id: <wallet lowercased>)` — running refund credit balance

## ⚠ Contract event gaps (affect a few fields, not the core fix)

The events alone can't fully reconstruct every dashboard field:

1. **`EscrowCreated` omits `milestoneCount` and per-milestone amounts**, and there
   is no `MilestoneCreated` event. So `Escrow.milestoneCount` is best-effort
   (highest milestone index that has emitted an event, + 1) and `Milestone.amount`
   is always null. Hydrate amounts/count on the detail page via the bounded
   on-chain `getMilestones(escrowId)`.
2. **No event signals escrow `COMPLETED`.** `Escrow.state` is `ACTIVE` until a
   mutual cancel (`CANCELLED`); the dashboard's `activeEscrowCount` may over-count
   vs on-chain `getDashboard`.

**Recommendation:** add `milestoneCount` (and ideally per-milestone amounts) to
`EscrowCreated`, and emit an `EscrowCompleted` event, to make the dashboard fully
event-sourced. Cheap to add; no logic change. Until then the gaps above stand.

## Verify (Step 8)

- Goldsky dashboard shows the subgraph syncing / processing blocks.
- Frontend dashboard + arbiter panel load lists with `VITE_GOLDSKY_ENDPOINT` set
  (Network tab shows GraphQL POSTs, no `getDashboard`/`getDisputedEscrows` calls).
- Spot-check: `refundBalance.balance` from the subgraph matches on-chain
  `getRefundBalance(wallet)`.
