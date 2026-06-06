import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPublicClient, defineChain, encodeFunctionData, http } from 'viem';
import {
  initiateDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
if (!CONTRACT_ADDRESS) throw new Error('CONTRACT_ADDRESS is not set in .env');

const CCTP_FORWARD_FEE = process.env.CCTP_FORWARD_FEE
  ? BigInt(process.env.CCTP_FORWARD_FEE)
  : 100000n;

const ARC_RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';

const SET_FEE_ABI = [
  {
    type: 'function',
    name: 'setCctpForwardFee',
    inputs: [{ name: 'fee', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
];

const READ_FEE_ABI = [
  {
    type: 'function',
    name: 'cctpForwardFee',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
];

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

async function main() {
  console.log('Contract          :', CONTRACT_ADDRESS);
  console.log('cctpForwardFee    :', CCTP_FORWARD_FEE.toString(), 'micro-USDC');

  const callData = encodeFunctionData({
    abi: SET_FEE_ABI,
    functionName: 'setCctpForwardFee',
    args: [CCTP_FORWARD_FEE],
  });

  console.log('Calldata          :', callData);

  const circleClient = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  });

  const response = await circleClient.createContractExecutionTransaction({
    walletId: process.env.DEPLOYER_WALLET_ID,
    contractAddress: CONTRACT_ADDRESS,
    callData,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });

  const txId =
    response.data?.id ??
    response.data?.transactionId ??
    response.data?.transaction?.id;

  if (!txId) {
    console.error('No transaction ID returned:', JSON.stringify(response.data, null, 2));
    process.exit(1);
  }

  console.log('\nTransaction submitted:', txId);
  console.log('Polling every 3 s...\n');

  let confirmed = false;
  for (let i = 1; i <= 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));

    const txResponse = await circleClient.getTransaction({ id: txId });
    const tx = txResponse.data?.transaction ?? txResponse.data;
    const state = String(tx?.state ?? '').toUpperCase();

    console.log(`[${i}] state: ${state}`);

    if (['CONFIRMED', 'COMPLETE', 'COMPLETED'].includes(state)) {
      const hash = tx?.txHash ?? tx?.transactionHash ?? tx?.hash;
      console.log(`\nConfirmed${hash ? ': ' + hash : '.'}`);
      confirmed = true;
      break;
    }

    if (['FAILED', 'DENIED', 'CANCELLED', 'CANCELED'].includes(state)) {
      console.error(`Transaction ${state}: ${txId}`);
      process.exit(1);
    }
  }

  if (!confirmed) {
    console.error('Timed out waiting for confirmation.');
    process.exit(1);
  }

  const fee = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: READ_FEE_ABI,
    functionName: 'cctpForwardFee',
  });

  console.log('\ncctpForwardFee on-chain:', fee.toString());
}

main().catch((err) => {
  console.error('Fatal:', err?.message ?? err);
  process.exit(1);
});
