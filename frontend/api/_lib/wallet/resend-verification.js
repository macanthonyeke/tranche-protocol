// POST /api/wallet/resend-verification — mail a fresh code for an open
// verification.
//
// Takes only the verificationId; the destination is read from the pending
// record, never from the request. That matters — accepting a `to` here would
// hand back exactly the redirect this whole mechanism exists to prevent.

import { rotateVerificationCode, CODE_TTL_MINUTES } from '../emailVerification.js'
import { sendEmail, verificationMessage } from '../resend.js'
import { postRoute, requireString } from '../walletRoute.js'

export default postRoute(async (body) => {
  const verificationId = requireString(body, 'verificationId', { max: 128 })

  const { email, code } = await rotateVerificationCode(verificationId)
  await sendEmail({ to: email, ...verificationMessage(code, CODE_TTL_MINUTES) })

  return { sent: true, expiresInMinutes: CODE_TTL_MINUTES }
})
