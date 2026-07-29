// POST /api/wallet/balances — token balances for one of the caller's wallets.
//
// Used for the USDC figure on the dashboard when signed in with email. EOA
// users get the same number straight from the chain via wagmi's useBalance,
// so this exists only because an SCA wallet's id (not its address) is the
// handle Circle indexes balances by.

import { getCircleClient } from '../circle.js'
import { postRoute, requireString } from '../walletRoute.js'

export default postRoute(async (body) => {
  const userToken = requireString(body, 'userToken')
  const walletId = requireString(body, 'walletId', { max: 128 })

  const circle = getCircleClient()
  const res = await circle.getWalletTokenBalance({ userToken, walletId })

  const tokenBalances = (res?.data?.tokenBalances ?? []).map((b) => ({
    amount: b.amount,
    symbol: b.token?.symbol ?? null,
    name: b.token?.name ?? null,
    decimals: b.token?.decimals ?? null,
    tokenAddress: b.token?.tokenAddress ?? null
  }))

  return { tokenBalances }
})
