// POST /api/wallet/initialize — create the user's Arc wallet.
//
// Returns a challengeId that the browser SDK executes (sdk.execute). Despite
// the SDK wrapper's name, createUserPinWithWallets calls the REST endpoint
// Users.createUserWithPinChallenge, whose own summary is "create a challenge
// for user initialization with wallet creation" — an INITIALIZE challenge, not
// a request for PIN authentication. Email-auth users have no PIN for it to
// set. The wallet only exists once the user completes the challenge on their
// own device; nothing here creates a wallet server-side, and no key material
// is ever reachable from this process.
//
// accountType SCA is required for Circle's Gas Station to sponsor gas — the
// whole point of the email path is that the user never holds native currency.
// Circle silently defaults to EOA if it's omitted, which would strand
// email users with an unfundable wallet, so it is passed explicitly.

import { getCircleClient, ARC_BLOCKCHAIN, ACCOUNT_TYPE, getArcWallet, circleErrorInfo } from '../circle.js'
import { LOGIN_INTENTS, peekOtpSession } from '../emailWallets.js'
import { postRoute, requireString, RequestError } from '../walletRoute.js'

// Circle's "user already initialized" code. Not an error for us: it means the
// user is returning on a new device, so we skip the challenge and hand back
// the wallet they already have.
const ALREADY_INITIALIZED = 155106

export default postRoute(async (body) => {
  const sessionId = requireString(body, 'sessionId', { max: 128 })
  const userToken = requireString(body, 'userToken')
  const attempt = await peekOtpSession(sessionId)
  if (!attempt) {
    throw new RequestError('This sign-in session has expired. Please sign in again.', 410)
  }
  if (attempt.intent !== LOGIN_INTENTS.SIGNUP) {
    throw new RequestError('Wallet setup is available only while creating an account.', 403)
  }

  const circle = getCircleClient()
  const status = await circle.getUserStatus({ userToken })
  if (!status?.data?.id) {
    throw new RequestError('Could not verify your Circle sign-in. Please try again.', 401)
  }
  try {
    const res = await circle.createUserPinWithWallets({
      userToken,
      blockchains: [ARC_BLOCKCHAIN],
      accountType: ACCOUNT_TYPE
    })
    const challengeId = res?.data?.challengeId
    if (challengeId) return { challengeId, alreadyInitialized: false }
  } catch (err) {
    if (circleErrorInfo(err).code !== ALREADY_INITIALIZED) throw err
  }

  // Either Circle told us the user is already set up, or it returned no
  // challenge. Both mean "look up what they already have".
  const wallet = await getArcWallet(userToken)
  return { challengeId: null, alreadyInitialized: true, wallet }
})
