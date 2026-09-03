// POST /api/wallet/directory-claim — manage the optional email directory.
//
// This is a product feature, not authentication. The wallet identity comes
// only from the authenticated Tranche session. The requested email is an
// alias chosen for the directory and is committed only after the independent
// Resend code is verified. Status and removal use the same authenticated
// endpoint so the browser cannot choose a wallet identity to inspect or delete.

import { requireAuthSession } from '../authSession.js'
import {
  DIRECTORY_PREFERENCE_CHOICES,
  readBinding,
  readDirectoryPreference,
  normalizeEmail,
  removeBinding,
  setDirectoryPreference,
  writeBinding
} from '../emailWallets.js'
import { createVerification, CODE_TTL_MINUTES } from '../emailVerification.js'
import { sendEmail, verificationMessage } from '../resend.js'
import { postRoute, RequestError } from '../walletRoute.js'

export default postRoute(async (body, req) => {
  const session = await requireAuthSession(req)
  const email = normalizeEmail(body.email)
  if (!email) throw new RequestError('A valid email address is required.')

  const action = body.action ?? 'claim'
  if (action === 'status') {
    const binding = await readBinding(email)
    const preference = await readDirectoryPreference(session.circleUserId)
    const verified = Boolean(
      binding &&
      binding.userId === session.circleUserId &&
      binding.address === session.walletAddress
    )
    let choice = preference?.choice ?? DIRECTORY_PREFERENCE_CHOICES.UNDECIDED
    if (verified && choice !== DIRECTORY_PREFERENCE_CHOICES.VERIFIED) {
      await setDirectoryPreference(session.circleUserId, DIRECTORY_PREFERENCE_CHOICES.VERIFIED)
      choice = DIRECTORY_PREFERENCE_CHOICES.VERIFIED
    }
    return {
      email,
      verified,
      choice,
      ...(verified ? { boundAt: binding.boundAt } : {})
    }
  }

  if (action === 'skip') {
    // This path intentionally never reads or writes the email binding. It
    // records only the onboarding decision for the authenticated identity.
    const preference = await setDirectoryPreference(
      session.circleUserId,
      DIRECTORY_PREFERENCE_CHOICES.SKIPPED
    )
    return { email, verified: false, choice: preference.choice }
  }

  if (action === 'remove') {
    const removed = await removeBinding(email, {
      address: session.walletAddress,
      userId: session.circleUserId
    })
    const preference = await setDirectoryPreference(
      session.circleUserId,
      DIRECTORY_PREFERENCE_CHOICES.REMOVED
    )
    return { email, removed, verified: false, choice: preference.choice }
  }

  if (action !== 'claim') throw new RequestError('Unknown email-directory action.')

  const existing = await readBinding(email)
  if (existing) {
    if (existing.userId !== session.circleUserId) {
      throw new RequestError('This email is already linked to a different wallet.', 409)
    }
    const binding = await writeBinding(email, {
      address: session.walletAddress,
      userId: session.circleUserId
    })
    await setDirectoryPreference(session.circleUserId, DIRECTORY_PREFERENCE_CHOICES.VERIFIED)
    return {
      email,
      address: binding.address,
      verificationRequired: false,
      verified: true,
      choice: DIRECTORY_PREFERENCE_CHOICES.VERIFIED
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
