#!/usr/bin/env node
// One command to re-point the indexer (and the frontend ABI) at the current
// deploy. Run after every contract redeploy or ABI change:
//
//   cd indexer && npm run sync
//
// It:
//   1. reads CONTRACT_ADDRESS + CONTRACT_START_BLOCK from deploy/.env
//      (override with --address 0x.. / --start-block N / --network slug)
//   2. extracts the ABI from out/TrancheProtocol.sol/TrancheProtocol.json to
//      both indexer/abis/ and frontend/src/abi/ (keeps the two copies in sync)
//   3. stamps address + startBlock (+ optional network) into subgraph.yaml and
//      networks.json
//
// After it runs: `npm run codegen && npm run build && npm run deploy`, then set
// VITE_GOLDSKY_ENDPOINT in frontend/.env to the new subgraph URL.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const paths = {
  deployEnv: path.join(repoRoot, 'deploy/.env'),
  artifact: path.join(repoRoot, 'out/TrancheProtocol.sol/TrancheProtocol.json'),
  indexerAbi: path.join(repoRoot, 'indexer/abis/TrancheProtocol.json'),
  frontendAbi: path.join(repoRoot, 'frontend/src/abi/TrancheProtocol.json'),
  subgraphYaml: path.join(repoRoot, 'indexer/subgraph.yaml'),
  networksJson: path.join(repoRoot, 'indexer/networks.json'),
};

function fail(msg) {
  console.error(`sync-config: ${msg}`);
  process.exit(1);
}

// --- tiny arg + .env parsers (no deps) ---
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--address') out.address = argv[++i];
    else if (a === '--start-block') out.startBlock = argv[++i];
    else if (a === '--network') out.network = argv[++i];
  }
  return out;
}

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const args = parseArgs(process.argv.slice(2));
const env = readEnv(paths.deployEnv);

const address = args.address || env.CONTRACT_ADDRESS;
const startBlock = args.startBlock || env.CONTRACT_START_BLOCK;
const network = args.network; // optional; leave subgraph.yaml's network untouched if absent

if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
  fail(`No valid contract address. Set CONTRACT_ADDRESS in deploy/.env or pass --address. Got: ${address ?? '(none)'}`);
}
if (!startBlock || !/^\d+$/.test(String(startBlock))) {
  fail(`No valid start block. Set CONTRACT_START_BLOCK in deploy/.env or pass --start-block. Got: ${startBlock ?? '(none)'}`);
}
const addr = address.toLowerCase();
const block = Number(startBlock);

// --- 1. ABI → both locations ---
if (!fs.existsSync(paths.artifact)) {
  fail(`Artifact not found at ${paths.artifact}. Run \`forge build\` first.`);
}
const artifact = JSON.parse(fs.readFileSync(paths.artifact, 'utf8'));
if (!Array.isArray(artifact.abi)) fail('Artifact has no .abi array.');
const abiJson = JSON.stringify(artifact.abi, null, 2) + '\n';
fs.writeFileSync(paths.indexerAbi, abiJson);
fs.writeFileSync(paths.frontendAbi, abiJson);
console.log(`✓ ABI synced (${artifact.abi.length} entries) → indexer/abis + frontend/src/abi`);

// --- 2. subgraph.yaml: address + startBlock (+ optional network) ---
let yaml = fs.readFileSync(paths.subgraphYaml, 'utf8');
const addrRe = /address:\s*"0x[0-9a-fA-F]{40}"/;
const blockRe = /startBlock:\s*\d+/;
const missing = [];
if (!addrRe.test(yaml)) missing.push('address:');
if (!blockRe.test(yaml)) missing.push('startBlock:');
yaml = yaml.replace(addrRe, `address: "${addr}"`).replace(blockRe, `startBlock: ${block}`);
if (network) yaml = yaml.replace(/network:\s*\S+/, `network: ${network}`);
if (missing.length) {
  console.warn(`⚠ subgraph.yaml: could not find ${missing.join(' / ')} line(s). Check the file manually.`);
}
fs.writeFileSync(paths.subgraphYaml, yaml);
console.log(`✓ subgraph.yaml → address ${addr}, startBlock ${block}${network ? `, network ${network}` : ''}`);

// --- 3. networks.json ---
const networks = JSON.parse(fs.readFileSync(paths.networksJson, 'utf8'));
const netKey = network || Object.keys(networks)[0];
if (!networks[netKey]) networks[netKey] = {};
networks[netKey].TrancheProtocol = { address: addr, startBlock: block };
fs.writeFileSync(paths.networksJson, JSON.stringify(networks, null, 2) + '\n');
console.log(`✓ networks.json [${netKey}].TrancheProtocol updated`);

console.log('\nNext:');
console.log('  npm run codegen && npm run build');
console.log('  npm run deploy   # then set VITE_GOLDSKY_ENDPOINT in frontend/.env');
