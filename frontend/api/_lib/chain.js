// Minimal read-only viem client for server-side contract reads — currently
// only request-invoice-key.js's authorization check.
//
// Can't import frontend/src/config/wagmi.js here: it references
// import.meta.env (Vite-only, undefined in a plain Node/Vercel serverless
// function) and pulls in wagmi's browser connector stack, neither of which
// belongs in a server context. The RPC URL constant below is duplicated
// from there instead, but both read the same VITE_ARC_RPC_URL_ALCHEMY env
// var (see that file), so there's a single source of truth for the actual
// endpoint even though the client setup itself can't be shared.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http } from 'viem'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ABI_PATH = path.resolve(__dirname, '../../src/abi/TrancheProtocol.json')
// Same VITE_ARC_RPC_URL_ALCHEMY as config/wagmi.js -- Vercel injects every
// env var into a serverless function's process.env regardless of the VITE_
// prefix (that prefix only controls Vite's client-bundle inclusion), so one
// var name covers both the browser and this server context. See wagmi.js
// for why: Circle's shared gateway (the fallback below) has been observed
// returning HTTP 400 on CORS preflight requests.
const ARC_TESTNET_RPC = process.env.VITE_ARC_RPC_URL_ALCHEMY || 'https://rpc.testnet.arc.network'

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
