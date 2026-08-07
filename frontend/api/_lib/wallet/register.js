// POST /api/wallet/register — begin recording this user's email -> Arc
// address, so a payer can address an escrow to them by email.
//
// Called once, after the wallet-creation challenge completes. Both halves of
// the pair are sourced by the server:
//
//   email   <- our own OTP-send record, keyed by the single-use sessionId
//   address <- Circle, via listWallets on the caller's userToken
//
// Neither is read from the request body. The client supplies only two opaque
// tokens, and cannot state who it is or where it wants to be paid.
//
// A FIRST binding is not written here. Circle's OTP proves inbox control to
// Circle, but nothing in Circle's API lets us verify which email a userToken
// belongs to — so on its own it cannot rule out someone opening an OTP
// session for a stranger's address, never reading it, and presenting their
// own token. This route therefore hands off to Tranche's own verification
// (_lib/emailVerification.js): a code we generate and mail ourselves, which
// must come back before anything is committed. Returning users whose binding
// already exists skip all of that — they proved this email once already.

import { getArcWallet, getCircleClient } from '../circle.js'
import { readBinding, restoreOtpSession, takeOtpSession, writeBinding } from '../emailWallets.js'
import { createVerification, CODE_TTL_MINUTES } from '../emailVerification.js'
import { sendEmail, verificationMessage } from '../resend.js'
import { postRoute, requireString, RequestError } from '../walletRoute.js'

export default postRoute(async (body) => {
  const sessionId = requireString(body, 'sessionId', { max: 128 })
  const userToken = requireString(body, 'userToken')

  // Single-use: consumed here whether or not the rest succeeds, so a replayed
  // sessionId can't be used to attempt a second binding.
  const session = await takeOtpSession(sessionId)
  if (!session) {
    throw new RequestError('This sign-in session has expired. Please sign in again.', 410)
  }

  // Proves the userToken is a live Circle session and gives us the userId the
  // binding is pinned to. Doing this via the token (not a client-sent userId)
  // is what makes the pin meaningful.
  const circle = getCircleClient()
  const status = await circle.getUserStatus({ userToken })
  const userId = status?.data?.id
  if (!userId) {
    throw new RequestError('Could not verify your sign-in. Please try again.', 401)
  }

  const wallet = await getArcWallet(userToken)
  if (!wallet) {
    // The challenge hasn't finished indexing, or the user abandoned setup.
    // Nothing to bind yet — the client retries after its post-execute delay.
    //
    // Uniquely among the failures here, this one is a transient race and not
    // a verdict, so the session goes back: we are explicitly asking the
    // client to call again, and it would otherwise find the session consumed
    // and report "sign-in expired" for what is a normal indexing delay. The
    // 401 above is deliberately NOT restored — a userToken Circle won't
    // vouch for is an answer, not a race.
    await restoreOtpSession(sessionId, session)
    throw new RequestError('Your wallet is still being created. Please try again in a moment.', 409)
  }

  const existing = await readBinding(session.email)

  if (existing) {
    // Already proven by this same person: writeBinding still refuses to move
    // it to a different Circle user, so this is safe to run straight through
    // and keeps re-onboarding on a new device friction-free.
    const binding = await writeBinding(session.email, { address: wallet.address, userId })
    return {
      email: session.email,
      address: binding.address,
      walletId: wallet.id,
      verificationRequired: false
    }
  }

  // First time for this email. Nothing is written to the directory yet.
  const { verificationId, code } = await createVerification({
    email: session.email,
    address: wallet.address,
    userId
  })

  await sendEmail({
    to: session.email,
    ...verificationMessage(code, CODE_TTL_MINUTES)
  })

  return {
    email: session.email,
    walletId: wallet.id,
    verificationRequired: true,
    verificationId,
    expiresInMinutes: CODE_TTL_MINUTES
  }
})
