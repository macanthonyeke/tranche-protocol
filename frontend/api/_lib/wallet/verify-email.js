// POST /api/wallet/verify-email — commit a first-time email -> address
// binding, once the person has produced the code we mailed them.
//
// This is the only place a brand-new binding is written. The email, address
// and userId all come out of the pending record created by register.js, which
// derived them server-side from the OTP session and from Circle — so a caller
// holding a verificationId still cannot influence what gets committed. The
// code is the single thing they contribute, and it is exactly the thing only
// the real owner of the inbox can have.

import { confirmVerification } from '../emailVerification.js'
import { writeBinding } from '../emailWallets.js'
import { postRoute, requireString } from '../walletRoute.js'

export default postRoute(async (body) => {
  const verificationId = requireString(body, 'verificationId', { max: 128 })
  // Not requireString: a code of "000000" is legitimate, and trimming is the
  // kindness that lets someone paste it with a stray space.
  const code = String(body.code ?? '').trim()

  const { email, address, userId } = await confirmVerification(verificationId, code)
  const binding = await writeBinding(email, { address, userId })

  return { email, address: binding.address, verified: true }
})
