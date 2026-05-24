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

async function getRoleMembers(role) {
  const count = await readContract('getRoleMemberCount', [role]);
  const members = [];
  for (let index = 0n; index < count; index++) {
    members.push(await readContract('getRoleMember', [role, index]));
  }
  return members;
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
  arcDomain,
  arbiterRole,
  pauserRole,
  domainManagerRole,
  feeManagerRole,
  recoveryManagerRole,
  escrowCount,
  paused,
  arcSupported,
] = await Promise.all([
  readContract('usdc'),
  readContract('tokenMessenger'),
  readContract('protocolTreasury'),
  readContract('protocolFeeBps'),
  readContract('cctpForwardFee'),
  readContract('ARC_DOMAIN'),
  readContract('ARBITER_ROLE'),
  readContract('PAUSER_ROLE'),
  readContract('DOMAIN_MANAGER_ROLE'),
  readContract('FEE_MANAGER_ROLE'),
  readContract('RECOVERY_MANAGER_ROLE'),
  readContract('escrowCount'),
  readContract('paused'),
  readContract('supportedDomains', [ARC_DOMAIN]),
]);

const [
  defaultAdminMembers,
  arbiterMembers,
  pauserMembers,
  domainManagerMembers,
  feeManagerMembers,
  recoveryManagerMembers,
] = await Promise.all([
  getRoleMembers(DEFAULT_ADMIN_ROLE),
  getRoleMembers(arbiterRole),
  getRoleMembers(pauserRole),
  getRoleMembers(domainManagerRole),
  getRoleMembers(feeManagerRole),
  getRoleMembers(recoveryManagerRole),
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
const expectedArbiter = process.env.ARBITER_ADDRESS;
const expectedPauser = process.env.PAUSER_ADDRESS;
const expectedDomainManager = process.env.DOMAIN_MANAGER_ADDRESS;
const expectedDeployer = process.env.DEPLOYER_ADDRESS;
const expectedTreasury = process.env.PROTOCOL_TREASURY;

record(
  'DEFAULT_ADMIN_ROLE held by deployer',
  expectedDeployer ? defaultAdminMembers.some((m) => eqAddress(m, expectedDeployer)) : false,
  defaultAdminMembers.join(', ') || '(none)',
);
record(
  'ARBITER_ROLE held by configured arbiter',
  expectedArbiter ? arbiterMembers.some((m) => eqAddress(m, expectedArbiter)) : false,
  arbiterMembers.join(', ') || '(none)',
);
record(
  'PAUSER_ROLE held by configured pauser',
  expectedPauser ? pauserMembers.some((m) => eqAddress(m, expectedPauser)) : false,
  pauserMembers.join(', ') || '(none)',
);
record(
  'DOMAIN_MANAGER_ROLE held by configured domain manager',
  expectedDomainManager ? domainManagerMembers.some((m) => eqAddress(m, expectedDomainManager)) : false,
  domainManagerMembers.join(', ') || '(none)',
);
record(
  'FEE_MANAGER_ROLE held by deployer',
  expectedDeployer ? feeManagerMembers.some((m) => eqAddress(m, expectedDeployer)) : false,
  feeManagerMembers.join(', ') || '(none)',
);
record(
  'RECOVERY_MANAGER_ROLE held by deployer',
  expectedDeployer ? recoveryManagerMembers.some((m) => eqAddress(m, expectedDeployer)) : false,
  recoveryManagerMembers.join(', ') || '(none)',
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
