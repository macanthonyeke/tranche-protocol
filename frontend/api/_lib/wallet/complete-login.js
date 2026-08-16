// POST /api/wallet/complete-login — turn a verified Circle OTP attempt into
// a Tranche server session.
//
// This is the only point where a Tranche auth session is minted. The browser
// supplies only the opaque attempt id and Circle user token; the attempt's
// intent was fixed by /email-token and is never read from the completion body.

import { getArcWallet, getCircleClient, ARC_BLOCKCHAIN, ACCOUNT_TYPE } from '../circle.js'
import { createAuthSession, publicAuthSession, setAuthCookie } from '../authSession.js'
import {
  getIdentityMode,
  IDENTITY_MODES,
  identityMatchesWallet,
  readTrancheIdentity,
  registerTrancheIdentity
} from '../identityRegistry.js'
import { LOGIN_INTENTS, restoreOtpSession, takeOtpSession } from '../emailWallets.js'
import { postRoute, requireString, RequestError } from '../walletRoute.js'

export const TRANCHE_ACCOUNT_NOT_FOUND = 'TRANCHE_ACCOUNT_NOT_FOUND'

function accountNotFound() {
  // This response is intentionally returned only after Circle has accepted the
  // OTP and the server has validated the Circle user token. Before that point
  // the email endpoint has no account-existence branch.
  return { code: TRANCHE_ACCOUNT_NOT_FOUND, next: 'signup' }
}

function walletIdentity(circleUserId, wallet) {
  if (
    !wallet?.id ||
    !wallet.address ||
    wallet.blockchain !== ARC_BLOCKCHAIN ||
    wallet.accountType !== ACCOUNT_TYPE
  ) {
    throw new RequestError('Could not verify your Arc wallet. Please try again.', 502)
  }
  return {
    circleUserId,
    walletId: wallet.id,
    walletAddress: wallet.address,
    blockchain: wallet.blockchain,
    accountType: wallet.accountType
  }
}

async function mintSession(identity, res) {
  const { token, record } = await createAuthSession(identity)
  setAuthCookie(res, token)
  return publicAuthSession(record)
}

export default postRoute(async (body, _req, res) => {
  const attemptId = requireString(body, 'sessionId', { max: 128 })
  const userToken = requireString(body, 'userToken')
  const attempt = await takeOtpSession(attemptId)
  if (!attempt) {
    throw new RequestError('This sign-in session has expired. Please sign in again.', 410)
  }
  if (attempt.intent !== LOGIN_INTENTS.SIGNUP && attempt.intent !== LOGIN_INTENTS.SIGNIN) {
    throw new RequestError('This sign-in session is invalid. Please sign in again.', 410)
  }

  const circle = getCircleClient()
  const status = await circle.getUserStatus({ userToken })
  const circleUserId = status?.data?.id
  if (!circleUserId) {
    throw new RequestError('Could not verify your Circle sign-in. Please try again.', 401)
  }

  const wallet = await getArcWallet(userToken)
  const current = wallet ? walletIdentity(circleUserId, wallet) : null

  if (attempt.intent === LOGIN_INTENTS.SIGNUP) {
    if (!current) {
      // Wallet indexing after an initialization challenge is a normal
      // transient race. Restore the original attempt TTL so the browser can
      // retry without getting a fresh OTP.
      await restoreOtpSession(attemptId, attempt)
      throw new RequestError('Your wallet is still being created. Please try again in a moment.', 409)
    }

    const identity = await registerTrancheIdentity(current, { source: 'signup' })
    return { session: await mintSession(identity, res), next: 'onboarding' }
  }

  // Signin never initializes a wallet. No live eligible wallet is the same
  // safe post-auth outcome as a missing registry record.
  if (!current) return accountNotFound()

  let identity = await readTrancheIdentity(circleUserId)
  if (identity && !identityMatchesWallet(identity, { circleUserId, wallet: current })) {
    throw new RequestError(
      'Your Circle wallet does not match its Tranche identity. Please contact support.',
      409
    )
  }

  if (!identity) {
    const mode = getIdentityMode()
    if (mode === IDENTITY_MODES.STRICT) return accountNotFound()

    // Migration modes preserve access for users created before the registry.
    // dual-write records the already-live Circle wallet immediately. shadow
    // leaves the legacy session path intact; the normal session read then
    // backfills it opportunistically.
    if (mode === IDENTITY_MODES.DUAL_WRITE) {
      identity = await registerTrancheIdentity(current, { source: 'legacy-signin' })
    }
  }

  const sessionIdentity = identity ?? current
  return { session: await mintSession(sessionIdentity, res), next: 'app' }
})
