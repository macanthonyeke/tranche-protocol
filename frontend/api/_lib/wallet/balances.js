// POST /api/wallet/balances — token balances for one of the caller's wallets.
//
// Used for the USDC figure on the dashboard when signed in with email. EOA
// users get the same number straight from the chain via wagmi's useBalance,
// so this exists only because an SCA wallet's id (not its address) is the
// handle Circle indexes balances by.

import { sessionPostRoute } from './identity.js'

export default sessionPostRoute(async ({ circle, userToken, wallet }) => {
  const res = await circle.getWalletTokenBalance({ userToken, walletId: wallet.id })

  const tokenBalances = (res?.data?.tokenBalances ?? []).map((b) => ({
    amount: b.amount,
    symbol: b.token?.symbol ?? null,
    name: b.token?.name ?? null,
    decimals: b.token?.decimals ?? null,
    tokenAddress: b.token?.tokenAddress ?? null
  }))

  return { tokenBalances }
})
