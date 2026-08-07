// POST /api/wallet/resolve-email — "does this person already have a wallet?"
//
// Read-only by design. It never creates a Circle user, never sends an OTP,
// and never provisions a wallet on someone's behalf: a freelancer's wallet
// can only come into existence when they themselves complete Circle's email
// OTP challenge on their own device. An escrow must never be able to name an
// address its owner has not proven control of.
//
// Answers only from our own binding store, which is populated exclusively by
// wallet/register.js. A miss is reported as not-onboarded so CreateEscrow can
// say "ask them to sign up first" instead of failing opaquely.

import { normalizeEmail, readBinding } from '../emailWallets.js'
import { postRoute, RequestError } from '../walletRoute.js'

export default postRoute(async (body) => {
  const email = normalizeEmail(body.email)
  if (!email) throw new RequestError('A valid email address is required.')

  const binding = await readBinding(email)
  if (!binding) {
    // Deliberately the same shape as a hit. This endpoint is an existence
    // oracle for email addresses no matter how it's phrased — anyone can ask
    // about any address — so the honest move is a clear answer for the payer
    // rather than a vague one that leaks the same bit more slowly.
    return { onboarded: false, address: null }
  }

  return { onboarded: true, address: binding.address, boundAt: binding.boundAt }
})
