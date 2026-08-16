// POST /api/wallet/register is retired. Authentication completion now lives
// in complete-login.js and email-directory binding is an explicit claim in
// directory-claim.js. Keeping this compatibility endpoint closed prevents a
// stale client from reintroducing Resend into the sign-in critical path.

import { postRoute, RequestError } from '../walletRoute.js'

export default postRoute(async () => {
  throw new RequestError('This sign-in route has been retired. Please sign in again.', 410)
})
