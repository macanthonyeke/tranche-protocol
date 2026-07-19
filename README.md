# Tranche Protocol

Freelance payments are broken because there's no neutral place for 
money to sit while work is being done. Tranche is that place.

Tranche Protocol is a USDC milestone escrow system built on Arc, 
Circle's EVM-compatible L1. A payer locks funds upfront, defines 
milestones, and each one releases only when the work is approved. 
If there's a dispute, an arbiter resolves it. If the payer goes 
silent, the recipient can claim silent approval. Nobody needs to 
trust anybody. The contract holds the money and enforces the rules.

Cross-chain settlement runs through Circle CCTP V2, so recipients 
can receive funds on any supported chain without the payer worrying 
about destination logistics.

## Status

| | |
|---|---|
| Network | Arc testnet |
| Contract | `0x6bf5e723b5a542b8d49bedab7c8eb2791af00d3d` |
| Audit rounds | 6 complete, 0 Critical/High findings |
| Test suite | 275 tests passing |
| Contract size | 23,722 bytes (EIP-170 limit: 24,576) |
| Subgraph | Goldsky v0.5.3 live |

## What It Does

- Locks USDC into milestone escrows at deposit. The money doesn't 
  move until conditions are met.
- Supports single and multi-milestone project payments with 
  independent dispute windows per milestone.
- Requires a verifiable invoice at creation. The invoice JSON is 
  committed on-chain via the `InvoiceSnapshotted` event, so both 
  parties and any arbiter can verify the agreed scope without 
  trusting a third-party URL.
- Lets recipients acknowledge invoice terms on-chain before work 
  begins, and decline escrows they don't agree to.
- Lets the depositor mark milestones fulfilled, opening a 
  configurable review window.
- Lets the recipient signal delivery and claim silent approval if 
  the depositor goes silent past the review window.
- Lets an arbiter release or refund disputed milestones, with a 
  mandatory evidence hash from both sides.
- Lets both parties mutually settle at any agreed split, or 
  mutually cancel and refund unreleased funds.
- Lets the depositor extend the project deadline.
- Supports split recipients, where each split address can be on 
  a different CCTP destination chain.
- Charges a configurable protocol fee, capped at 5%.
- Uses Circle CCTP V2 `depositForBurnWithHook` with the 
  forwarding-service hook. Same-chain Arc releases use direct 
  transfer.

## Architecture

```text
Depositor
  |
  | approve USDC + create escrow (with invoice JSON)
  v
TrancheProtocol.sol on Arc
  |
  | milestone release / arbiter resolution / silent approval
  v
Circle TokenMessengerV2 (cross-chain) 
or direct safeTransfer (same-chain Arc)
  |
  v
Recipient on destination chain
```

The project has five main parts:

- **Contract**: Foundry Solidity in `src/` and `test/`
- **Frontend**: Vite + React app in `frontend/`
- **Subgraph**: Goldsky indexer in `indexer/`
- **Deployment**: Circle Smart Contract Platform scripts in `deploy/`
- **Bot**: Telegram notification bot in `bot/`

## Invoice System

Every escrow requires an invoice. The invoice is a structured JSON 
document containing an invoice number, line items derived from the 
escrow milestones, optional notes, and optional file attachments 
with client-side content hashes.

At deposit, the frontend serializes the JSON, hashes it, and passes 
both the hash and the full JSON string to the contract. The contract 
stores the hash in escrow state and emits the full JSON in the 
`InvoiceSnapshotted` event. The hash is the on-chain commitment. 
The event is the permanent, verifiable preimage.

This means:
- The invoice is retrievable from chain forever without trusting 
  any third-party URL
- Anyone can verify integrity by hashing the subgraph's stored 
  JSON and comparing it to the on-chain `invoiceHash`
- File attachments include client-side content hashes, so the 
  actual file is verifiable even if the link dies
- Private mode: the frontend encrypts the JSON (AES-256-GCM) and 
  pins the ciphertext to IPFS, emitting the ciphertext's `ipfs://` 
  URI in the event instead of the plaintext. The escrow's payer 
  and recipient can always decrypt it; the arbiter can decrypt 
  it only while a milestone is under dispute — all by signing a 
  short-lived challenge message that `api/request-invoice-key.js` 
  verifies before releasing the key. No key is ever stored: it's derived 
  deterministically server-side from a secret and the invoice's 
  own hash. A manual "drag the file to verify" fallback still 
  exists for when the automatic fetch/decrypt fails.

Recipients can call `acknowledgeInvoice` to create an on-chain 
record of acceptance. This is never required to claim payment, 
but it's a strong signal in any dispute. The payer can update 
the invoice URI via `updateInvoiceURI` without touching the hash.

## Protocol Lifecycle

**1. Deposit**
The depositor approves USDC, builds the invoice JSON, and calls 
`deposit()` with milestone definitions, invoice data, deadlines, 
and recipient details. USDC transfers into the contract.

**2. Recipient review**
The recipient sees the rendered invoice and can accept terms via 
`acknowledgeInvoice` or decline and trigger a refund via 
`declineEscrow`.

**3. Milestone fulfillment**
The depositor marks a milestone fulfilled. A review window opens 
(1-7 days, set at deposit). The recipient can raise a dispute 
during this window with a mandatory evidence hash.

**4. Release paths**
- No dispute: after the review window, anyone calls 
  `release`. Funds settle via CCTP or direct transfer.
- Dispute raised: both parties submit evidence hashes. An arbiter 
  resolves within 14 days.
- Arbiter timeout: if unresolved after 14 days, either party can 
  call `resolveDisputeByTimeout` for an unconditional 50/50 split.
- Silent approval: the recipient signals delivery. If the depositor 
  doesn't dispute within the review window (1-7 days, set at deposit), 
  anyone can call `release`.

**5. Exits**
- Mutual cancel: both parties agree to cancel. Unreleased funds 
  credit to `refundBalances`, withdrawn via `withdrawRefund`.
- Mutual settle: both parties agree on a recipient percentage 
  off-chain, both submit the same number on-chain. Executes 
  immediately.
- Deadline missed: after deadline plus 72-hour grace period, 
  the depositor can trigger a refund.

## Audit Status

Five rounds of audit completed. No Critical or High findings across 
all rounds.

Rounds 1-4 focused on contract security: access control, 
reentrancy, CCTP integration, economic edge cases.

Round 5 was a full UX audit: 8 critical UX issues and 20+ frontend 
and dispute issues identified and fixed. Key areas: dispute 
visibility, grace period handling, evidence integrity, mutual cancel 
trap, cross-chain delivery tracking, onboarding friction.

This is an active testnet project. It is not presented as 
production-ready.

## Repository Layout

```text
.
├── src/
│   ├── TrancheProtocol.sol
│   └── interface/
├── test/
│   ├── Base.t.sol
│   ├── TrancheProtocol.auditFixes.t.sol
│   ├── TrancheProtocol.auditRound2.t.sol
│   ├── TrancheProtocol.auditRound3.t.sol
│   ├── TrancheProtocol.auditRound4.t.sol
│   ├── TrancheProtocol.cctp_signal.t.sol
│   ├── TrancheProtocol.crossChainRefund.t.sol
│   ├── TrancheProtocol.fuzz.t.sol
│   ├── TrancheProtocol.invariant.t.sol
│   ├── TrancheProtocol.lifecycle.t.sol
│   ├── TrancheProtocol.receivingAddress.t.sol
│   ├── TrancheProtocol.t.sol
│   ├── TrancheProtocol.upgrades.t.sol
│   ├── TrancheProtocol.v2features.t.sol
│   └── mocks/
├── script/
│   └── Deploy.s.sol
├── deploy/
│   ├── deploy-explicit-gas.mjs
│   ├── deploy.js
│   ├── lib/deployment.mjs
│   ├── setFee.js
│   ├── setup.js
│   ├── verify.js
│   └── README.md
├── frontend/
│   ├── src/
│   ├── package.json
│   └── README.md
├── indexer/
│   ├── schema.graphql
│   ├── subgraph.yaml
│   ├── src/mapping.ts
│   └── package.json
├── bot/
│   ├── src/
│   ├── package.json
│   └── README.md
├── foundry.toml
└── .env.example
```

## Smart Contract

`src/TrancheProtocol.sol`

### Escrow

An escrow stores: depositor, recipient, refund recipient, total 
USDC amount, destination CCTP domain, mint recipient, review window, 
invoice hash and URI, escrow-level CCTP forward fee snapshot, 
deadline, milestone count, and escrow state.

Escrow states: `ACTIVE`, `COMPLETED`, `CANCELLED`

### Milestone

Each milestone stores: amount, title, fulfilled timestamp, 
delivery-signaled timestamp, and milestone state.

Milestone states: `PENDING`, `IN_REVIEW`, `DISPUTED`, `RELEASED`, 
`REFUNDED`

### CCTP Settlement

- Source domain: Arc domain `26`
- Same-chain Arc releases: direct `safeTransfer`, no fee
- Cross-chain: CCTP V2 `depositForBurnWithHook` with Circle 
  forwarding-service hook
- `CCTP_MIN_FINALITY_THRESHOLD`: fixed at `2000` (Standard Transfer)
- CCTP forward fee: snapshotted per escrow at deposit time

The frontend fetches the live fee from Circle's Iris API before 
each cross-chain call:

https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/26/{destinationDomain}?forward=true

### Roles

| Role | Permissions |
|---|---|
| `DEFAULT_ADMIN_ROLE` | protocol fee, treasury, CCTP forward fee, role grants |
| `ARBITER_ROLE` | resolve disputes |
| `PAUSER_ROLE` | pause and unpause deposits |
| `DOMAIN_MANAGER_ROLE` | add and remove supported CCTP domains |
| `FEE_MANAGER_ROLE` | manage CCTP forward fee |
| `RECOVERY_MANAGER_ROLE` | recover stuck escrows (internal — no public getter) |

### Protocol Fee

- Default: `199` bps (1.99%)
- Maximum: `500` bps (5%)
- Collected at release, sent to `protocolTreasury`
- Not collected on mutual cancel. Collected on timeout settlement.

## Frontend

`frontend/`

Stack: Vite, React 19, TypeScript, Tailwind CSS, RainbowKit, 
wagmi v2, viem, React Router, TanStack Query, Framer Motion

Design system: Switzer (body), Fraunces (display), Geist Mono 
(data and amounts), warm clay accent.

Main screens:

- `/` dashboard with escrow list and state filters
- `/create` five-step escrow creation flow with live invoice builder
- `/escrow/:id` escrow detail, milestone actions, invoice 
  verification card
- `/withdraw` refund balance withdrawal with cross-chain option
- `/arbiter` arbiter workspace
- `/docs` public protocol documentation, no wallet required

```sh
cd frontend
npm install
npm run dev
npm test        # vitest — invoice-pinning backend + component suites
```

## Subgraph

`indexer/`

Goldsky subgraph indexing all protocol events. Used by the frontend 
as the primary data source.

Indexed entities: `Escrow`, `Milestone`, `Dispute`, `Split`, 
`RefundBalance`, `RefundCredit`, `EvidenceEntry`, `InvoiceURIUpdate`

The `Escrow` entity includes parsed invoice fields: `invoiceData`, 
`invoiceNumber`, `invoiceAcknowledgedAt`, `invoiceAcknowledgedBy`.

```sh
cd indexer
npm run sync     # sync ABI and address from deploy/.env
npm run codegen  # generate AssemblyScript types
npm run build    # compile to WASM
```

Deploy:

```sh
~/.local/bin/goldsky subgraph deploy tranche-protocol/0.x.x --path .
```

## Telegram Bot

`bot/`

Listens to escrow events, links wallets to Telegram users via 
signature verification, and sends reminders.

Features:
- `/link <wallet>` challenge flow
- `/verify <signature>` wallet ownership verification
- `/wallets` and `/unlink <wallet>` wallet management
- `/status` listener status
- Event notifications: creation, disputes, releases, refunds, 
  cancellations
- Deadline and dispute-window reminders
- Durable SQLite storage in `bot/data/bot.sqlite`

```sh
cd bot
npm install
cp .env.example .env
npm start
```

Development mode:

```sh
cd bot && npm run dev
```

## Deployment

### Circle Deployment Scripts (primary path)

`deploy/`

```sh
forge build
cd deploy
npm install
cp .env.example .env
npm run deploy
npm run setup
npm run verify
```

After every deploy, run `setFee.js` to restore the CCTP 
forward fee:

```sh
npm run set-fee
```

The fee resets to 0 on every fresh deploy. The contract 
will reject cross-chain releases until this is run.

Or all three:

```sh
npm run full-gas
```

Do not use `npm run full` — Circle's gas estimation enforces EIP-170 at estimation 
time. `full-gas` bypasses this correctly.

`setup.js` grants roles, adds Arc domain `26`, sets the initial 
CCTP forward fee, and syncs the new contract address to `bot/.env` 
and `frontend/src/config/`.

## Getting Started

Prerequisites: Foundry, Node.js 18+, Arc testnet RPC, Arc testnet 
USDC, Circle developer account (Circle deployment path), Telegram 
bot token (notifications)

```sh
# install contract dependencies
git submodule update --init --recursive
forge build

# run tests
forge test

# run frontend
cd frontend && npm install && npm run dev

# run bot
cd bot && npm install && cp .env.example .env && npm start
```

## Testing

236 tests across unit, adversarial, CCTP, fuzz, invariant, and 
upgrade-regression suites.

```sh
forge test
forge test -vvv
forge test --match-contract TrancheProtocolInvariantTest
forge test --match-contract TrancheProtocolFuzzTest
forge coverage
```

Coverage: deposits and milestone accounting, invoice validation, 
dispute creation and counter-evidence, arbiter resolution, mutual 
cancel and settle, refund withdrawals, role permissions, pause 
behavior, reentrancy, CCTP hook data, same-chain releases, silent 
approval, split validation, protocol fee bounds, invariant solvency.

## CI

GitHub Actions runs the Foundry test suite on every push 
and pull request via `.github/workflows/test.yml`. 
Frontend responsive e2e tests run in the same workflow.

## Environment Variables

### Root `.env`

| Variable | Purpose |
|---|---|
| `ARC_TESTNET_RPC` | Arc testnet RPC URL |
| `PRIVATE_KEY` | Deployer private key |
| `ARBITER_ADDRESS` | Arbiter wallet |
| `PAUSER_ADDRESS` | Pauser wallet |
| `DOMAIN_MANAGER_ADDRESS` | Domain manager wallet |
| `PROTOCOL_TREASURY` | Fee collection address |
| `USDC_ADDRESS` | Optional override |
| `TOKEN_MESSENGER` | Optional override |

### Deploy `.env`

| Variable | Purpose |
|---|---|
| `CIRCLE_API_KEY` | Circle API key |
| `CIRCLE_ENTITY_SECRET` | Circle entity secret |
| `DEPLOYER_WALLET_ID` | Circle wallet ID |
| `DEPLOYER_ADDRESS` | Deployer address |
| `ARBITER_ADDRESS` | Arbiter address |
| `PAUSER_ADDRESS` | Pauser address |
| `DOMAIN_MANAGER_ADDRESS` | Domain manager address |
| `DOMAIN_MANAGER_PRIVATE_KEY` | Domain manager key |
| `PROTOCOL_TREASURY` | Fee collection address |
| `ARC_RPC_URL` | Arc RPC URL |
| `CONTRACT_ADDRESS` | Filled after deployment |

### Bot `.env`

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather |
| `ARC_TESTNET_RPC_URL` | Arc RPC URL |
| `ARC_CHAIN_ID` | Arc chain ID |
| `CONTRACT_ADDRESS` | Deployed contract address |
| `ARBITER_TELEGRAM_ID` | Arbiter's Telegram user ID |
| `REMINDER_CRON` | Optional cron schedule |
| `DEBUG` | Optional debug flag |

### Frontend `.env`

| Variable | Purpose |
|---|---|
| `VITE_CONTRACT_ADDRESS` | Deployed contract address |
| `VITE_GOLDSKY_ENDPOINT` | Goldsky subgraph query URL |
| `VITE_PINATA_GATEWAY` | IPFS gateway subdomain for pinned invoice attachments (optional — defaults to the team's dedicated gateway) |
| `PINATA_JWT` | Server-side only (`api/pin-invoice.js`). Pinata JWT for pinning invoice attachments and encrypted private-invoice envelopes to IPFS. |
| `INVOICE_KEY_SECRET` | Server-side only (`api/pin-invoice.js`, `api/request-invoice-key.js`). Secret used to deterministically derive each private-mode invoice's AES-256 decryption key — no key is ever stored. Rotating it permanently strands every previously pinned private invoice. |

`VITE_GOLDSKY_ENDPOINT` is required. The frontend has no 
on-chain fallback for bulk reads — if this is unset, 
the dashboard will not load.

## Security Model

Defensive measures:
- `ReentrancyGuard` on all token-moving entry points
- `Pausable` deposits
- OpenZeppelin role-based access control
- Configurable review window with independent dispute handling 
  per milestone
- Sequential milestone enforcement
- Refund accounting before withdrawal
- Protocol fee cap at 5%
- Supported-domain allowlist for CCTP destinations
- CCTP Standard Transfer finality threshold only
- Invoice JSON committed on-chain at deposit via 
  `InvoiceSnapshotted` event, not just a URI reference

Assumptions:
- The arbiter is trusted to resolve disputes fairly
- The default admin is trusted to manage roles, treasury, 
  and fee settings
- Supported CCTP domains must stay aligned with Circle's 
  active domain support
- Cross-chain completion depends on Circle CCTP V2 and its 
  forwarding service

## Operational Notes

- CCTP stranded burn recovery: if a cross-chain release is 
  stranded because `maxFee` was too low, the burn is recoverable. 
  Anyone can self-relay by calling `receiveMessage(message, 
  attestation)` on the destination chain's `MessageTransmitterV2`. 
  `destinationCaller` is `0x0`, so no special permission is needed.
- The Goldsky CLI is not on PATH by default. Use the full path: 
  `~/.local/bin/goldsky subgraph deploy ...`

## Roadmap

Tranche is currently in testnet phase on Arc.

**Phase 2 (pre-mainnet):** Embedded wallets via Turnkey. The payer 
enters a recipient email at escrow creation. Turnkey creates a 
wallet silently. The recipient logs in to find the escrow waiting. 
Gas is sponsored via Circle Gas Station. Private key export is 
available as an escape hatch. Off-ramp via MoonPay, Transak, or 
Yellow Card.

**Mainnet:** Role management migrated from deployer wallet to 
multisig.

## Common Commands

```sh
# contracts
forge build
forge test
forge fmt

# Circle deployment
cd deploy && npm run full-gas

# sync ABI and address
cd indexer && npm run sync

# frontend
cd frontend && npm run dev
cd frontend && npm run build

# bot
cd bot && npm start
```

## License

MIT
