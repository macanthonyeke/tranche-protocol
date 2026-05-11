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

const artifact = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../out/CrossChainEscrow.sol/CrossChainEscrow.json'),
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

async function getSupportedDomains() {
  const domains = [];

  for (let domain = 0; domain <= 31; domain++) {
    if (await readContract('supportedDomains', [domain])) {
      domains.push(domain);
    }
  }

  return domains;
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
  escrowCount,
  paused,
  supportedDomains,
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
  readContract('escrowCount'),
  readContract('paused'),
  getSupportedDomains(),
]);

const [
  arbiterMembers,
  pauserMembers,
  domainManagerMembers,
  defaultAdminMembers,
] = await Promise.all([
  getRoleMembers(arbiterRole),
  getRoleMembers(pauserRole),
  getRoleMembers(domainManagerRole),
  getRoleMembers(DEFAULT_ADMIN_ROLE),
]);

console.log('CrossChainEscrow V2 Deployment Report');
console.log('=====================================');
console.log('Contract address:', CONTRACT_ADDRESS);
console.log('USDC address:', usdc);
console.log('TokenMessenger address:', tokenMessenger);
console.log('Protocol treasury:', protocolTreasury);
console.log(`Protocol fee: ${protocolFeeBps.toString()} bps (${Number(protocolFeeBps) / 100}%)`);
console.log('cctpForwardFee:', cctpForwardFee.toString());
console.log('ARC_DOMAIN:', arcDomain.toString());
console.log('Supported domains 0-31:', supportedDomains.length ? supportedDomains.join(', ') : '(none)');
console.log('escrowCount:', escrowCount.toString());
console.log('Paused:', paused);

console.log('\nRoles');
console.log('-----');
console.log('DEFAULT_ADMIN_ROLE:', DEFAULT_ADMIN_ROLE);
console.log('DEFAULT_ADMIN_ROLE holders:', defaultAdminMembers.length ? defaultAdminMembers.join(', ') : '(none)');
console.log('ARBITER_ROLE:', arbiterRole);
console.log('ARBITER_ROLE holders:', arbiterMembers.length ? arbiterMembers.join(', ') : '(none)');
console.log('PAUSER_ROLE:', pauserRole);
console.log('PAUSER_ROLE holders:', pauserMembers.length ? pauserMembers.join(', ') : '(none)');
console.log('DOMAIN_MANAGER_ROLE:', domainManagerRole);
console.log('DOMAIN_MANAGER_ROLE holders:', domainManagerMembers.length ? domainManagerMembers.join(', ') : '(none)');
