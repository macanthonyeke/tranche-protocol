// POST /api/wallet/complete-login — turn a verified Circle OTP attempt into
// a Tranche server session.
//
// This is the only point where a Tranche auth session is minted. The email in
// the OTP attempt is deliberately not used as an identity claim: Circle has
// verified the login and this route derives the user ID and Arc wallet from
// Circle's token. Email-directory binding is a separate, explicit flow.

import { getArcWallet, getCircleClient, ARC_BLOCKCHAIN, ACCOUNT_TYPE } from '../circle.js'
import { createAuthSession, publicAuthSession, setAuthCookie } from '../authSession.js'
import { restoreOtpSession, takeOtpSession } from '../emailWallets.js'
import { postRoute, requireString, RequestError } from '../walletRoute.js'

export default postRoute(async (body, _req, res) => {
  const attemptId = requireString(body, 'sessionId', { max: 128 })
  const userToken = requireString(body, 'userToken')
  const attempt = await takeOtpSession(attemptId)
  if (!attempt) {
    throw new RequestError('This sign-in session has expired. Please sign in again.', 410)
  }

  const circle = getCircleClient()
  const status = await circle.getUserStatus({ userToken })
  const circleUserId = status?.data?.id
  if (!circleUserId) {
    throw new RequestError('Could not verify your Circle sign-in. Please try again.', 401)
  }

  const wallet = await getArcWallet(userToken)
  if (!wallet) {
    // Wallet indexing after an initialization challenge is a normal transient
    // race. Restore the original attempt TTL so the browser can retry.
    await restoreOtpSession(attemptId, attempt)
    throw new RequestError('Your wallet is still being created. Please try again in a moment.', 409)
  }

  const { token, record } = await createAuthSession({
    circleUserId,
    walletId: wallet.id,
    walletAddress: wallet.address,
    blockchain: ARC_BLOCKCHAIN,
    accountType: ACCOUNT_TYPE
  })
  setAuthCookie(res, token)

  return { session: publicAuthSession(record) }
})
