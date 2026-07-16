// One-off end-to-end health check: creates a real escrow on Arc Testnet
// against the currently deployed contract, walks it through claim + approve,
// then cross-checks on-chain state against the Goldsky subgraph.
// Not part of the deploy pipeline — safe to delete after running.
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import {
  createPublicClient, createWalletClient, http, keccak256, toHex,
  decodeEventLog, pad, parseUnits, formatUnits
} from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { defineChain } from 'viem'

const ABI = JSON.parse(readFileSync(new URL('../frontend/src/abi/TrancheProtocol.json', import.meta.url)))
const USDC_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] }
]

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000'
const ARC_DOMAIN = 26
const GOLDSKY_ENDPOINT = 'https://api.goldsky.com/api/public/project_cmpuerrux1uoo01x8gljs18vq/subgraphs/tranche-protocol/0.5.2/gn'

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL] } }
})

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() })

const payer = privateKeyToAccount(process.env.DOMAIN_MANAGER_PRIVATE_KEY)
const freelancerPk = generatePrivateKey()
const freelancer = privateKeyToAccount(freelancerPk)

const payerClient = createWalletClient({ account: payer, chain: arcTestnet, transport: http() })
const freelancerClient = createWalletClient({ account: freelancer, chain: arcTestnet, transport: http() })

function addressToBytes32(addr) { return pad(addr, { size: 32 }) }

async function gql(query, variables) {
  const res = await fetch(GOLDSKY_ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  const json = await res.json()
  if (json.errors) throw new Error(JSON.stringify(json.errors))
  return json.data
}

async function main() {
  console.log('Payer     :', payer.address)
  console.log('Freelancer:', freelancer.address, '(throwaway, generated for this test)')
  console.log('Contract  :', CONTRACT_ADDRESS)
  console.log()

  // 1. Fund freelancer with a little native balance so it can pay gas for claimDelivery.
  console.log('-> Funding freelancer with 0.02 USDC (native) for gas...')
  let hash = await payerClient.sendTransaction({ to: freelancer.address, value: parseUnits('0.02', 18) })
  await publicClient.waitForTransactionReceipt({ hash })

  // 2. Approve + deposit a small 1-milestone escrow.
  const totalAmount = parseUnits('1', 6) // 1.00 USDC
  console.log('-> Approving USDC spend...')
  hash = await payerClient.writeContract({
    address: USDC_ADDRESS, abi: USDC_ABI, functionName: 'approve',
    args: [CONTRACT_ADDRESS, totalAmount]
  })
  await publicClient.waitForTransactionReceipt({ hash })

  const now = Math.floor(Date.now() / 1000)
  const invoiceJson = JSON.stringify({ version: 1, note: 'internal e2e health-check escrow', issuedAt: new Date().toISOString() })
  const invoiceHash = keccak256(toHex(invoiceJson))

  console.log('-> Depositing (creating escrow)...')
  hash = await payerClient.writeContract({
    address: CONTRACT_ADDRESS, abi: ABI, functionName: 'deposit',
    args: [
      freelancer.address,
      '0x0000000000000000000000000000000000000000',
      totalAmount,
      ARC_DOMAIN,
      addressToBytes32(freelancer.address),
      86400n, // 1-day review window (MIN_REVIEW_WINDOW)
      invoiceHash,
      'none', // mirrors CreateEscrow.jsx's NO_ATTACHMENT_URI sentinel for a blank attachment field
      [totalAmount],
      BigInt(now + 2 * 86400),
      [],
      invoiceJson
    ]
  })
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash })

  let escrowId
  for (const log of depositReceipt.logs) {
    if (log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue
    try {
      const dec = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics })
      if (dec.eventName === 'EscrowCreated') { escrowId = dec.args.escrowId; break }
    } catch {}
  }
  if (escrowId === undefined) throw new Error('EscrowCreated event not found in receipt')
  console.log('   Escrow created, id =', escrowId.toString(), 'tx =', hash)

  // 3. Freelancer acknowledges the invoice (required before claimDelivery).
  console.log('-> Freelancer calling acknowledgeInvoice...')
  hash = await freelancerClient.writeContract({
    address: CONTRACT_ADDRESS, abi: ABI, functionName: 'acknowledgeInvoice',
    args: [escrowId]
  })
  await publicClient.waitForTransactionReceipt({ hash })
  console.log('   acknowledgeInvoice tx =', hash)

  // 4. Freelancer claims delivery on milestone 0.
  console.log('-> Freelancer calling claimDelivery...')
  hash = await freelancerClient.writeContract({
    address: CONTRACT_ADDRESS, abi: ABI, functionName: 'claimDelivery',
    args: [escrowId, 0n]
  })
  await publicClient.waitForTransactionReceipt({ hash })
  console.log('   claimDelivery tx =', hash)

  // 4. Payer approves release immediately (same-chain, maxFee=0).
  console.log('-> Payer calling approveRelease...')
  hash = await payerClient.writeContract({
    address: CONTRACT_ADDRESS, abi: ABI, functionName: 'approveRelease',
    args: [escrowId, 0n, 0n]
  })
  await publicClient.waitForTransactionReceipt({ hash })
  console.log('   approveRelease tx =', hash)

  // 5. Verify on-chain final state.
  const escrow = await publicClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'getEscrow', args: [escrowId] })
  const milestones = await publicClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'getMilestones', args: [escrowId] })
  const freelancerBalance = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: 'balanceOf', args: [freelancer.address] })

  console.log()
  console.log('=== On-chain state ===')
  console.log('Escrow state (0=ACTIVE,1=COMPLETED,2=CANCELLED):', escrow.state)
  console.log('Milestone[0] state (0=PENDING,1=IN_REVIEW,2=DISPUTED,3=RELEASED,4=REFUNDED):', milestones[0].state)
  console.log('Freelancer USDC balance after release:', formatUnits(freelancerBalance, 6), 'USDC (started at 0.02 native-funded, expect ~0.98 more from release)')

  // 6. Cross-check the subgraph picked it up.
  console.log()
  console.log('-> Waiting 5s then querying subgraph for this escrow...')
  await new Promise((r) => setTimeout(r, 5000))
  const data = await gql(`
    query($id: String!) {
      escrow(id: $id) {
        escrowId depositor recipient state totalAmount invoiceHash
        milestones { index state settledVia }
      }
      _meta { block { number } hasIndexingErrors }
    }
  `, { id: escrowId.toString() })

  console.log('=== Subgraph state ===')
  console.log(JSON.stringify(data, null, 2))
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
