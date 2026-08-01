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

const PREFIX = '/api/wallet/'

/* Candidate route names for a request, most trustworthy first.
 *
 * The URL path comes first deliberately. An earlier version read only
 * req.query.route, on the assumption that the platform hands back the matched
 * segment as ['email-token'] or 'email-token'. Every wallet endpoint 404'd in
 * production because that assumption was wrong, and the unit tests encoded
 * the same assumption so they passed throughout. The request path is the one
 * thing that is unambiguous and identical across environments, so it is what
 * decides; the dynamic param remains a fallback rather than the contract.
 */
function candidateNames(req) {
  const names = []

  const path = String(req.url ?? '').split('?')[0]
  const at = path.indexOf(PREFIX)
  if (at !== -1) {
    const rest = path.slice(at + PREFIX.length).replace(/^\/+|\/+$/g, '')
    if (rest) {
      names.push(rest)
      // Percent-encoding is legal in a path; a mismatch here must not be the
      // reason a valid route misses.
      try {
        const decoded = decodeURIComponent(rest)
        if (decoded !== rest) names.push(decoded)
      } catch {
        // Malformed escape — the raw form above is still worth trying.
      }
    }
  }

  // Fallback only, for a request that somehow arrives without a usable path.
  // Matched whole, never by trailing segment: a "last segment wins" rule would
  // quietly make /api/wallet/anything/register an alias for register, which is
  // an alias nobody asked for and everybody reading this later would have to
  // have explained to them.
  const seg = req.query?.route
  if (Array.isArray(seg)) {
    if (seg.length) names.push(seg.join('/'))
  } else if (typeof seg === 'string' && seg) {
    const trimmed = seg.replace(/^\/+|\/+$/g, '')
    if (trimmed) names.push(trimmed)
  }

  return names
}

export default async function handler(req, res) {
  // Object.hasOwn, not `ROUTES[name]`: a bare lookup would resolve inherited
  // keys like "constructor" or "toString" to Object.prototype members and
  // then try to call one as a handler.
  const name = candidateNames(req).find((n) => Object.hasOwn(ROUTES, n))

  if (!name) {
    // Echo what was actually received. This is the caller's own path, and
    // having it in the response is what turns "Not found" from a dead end
    // into a one-look diagnosis — the absence of it cost a full debugging
    // round on this very endpoint. JSON-encoded, so nothing is interpreted.
    res.status(404).json({
      error: 'Not found.',
      received: { url: req.url ?? null, route: req.query?.route ?? null }
    })
    return
  }

  return ROUTES[name](req, res)
}
