# Tranche Protocol V2

A milestone-based USDC escrow system built for Arc Testnet with Circle CCTP V2 settlement, dispute resolution, role-based administration, a React dashboard, Circle deployment scripts, and a Telegram notification bot.

Tranche Protocol lets a depositor lock USDC upfront, define one or more milestones, and release each milestone to a recipient after approval, silent approval, or arbiter resolution. Released funds are burned through Circle CCTP V2 from Arc and minted to the recipient's selected destination domain.

> Status: active testnet project. Contracts are not presented as audited production code.

## Table of Contents

- [What It Does](#what-it-does)
- [Architecture](#architecture)
- [Repository Layout](#repository-layout)
- [Smart Contract](#smart-contract)
- [Frontend](#frontend)
- [Telegram Bot](#telegram-bot)
- [Deployment](#deployment)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Environment Variables](#environment-variables)
- [Operational Notes](#operational-notes)
- [Security Model](#security-model)

## What It Does

- Locks USDC into milestone escrows.
- Supports single and multi-milestone project payments.
- Requires invoice metadata through `invoiceHash` and `invoiceURI`.
- Allows a depositor to mark milestones fulfilled.
- Allows either party to raise disputes during the dispute window.
- Allows an arbiter to release or refund disputed milestones.
- Lets recipients signal delivery and claim silent approval if the depositor does not respond.
- Lets both parties mutually cancel active escrows and refund unreleased funds.
- Supports recipient-controlled mint-recipient updates for future releases.
- Supports optional split recipients, where each split can target a different CCTP destination domain.
- Charges a configurable protocol fee, capped at 5%.
- Uses Circle CCTP V2 `depositForBurnWithHook` with the forwarding-service hook.
- Provides a dashboard for users and a separate arbiter/admin workspace.
- Sends Telegram notifications and deadline/dispute reminders.

## Architecture

```text
Depositor
  |
  | approve USDC + create escrow
  v
TrancheProtocol.sol on Arc Testnet
  |
  | milestone release / arbiter resolution / silent approval
  v
Circle TokenMessengerV2
  |
  | CCTP V2 burn with forwarding hook
  v
Destination chain recipient
```

The project has four main parts:

- **Contracts**: Foundry Solidity contracts and tests in `src/`, `script/`, and `test/`.
- **Frontend**: Vite + React + TypeScript app in `frontend/`.
- **Deployment tools**: Circle Smart Contract Platform / developer-controlled wallet scripts in `deploy/`.
- **Telegram bot**: Event listener, reminder scheduler, and wallet-linking bot in `bot/`.

## Repository Layout

```text
.
├── src/
│   ├── TrancheProtocol.sol
│   └── interface/
├── test/
│   ├── TrancheProtocol.t.sol
│   ├── TrancheProtocol.adversarial.t.sol
│   ├── TrancheProtocol.cctp_signal.t.sol
│   ├── TrancheProtocol.fuzz.t.sol
│   ├── TrancheProtocol.invariant.t.sol
│   ├── TrancheProtocol.upgrades.t.sol
│   └── mocks/
├── script/
│   └── Deploy.s.sol
├── deploy/
│   ├── deploy.js
│   ├── setup.js
│   ├── verify.js
│   └── README.md
├── frontend/
│   ├── src/
│   ├── package.json
│   └── README.md
├── bot/
│   ├── src/
│   ├── package.json
│   └── README.md
├── foundry.toml
├── remappings.txt
└── .env.example
```

## Smart Contract

Main contract: `src/TrancheProtocol.sol`

### Core Concepts

**Escrow**

An escrow stores:

- depositor
- recipient
- refund recipient
- total USDC amount
- destination CCTP domain
- CCTP mint recipient
- dispute window
- delivery notice window
- invoice metadata
- deadline
- milestone count
- escrow state

**Milestone**

Each milestone stores:

- amount
- fulfilled timestamp
- milestone state
- delivery-signaled timestamp

**States**

Escrow states:

- `ACTIVE`
- `COMPLETED`
- `CANCELLED`

Milestone states:

- `PENDING`
- `FULFILLED`
- `DISPUTED`
- `RELEASED`
- `REFUNDED`

### Main Lifecycle

1. **Deposit**
   - Depositor approves USDC.
   - Depositor calls `deposit(...)`.
   - Contract validates invoice metadata, deadline, windows, milestones, domains, and splits.
   - USDC is transferred into escrow.

2. **Fulfillment**
   - Depositor calls `fulfillCondition(escrowId, milestoneIndex)`.
   - Milestone becomes `FULFILLED`.
   - Dispute window starts.

3. **Dispute path**
   - Depositor or recipient can call `raiseDispute(...)` before the dispute window expires.
   - The other party can submit counter-evidence.
   - An address with `ARBITER_ROLE` calls `resolveDispute(...)`.
   - Arbiter either releases the milestone to the recipient or refunds it.

4. **No-dispute release path**
   - After the dispute window expires, anyone can call `releaseAfterWindow(...)`.
   - Protocol fee is sent to the treasury.
   - Remaining USDC is released through CCTP.

5. **Silent approval path**
   - Recipient calls `signalDelivery(...)`.
   - If the depositor does nothing until `deliveryNoticeWindow` expires, anyone can call `claimSilentApproval(...)`.
   - The milestone is released through the same CCTP settlement path.

6. **Cancellation path**
   - Depositor and recipient both call `mutualCancel(...)`.
   - Unreleased and undisputed funds are credited to `refundBalances`.
   - Refunds are withdrawn with `withdrawRefund(recipient)`.

### CCTP Settlement

The contract uses Circle CCTP V2:

- Source domain: Arc domain `26`.
- Same-chain Arc releases use `maxFee = 0`.
- Cross-chain releases use a caller-supplied `cctpMaxFee`.
- `CCTP_MIN_FINALITY_THRESHOLD` is fixed to `2000` for Standard Transfer.
- The contract uses Circle's forwarding-service hook data so Circle can relay the destination-chain mint.

The frontend fetches Circle's sandbox forwarding fee from:

```text
https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/26/{destinationDomain}?forward=true
```

### Roles

The contract uses OpenZeppelin `AccessControlEnumerable`.

- `DEFAULT_ADMIN_ROLE`: manages protocol fee, treasury, CCTP forward fee, and role grants.
- `ARBITER_ROLE`: resolves disputes.
- `PAUSER_ROLE`: pauses and unpauses deposits.
- `DOMAIN_MANAGER_ROLE`: adds and removes supported CCTP domains.

### Protocol Fee

- Default protocol fee: `199` bps, or 1.99%.
- Maximum protocol fee: `500` bps, or 5%.
- Fees are collected on release and sent to `protocolTreasury`.

## Frontend

Location: `frontend/`

Stack:

- Vite
- React 19
- TypeScript
- Tailwind CSS
- RainbowKit
- wagmi
- viem
- React Router
- TanStack Query
- Framer Motion

Main screens:

- `/` user dashboard
- `/create` escrow creation flow
- `/escrow/:id` escrow detail and milestone actions
- `/withdraw` refund withdrawal
- `/arbiter` arbiter/admin workspace

Frontend config lives in:

```text
frontend/src/lib/config.ts
```

That file contains the escrow contract address, Arc USDC address, explorer URL, CCTP domain catalog, UI presets, and displayed protocol fee.

Run locally:

```sh
cd frontend
npm install
npm run dev
```

Build:

```sh
cd frontend
npm run build
```

Lint:

```sh
cd frontend
npm run lint
```

Optional frontend environment:

```sh
VITE_WC_PROJECT_ID=your_walletconnect_project_id
```

If omitted, the app uses the public project ID currently configured in `frontend/src/lib/wagmi.ts`.

## Telegram Bot

Location: `bot/`

The bot listens to escrow events, links wallets to Telegram users via signature verification, and sends reminders.

Features:

- `/link <wallet>` challenge flow.
- `/verify <signature>` wallet ownership verification.
- `/wallets` and `/unlink <wallet>` wallet management.
- `/status` listener status.
- Event notifications for escrow creation, disputes, releases, refunds, cancellations, and escalations.
- Deadline reminders and dispute-window reminders.
- Durable SQLite storage in `bot/data/bot.sqlite`.

Run locally:

```sh
cd bot
npm install
cp .env.example .env
npm start
```

Development mode:

```sh
cd bot
npm run dev
```

See `bot/README.md` for command details and notification routing.

## Deployment

There are two deployment paths.

### Circle Deployment Scripts

Location: `deploy/`

This is the richer deployment path and uses:

- Circle Smart Contract Platform
- Circle developer-controlled wallets
- viem

Setup:

```sh
forge build
cd deploy
npm install
cp .env.example .env
```

Fill `deploy/.env`, then run:

```sh
npm run deploy
npm run setup
npm run verify
```

Or run all three:

```sh
npm run full
```

`setup.js` grants or confirms roles, adds Arc domain `26`, sets the initial CCTP forward fee to `0`, revokes deployer domain-manager power if present, and updates downstream config in `bot/.env` and `frontend/src/lib/config.ts`.

More details are in `deploy/README.md`.

### Foundry Script

Location: `script/Deploy.s.sol`

Example:

```sh
cp .env.example .env
# Ensure .env includes DOMAIN_MANAGER_ADDRESS; Deploy.s.sol requires it.
set -a; source .env; set +a

forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$ARC_TESTNET_RPC" \
  --broadcast
```

The Foundry script deploys the contract using:

- Arc native USDC precompile by default: `0x3600000000000000000000000000000000000000`
- Arc TokenMessengerV2 by default: `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`

Supported domains must be seeded by the domain manager after deployment.

## Getting Started

### Prerequisites

- Foundry
- Node.js 18+
- npm
- Git submodules initialized
- An Arc Testnet RPC endpoint
- Arc Testnet gas for deploy/admin wallets
- USDC on Arc Testnet for test deposits
- Circle developer account for the Circle deployment path
- Telegram bot token if running notifications

### Install Contract Dependencies

```sh
git submodule update --init --recursive
forge build
```

### Run the Contract Tests

```sh
forge test
```

### Run the Frontend

```sh
cd frontend
npm install
npm run dev
```

### Run the Bot

```sh
cd bot
npm install
cp .env.example .env
npm start
```

## Testing

The test suite covers unit, adversarial, CCTP/silent-approval, upgrade-regression, fuzz, and invariant cases.

Useful commands:

```sh
forge test
forge test -vvv
forge test --match-contract TrancheProtocolInvariantTest
forge test --match-contract TrancheProtocolFuzzTest
forge coverage
```

Notable coverage areas:

- deposits and milestone accounting
- invoice validation
- dispute creation and counter-evidence
- arbiter release/refund decisions
- mutual cancellation
- refund withdrawals
- role permissions
- pause behavior
- reentrancy protections
- CCTP hook data and forwarding fee behavior
- same-chain Arc releases
- silent approval
- split-recipient validation
- protocol fee bounds
- invariant solvency and milestone ordering

## Environment Variables

### Root `.env`

Template: `.env.example`

Used by the Foundry deployment script.

Important values:

- `ARC_TESTNET_RPC`
- `PRIVATE_KEY`
- `ARBITER_ADDRESS`
- `PAUSER_ADDRESS`
- `DOMAIN_MANAGER_ADDRESS`
- `PROTOCOL_TREASURY`
- optional `USDC_ADDRESS`
- optional `TOKEN_MESSENGER`

### Deploy `.env`

Template: `deploy/.env.example`

Used by Circle deployment scripts.

Important values:

- `CIRCLE_API_KEY`
- `CIRCLE_ENTITY_SECRET`
- `DEPLOYER_WALLET_ID`
- `DEPLOYER_ADDRESS`
- `ARBITER_ADDRESS`
- `PAUSER_ADDRESS`
- `DOMAIN_MANAGER_ADDRESS`
- `DOMAIN_MANAGER_PRIVATE_KEY`
- `PROTOCOL_TREASURY`
- `ARC_RPC_URL`
- `CONTRACT_ADDRESS`, filled after deployment

### Bot `.env`

Template: `bot/.env.example`

Important values:

- `TELEGRAM_BOT_TOKEN`
- `ARC_TESTNET_RPC_URL`
- `ARC_CHAIN_ID`
- `CONTRACT_ADDRESS`
- `ARBITER_TELEGRAM_ID`
- optional `REMINDER_CRON`
- optional `DEBUG`

## Operational Notes

- `deploy/.env`, root `.env`, `bot/.env`, and other real dotenv files are git-ignored.
- The frontend currently stores its contract address in `frontend/src/lib/config.ts`.
- Run `forge build` before running deployment scripts or the bot; both depend on the generated contract artifact.
- For cross-chain releases, fetch the current Circle forwarding fee close to transaction submission.
- Domain support is controlled on-chain through `addSupportedDomain` and `removeSupportedDomain`.
- Same-chain Arc releases use domain `26` and do not require a CCTP forwarding fee.
- The bot's SQLite database is created under `bot/data/` on first run.

## Security Model

This project includes several defensive measures:

- `ReentrancyGuard` on token-moving entry points.
- `Pausable` deposits.
- OpenZeppelin role-based access control.
- Explicit dispute and delivery windows.
- Sequential milestone enforcement.
- Refund accounting before withdrawal.
- Protocol fee cap.
- Supported-domain allowlist.
- CCTP Standard Transfer finality threshold only.

Important assumptions:

- The arbiter is trusted to resolve disputes fairly.
- The default admin is trusted to manage roles, treasury, fee settings, and CCTP forward-fee configuration.
- Supported CCTP domains must be kept aligned with Circle's active domain support.
- Invoice and evidence URIs/hashes are application-level records; the contract stores references, not the underlying documents.
- Cross-chain completion depends on Circle CCTP V2 and its forwarding service.

## Common Commands

```sh
# Contracts
forge build
forge test
forge fmt

# Circle deployment
cd deploy && npm run full

# Frontend
cd frontend && npm run dev
cd frontend && npm run build

# Bot
cd bot && npm start
```

## License

MIT, matching the Solidity SPDX headers.
