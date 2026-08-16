// Shared UCW request boundary.
//
// A browser may still provide Circle's userToken because the current public
// Circle API methods use it as their bearer credential. It may not provide the
// wallet identity. Every sensitive route requires the Tranche cookie, checks
// that the token belongs to the Circle user pinned in that session, and uses
// the session's canonical wallet ID/address.

import { getCircleClient } from '../circle.js'
import { requireAuthSession } from '../authSession.js'
import { postRoute, requireString, RequestError } from '../walletRoute.js'

export async function requireCircleIdentity(req, body) {
  const session = await requireAuthSession(req)
  const userToken = requireString(body, 'userToken')
  const circle = getCircleClient()
  const status = await circle.getUserStatus({ userToken })
  const circleUserId = status?.data?.id

  if (!circleUserId || circleUserId !== session.circleUserId) {
    throw new RequestError('Circle credentials do not match the signed-in wallet session.', 401)
  }

  return {
    circle,
    session,
    userToken,
    wallet: {
      id: session.walletId,
      address: session.walletAddress
    }
  }
}

export function sessionPostRoute(fn) {
  return postRoute(async (body, req, res) => fn(await requireCircleIdentity(req, body), body, req, res))
}
