// Minimal read-only viem client for server-side contract reads — currently
// only request-invoice-key.js's authorization check.
//
// Can't import frontend/src/config/wagmi.js here: it references
// import.meta.env (Vite-only, undefined in a plain Node/Vercel serverless
// function) and pulls in wagmi's browser connector stack, neither of which
// belongs in a server context. The RPC URL is duplicated from there instead
// — keep the two in sync if Arc Testnet's endpoint ever changes.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http } from 'viem'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ABI_PATH = path.resolve(__dirname, '../../src/abi/TrancheProtocol.json')
const ARC_TESTNET_RPC = 'https://rpc.testnet.arc.network'

const abi = JSON.parse(fs.readFileSync(ABI_PATH, 'utf8'))
const client = createPublicClient({ transport: http(ARC_TESTNET_RPC) })

/**
 * Single-call read of everything request-invoice-key.js's authorization
 * check needs: recipient, milestone states, and (via `caller`) whether the
 * caller holds ARBITER_ROLE — mirrors the frontend's own use of this same
 * view (see InvoiceCard.jsx / ArbiterPanel.jsx).
 * @param {number|string} escrowId
 * @param {`0x${string}`} caller
 */
export async function getEscrowDetailFor(escrowId, caller) {
  const contractAddress = process.env.VITE_CONTRACT_ADDRESS
  if (!contractAddress) throw new Error('VITE_CONTRACT_ADDRESS is not configured on the server.')
  return client.readContract({
    address: contractAddress,
    abi,
    functionName: 'getEscrowDetail',
    args: [BigInt(escrowId), caller]
  })
}
