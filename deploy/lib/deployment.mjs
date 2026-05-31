// Shared deployment helpers: capture the on-chain deploy block and persist
// deploy results to deploy/.env. Used by deploy.js and deploy-explicit-gas.mjs.
import fs from 'fs';
import { createPublicClient, defineChain, http } from 'viem';

const DEFAULT_RPC = 'https://rpc.testnet.arc.network';

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { name: 'Arc', symbol: 'ARC', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.ARC_RPC_URL || DEFAULT_RPC] },
    public: { http: [process.env.ARC_RPC_URL || DEFAULT_RPC] },
  },
});

export function getPublicClient(rpc) {
  const url = rpc || process.env.ARC_RPC_URL || DEFAULT_RPC;
  return createPublicClient({ chain: arcTestnet, transport: http(url) });
}

// Resolves the block the contract was created at. Prefers the exact receipt
// block when we have a real 0x tx hash; otherwise falls back to `floorBlock`
// (the head captured just before the deploy was submitted), which is a safe
// lower bound — the subgraph will scan a few empty blocks but never miss data.
export async function resolveStartBlock(client, txHash, floorBlock) {
  if (txHash && /^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      if (receipt?.blockNumber != null) return Number(receipt.blockNumber);
    } catch {
      // fall through to floor
    }
  }
  return floorBlock != null ? Number(floorBlock) : null;
}

// Idempotently sets KEY=value lines in an env file (removes any existing or
// commented-out copies of each key first).
export function upsertEnvVars(envPath, vars) {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  let lines = content.split(/\r?\n/);
  for (const [key, val] of Object.entries(vars)) {
    const re = new RegExp(`^\\s*#?\\s*${key}=`);
    lines = lines.filter((l) => !re.test(l));
    lines.push(`${key}=${val}`);
  }
  fs.writeFileSync(envPath, lines.join('\n').replace(/\n*$/, '\n'));
}
