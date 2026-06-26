// Post-deploy verification. Reads on-chain state via the Arc RPC and
// logs PASSED / FAILED for each invariant the setup script is supposed
// to leave in place. Exits non-zero if any check fails so this can be
// wired into CI / release scripts.

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPublicClient, defineChain, http, isAddress } from 'viem';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

if (!process.env.CONTRACT_ADDRESS) {
  console.error('Missing CONTRACT_ADDRESS. Run deploy.js first or fill deploy/.env.');
  process.exit(1);
}

if (!isAddress(process.env.CONTRACT_ADDRESS)) {
  console.error('Invalid CONTRACT_ADDRESS in deploy/.env.');
  process.exit(1);
}

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const ARC_RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';
const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';
const ARC_DOMAIN = 26;
const EXPECTED_PROTOCOL_FEE_BPS = 199n;

// Role hashes are keccak256 of their string names. Defined locally — mirrors
// setup.js byte-for-byte — because the role constants are `internal` in the
// contract and have no public getter to read.
const arbiterRole = '0xbb08418a67729a078f87bbc8d02a770929bb68f5bfdf134ae2ead6ed38e2f4ae';
const pauserRole = '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a';
const domainManagerRole = '0x7792e66be7e1c65b630a8198da6bf1636e24cd26934ca652e146dd12060d06fb';
const feeManagerRole = '0x6c0757dc3e6b28b2580c03fd9e96c274acf4f99d91fbec9b418fa1d70604ff1c';
const recoveryManagerRole = '0x926fb51ac9583c9ff853ed9f763f17034aa5e977d332565b8a7360cd393448b1';

const artifact = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../out/TrancheProtocol.sol/TrancheProtocol.json'),
    'utf8',
  ),
);
const abi = artifact.abi;

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

function readContract(functionName, args = []) {
  return publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi,
    functionName,
    args,
  });
}

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASSED' : 'FAILED'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function eqAddress(a, b) {
  return a && b && a.toLowerCase() === b.toLowerCase();
}

const [
  usdc,
  tokenMessenger,
  protocolTreasury,
  protocolFeeBps,
  cctpForwardFee,
  protocolConfig,
  escrowCount,
  paused,
  arcSupported,
] = await Promise.all([
  readContract('usdc'),
  readContract('tokenMessenger'),
  readContract('protocolTreasury'),
  readContract('protocolFeeBps'),
  readContract('cctpForwardFee'),
  readContract('getProtocolConfig'),
  readContract('escrowCount'),
  readContract('paused'),
  readContract('supportedDomains', [ARC_DOMAIN]),
]);

// ARC_DOMAIN is an internal constant with no standalone getter; read it from
// the getProtocolConfig() struct instead.
const arcDomain = protocolConfig.arcDomain;

const expectedArbiter = process.env.ARBITER_ADDRESS;
const expectedPauser = process.env.PAUSER_ADDRESS;
const expectedDomainManager = process.env.DOMAIN_MANAGER_ADDRESS;
const expectedDeployer = process.env.DEPLOYER_ADDRESS;
const expectedTreasury = process.env.PROTOCOL_TREASURY;

const [
  deployerIsDefaultAdmin,
  arbiterHasRole,
  pauserHasRole,
  domainManagerHasRole,
  deployerIsFeeManager,
  deployerIsRecoveryManager,
] = await Promise.all([
  expectedDeployer ? readContract('hasRole', [DEFAULT_ADMIN_ROLE, expectedDeployer]) : false,
  expectedArbiter ? readContract('hasRole', [arbiterRole, expectedArbiter]) : false,
  expectedPauser ? readContract('hasRole', [pauserRole, expectedPauser]) : false,
  expectedDomainManager ? readContract('hasRole', [domainManagerRole, expectedDomainManager]) : false,
  expectedDeployer ? readContract('hasRole', [feeManagerRole, expectedDeployer]) : false,
  expectedDeployer ? readContract('hasRole', [recoveryManagerRole, expectedDeployer]) : false,
]);

console.log('TrancheProtocol V2 Deployment Verification');
console.log('===========================================');
console.log('Contract:', CONTRACT_ADDRESS);
console.log('USDC:', usdc);
console.log('TokenMessenger:', tokenMessenger);
console.log('Treasury:', protocolTreasury);
console.log(`Protocol fee: ${protocolFeeBps.toString()} bps`);
console.log('cctpForwardFee:', cctpForwardFee.toString());
console.log('ARC_DOMAIN:', arcDomain.toString());
console.log('escrowCount:', escrowCount.toString());
console.log('');

// --- Role assignments ---
record(
  'DEFAULT_ADMIN_ROLE held by deployer',
  deployerIsDefaultAdmin === true,
  `deployer=${expectedDeployer ?? '(unset)'}`,
);
record(
  'ARBITER_ROLE held by configured arbiter',
  arbiterHasRole === true,
  `arbiter=${expectedArbiter ?? '(unset)'}`,
);
record(
  'PAUSER_ROLE held by configured pauser',
  pauserHasRole === true,
  `pauser=${expectedPauser ?? '(unset)'}`,
);
record(
  'DOMAIN_MANAGER_ROLE held by configured domain manager',
  domainManagerHasRole === true,
  `domainManager=${expectedDomainManager ?? '(unset)'}`,
);
record(
  'FEE_MANAGER_ROLE held by deployer',
  deployerIsFeeManager === true,
  `deployer=${expectedDeployer ?? '(unset)'}`,
);
record(
  'RECOVERY_MANAGER_ROLE held by deployer',
  deployerIsRecoveryManager === true,
  `deployer=${expectedDeployer ?? '(unset)'}`,
);

// --- Pause state ---
record('Contract is not paused', paused === false, `paused=${paused}`);

// --- Protocol fee ---
record(
  `Protocol fee equals expected ${EXPECTED_PROTOCOL_FEE_BPS} bps`,
  BigInt(protocolFeeBps) === EXPECTED_PROTOCOL_FEE_BPS,
  `actual=${protocolFeeBps.toString()} bps`,
);

// --- Supported domains ---
record(
  `Arc domain (${ARC_DOMAIN}) is in the supported allow-list`,
  arcSupported === true,
  `supportedDomains[${ARC_DOMAIN}]=${arcSupported}`,
);

// --- Treasury address ---
record(
  'Treasury matches configured PROTOCOL_TREASURY',
  expectedTreasury ? eqAddress(protocolTreasury, expectedTreasury) : false,
  `on-chain=${protocolTreasury}, env=${expectedTreasury ?? '(unset)'}`,
);

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(
  `Result: ${results.length - failed.length} passed, ${failed.length} failed`,
);

if (failed.length > 0) {
  console.error('Verification FAILED. See above.');
  process.exit(1);
}

console.log('Verification PASSED.');
