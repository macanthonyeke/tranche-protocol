// Single serverless function fronting every /api/wallet/* endpoint.
//
// WHY ONE FILE: Vercel turns each file under api/ into its own serverless
// function, and the Hobby plan caps a deployment at 12. Eleven wallet routes
// plus the three invoice ones blew past that. Note that *.test.js files count
// too — they are ordinary files under api/ as far as the platform is
// concerned — which is why the route handlers AND their tests now live in
// api/_lib/wallet/. The leading underscore is what excludes a path from
// becoming a function, the same mechanism api/_lib has always relied on.
//
// The URL surface is deliberately unchanged: POST /api/wallet/email-token
// still routes to the same handler it always did, so no frontend caller was
// touched when this consolidation happened. Only the on-disk layout and the
// platform's function count changed.
//
// Each handler is still its own module with its own tests. This file is a
// dispatcher and nothing else — no request logic belongs here, so that
// "which code runs for this URL" stays answerable by reading one map.

import balances from '../_lib/wallet/balances.js'
import emailResend from '../_lib/wallet/email-resend.js'
import emailToken from '../_lib/wallet/email-token.js'
import executeContractCall from '../_lib/wallet/execute-contract-call.js'
import initialize from '../_lib/wallet/initialize.js'
import list from '../_lib/wallet/list.js'
import register from '../_lib/wallet/register.js'
import resendVerification from '../_lib/wallet/resend-verification.js'
import resolveEmail from '../_lib/wallet/resolve-email.js'
import txStatus from '../_lib/wallet/tx-status.js'
import verifyEmail from '../_lib/wallet/verify-email.js'

// Keys are the exact URL segment after /api/wallet/. An explicit map, not a
// dynamic import built from the request: a caller must never be able to
// influence which module gets loaded, and unknown names can only miss.
const ROUTES = {
  'balances': balances,
  'email-resend': emailResend,
  'email-token': emailToken,
  'execute-contract-call': executeContractCall,
  'initialize': initialize,
  'list': list,
  'register': register,
  'resend-verification': resendVerification,
  'resolve-email': resolveEmail,
  'tx-status': txStatus,
  'verify-email': verifyEmail
}

export default async function handler(req, res) {
  // Vercel supplies the matched segments as req.query.route — an array for a
  // multi-segment path, a plain string for one. Normalising to a joined
  // string means a nested path like /api/wallet/a/b looks up "a/b", misses,
  // and 404s, rather than silently matching on its first segment.
  const segments = req.query?.route
  const name = Array.isArray(segments) ? segments.join('/') : segments ?? ''

  // Object.hasOwn, not `ROUTES[name]`: a bare lookup would resolve inherited
  // keys like "constructor" or "toString" to Object.prototype members and
  // then try to call one as a handler.
  if (!Object.hasOwn(ROUTES, name)) {
    res.status(404).json({ error: 'Not found.' })
    return
  }

  return ROUTES[name](req, res)
}
