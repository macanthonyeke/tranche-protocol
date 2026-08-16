// @vitest-environment node
//
// Guards the SPA catch-all in vercel.json against swallowing the API.
//
// The app is a single-page app, so vercel.json rewrites unmatched paths to
// /index.html. That rewrite used to be "/(.*)" — everything. Once the eleven
// wallet routes were consolidated behind a single dynamic
// api/wallet/[...route].js, POSTs to /api/wallet/* came back 405 Method Not
// Allowed: the request was being served index.html, a static file, and
// static serving only answers GET/HEAD.
//
// Worth knowing when reading a 405 from these endpoints: it cannot have come
// from our own code on a POST. walletRoute.js only returns 405 for a
// non-POST method, and returns 400 for a malformed POST — so a 405 on a POST
// means the function never ran and something upstream answered instead.
//
// vercel.json is configuration with no other test coverage, and reverting
// this pattern would break every wallet endpoint while the build, the unit
// suite and the rendered app all stayed green. Hence a test.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const config = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8')
)

const spaRewrite = config.rewrites?.find((r) => r.destination === '/index.html')

// Vercel compiles `source` with path-to-regexp; for this pattern the matcher
// is equivalent to this anchored regex.
const matcher = () => new RegExp(`^${spaRewrite.source}/?$`, 'i')

describe('vercel.json SPA rewrite', () => {
  it('exists and points at index.html', () => {
    expect(spaRewrite).toBeTruthy()
  })

  it.each([
    '/api/wallet/complete-login',
    '/api/wallet/directory-claim',
    '/api/wallet/session',
    '/api/wallet/logout',
    '/api/wallet/register',
    '/api/wallet/email-token',
    '/api/wallet/verify-email',
    '/api/wallet/execute-contract-call',
    '/api/pin-invoice',
    '/api/request-invoice-key',
    '/api/unpin-invoice'
  ])('does not swallow %s', (path) => {
    expect(matcher().test(path)).toBe(false)
  })

  it.each([
    '/src/main.jsx',
    '/@vite/client',
    '/@react-refresh',
    '/node_modules/.vite/deps/react.js',
    '/assets/index.js',
    '/fonts/tranche-fonts.css'
  ])('does not swallow development or static asset %s', (path) => {
    expect(matcher().test(path)).toBe(false)
  })

  // The rewrite still has to do its actual job: deep links into client-side
  // routes must reach index.html rather than 404.
  it.each(['/', '/dashboard', '/create', '/escrow/12', '/settings', '/arbiter'])(
    'still rewrites %s to the SPA',
    (path) => {
      expect(matcher().test(path)).toBe(true)
    }
  )
})
