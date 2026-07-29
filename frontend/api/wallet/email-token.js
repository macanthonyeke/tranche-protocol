// POST /api/wallet/email-token — start the email-OTP sign-in.
//
// Circle mails the one-time code (via the SMTP configured in Circle Console
// under Wallets > User Controlled > Configurator > Email) and hands back the
// tokens the browser SDK needs to open its OTP dialog.
//
// The sessionId returned here is ours, not Circle's. It is the ONLY record of
// which email this OTP went to: wallet/register.js reads the email back out
// of it rather than accepting one from the client, so a caller cannot finish
// a flow for one address and then claim a different one. See the threat model
// in _lib/emailWallets.js.

import { randomUUID } from 'node:crypto'
import { getCircleClient } from '../_lib/circle.js'
import { normalizeEmail, putOtpSession } from '../_lib/emailWallets.js'
import { postRoute, requireString, RequestError } from '../_lib/walletRoute.js'

export default postRoute(async (body) => {
  const deviceId = requireString(body, 'deviceId', { max: 256 })
  const email = normalizeEmail(body.email)
  if (!email) throw new RequestError('A valid email address is required.')

  const circle = getCircleClient()
  const res = await circle.createDeviceTokenForEmailLogin({ deviceId, email })

  const { deviceToken, deviceEncryptionKey, otpToken } = res?.data ?? {}
  if (!deviceToken) {
    throw new RequestError('Could not start email sign-in. Please try again.', 502)
  }

  const sessionId = randomUUID()
  await putOtpSession(sessionId, { email, deviceId })

  // The email is echoed back because the SDK's loginConfigs wants it to
  // label its own dialog — it is display state, and register.js pointedly
  // does not read it back from the client.
  return { sessionId, deviceToken, deviceEncryptionKey, otpToken, email }
})
