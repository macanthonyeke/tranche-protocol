// POST /api/wallet/directory-claim — explicitly opt into being findable by
// email in Create Escrow.
//
// This is a product feature, not authentication. The wallet identity comes
// only from the authenticated Tranche session. The requested email is an
// alias chosen for the directory and is committed only after the independent
// Resend code is verified.

import { requireAuthSession } from '../authSession.js'
import { readBinding, normalizeEmail, writeBinding } from '../emailWallets.js'
import { createVerification, CODE_TTL_MINUTES } from '../emailVerification.js'
import { sendEmail, verificationMessage } from '../resend.js'
import { postRoute, RequestError } from '../walletRoute.js'

export default postRoute(async (body, req) => {
  const session = await requireAuthSession(req)
  const email = normalizeEmail(body.email)
  if (!email) throw new RequestError('A valid email address is required.')

  const existing = await readBinding(email)
  if (existing) {
    if (existing.userId !== session.circleUserId) {
      throw new RequestError('This email is already linked to a different wallet.', 409)
    }
    const binding = await writeBinding(email, {
      address: session.walletAddress,
      userId: session.circleUserId
    })
    return {
      email,
      address: binding.address,
      verificationRequired: false,
      verified: true
    }
  }

  const { verificationId, code } = await createVerification({
    email,
    address: session.walletAddress,
    userId: session.circleUserId
  })
  await sendEmail({ to: email, ...verificationMessage(code, CODE_TTL_MINUTES) })

  return {
    email,
    verificationRequired: true,
    verificationId,
    expiresInMinutes: CODE_TTL_MINUTES
  }
})
