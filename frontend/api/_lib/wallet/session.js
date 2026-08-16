// GET /api/wallet/session — return the sanitized cookie-backed app session.

import { getAuthSession, publicAuthSession } from '../authSession.js'
import { getRoute } from '../walletRoute.js'

export default getRoute(async (_body, req) => {
  const session = await getAuthSession(req)
  return {
    authenticated: !!session,
    session: publicAuthSession(session)
  }
})
