// POST /api/wallet/tx-status — resolve a completed challenge to a real
// transaction hash.
//
// The EOA path gets a hash back from writeContract immediately and then waits
// on a receipt. The SCA path has no hash at approval time: sdk.execute only
// reports that the challenge succeeded, and Circle broadcasts afterwards. So
// useTx polls here to reach the same {hash, confirmed} state the wagmi path
// reaches, which is what lets both wallet types share one transaction
// lifecycle and one set of toasts.
//
// challengeId -> transaction id comes from the challenge's correlationIds.

import { sessionPostRoute } from './identity.js'
import { requireString } from '../walletRoute.js'

// Circle transaction states that mean "stop polling".
const TERMINAL = new Set(['COMPLETE', 'CONFIRMED', 'FAILED', 'CANCELLED', 'DENIED'])
const FAILED = new Set(['FAILED', 'CANCELLED', 'DENIED'])

export default sessionPostRoute(async ({ circle, userToken }, body) => {
  const challengeId = requireString(body, 'challengeId', { max: 128 })

  const challengeRes = await circle.getUserChallenge({ userToken, challengeId })
  const challenge = challengeRes?.data?.challenge ?? challengeRes?.data
  const transactionId = challenge?.correlationIds?.[0]

  if (!transactionId) {
    // The challenge exists but Circle hasn't linked a transaction to it yet.
    return { state: 'PENDING', txHash: null, done: false, failed: false }
  }

  const txRes = await circle.getTransaction({ userToken, id: transactionId })
  const tx = txRes?.data?.transaction ?? txRes?.data
  const state = tx?.state ?? 'PENDING'

  return {
    state,
    txHash: tx?.txHash ?? null,
    done: TERMINAL.has(state),
    failed: FAILED.has(state),
    errorReason: tx?.errorReason ?? null
  }
})
