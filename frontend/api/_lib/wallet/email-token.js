// POST /api/wallet/email-token — start the email-OTP sign-in.
//
// Circle mails the one-time code (via the SMTP configured in Circle Console
// under Wallets > User Controlled > Configurator > Email) and hands back the
// tokens the browser SDK needs to open its OTP dialog.
//
// The sessionId returned here is ours, not Circle's. It is a short-lived login
// attempt used by initialize.js and complete-login.js; it is not an
// authenticated Tranche session and it never creates an email-directory
// binding.

import { randomUUID } from 'node:crypto'
import { getCircleClient } from '../circle.js'
import { normalizeEmail, normalizeLoginIntent, putOtpSession } from '../emailWallets.js'
import { postRoute, requireString, RequestError } from '../walletRoute.js'

export default postRoute(async (body) => {
  const deviceId = requireString(body, 'deviceId', { max: 256 })
  const email = normalizeEmail(body.email)
  if (!email) throw new RequestError('A valid email address is required.')
  const intent = normalizeLoginIntent(body.intent)
  if (!intent) throw new RequestError('A valid login intent is required.')

  const circle = getCircleClient()
  const res = await circle.createDeviceTokenForEmailLogin({ deviceId, email })

  const { deviceToken, deviceEncryptionKey, otpToken } = res?.data ?? {}
  if (!deviceToken) {
    throw new RequestError('Could not start email sign-in. Please try again.', 502)
  }

  const sessionId = randomUUID()
  await putOtpSession(sessionId, { email, deviceId, intent })

  // The email is echoed back because the SDK's loginConfigs wants it to
  // label its own dialog. The server does not use this email as an identity
  // claim when complete-login creates the app session.
  return { sessionId, deviceToken, deviceEncryptionKey, otpToken, email }
})
