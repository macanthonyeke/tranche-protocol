// POST /api/wallet/initialize — create the user's Arc wallet.
//
// Returns a challengeId that the browser SDK executes (sdk.execute) to put up
// Circle's hosted PIN + security-questions UI. The wallet only exists once
// the user completes that challenge on their own device; nothing here creates
// a wallet server-side, and no key material is ever reachable from this
// process.
//
// accountType SCA is required for Circle's Gas Station to sponsor gas — the
// whole point of the email path is that the user never holds native currency.
// Circle silently defaults to EOA if it's omitted, which would strand
// email users with an unfundable wallet, so it is passed explicitly.

import { getCircleClient, ARC_BLOCKCHAIN, ACCOUNT_TYPE, getArcWallet, circleErrorInfo } from '../_lib/circle.js'
import { postRoute, requireString } from '../_lib/walletRoute.js'

// Circle's "user already initialized" code. Not an error for us: it means the
// user is returning on a new device, so we skip the challenge and hand back
// the wallet they already have.
const ALREADY_INITIALIZED = 155106

export default postRoute(async (body) => {
  const userToken = requireString(body, 'userToken')

  const circle = getCircleClient()
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
