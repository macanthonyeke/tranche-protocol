// WARNING: Deployer holds DEFAULT_ADMIN_ROLE,
// FEE_MANAGER_ROLE, and RECOVERY_MANAGER_ROLE.
// For mainnet, distribute these roles to separate
// multisig wallets before announcing deployment.

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { isAddress } from 'viem';
import { getPublicClient, resolveStartBlock, upsertEnvVars } from './lib/deployment.mjs';
import {
  initiateSmartContractPlatformClient,
} from '@circle-fin/smart-contract-platform';
import {
  initiateDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

function sanitizeError(err) {
  const status = err?.response?.status;
  const statusText = err?.response?.statusText;
  const code = err?.code ?? err?.cause?.code;
  const message = err?.response?.data?.message ?? err?.message ?? String(err);
  return [
    status ? `HTTP ${status}${statusText ? ` ${statusText}` : ''}` : null,
    code ? `code ${code}` : null,
    message,
  ].filter(Boolean).join(' -- ');
}

const ARC_TESTNET_BLOCKCHAIN = 'ARC-TESTNET';
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';

async function main() {

const required = [
  'CIRCLE_API_KEY',
  'CIRCLE_ENTITY_SECRET',
  'DEPLOYER_WALLET_ID',
  'DEPLOYER_ADDRESS',
  'ARBITER_ADDRESS',
  'PAUSER_ADDRESS',
  'DOMAIN_MANAGER_ADDRESS',
  'PROTOCOL_TREASURY',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

for (const key of [
  'DEPLOYER_ADDRESS',
  'ARBITER_ADDRESS',
  'PAUSER_ADDRESS',
  'DOMAIN_MANAGER_ADDRESS',
  'PROTOCOL_TREASURY',
]) {
  if (!isAddress(process.env[key])) {
    console.error(`Invalid address in env var: ${key}`);
    process.exit(1);
  }
}

if (process.env.DOMAIN_MANAGER_ADDRESS.toLowerCase() === process.env.DEPLOYER_ADDRESS.toLowerCase()) {
  console.error('DOMAIN_MANAGER_ADDRESS must be different from DEPLOYER_ADDRESS.');
  process.exit(1);
}

const artifactPath = path.resolve(__dirname, '../out/TrancheProtocol.sol/TrancheProtocol.json');
if (!fs.existsSync(artifactPath)) {
  console.error('Artifact not found. Run forge build first.');
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const abi = artifact.abi;
const bytecode = artifact.bytecode?.object ?? artifact.bytecode;

if (!bytecode || bytecode === '0x') {
  console.error('Bytecode is empty. forge build may have failed.');
  process.exit(1);
}

const constructorAbi = abi.find((item) => item.type === 'constructor');
const constructorTypes = constructorAbi?.inputs?.map((input) => input.type) ?? [];
const expectedConstructorTypes = ['address', 'address', 'address', 'address', 'address', 'address'];

if (constructorTypes.join(',') !== expectedConstructorTypes.join(',')) {
  console.error('Unexpected TrancheProtocol constructor signature.');
  console.error('Expected:', expectedConstructorTypes.join(', '));
  console.error('Found:   ', constructorTypes.join(', ') || '(none)');
  process.exit(1);
}

const contractClient = initiateSmartContractPlatformClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

const constructorParameters = [
  USDC_ADDRESS,
  process.env.ARBITER_ADDRESS,
  process.env.PAUSER_ADDRESS,
  process.env.DOMAIN_MANAGER_ADDRESS,
  TOKEN_MESSENGER,
  process.env.PROTOCOL_TREASURY,
];

console.log('Deploying TrancheProtocol V2...');
console.log('Blockchain:', ARC_TESTNET_BLOCKCHAIN);
console.log('USDC:', USDC_ADDRESS);
console.log('Arbiter:', process.env.ARBITER_ADDRESS);
console.log('Pauser:', process.env.PAUSER_ADDRESS);
console.log('Domain manager:', process.env.DOMAIN_MANAGER_ADDRESS);
console.log('TokenMessenger:', TOKEN_MESSENGER);
console.log('Treasury:', process.env.PROTOCOL_TREASURY);
console.log('Deployer wallet ID:', process.env.DEPLOYER_WALLET_ID);
console.log('Deployer address:', process.env.DEPLOYER_ADDRESS);
console.log('Deployer will receive DEFAULT_ADMIN_ROLE, FEE_MANAGER_ROLE, RECOVERY_MANAGER_ROLE.');

// Head just before submitting — a safe lower bound for the subgraph startBlock
// if the receipt's exact block can't be fetched later.
const arcClient = getPublicClient();
let startBlockFloor = null;
try {
  startBlockFloor = await arcClient.getBlockNumber();
} catch {
  console.warn('Could not read current block for startBlock floor; will rely on receipt.');
}

const deployResponse = await contractClient.deployContract({
  idempotencyKey: randomUUID(),
  name: 'TrancheProtocolV2',
  blockchain: ARC_TESTNET_BLOCKCHAIN,
  walletId: process.env.DEPLOYER_WALLET_ID,
  abiJson: JSON.stringify(abi),
  bytecode,
  constructorParameters,
  fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
});

const contractId =
  deployResponse.data?.contractId ??
  deployResponse.data?.contract?.id ??
  deployResponse.data?.id;
const transactionId =
  deployResponse.data?.transactionId ??
  deployResponse.data?.transaction?.id ??
  deployResponse.data?.transactionHash;

if (!contractId) {
  console.error('Circle did not return a contract ID.');
  console.error(JSON.stringify(deployResponse.data, null, 2));
  process.exit(1);
}

console.log('\nDeployment submitted.');
console.log('Contract ID:', contractId);
console.log('Transaction ID:', transactionId ?? '(pending)');

console.log('\nWaiting for confirmation...');
let contractAddress = null;
let deploymentTxHash = null;
let attempts = 0;
const maxAttempts = 60;

while (!contractAddress && attempts < maxAttempts) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  attempts++;

  try {
    const contractResponse = await contractClient.getContract({ id: contractId });
    const contract = contractResponse.data?.contract ?? contractResponse.data;
    contractAddress = contract?.contractAddress ?? contract?.address ?? null;
    deploymentTxHash =
      contract?.deploymentTxHash ??
      contract?.transactionHash ??
      contract?.txHash ??
      transactionId ??
      null;

    if (contractAddress) {
      console.log('\nDeployment confirmed.');
      console.log('Contract address:', contractAddress);
      console.log('Transaction hash:', deploymentTxHash ?? '(unavailable)');
    } else {
      process.stdout.write('.');
    }
  } catch {
    process.stdout.write('x');
  }
}

if (!contractAddress) {
  console.error('\nDeployment timed out. Check Circle console for status.');
  console.error('Contract ID:', contractId);
  process.exit(1);
}

const envPath = path.resolve(__dirname, '.env');
const startBlock = await resolveStartBlock(arcClient, deploymentTxHash, startBlockFloor);

upsertEnvVars(envPath, {
  CONTRACT_ADDRESS: contractAddress,
  ...(startBlock != null ? { CONTRACT_START_BLOCK: startBlock } : {}),
});

console.log('\nContract address saved to deploy/.env');
if (startBlock != null) {
  console.log(`Deploy block ${startBlock} saved as CONTRACT_START_BLOCK.`);
} else {
  console.warn('Could not determine deploy block — set CONTRACT_START_BLOCK in deploy/.env manually.');
}
console.log('\nNext steps:');
console.log('  1. node setup.js   # configure roles and settings');
console.log('  2. cd ../indexer && npm run sync   # point the subgraph + frontend ABI at this deploy');
}

main().catch((err) => {
  console.error(`Deployment failed: ${sanitizeError(err)}`);
  process.exit(1);
});
