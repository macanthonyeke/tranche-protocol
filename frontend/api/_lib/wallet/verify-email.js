// POST /api/wallet/verify-email — commit a first-time email -> address
// binding, once the person has produced the code we mailed them.
//
// This is the only place a brand-new binding is written. The email, address
// and userId all come out of the pending record created by directory-claim.js,
// which derived them server-side from the authenticated session — so a caller
// holding a verificationId still cannot influence what gets committed. The
// code is the single thing they contribute, and it is exactly the thing only
// the real owner of the inbox can have.

import { confirmVerification } from '../emailVerification.js'
import { peekVerification } from '../emailVerification.js'
import { DIRECTORY_PREFERENCE_CHOICES, setDirectoryPreference, writeBinding } from '../emailWallets.js'
import { requireAuthSession } from '../authSession.js'
import { postRoute, requireString, RequestError } from '../walletRoute.js'

export default postRoute(async (body, req) => {
  const session = await requireAuthSession(req)
  const verificationId = requireString(body, 'verificationId', { max: 128 })
  // Not requireString: a code of "000000" is legitimate, and trimming is the
  // kindness that lets someone paste it with a stray space.
  const code = String(body.code ?? '').trim()

  const pending = await peekVerification(verificationId)
  if (!pending) {
    throw new RequestError('That code has expired. Please request a new one.', 410)
  }
  if (pending.userId !== session.circleUserId) {
    throw new RequestError('That email-directory request does not belong to this session.', 403)
  }

  const { email, address, userId } = await confirmVerification(verificationId, code)
  const binding = await writeBinding(email, { address, userId })
  await setDirectoryPreference(session.circleUserId, DIRECTORY_PREFERENCE_CHOICES.VERIFIED)

  return { email, address: binding.address, verified: true }
})
