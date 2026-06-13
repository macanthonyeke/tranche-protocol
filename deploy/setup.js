// WARNING: Deployer holds DEFAULT_ADMIN_ROLE,
// FEE_MANAGER_ROLE, and RECOVERY_MANAGER_ROLE.
// For mainnet, distribute these roles to separate
// multisig wallets before announcing deployment.

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPublicClient, createWalletClient, defineChain, http, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  initiateDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const required = [
  'CIRCLE_API_KEY',
  'CIRCLE_ENTITY_SECRET',
  'DEPLOYER_WALLET_ID',
  'DEPLOYER_ADDRESS',
  'ARBITER_ADDRESS',
  'PAUSER_ADDRESS',
  'DOMAIN_MANAGER_ADDRESS',
  'DOMAIN_MANAGER_PRIVATE_KEY',
  'CONTRACT_ADDRESS',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing: ${key} -- run deploy.js first or fill deploy/.env`);
    process.exit(1);
  }
}

for (const key of [
  'DEPLOYER_ADDRESS',
  'ARBITER_ADDRESS',
  'PAUSER_ADDRESS',
  'DOMAIN_MANAGER_ADDRESS',
  'CONTRACT_ADDRESS',
]) {
  if (!isAddress(process.env[key])) {
    console.error(`Invalid address in env var: ${key}`);
    process.exit(1);
  }
}

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const DEPLOYER_WALLET_ID = process.env.DEPLOYER_WALLET_ID;
const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS;
const DOMAIN_MANAGER_ADDRESS = process.env.DOMAIN_MANAGER_ADDRESS;
const ARC_RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';
const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

if (DOMAIN_MANAGER_ADDRESS.toLowerCase() === DEPLOYER_ADDRESS.toLowerCase()) {
  throw new Error('DOMAIN_MANAGER_ADDRESS must be different from DEPLOYER_ADDRESS.');
}

// Basic sanity check: sensitive roles should not share an address with the
// deployer EOA. A shared address means a single key compromise reaches every
// privileged action. We cannot detect a multisig from off-chain, so the
// strongest signal we have is "this isn't the deployer EOA". For mainnet,
// confirm separately that each address below is a multisig.
const SENSITIVE_ADDRESSES = [
  ['PROTOCOL_TREASURY', process.env.PROTOCOL_TREASURY],
  ['ARBITER_ADDRESS', process.env.ARBITER_ADDRESS],
  ['PAUSER_ADDRESS', process.env.PAUSER_ADDRESS],
];
for (const [label, addr] of SENSITIVE_ADDRESSES) {
  if (!addr) continue;
  if (addr.toLowerCase() === DEPLOYER_ADDRESS.toLowerCase()) {
    console.warn(
      `WARNING: ${label} (${addr}) is the same as DEPLOYER_ADDRESS. ` +
        'A single-key compromise would reach every privileged role. ' +
        'For mainnet, set this to a dedicated multisig.',
    );
  }
}

const domainManagerPrivateKey = process.env.DOMAIN_MANAGER_PRIVATE_KEY.startsWith('0x')
  ? process.env.DOMAIN_MANAGER_PRIVATE_KEY
  : `0x${process.env.DOMAIN_MANAGER_PRIVATE_KEY}`;
const domainManagerAccount = privateKeyToAccount(domainManagerPrivateKey);

if (domainManagerAccount.address.toLowerCase() !== DOMAIN_MANAGER_ADDRESS.toLowerCase()) {
  throw new Error(
    [
      'DOMAIN_MANAGER_PRIVATE_KEY does not match DOMAIN_MANAGER_ADDRESS.',
      `Derived address: ${domainManagerAccount.address}`,
      `Configured address: ${DOMAIN_MANAGER_ADDRESS}`,
    ].join('\n'),
  );
}

const artifact = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../out/TrancheProtocol.sol/TrancheProtocol.json'),
    'utf8',
  ),
);
const abi = artifact.abi;

const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { name: 'Arc', symbol: 'ARC', decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC_URL] },
    public: { http: [ARC_RPC_URL] },
  },
});

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
});

const domainManagerWalletClient = createWalletClient({
  account: domainManagerAccount,
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
});

async function executeAndWait(functionName, args, description) {
  console.log(`\n${description}...`);

  const fn = abi.find((item) => item.type === 'function' && item.name === functionName);
  if (!fn) throw new Error(`Function ${functionName} not found in ABI`);

  const paramTypes = fn.inputs.map((input) => input.type).join(',');
  const abiFunctionSignature = `${functionName}(${paramTypes})`;

  const response = await client.createContractExecutionTransaction({
    walletId: DEPLOYER_WALLET_ID,
    contractAddress: CONTRACT_ADDRESS,
    abiFunctionSignature,
    abiParameters: args.map(String),
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });

  const txId =
    response.data?.id ??
    response.data?.transactionId ??
    response.data?.transaction?.id;
  if (!txId) {
    throw new Error(`No transaction ID returned for ${functionName}`);
  }

  console.log(`Transaction submitted: ${txId}`);

  let attempts = 0;
  while (attempts < 30) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    attempts++;

    const txResponse = await client.getTransaction({ id: txId });
    const transaction = txResponse.data?.transaction ?? txResponse.data;
    const state = String(transaction?.state ?? '').toUpperCase();

    if (['CONFIRMED', 'COMPLETE', 'COMPLETED'].includes(state)) {
      const txHash = transaction?.txHash ?? transaction?.transactionHash ?? transaction?.hash;
      console.log(`Confirmed${txHash ? `: ${txHash}` : '.'}`);
      return txHash;
    }

    if (['FAILED', 'DENIED', 'CANCELLED', 'CANCELED'].includes(state)) {
      throw new Error(`Transaction failed: ${txId} (${state})`);
    }

    process.stdout.write('.');
  }

  throw new Error(`Transaction timed out: ${txId}`);
}

async function executeWithDomainManagerAndWait(functionName, args, description) {
  console.log(`\n${description}...`);

  const hash = await domainManagerWalletClient.writeContract({
    address: CONTRACT_ADDRESS,
    abi,
    functionName,
    args,
  });

  console.log(`Transaction submitted: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`Transaction failed: ${hash}`);
  }

  console.log(`Confirmed: ${hash}`);
  return hash;
}

async function readContract(functionName, args = []) {
  return publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi,
    functionName,
    args,
  });
}

async function grantRoleIfMissing(role, account, label) {
  const hasRole = await readContract('hasRole', [role, account]);
  if (hasRole) {
    console.log(`${label} already held by ${account}.`);
    return;
  }

  await executeAndWait('grantRole', [role, account], `Granting ${label} to ${account}`);
}

function upsertEnvValue(filePath, key, value) {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';

  if (content.includes(`${key}=`)) {
    content = content.replace(new RegExp(`${key}=.*`), `${key}=${value}`);
  } else {
    content += `${content.endsWith('\n') || content.length === 0 ? '' : '\n'}${key}=${value}\n`;
  }

  fs.writeFileSync(filePath, content);
}

function updateFrontendConfig(contractAddress) {
  const envPath = path.resolve(__dirname, '../frontend/.env');
  upsertEnvValue(envPath, 'VITE_CONTRACT_ADDRESS', contractAddress);
}

function updateDownstreamConfig(contractAddress) {
  upsertEnvValue(path.resolve(__dirname, '../bot/.env'), 'CONTRACT_ADDRESS', contractAddress);
  updateFrontendConfig(contractAddress);
  console.log('\nUpdated bot/.env and frontend/.env with contract address.');
}

console.log('Setting up TrancheProtocol V2...');
console.log('Contract:', CONTRACT_ADDRESS);

// Role hashes are keccak256 of their string names. Hardcoded here because
// the constants are internal in the contract and have no public getter.
const arbiterRole      = '0xbb08418a67729a078f87bbc8d02a770929bb68f5bfdf134ae2ead6ed38e2f4ae';
const pauserRole       = '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a';
const domainManagerRole = '0x7792e66be7e1c65b630a8198da6bf1636e24cd26934ca652e146dd12060d06fb';
const feeManagerRole   = '0x6c0757dc3e6b28b2580c03fd9e96c274acf4f99d91fbec9b418fa1d70604ff1c';
const recoveryManagerRole = '0x926fb51ac9583c9ff853ed9f763f17034aa5e977d332565b8a7360cd393448b1';

console.log('ARBITER_ROLE:', arbiterRole);
console.log('PAUSER_ROLE:', pauserRole);
console.log('DOMAIN_MANAGER_ROLE:', domainManagerRole);
console.log('FEE_MANAGER_ROLE:', feeManagerRole);
console.log('RECOVERY_MANAGER_ROLE:', recoveryManagerRole);

const deployerIsAdmin = await readContract('hasRole', [DEFAULT_ADMIN_ROLE, DEPLOYER_ADDRESS]);

if (!deployerIsAdmin) {
  throw new Error(
    [
      'Configured DEPLOYER_ADDRESS does not hold DEFAULT_ADMIN_ROLE.',
      `DEPLOYER_ADDRESS: ${DEPLOYER_ADDRESS}`,
      `DEFAULT_ADMIN_ROLE: ${deployerIsAdmin}`,
      'Check that DEPLOYER_ADDRESS is the on-chain address for DEPLOYER_WALLET_ID and that this contract was deployed by that Circle wallet.',
    ].join('\n'),
  );
}

console.log('Deployer has DEFAULT_ADMIN_ROLE:', deployerIsAdmin);

// ARBITER_ROLE, PAUSER_ROLE, and DOMAIN_MANAGER_ROLE are granted by the
// constructor to the addresses supplied at deploy time, so no grantRole
// calls are needed here. DEFAULT_ADMIN_ROLE / FEE_MANAGER_ROLE /
// RECOVERY_MANAGER_ROLE remain with the deployer — see warning at top of
// file before mainnet.
await grantRoleIfMissing(domainManagerRole, DOMAIN_MANAGER_ADDRESS, 'DOMAIN_MANAGER_ROLE');
await grantRoleIfMissing(feeManagerRole, process.env.ARBITER_ADDRESS, 'FEE_MANAGER_ROLE');
await grantRoleIfMissing(recoveryManagerRole, process.env.ARBITER_ADDRESS, 'RECOVERY_MANAGER_ROLE');

await executeWithDomainManagerAndWait(
  'addSupportedDomain',
  [26],
  'Adding Arc Testnet (domain 26) as supported domain',
);

// INTENTIONAL — initial deploy ships with the CCTP forwarding fee unset.
// Same-chain (Arc -> Arc) releases work because _approveAndBurn forces
// maxFee = 0 there. Cross-chain `claimSilentApproval` and
// `releaseAfterWindow` will revert until a FEE_MANAGER bumps this to
// match Circle's published forwarding fee (`tokenMessenger.getMinFeeAmount`).
// Update with `node setFee.js` before any cross-chain testing.
await executeAndWait(
  'setCctpForwardFee',
  [0],
  'Setting initial CCTP forward fee to 0 (same-chain only for now)',
);

const [
  arbiterSet,
  pauserSet,
  domainManagerSet,
  deployerStillDomainManager,
  deployerFeeManager,
  deployerRecoveryManager,
  arbiterFeeManager,
  arbiterRecoveryManager,
  arcSupported,
  cctpForwardFee,
] = await Promise.all([
  readContract('hasRole', [arbiterRole, process.env.ARBITER_ADDRESS]),
  readContract('hasRole', [pauserRole, process.env.PAUSER_ADDRESS]),
  readContract('hasRole', [domainManagerRole, DOMAIN_MANAGER_ADDRESS]),
  readContract('hasRole', [domainManagerRole, DEPLOYER_ADDRESS]),
  readContract('hasRole', [feeManagerRole, DEPLOYER_ADDRESS]),
  readContract('hasRole', [recoveryManagerRole, DEPLOYER_ADDRESS]),
  readContract('hasRole', [feeManagerRole, process.env.ARBITER_ADDRESS]),
  readContract('hasRole', [recoveryManagerRole, process.env.ARBITER_ADDRESS]),
  readContract('supportedDomains', [26]),
  readContract('cctpForwardFee'),
]);

console.log('\nSetup verification:');
console.log('Arbiter configured:', arbiterSet);
console.log('Pauser configured:', pauserSet);
console.log('Domain manager configured:', domainManagerSet);
console.log('Deployer still domain manager:', deployerStillDomainManager);
console.log('Deployer has FEE_MANAGER_ROLE:', deployerFeeManager);
console.log('Deployer has RECOVERY_MANAGER_ROLE:', deployerRecoveryManager);
console.log(`${process.env.ARBITER_ADDRESS} has FEE_MANAGER_ROLE:`, arbiterFeeManager);
console.log(`${process.env.ARBITER_ADDRESS} has RECOVERY_MANAGER_ROLE:`, arbiterRecoveryManager);
console.log('Arc domain 26 supported:', arcSupported);
console.log('cctpForwardFee:', cctpForwardFee.toString());

updateDownstreamConfig(CONTRACT_ADDRESS);

console.log('\nSetup complete. Run node verify.js to confirm all settings.');
