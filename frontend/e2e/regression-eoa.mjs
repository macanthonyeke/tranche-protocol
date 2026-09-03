// EOA-only end-to-end regression driver for the Tranche frontend.
//
// Drives the REAL app (not raw contract calls) via Playwright, with a
// Playwright-injected EIP-1193 provider standing in for a browser wallet
// extension. wagmi's plain `injected()` connector picks it up exactly like
// it would MetaMask -- this exercises the same useAuth/useTx dispatch path
// a real EOA user hits, which is the thing the Circle UCW work could
// plausibly have regressed.
//
// The injected provider is a thin browser-side stub whose .request() calls
// back into Node (via page.exposeFunction) where a real viem WalletClient
// holding the burner private key does the actual signing/sending. The key
// never enters the browser context. Every eth_sendTransaction that crosses
// this bridge is recorded with its real hash, then independently confirmed
// with a direct RPC read (publicClient.waitForTransactionReceipt /
// readContract) -- so "pass" means the chain actually changed state, not
// just that the UI showed a success toast.
//
// Covers: happy-path release, dispute resolution (full release / full
// refund / arbitrary split), and mutual cancellation + refund withdrawal.
// Deliberately NOT covered: the two time-gated permissionless paths
// (release() after reviewWindow expiry, refundAfterDeadline() after the
// 72h delivery grace period) -- both require real multi-day waits with no
// way to compress them on live testnet, and both already have
// deterministic coverage in the 275 Foundry tests.
//
// Before anything else runs, assertRpcChainId() confirms config.json's
// rpcUrl actually answers as Arc Testnet (chain 5042002). A clean HTTP
// response is not evidence of which chain answered it -- Multicall3 (and
// plenty else) is deployed at the same address on most EVM chains, so a
// misconfigured endpoint can return well-formed-looking data for the
// wrong network and fail silently deep into a run instead of loudly up
// front. Caught for real once: a Vercel env var pointed at an Alchemy
// Ethereum Mainnet app instead of the Arc Testnet one.
//
// Usage: E2E_CONFIG=/path/to/config.json node regression-eoa.mjs
// Config (burner private keys + Vercel protection-bypass secret) is never
// read from inside this repo -- point E2E_CONFIG at a file outside the
// working tree so a secret can't accidentally get committed.

import { chromium } from 'playwright'
import { createWalletClient, createPublicClient, http, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const configPath = process.env.E2E_CONFIG
if (!configPath) throw new Error('Set E2E_CONFIG=/path/to/config.json (outside the repo)')
const cfg = JSON.parse(readFileSync(configPath, 'utf8'))

const { baseUrl, bypassSecret, payerKey, freelancerKey, arbiterKey, contractAddress, usdcAddress, rpcUrl } = cfg

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: [rpcUrl] } }
})

const ESCROW_ABI = JSON.parse(
  readFileSync(join(__dirname, '../src/abi/TrancheProtocol.json'), 'utf8')
)
const USDC_ABI = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }]

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) })

const MILESTONE_STATE = ['PENDING', 'IN_REVIEW', 'DISPUTED', 'RELEASED', 'REFUNDED']
const ESCROW_STATE = ['ACTIVE', 'COMPLETED', 'CANCELLED']
const stringify = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x))
const maskedRpcUrl = () => new URL(rpcUrl).origin + '/***'

// Retries a read against the flaky public RPC on 429/network errors.
async function withRetry(fn, { retries = 4, delayMs = 2000 } = {}) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try { return await fn() } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)))
    }
  }
  throw lastErr
}

// Preflight, run before anything else in main(): confirm rpcUrl actually
// answers as Arc Testnet before spending any time or gas on the rest of
// the suite. Fails loud and immediately on a mismatch -- see the file
// header for why a clean response alone was never good enough evidence.
// Retried like any other RPC call here: a transient DNS/connect hiccup
// (observed in this sandbox -- occasional resolver timeouts that clear up
// within a couple of seconds) shouldn't abort the whole run on its own,
// but a genuine wrong-chain answer still fails immediately, no retry.
async function assertRpcChainId() {
  let json
  try {
    json = await withRetry(async () => {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'eth_chainId', params: [] })
      })
      return res.json()
    }, { retries: 3, delayMs: 2000 })
  } catch (err) {
    throw new Error(
      `RPC preflight FAILED: could not reach ${maskedRpcUrl()} at all after retries (${err.message}). Check connectivity/rpcUrl in config.json -- refusing to proceed.`
    )
  }
  const decimalChainId = json.result ? parseInt(json.result, 16) : null
  if (decimalChainId !== arcTestnet.id) {
    throw new Error(
      `RPC preflight FAILED: ${maskedRpcUrl()} answered chain ${decimalChainId} (raw: ${JSON.stringify(json)}), expected Arc Testnet (${arcTestnet.id}). Fix rpcUrl in config.json before rerunning -- refusing to proceed.`
    )
  }
  console.log(`RPC preflight OK: ${maskedRpcUrl()} confirmed as chain ${decimalChainId} (Arc Testnet).`)
}

async function readMilestone0(escrowId) {
  const list = await withRetry(() => publicClient.readContract({
    address: contractAddress, abi: ESCROW_ABI, functionName: 'getMilestones', args: [BigInt(escrowId)]
  }))
  const m = list[0]
  return { ...m, stateName: MILESTONE_STATE[m.state] }
}

async function readEscrow(escrowId) {
  const e = await withRetry(() => publicClient.readContract({
    address: contractAddress, abi: ESCROW_ABI, functionName: 'getEscrow', args: [BigInt(escrowId)]
  }))
  return { ...e, stateName: ESCROW_STATE[e.state] }
}

// Named-field dispute data (getEscrowDetail's tuple has named components,
// unlike the raw `disputes` mapping getter) -- used only for the dispute
// scenarios below.
async function readDispute0(escrowId) {
  const detail = await withRetry(() => publicClient.readContract({
    address: contractAddress, abi: ESCROW_ABI, functionName: 'getEscrowDetail',
    args: [BigInt(escrowId), '0x0000000000000000000000000000000000000000']
  }))
  return detail.disputes[0]
}

async function usdcBalanceOf(address) {
  return withRetry(() => publicClient.readContract({ address: usdcAddress, abi: USDC_ABI, functionName: 'balanceOf', args: [address] }))
}

async function refundBalanceOf(address) {
  return withRetry(() => publicClient.readContract({ address: contractAddress, abi: ESCROW_ABI, functionName: 'refundBalances', args: [address] }))
}

const results = []
function record(step, ok, detail) {
  results.push({ step, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${step}${detail ? ': ' + detail : ''}`)
}

// ---- Injected EIP-1193 provider (runs in the PAGE context) ----
const injectedProviderSrc = (chainIdHex) => `
(() => {
  const listeners = {};
  const provider = {
    isMetaMask: true,
    selectedAddress: null,
    chainId: '${chainIdHex}',
    request: async ({ method, params }) => {
      const result = await window.__eip1193Request({ method, params });
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
        provider.selectedAddress = result[0] || null;
      }
      return result;
    },
    on: (event, cb) => { (listeners[event] ||= []).push(cb); },
    removeListener: (event, cb) => {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((f) => f !== cb);
    }
  };
  window.ethereum = provider;
})();
`

// Node-side handler for every provider.request() call. sentHashes is a
// shared array the test loop polls to know when a wallet action actually
// produced a broadcast transaction.
function makeEip1193Handler(walletClient, account, sentHashes) {
  return async ({ method, params }) => {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [account.address]
      case 'eth_chainId':
        return '0x' + arcTestnet.id.toString(16)
      case 'net_version':
        return String(arcTestnet.id)
      case 'wallet_switchEthereumChain':
      case 'wallet_addEthereumChain':
        return null
      case 'eth_sendTransaction': {
        const tx = params[0]
        const hash = await walletClient.sendTransaction({
          account, to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined
        })
        sentHashes.push(hash)
        return hash
      }
      default:
        throw new Error(`E2E stub provider: unhandled method ${method}`)
    }
  }
}

async function newWalletContext(browser, privateKey) {
  const account = privateKeyToAccount(privateKey)
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(rpcUrl) })
  const sentHashes = []
  const context = await browser.newContext()
  // Scoped to the app's own origin only -- setting this context-wide via
  // extraHTTPHeaders also attaches it to cross-origin requests (e.g. the
  // page's own fetches to rpc.testnet.arc.network for wagmi reads), which
  // then fail CORS preflight because that header isn't in the RPC's
  // Access-Control-Allow-Headers. Bare object-mode route() applies to every
  // request in the context but lets us inspect the URL before deciding.
  const baseOrigin = new URL(baseUrl).origin
  await context.route('**/*', (route) => {
    const req = route.request()
    const u = new URL(req.url())
    if (u.origin === baseOrigin) {
      return route.continue({
        headers: { ...req.headers(), 'x-vercel-protection-bypass': bypassSecret, 'x-vercel-set-bypass-cookie': 'true' }
      })
    }
    // The deployed app's bundled config/wagmi.js hardcodes
    // https://rpc.testnet.arc.network -- our config.json's rpcUrl only
    // controls this script's OWN direct reads/tx-broadcasting, not the
    // page's internal wagmi reads. Circle's shared gateway is currently
    // returning HTTP 400 on CORS preflight (reproduced independently with
    // raw curl -X OPTIONS, outside this harness or the app), which blocks
    // every browser-side RPC call regardless of retries. Transparently
    // redirect the browser's requests to a working RPC endpoint (rpcUrl,
    // e.g. Alchemy) for this test run -- does not touch the deployed app's
    // bundled config.
    if (u.hostname === 'rpc.testnet.arc.network') {
      return route.continue({ url: rpcUrl })
    }
    return route.continue()
  })
  await context.exposeFunction('__eip1193Request', makeEip1193Handler(walletClient, account, sentHashes))
  await context.addInitScript(injectedProviderSrc('0x' + arcTestnet.id.toString(16)))
  const page = await context.newPage()
  // Raises Playwright's default actionability timeout for every action on
  // this page (click/fill/waitFor/etc.) from the 30s default to 45s.
  // Playwright already polls an element's actionability (visible + enabled
  // + stable) internally until this timeout -- this replaces a set of
  // blind fixed-length sleeps that used to run before every RPC-gated
  // button click, giving react-query's own default retry/backoff room to
  // land without guessing how long that takes.
  page.setDefaultTimeout(45000)
  page.on('pageerror', (err) => console.error(`[pageerror:${account.address.slice(0, 10)}]`, err.message))
  page.on('console', (msg) => { if (msg.type() === 'error') console.error(`[console:${account.address.slice(0, 10)}]`, msg.text()) })
  return { context, page, account, walletClient, sentHashes, connected: false }
}

async function connectWallet(page) {
  await page.getByRole('button', { name: /connect wallet/i }).click()
  // Arc Testnet's shared public RPC rate-limits aggressively under any
  // burst (documented in config/wagmi.js: "37/41 requests came back 429 on
  // a single /create load"); react-query's default retry/backoff means the
  // pill can take a while to settle even though the connect itself is
  // instant and purely local (no RPC involved). Generous timeout here is
  // about tolerating that infra behavior, not the connect step itself.
  // truncateAddr (utils/format.js) renders "0x1234...abcd" -- three literal
  // ASCII dots, not a unicode ellipsis.
  await page.getByText(/0x[a-fA-F0-9]{4}\.\.\.[a-fA-F0-9]{4}/).first().waitFor({ timeout: 45000 })
}

// Wagmi auto-reconnects the injected connector on every fresh page load
// (localStorage-persisted "last connector" + our stub always answering
// eth_accounts truthfully) -- so "Connect Wallet" only needs a real click
// the first time per wallet context, verified empirically in the original
// single-scenario run (payer's second page.goto() never needed to
// reconnect). Subsequent scenarios reusing the same wallet context just
// skip straight past this.
async function ensureConnected(wallet) {
  if (wallet.connected) return
  await connectWallet(wallet.page)
  wallet.connected = true
}

// useSupportedDomains() (a read-only, wallet-independent multicall predating
// the UCW work entirely) doesn't auto-retry on the shared RPC's 429s the way
// most of the app's queries do -- one failed attempt leaves `domainsFailed`
// permanently true for the rest of the page's life, surfacing "Add a
// supported destination chain to continue" even though supportedDomains(26)
// is true on-chain. The app already ships a manual Retry control for exactly
// this (CreateEscrow.jsx's AdvancedSection, gated on domainsFailed) -- drive
// that instead of reloading and losing the filled-in form.
async function ensureDomainsLoaded(page, { attempts = 4 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const blocked = await page.getByText(/supported destination chain/i).count()
    if (blocked === 0) return
    const retryBtn = page.getByRole('button', { name: /^retry$/i })
    if (await retryBtn.count() === 0) {
      // Advanced settings isn't open yet -- the same missing-field link in
      // the review panel jumps there (see CreateEscrow.jsx's onJump). The
      // underlying query can still be in flight, re-rendering this exact
      // text out from under the click (Playwright's stability check then
      // throws) -- same tolerance as the Retry click below, just retry the
      // whole loop rather than letting one flaky click abort the scenario.
      await page.getByText(/supported destination chain/i).first().click({ timeout: 5000 }).catch(() => {})
    }
    await page.getByRole('button', { name: /^retry$/i }).click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(4000 * (i + 1))
  }
}

// Clicks the given locator, then waits for the injected provider to have
// relayed a NEW eth_sendTransaction, and confirms it on-chain directly via
// RPC (not by trusting any UI state). Returns { hash, receipt }.
async function clickAndConfirm(page, locator, sentHashes, label, timeoutMs = 60000) {
  const before = sentHashes.length
  await locator.click()
  const deadline = Date.now() + timeoutMs
  while (sentHashes.length === before && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250))
  }
  if (sentHashes.length === before) throw new Error(`${label}: no transaction was broadcast within ${timeoutMs}ms`)
  const hash = sentHashes[sentHashes.length - 1]
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: timeoutMs })
  if (receipt.status !== 'success') throw new Error(`${label}: tx ${hash} reverted on-chain`)
  return { hash, receipt }
}

// ---------------- Reusable flow steps ----------------

async function createEscrow(payer, freelancerAddress, label) {
  await payer.page.goto(`${baseUrl}/create`, { waitUntil: 'domcontentloaded' })
  await ensureConnected(payer)

  await payer.page.getByPlaceholder('0x…').fill(freelancerAddress)
  await payer.page.locator('input[placeholder="0.00"]').first().fill('1')
  await payer.page.getByPlaceholder(/describe the work/i).fill(`E2E ${label} — safe to ignore.`)
  await payer.page.getByLabel('Milestone 1 amount').fill('1')

  const deadline = new Date(Date.now() + 2 * 24 * 3600 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  const deadlineStr = `${deadline.getFullYear()}-${pad(deadline.getMonth() + 1)}-${pad(deadline.getDate())}T${pad(deadline.getHours())}:${pad(deadline.getMinutes())}`
  await payer.page.locator('input[type="datetime-local"]').fill(deadlineStr)

  await ensureDomainsLoaded(payer.page)

  // Arc's native USDC precompile doesn't reset/decrement allowance the way
  // a standard ERC20 does (see CLAUDE.md's hazard note: SafeERC20 approve
  // doesn't work against it either) -- this payer wallet has already
  // approved this contract for >= 1 USDC across many prior test escrows
  // this session, so this step may already be satisfied. CreateEscrow.jsx's
  // FlowStep (line ~1628) renders structurally different markup depending
  // on `done`: a plain "Approved" <div> (NOT a button -- a getByRole
  // button locator can never match it and will wait forever) when already
  // approved, vs. a real <button>Approve</button> otherwise. Wait for
  // whichever actually shows up, scoped to the review section to avoid any
  // other same-named element elsewhere on the page.
  const reviewSection = payer.page.locator('#section-review')
  const alreadyApprovedLabel = reviewSection.getByText('Approved', { exact: true })
  const approveButton = reviewSection.getByRole('button', { name: /^approve$/i })
  await Promise.any([
    alreadyApprovedLabel.first().waitFor({ timeout: 45000 }),
    approveButton.first().waitFor({ timeout: 45000 })
  ])
  if (await alreadyApprovedLabel.count() > 0) {
    record(`${label}: approve USDC allowance`, true, 'already approved from a prior escrow — skipped')
  } else {
    const { hash: approveHash } = await clickAndConfirm(
      payer.page, approveButton.first(), payer.sentHashes, `${label}: approve USDC`, 120000
    )
    record(`${label}: approve USDC allowance`, true, `tx=${approveHash}`)
  }

  await payer.page.getByRole('button', { name: /lock funds/i }).click()
  const { hash: depositHash } = await clickAndConfirm(
    payer.page, payer.page.getByRole('button', { name: /sign and lock/i }), payer.sentHashes, `${label}: deposit escrow`, 120000
  )
  await payer.page.waitForURL(/\/escrow\/\d+/, { timeout: 30000 })
  const escrowId = Number(payer.page.url().match(/\/escrow\/(\d+)/)[1])
  record(`${label}: create + deposit escrow`, true, `tx=${depositHash} escrowId=${escrowId}`)
  return escrowId
}

async function ackAndClaim(freelancer, escrowId, label) {
  await freelancer.page.goto(`${baseUrl}/escrow/${escrowId}`, { waitUntil: 'domcontentloaded' })
  await ensureConnected(freelancer)

  const { hash: ackHash } = await clickAndConfirm(
    freelancer.page, freelancer.page.getByRole('button', { name: /accept terms/i }), freelancer.sentHashes, `${label}: acknowledgeInvoice`, 120000
  )
  record(`${label}: acknowledgeInvoice`, true, `tx=${ackHash}`)

  // FocusBar (the page's "what to act on now" shortcut) and the inline
  // per-milestone action both render a button with the same accessible
  // name -- scope to the milestone's own container to disambiguate.
  const { hash: claimHash } = await clickAndConfirm(
    freelancer.page, freelancer.page.locator('#milestone-0').getByRole('button', { name: /mark as delivered/i }), freelancer.sentHashes, `${label}: claimDelivery`, 120000
  )
  record(`${label}: claimDelivery`, true, `tx=${claimHash}`)
}

async function approveAndRelease(payer, escrowId, label) {
  await payer.page.goto(`${baseUrl}/escrow/${escrowId}`, { waitUntil: 'domcontentloaded' })
  await ensureConnected(payer)
  const { hash } = await clickAndConfirm(
    payer.page, payer.page.locator('#milestone-0').getByRole('button', { name: /approve & release/i }), payer.sentHashes, `${label}: approveRelease`, 120000
  )
  record(`${label}: approveRelease`, true, `tx=${hash}`)
}

async function raiseDispute(payer, escrowId, label) {
  await payer.page.goto(`${baseUrl}/escrow/${escrowId}`, { waitUntil: 'domcontentloaded' })
  await ensureConnected(payer)

  await payer.page.locator('#milestone-0').getByRole('button', { name: /^raise dispute$/i }).click()
  await payer.page.getByLabel('Reason').fill('E2E test dispute — work not delivered as described.')
  await payer.page.getByLabel('Evidence link').fill('https://example.com/e2e-evidence')
  const { hash } = await clickAndConfirm(
    payer.page, payer.page.getByRole('button', { name: /^submit dispute$/i }), payer.sentHashes, `${label}: raiseDispute`, 120000
  )
  record(`${label}: raiseDispute`, true, `tx=${hash}`)
}

async function submitCounterEvidence(freelancer, escrowId, label) {
  await freelancer.page.goto(`${baseUrl}/escrow/${escrowId}`, { waitUntil: 'domcontentloaded' })
  await ensureConnected(freelancer)

  await freelancer.page.getByRole('tab', { name: /^evidence$/i }).click()
  // Trigger button ("Submit Counter Evidence", no hyphen) sits next to an
  // unrelated "Add Evidence" button in the same evidence tab -- scope to
  // the milestone container and match the exact trigger string so we don't
  // accidentally hit "Add Evidence" or the modal's own submit button
  // ("Submit counter-evidence", hyphenated -- a different string).
  await freelancer.page.locator('#milestone-0').getByRole('button', { name: /^submit counter evidence$/i }).click()
  await freelancer.page.getByLabel('Counter-evidence link').fill('https://example.com/e2e-counter-evidence')
  const { hash } = await clickAndConfirm(
    freelancer.page, freelancer.page.getByRole('button', { name: /^submit counter-evidence$/i }), freelancer.sentHashes, `${label}: submitCounterEvidence`, 120000
  )
  record(`${label}: submitCounterEvidence`, true, `tx=${hash}`)
}

// Resolves the dispute as the arbiter. The dispute queue on /arbiter is
// Goldsky-indexed (useDisputedEscrows), not a direct on-chain read, so the
// just-raised dispute may not appear immediately -- poll with a manual
// "Refresh" click rather than treating a miss on the first check as failure.
async function resolveDisputeAsArbiter(arbiter, escrowId, recipientPct, label) {
  await arbiter.page.goto(`${baseUrl}/arbiter`, { waitUntil: 'domcontentloaded' })
  await ensureConnected(arbiter)

  const row = arbiter.page.getByRole('button', { name: new RegExp(`^#${escrowId}\\s`) })
  const deadline = Date.now() + 120000
  while ((await row.count()) === 0 && Date.now() < deadline) {
    await arbiter.page.getByRole('button', { name: /^refresh$/i }).click().catch(() => {})
    await arbiter.page.waitForTimeout(6000)
  }
  if ((await row.count()) === 0) {
    throw new Error(`${label}: escrow #${escrowId} never appeared in the arbiter queue (Goldsky indexing lag or not reachable)`)
  }
  await row.click()

  await arbiter.page.getByLabel('Recipient share percent (numeric)').fill(String(recipientPct))
  await arbiter.page.getByLabel('Resolution URI').fill('https://example.com/e2e-resolution')
  const { hash } = await clickAndConfirm(
    arbiter.page, arbiter.page.getByRole('button', { name: /^resolve dispute$/i }), arbiter.sentHashes, `${label}: resolveDispute`, 120000
  )
  record(`${label}: resolveDispute (${recipientPct}% to recipient)`, true, `tx=${hash}`)
}

// Both the depositor's first call and the recipient's second call invoke
// the exact same mutualCancel(escrowId) -- the button LABEL changes
// ("Approve cancellation" -> "Finalize cancellation") based on on-chain
// flags, but it's the same function both times. Scoped to the "Cancel by
// mutual agreement" card specifically: its "Finalize cancellation" label
// collides with the unrelated per-milestone MilestoneCancelControl, which
// also renders "Finalize cancellation" (a different function,
// proposeMilestoneCancel) inside #milestone-0.
function cancelCardButton(page) {
  return page.locator('div:has(> h3:text-is("Cancel by mutual agreement"))')
    .getByRole('button', { name: /approve cancellation|finalize cancellation|you approved this/i })
}

async function mutualCancelBoth(payer, freelancer, escrowId, label) {
  await payer.page.goto(`${baseUrl}/escrow/${escrowId}`, { waitUntil: 'domcontentloaded' })
  await ensureConnected(payer)
  const { hash: approveHash } = await clickAndConfirm(
    payer.page, cancelCardButton(payer.page), payer.sentHashes, `${label}: payer mutualCancel`, 120000
  )
  record(`${label}: payer approves cancellation`, true, `tx=${approveHash}`)

  await freelancer.page.goto(`${baseUrl}/escrow/${escrowId}`, { waitUntil: 'domcontentloaded' })
  await ensureConnected(freelancer)
  const { hash: finalizeHash } = await clickAndConfirm(
    freelancer.page, cancelCardButton(freelancer.page), freelancer.sentHashes, `${label}: freelancer mutualCancel`, 120000
  )
  record(`${label}: freelancer finalizes cancellation`, true, `tx=${finalizeHash}`)
}

async function withdrawRefund(wallet, label) {
  await wallet.page.goto(`${baseUrl}/settings`, { waitUntil: 'domcontentloaded' })
  await ensureConnected(wallet)
  // Recipient field is pre-filled with the connected wallet's own address
  // (Settings.jsx's RefundSection useEffect) -- nothing to type.
  const { hash } = await clickAndConfirm(
    wallet.page, wallet.page.getByRole('button', { name: /^withdraw funds$/i }), wallet.sentHashes, `${label}: withdrawRefund`, 120000
  )
  record(`${label}: withdrawRefund`, true, `tx=${hash}`)
}

// ---------------- Scenario: happy path (claim -> approve & release) ----------------

async function runHappyPathScenario(payer, freelancer) {
  const label = 'happy-path'
  let escrowId
  try {
    escrowId = await createEscrow(payer, freelancer.account.address, label)
  } catch (err) {
    record(`${label}: create escrow flow`, false, err.message)
    return
  }

  try {
    const escrow = await readEscrow(escrowId)
    const ok = escrow.depositor.toLowerCase() === payer.account.address.toLowerCase()
      && escrow.recipient.toLowerCase() === freelancer.account.address.toLowerCase()
      && escrow.totalAmount === 1_000000n
      && escrow.stateName === 'ACTIVE'
    record(`${label}: on-chain getEscrow matches expected state`, ok, stringify(escrow))
  } catch (err) {
    record(`${label}: on-chain read escrow state`, false, err.message)
  }

  try {
    await ackAndClaim(freelancer, escrowId, label)
  } catch (err) {
    record(`${label}: acknowledge/claim flow`, false, err.message)
  }

  try {
    const escrow = await readEscrow(escrowId)
    record(`${label}: on-chain invoiceAcknowledgedAt set`, escrow.invoiceAcknowledgedAt > 0n, `invoiceAcknowledgedAt=${escrow.invoiceAcknowledgedAt}`)
  } catch (err) {
    record(`${label}: on-chain read invoiceAcknowledgedAt`, false, err.message)
  }
  try {
    const m = await readMilestone0(escrowId)
    record(`${label}: on-chain milestone IN_REVIEW after claim`, m.stateName === 'IN_REVIEW', stringify(m))
  } catch (err) {
    record(`${label}: on-chain read milestone state`, false, err.message)
  }

  try {
    await approveAndRelease(payer, escrowId, label)
  } catch (err) {
    record(`${label}: approve & release flow`, false, err.message)
  }

  try {
    const m = await readMilestone0(escrowId)
    const freelancerUsdc = await usdcBalanceOf(freelancer.account.address)
    record(`${label}: on-chain milestone RELEASED`, m.stateName === 'RELEASED', stringify(m))
    record(`${label}: on-chain freelancer received USDC`, freelancerUsdc > 0n, `freelancerUSDC=${freelancerUsdc}`)
  } catch (err) {
    record(`${label}: on-chain final state read`, false, err.message)
  }
}

// ---------------- Scenario: dispute -> counter-evidence -> arbiter resolution ----------------

async function runDisputeScenario(payer, freelancer, arbiter, recipientBps, label) {
  let escrowId
  try {
    escrowId = await createEscrow(payer, freelancer.account.address, label)
    await ackAndClaim(freelancer, escrowId, label)
  } catch (err) {
    record(`${label}: setup (create/ack/claim)`, false, err.message)
    return
  }

  try {
    await raiseDispute(payer, escrowId, label)
  } catch (err) {
    record(`${label}: raiseDispute flow`, false, err.message)
    return
  }

  try {
    const m = await readMilestone0(escrowId)
    const d = await readDispute0(escrowId)
    const ok = m.stateName === 'DISPUTED'
      && d.raisedBy.toLowerCase() === payer.account.address.toLowerCase()
      && d.evidenceHash !== '0x0000000000000000000000000000000000000000000000000000000000000000'
    record(`${label}: on-chain milestone DISPUTED, raisedBy=payer, evidence set`, ok, `milestone=${stringify(m)} raisedBy=${d.raisedBy}`)
  } catch (err) {
    record(`${label}: on-chain read dispute state`, false, err.message)
  }

  try {
    await submitCounterEvidence(freelancer, escrowId, label)
  } catch (err) {
    record(`${label}: submitCounterEvidence flow`, false, err.message)
    return
  }

  try {
    const d = await readDispute0(escrowId)
    const ok = d.counterEvidenceHash !== '0x0000000000000000000000000000000000000000000000000000000000000000'
    record(`${label}: on-chain counter-evidence recorded`, ok, `counterEvidenceHash=${d.counterEvidenceHash}`)
  } catch (err) {
    record(`${label}: on-chain read counter-evidence`, false, err.message)
  }

  const freelancerUsdcBefore = await usdcBalanceOf(freelancer.account.address).catch(() => null)
  const payerRefundBefore = await refundBalanceOf(payer.account.address).catch(() => null)

  try {
    await resolveDisputeAsArbiter(arbiter, escrowId, Number(recipientBps) / 100, label)
  } catch (err) {
    record(`${label}: resolveDispute flow`, false, err.message)
    return
  }

  try {
    const m = await readMilestone0(escrowId)
    const d = await readDispute0(escrowId)
    const expectedState = recipientBps === 0n ? 'REFUNDED' : 'RELEASED'
    record(`${label}: on-chain milestone ${expectedState} after resolution`, m.stateName === expectedState, stringify(m))
    record(`${label}: on-chain resolvedRecipientBps matches`, d.resolvedRecipientBps === recipientBps, `resolvedRecipientBps=${d.resolvedRecipientBps}`)
  } catch (err) {
    record(`${label}: on-chain read post-resolution state`, false, err.message)
  }

  if (recipientBps > 0n) {
    try {
      const freelancerUsdcAfter = await usdcBalanceOf(freelancer.account.address)
      const ok = freelancerUsdcBefore !== null && freelancerUsdcAfter > freelancerUsdcBefore
      record(`${label}: freelancer USDC balance increased`, ok, `before=${freelancerUsdcBefore} after=${freelancerUsdcAfter}`)
    } catch (err) {
      record(`${label}: read freelancer post-resolution balance`, false, err.message)
    }
  }

  if (recipientBps < 10000n) {
    // recipientBps < 10000 means some (or all) of the milestone goes back
    // to the payer via the pull-based refundBalances credit -- confirm the
    // credit landed, then actually withdraw it and confirm the balance
    // moves for real, same discipline as the dedicated cancellation
    // scenario below.
    try {
      const payerRefundAfter = await refundBalanceOf(payer.account.address)
      const ok = payerRefundBefore !== null && payerRefundAfter > payerRefundBefore
      record(`${label}: payer refundBalances credited`, ok, `before=${payerRefundBefore} after=${payerRefundAfter}`)
    } catch (err) {
      record(`${label}: read payer refundBalances`, false, err.message)
    }

    try {
      const payerUsdcBefore = await usdcBalanceOf(payer.account.address)
      await withdrawRefund(payer, label)
      const payerUsdcAfter = await usdcBalanceOf(payer.account.address)
      const payerRefundFinal = await refundBalanceOf(payer.account.address)
      record(`${label}: payer refundBalances zeroed after withdrawal`, payerRefundFinal === 0n, `refundBalances=${payerRefundFinal}`)
      record(`${label}: payer USDC balance increased after withdrawal`, payerUsdcAfter > payerUsdcBefore, `before=${payerUsdcBefore} after=${payerUsdcAfter}`)
    } catch (err) {
      record(`${label}: withdrawRefund flow`, false, err.message)
    }
  }
}

// ---------------- Scenario: mutual cancellation + refund withdrawal ----------------

async function runCancellationScenario(payer, freelancer) {
  const label = 'cancel'
  let escrowId
  try {
    escrowId = await createEscrow(payer, freelancer.account.address, label)
  } catch (err) {
    record(`${label}: create escrow flow`, false, err.message)
    return
  }

  try {
    const m = await readMilestone0(escrowId)
    record(`${label}: on-chain milestone PENDING before cancel`, m.stateName === 'PENDING', stringify(m))
  } catch (err) {
    record(`${label}: on-chain read pre-cancel milestone state`, false, err.message)
  }

  try {
    await mutualCancelBoth(payer, freelancer, escrowId, label)
  } catch (err) {
    record(`${label}: mutualCancel flow`, false, err.message)
    return
  }

  try {
    const escrow = await readEscrow(escrowId)
    const m = await readMilestone0(escrowId)
    record(`${label}: on-chain escrow CANCELLED`, escrow.stateName === 'CANCELLED', stringify(escrow))
    record(`${label}: on-chain milestone REFUNDED`, m.stateName === 'REFUNDED', stringify(m))
  } catch (err) {
    record(`${label}: on-chain read post-cancel state`, false, err.message)
  }

  try {
    const payerRefund = await refundBalanceOf(payer.account.address)
    record(`${label}: payer refundBalances credited full amount`, payerRefund >= 1_000000n, `refundBalances=${payerRefund}`)
  } catch (err) {
    record(`${label}: read payer refundBalances`, false, err.message)
  }

  try {
    const payerUsdcBefore = await usdcBalanceOf(payer.account.address)
    await withdrawRefund(payer, label)
    const payerUsdcAfter = await usdcBalanceOf(payer.account.address)
    const payerRefundFinal = await refundBalanceOf(payer.account.address)
    record(`${label}: payer refundBalances zeroed after withdrawal`, payerRefundFinal === 0n, `refundBalances=${payerRefundFinal}`)
    record(`${label}: payer USDC balance increased after withdrawal`, payerUsdcAfter > payerUsdcBefore, `before=${payerUsdcBefore} after=${payerUsdcAfter}`)
  } catch (err) {
    record(`${label}: withdrawRefund flow`, false, err.message)
  }
}

async function main() {
  await assertRpcChainId()

  const browser = await chromium.launch()
  const payer = await newWalletContext(browser, payerKey)
  const freelancer = await newWalletContext(browser, freelancerKey)
  const arbiter = await newWalletContext(browser, arbiterKey)

  // happy-path (claim -> approve & release) already proved out in an
  // earlier run with real tx hashes -- skip it here to cut how many times
  // this run has to survive the initial page-load RPC burst before
  // reaching the still-unverified scenarios below.
  await runDisputeScenario(payer, freelancer, arbiter, 10000n, 'dispute-full-release')
  await runDisputeScenario(payer, freelancer, arbiter, 0n, 'dispute-full-refund')
  await runDisputeScenario(payer, freelancer, arbiter, 5000n, 'dispute-split')
  await runCancellationScenario(payer, freelancer)

  await finish(browser)
}

async function finish(browser) {
  await browser.close()
  console.log('\n=== SUMMARY ===')
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.step}`)
  process.exit(results.some((r) => !r.ok) ? 1 : 0)
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
