// Deploy TrancheProtocol by signing a raw transaction via Circle's signing API
// and broadcasting it directly. This bypasses Circle's gas estimation step,
// which rejects the contract due to EIP-170 even though Arc testnet doesn't
// enforce that limit on-chain.
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createPublicClient,
  defineChain,
  encodeDeployData,
  http,
  serializeTransaction,
} from 'viem';
import {
  initiateDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets';
import { getPublicClient, resolveStartBlock, upsertEnvVars } from './lib/deployment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const ARC_CHAIN_ID = 5042002;
const ARC_RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';

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

const artifact = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../out/TrancheProtocol.sol/TrancheProtocol.json'), 'utf8'),
);
const abi = artifact.abi;
const bytecode = artifact.bytecode?.object ?? artifact.bytecode;

const arcChain = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { name: 'Arc', symbol: 'ARC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] }, public: { http: [ARC_RPC_URL] } },
});

const publicClient = createPublicClient({ chain: arcChain, transport: http(ARC_RPC_URL) });

const walletClient = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

const deployerAddress = process.env.DEPLOYER_ADDRESS;

console.log('Fetching nonce and gas prices for', deployerAddress);
const [nonce, feeData, latestBlock] = await Promise.all([
  publicClient.getTransactionCount({ address: deployerAddress }),
  publicClient.estimateFeesPerGas(),
  publicClient.getBlock({ blockTag: 'latest' }),
]);

console.log('Nonce:', nonce);
console.log('maxFeePerGas:', feeData.maxFeePerGas, 'maxPriorityFeePerGas:', feeData.maxPriorityFeePerGas);

// Generous gas limit — Arc testnet has a high block gas limit, no EIP-170 enforcement.
const GAS_LIMIT = 15_000_000n;
// Add headroom over the estimated fee.
const maxFeePerGas = (feeData.maxFeePerGas ?? 30_000_000_000n) * 2n;
const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 2_000_000_000n;

const constructorArgs = [
  USDC_ADDRESS,
  process.env.ARBITER_ADDRESS,
  process.env.PAUSER_ADDRESS,
  process.env.DOMAIN_MANAGER_ADDRESS,
  TOKEN_MESSENGER,
  process.env.PROTOCOL_TREASURY,
];

const deployData = encodeDeployData({ abi, bytecode, args: constructorArgs });

const unsignedTx = {
  chainId: ARC_CHAIN_ID,
  nonce,
  type: 'eip1559',
  gas: GAS_LIMIT,
  maxFeePerGas,
  maxPriorityFeePerGas,
  data: deployData,
  to: null,
  value: 0n,
};

const serialized = serializeTransaction(unsignedTx);
console.log('\nSerialized unsigned tx (hex):', serialized.slice(0, 64), '...');

const arcClient = getPublicClient();
let startBlockFloor = null;
try {
  startBlockFloor = await arcClient.getBlockNumber();
} catch {
  console.warn('Could not read current block for startBlock floor.');
}

console.log('\nRequesting signature from Circle (walletId:', process.env.DEPLOYER_WALLET_ID, ')...');
const signRes = await walletClient.signTransaction({
  walletId: process.env.DEPLOYER_WALLET_ID,
  rawTransaction: serialized,
});

const signedTx = signRes.data?.signedTransaction ?? signRes.data?.data?.signedTransaction;
if (!signedTx) {
  console.error('No signedTransaction in response:', JSON.stringify(signRes.data, null, 2));
  process.exit(1);
}

console.log('Signed. Broadcasting...');
const txHash = await publicClient.sendRawTransaction({ serializedTransaction: signedTx });
console.log('Tx hash:', txHash);

console.log('\nWaiting for receipt...');
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 300_000 });

if (receipt.status !== 'success') {
  console.error('Transaction reverted. Receipt:', JSON.stringify(receipt, null, 2));
  process.exit(1);
}

const contractAddress = receipt.contractAddress;
if (!contractAddress) {
  console.error('No contractAddress in receipt:', JSON.stringify(receipt, null, 2));
  process.exit(1);
}

console.log('\nDeployment confirmed.');
console.log('Contract address:', contractAddress);
console.log('Block:', receipt.blockNumber.toString());

const envPath = path.resolve(__dirname, '.env');
const startBlock = await resolveStartBlock(arcClient, txHash, startBlockFloor);
upsertEnvVars(envPath, {
  CONTRACT_ADDRESS: contractAddress,
  ...(startBlock != null ? { CONTRACT_START_BLOCK: startBlock } : {}),
});
console.log('\nContract address saved to deploy/.env');
if (startBlock != null) console.log(`Deploy block ${startBlock} saved as CONTRACT_START_BLOCK.`);
console.log('\nNext: node setup.js');
