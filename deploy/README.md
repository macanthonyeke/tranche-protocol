# CrossChainEscrow V2 Deployment

This deployment path uses Circle developer-controlled wallets and Circle's Smart Contract Platform for deployment and admin signing. Domain-manager actions are signed by the separate `DOMAIN_MANAGER_PRIVATE_KEY`.

## Prerequisites

- Node.js 18+
- Foundry installed and `forge build` passing
- Circle developer account with API key and entity secret
- Existing Circle developer-controlled deployer wallet on Arc Testnet with gas funding
- A separate domain-manager wallet with a private key and gas funding

## Setup

```sh
cd deploy
npm install
cp .env.example .env
```

Fill in `.env` with your Circle credentials, deployer wallet ID, deployer wallet address, role addresses, domain-manager address/private key, treasury address, and Arc RPC URL.

## Deploy

```sh
npm run deploy
```

Deploys the contract, waits for confirmation, and saves `CONTRACT_ADDRESS` to `deploy/.env`.

## Configure

```sh
npm run setup
```

Grants or confirms roles via the Circle deployer wallet, confirms `DOMAIN_MANAGER_ROLE` for `DOMAIN_MANAGER_ADDRESS`, adds Arc domain `26` using `DOMAIN_MANAGER_PRIVATE_KEY`, sets the initial CCTP forward fee to `0` from the admin deployer wallet, removes domain-manager power from the deployer if it is present, then updates `bot/.env` and `frontend/src/lib/config.ts` with the deployed address.

## Verify

```sh
npm run verify
```

Reads and prints the full contract state using the Arc Testnet RPC.

## Full Deployment

```sh
npm run full
```

Runs deploy, setup, and verify in order.

## After Deployment

- Confirm `bot/.env` has the new `CONTRACT_ADDRESS`
- Confirm `frontend/src/lib/config.ts` has the new `ESCROW_ADDRESS`
- Restart any running bot or frontend processes so they pick up the new address

## Important

Never commit `deploy/.env` to git.
