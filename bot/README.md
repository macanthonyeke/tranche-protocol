# CrossChainEscrow Telegram bot

A Telegram notification bot for the `CrossChainEscrow` contract deployed on Arc
testnet. It links wallet addresses to Telegram users via signature
verification, listens for contract events, and sends timed reminders before
deadlines and dispute windows close.

## Prerequisites

- Node.js 18+ (tested on 24.x)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A running Arc testnet RPC endpoint and the deployed `CrossChainEscrow`
  address
- The Foundry artifact at `../out/CrossChainEscrow.sol/CrossChainEscrow.json`
  (run `forge build` in the project root if it's missing)

## Install

```bash
cd bot
npm install
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN, CONTRACT_ADDRESS, ARC_CHAIN_ID,
# ARBITER_TELEGRAM_ID, etc.
npm start
```

The SQLite database is created at `bot/data/bot.sqlite` on first run.

## Telegram commands

| Command | Description |
|---|---|
| `/start` | Welcome message and pointer to `/help` |
| `/help` | List every command |
| `/link <wallet>` | Begin linking a wallet — bot replies with a challenge to sign |
| `/verify <signature>` | Submit the signature produced for the latest `/link` challenge |
| `/wallets` | Show wallets linked to your Telegram account |
| `/unlink <wallet>` | Remove a linked wallet |
| `/status` | Show whether the contract event listener is connected and the last seen event |

A single Telegram user may link multiple wallets. Pending challenges expire
after 15 minutes.

## Notifications

| Event | Recipients |
|---|---|
| `EscrowCreated` | recipient |
| `ConditionFulfilled` | recipient |
| `DisputeRaised` | depositor, recipient, arbiter |
| `CounterEvidenceSubmitted` | original disputer, arbiter |
| `EscrowReleased` (arbiter resolution) | depositor, recipient |
| `EscrowReleasedWithoutDispute` | depositor, recipient |
| `EscrowRefunded` | depositor, recipient |
| `EscrowRefundedViaMutualCancel` | depositor, recipient |
| `EscalatedAfterDeadline` | depositor, arbiter |
| `RefundWithdrawn` | withdrawer |

The arbiter is reached via `ARBITER_TELEGRAM_ID`; the on-chain `ARBITER_ROLE`
holder must `/start` the bot once so Telegram allows direct messages.

## Reminders

A cron task (`REMINDER_CRON`, default `0 * * * *`) scans every active escrow
and sends:

- **Deadline reminders** to the depositor at 24h and 6h before
  `escrow.deadline`.
- **Dispute window reminders** to both parties at 24h and 6h before
  `conditionMetTimestamp + disputeWindow` for any FULFILLED milestone.

Each reminder is fired at most once (tracked in the `reminders_sent` table).

## Project structure

```
bot/
  src/
    index.js      entry point
    bot.js        Telegram command handlers
    listener.js   viem event watcher with reconnect
    notifier.js   per-event formatters and dispatch
    reminders.js  hourly cron scan
    db.js         SQLite schema and queries
    logger.js     structured console logger
  data/           SQLite database lives here (gitignored)
  .env.example    env template
  package.json
```

## Operational notes

- The listener uses `watchContractEvent` per event with HTTP polling. On
  transport failure it tears down the affected watcher and re-arms after 5s.
- All bigints are formatted with `viem.formatUnits` at 6 decimals (USDC).
- Restarting the bot is safe: pending links are durable, and reminders are
  idempotent.

## Stopping

`SIGINT` / `SIGTERM` triggers a graceful shutdown that stops the cron, the
listener, and Telegram polling.
