// POST /api/wallet/logout — revoke the cookie-backed Tranche session.

import { revokeAuthSession } from '../authSession.js'
import { postRoute } from '../walletRoute.js'

export default postRoute(async (_body, req, res) => {
  await revokeAuthSession(req, res)
  return { loggedOut: true }
})
