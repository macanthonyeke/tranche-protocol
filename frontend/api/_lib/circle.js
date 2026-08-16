// Server-side Circle User-Controlled Wallets client.
//
// CIRCLE_API_KEY is server-only and must never be VITE_-prefixed — same rule
// as PINATA_JWT (see pinata.js). It grants the ability to mint user session
// tokens for any user in this app, so a leak is a full compromise of every
// email-onboarded wallet.
//
// The client is memoized per warm serverless instance rather than rebuilt per
// request: initiateUserControlledWalletsClient sets up an axios instance, and
// rebuilding it on every invocation would throw away keep-alive connections
// for no benefit.

import { initiateUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets'

// Circle's blockchain enum value for Arc testnet. NOT "ArcTestnet" — that
// string is rejected by the API. Confirmed against the ARC-TESTNET enum in
// the createUserPinWithWallets / listWallets request schemas.
export const ARC_BLOCKCHAIN = 'ARC-TESTNET'

// Smart Contract Account, so Circle's Gas Station can sponsor gas. Arc
// testnet supports SCA (Circle's account-types matrix). Note Circle defaults
// to EOA when accountType is omitted, which would leave users paying their
// own gas — always pass this explicitly.
export const ACCOUNT_TYPE = 'SCA'

export class CircleError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.status = status
  }
}

let client = null

export function getCircleClient() {
  if (client) return client
  const apiKey = process.env.CIRCLE_API_KEY
  if (!apiKey) {
    throw new CircleError('Email sign-in is not configured on the server.', 503)
  }
  client = initiateUserControlledWalletsClient({ apiKey })
  return client
}

// Circle's SDK rejects with an axios-shaped error whose useful detail is
// buried in response.data. Surface the code so callers can branch on it (the
// email flow cares about 155106 = "user already initialized"), but never leak
// the raw payload to the browser.
export function circleErrorInfo(err) {
  const data = err?.response?.data
  return {
    code: data?.code ?? err?.code,
    message: data?.message ?? err?.message ?? 'Unknown error',
    status: err?.response?.status
  }
}

/**
 * The Arc wallet for a verified user session.
 *
 * Takes a userToken (never a userId) so the caller must already hold a
 * Circle-issued session for this user, and returns the address as Circle
 * reports it — the address is never accepted from client input anywhere in
 * this codebase.
 *
 * @param {string} userToken
 * @returns {Promise<{ id: string, address: string } | null>} null when the
 *   user has no Arc wallet yet (i.e. hasn't finished onboarding)
 */
export async function getArcWallet(userToken) {
  const circle = getCircleClient()
  const res = await circle.listWallets({ userToken, blockchain: ARC_BLOCKCHAIN })
  const wallets = res?.data?.wallets ?? []
  // LIVE only: a FROZEN wallet can't transact, so treating it as onboarded
  // would hand out an address that silently fails to receive an escrow. The
  // account type is checked here too: an Arc EOA is not the sponsored SCA
  // identity this email flow is allowed to authenticate.
  const wallet = wallets.find((w) =>
    w.state === 'LIVE' &&
    w.id &&
    w.address &&
    w.blockchain === ARC_BLOCKCHAIN &&
    w.accountType === ACCOUNT_TYPE
  )
  if (!wallet) return null
  return {
    id: wallet.id,
    address: wallet.address,
    blockchain: wallet.blockchain,
    accountType: wallet.accountType
  }
}
