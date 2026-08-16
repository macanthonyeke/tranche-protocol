// POST /api/wallet/canary-preflight
//
// Test-only, read-only Phase 2 harness. This route is deliberately separate
// from execute-contract-call.js: it cannot create a Circle challenge, submit
// a transaction, or return any Circle credential to the browser.

import { postRoute, RequestError } from '../walletRoute.js'
import { isCanaryEnabled, runCanaryPreflight } from '../canary.js'
import { requireCircleIdentity } from './identity.js'

export default postRoute(async (body, req) => {
  if (!isCanaryEnabled()) throw new RequestError('Not found.', 404)

  const { circle, userToken, session } = await requireCircleIdentity(req, body)

  // The token is used only as a server-to-Circle bearer credential. The
  // response is the sanitized report from canary.js; it never contains this
  // value, encryptionKey, API keys, cookies, or raw Circle errors.
  return runCanaryPreflight({
    circle,
    userToken,
    expectedIdentity: {
      circleUserId: session.circleUserId,
      walletId: session.walletId,
      walletAddress: session.walletAddress,
      blockchain: session.blockchain,
      accountType: session.accountType
    }
  })
})
