// One-off: deploy TrancheProtocol via the Circle dev-controlled wallet using an
// ABSOLUTE fee (explicit gasLimit) so Circle skips gas estimation. The normal
// `npm run deploy` path failed at the estimation step with
// ESTIMATION_ERROR / CreateContractSizeLimit; this bypasses estimation to let
// Arc itself accept or reject the CREATE.
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { initiateSmartContractPlatformClient } from '@circle-fin/smart-contract-platform';
import { getPublicClient, resolveStartBlock, upsertEnvVars } from './lib/deployment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const ARC_TESTNET_BLOCKCHAIN = 'ARC-TESTNET';
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';

const artifact = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../out/TrancheProtocol.sol/TrancheProtocol.json'), 'utf8'),
);
const abi = artifact.abi;
const bytecode = artifact.bytecode?.object ?? artifact.bytecode;

const contractClient = initiateSmartContractPlatformClient({
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

// Head just before submitting — safe lower-bound fallback for startBlock.
const arcClient = getPublicClient();
let startBlockFloor = null;
try {
  startBlockFloor = await arcClient.getBlockNumber();
} catch {
  console.warn('Could not read current block for startBlock floor.');
}

console.log('Deploying with explicit gasLimit (no estimation)...');
const deployResponse = await contractClient.deployContract({
  idempotencyKey: randomUUID(),
  name: 'TrancheProtocolV2',
  blockchain: ARC_TESTNET_BLOCKCHAIN,
  walletId: process.env.DEPLOYER_WALLET_ID,
  abiJson: JSON.stringify(abi),
  bytecode,
  constructorParameters,
  // EIP-1559 absolute fee. Arc baseFee ~20 gwei; gasLimit generous but under the
  // 30M block limit. Supplying gasLimit makes Circle skip estimation.
  fee: { type: 'absolute', config: { maxFee: '60', priorityFee: '2', gasLimit: '15000000' } },
});

const contractId =
  deployResponse.data?.contractId ?? deployResponse.data?.contract?.id ?? deployResponse.data?.id;
const transactionId =
  deployResponse.data?.transactionId ?? deployResponse.data?.transaction?.id ?? deployResponse.data?.transactionHash;

console.log('Submitted. Contract ID:', contractId, 'Tx ID:', transactionId ?? '(pending)');

let contractAddress = null;
let deploymentTxHash = null;
let attempts = 0;
while (!contractAddress && attempts < 60) {
  await new Promise((r) => setTimeout(r, 5000));
  attempts++;
  const cr = await contractClient.getContract({ id: contractId });
  const c = cr.data?.contract ?? cr.data;
  const status = String(c?.status ?? c?.state ?? '').toUpperCase();
  contractAddress = c?.contractAddress ?? c?.address ?? null;
  deploymentTxHash =
    c?.deploymentTxHash ?? c?.transactionHash ?? c?.txHash ?? transactionId ?? null;
  if (contractAddress) {
    console.log('\nCONFIRMED. Contract address:', contractAddress);
    console.log('Tx hash:', deploymentTxHash ?? '(n/a)');
    break;
  }
  if (status === 'FAILED') {
    console.error('\nDEPLOY FAILED (status FAILED). Contract ID:', contractId);
    process.exit(2);
  }
  process.stdout.write('.');
}

if (!contractAddress) {
  console.error('\nTimed out waiting for confirmation. Contract ID:', contractId);
  process.exit(1);
}

// Persist address + deploy block to deploy/.env so setup/verify and the indexer
// sync script pick them up.
const envPath = path.resolve(__dirname, '.env');
const startBlock = await resolveStartBlock(arcClient, deploymentTxHash, startBlockFloor);
upsertEnvVars(envPath, {
  CONTRACT_ADDRESS: contractAddress,
  ...(startBlock != null ? { CONTRACT_START_BLOCK: startBlock } : {}),
});
console.log('Saved CONTRACT_ADDRESS to deploy/.env');
if (startBlock != null) console.log(`Saved CONTRACT_START_BLOCK=${startBlock} to deploy/.env`);
console.log('Next: cd ../indexer && npm run sync');
