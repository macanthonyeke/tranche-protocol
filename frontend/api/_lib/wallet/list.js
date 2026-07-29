// POST /api/wallet/list — the caller's Arc wallet(s).
//
// POST rather than GET because the userToken is a bearer credential and has
// no business sitting in a URL, where it would land in access logs and
// Referer headers.

import { getCircleClient, ARC_BLOCKCHAIN } from '../circle.js'
import { postRoute, requireString } from '../walletRoute.js'

export default postRoute(async (body) => {
  const userToken = requireString(body, 'userToken')

  const circle = getCircleClient()
  const res = await circle.listWallets({ userToken, blockchain: ARC_BLOCKCHAIN })

  // Project down to what the UI needs. The raw Circle wallet object carries
  // walletSetId and other account-structure detail the browser has no use for.
  const wallets = (res?.data?.wallets ?? []).map((w) => ({
    id: w.id,
    address: w.address,
    blockchain: w.blockchain,
    state: w.state,
    accountType: w.accountType
  }))

  return { wallets }
})
