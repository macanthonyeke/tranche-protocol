// POST /api/wallet/email-resend — reissue the OTP for an in-flight sign-in.
//
// Wired to the SDK's setOnResendOtpEmail callback. Deliberately does NOT
// consume or refresh the OTP session record: the email is already fixed by
// the original email-token call, and resending must not be a way to re-point
// a live session at a different address.

import { getCircleClient } from '../_lib/circle.js'
import { postRoute, requireString } from '../_lib/walletRoute.js'

export default postRoute(async (body) => {
  const deviceId = requireString(body, 'deviceId', { max: 256 })
  const email = requireString(body, 'email', { max: 254 })
  const otpToken = requireString(body, 'otpToken')
  // Optional: Circle accepts a userToken here when one already exists.
  const userToken = typeof body.userToken === 'string' ? body.userToken : undefined

  const circle = getCircleClient()
  const res = await circle.resendOTP({ deviceId, email, otpToken, userToken })

  return { otpToken: res?.data?.otpToken ?? otpToken }
})
