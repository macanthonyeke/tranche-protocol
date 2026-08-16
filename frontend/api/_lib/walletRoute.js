// Shared plumbing for the api/wallet/* routes.
//
// The older single-purpose routes (pin-invoice, request-invoice-key) each
// carry their own copy of this method-check / parse / error-map boilerplate,
// which was fine at two routes. The Circle onboarding flow adds seven more,
// so it lives in one place here instead — and, more importantly, so that the
// "never leak a Circle error verbatim to the browser" rule is enforced once
// rather than remembered seven times.

import { CircleError, circleErrorInfo } from './circle.js'
import { AuthSessionError } from './authSession.js'
import { EmailWalletError } from './emailWallets.js'
import { VerificationError } from './emailVerification.js'
import { RedisError } from './redis.js'
import { ResendError } from './resend.js'

export class RequestError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

/**
 * Wrap a POST handler: enforces the method, guarantees a plain-object body,
 * and maps thrown errors onto safe responses.
 *
 * @param {(body: object, req: object) => Promise<object>} fn resolves to the JSON body to send
 */
function routeError(res, err) {
  if (
    err instanceof RequestError ||
    err instanceof AuthSessionError ||
    err instanceof EmailWalletError ||
    err instanceof VerificationError ||
    err instanceof RedisError ||
    err instanceof ResendError ||
    err instanceof CircleError
  ) {
    res.status(err.status).json({ error: err.message })
    return
  }
  const info = circleErrorInfo(err)
  console.error('wallet route failed:', info.code, info.message)
  res.status(502).json({ error: 'Wallet service is unavailable. Please try again.', code: info.code })
}

export function methodRoute(method, fn) {
  return async function handler(req, res) {
    if (req.method !== method) {
      res.setHeader('Allow', method)
      res.status(405).json({ error: 'Method not allowed.' })
      return
    }
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const result = await fn(body, req, res)
      res.status(200).json(result ?? {})
    } catch (err) {
      routeError(res, err)
    }
  }
}

export const postRoute = (fn) => methodRoute('POST', fn)
export const getRoute = (fn) => methodRoute('GET', fn)

/** @returns {string} a non-empty string field, or throws RequestError */
export function requireString(body, field, { max = 4096 } = {}) {
  const value = body[field]
  if (typeof value !== 'string' || !value.trim()) {
    throw new RequestError(`${field} is required.`)
  }
  if (value.length > max) {
    throw new RequestError(`${field} is too long.`)
  }
  return value.trim()
}
