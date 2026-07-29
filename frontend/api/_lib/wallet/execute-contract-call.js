// POST /api/wallet/execute-contract-call — the SCA half of every contract
// write in the app.
//
// Returns a challengeId; the browser SDK executes it, the user approves with
// their PIN, and Circle broadcasts. Gas is sponsored by Circle's Gas Station
// (the wallet is an SCA — see _lib/circle.js), so the user never needs native
// currency on Arc.
//
// CALLDATA, NOT abiFunctionSignature. Circle accepts either, but the frontend
// sends pre-encoded calldata built by viem's encodeFunctionData from the same
// ABI and args the wagmi path passes to writeContract. That means an SCA user
// and an EOA user submit byte-identical transactions to the same contract —
// the wallet type changes who signs, never what is signed. Going through
// abiFunctionSignature/abiParameters would instead re-encode the arguments a
// second time, on Circle's side, from a JSON representation that has no
// faithful spelling for several types this contract actually takes: bytes32
// mintRecipients (CCTP reverts on a raw 20-byte address — see CLAUDE.md),
// uint256 amounts beyond Number.MAX_SAFE_INTEGER, and deposit()'s milestone
// arrays. A mismatch there would not fail loudly; it would deposit the wrong
// amount or burn to the wrong recipient.
//
// abiFunctionSignature is still accepted for callers that genuinely have no
// ABI to hand, but callData wins whenever both are present.

import { getCircleClient } from '../circle.js'
import { postRoute, requireString, RequestError } from '../walletRoute.js'

// Gas Station sponsors the transaction, but Circle's API still requires a fee
// configuration to size the gas limit. MEDIUM is the level Circle's own
// examples use for contract execution.
const FEE = { type: 'level', config: { feeLevel: 'MEDIUM' } }

export default postRoute(async (body) => {
  const userToken = requireString(body, 'userToken')
  const walletId = requireString(body, 'walletId', { max: 128 })
  const contractAddress = requireString(body, 'contractAddress', { max: 128 })

  const base = { userToken, walletId, contractAddress, fee: FEE }
  if (body.refId) base.refId = String(body.refId).slice(0, 100)

  let input
  if (typeof body.callData === 'string' && body.callData) {
    if (!/^0x([0-9a-fA-F]{2})*$/.test(body.callData)) {
      throw new RequestError('callData must be an even-length 0x-prefixed hex string.')
    }
    input = { ...base, callData: body.callData }
  } else if (typeof body.abiFunctionSignature === 'string' && body.abiFunctionSignature) {
    if (!Array.isArray(body.abiParameters)) {
      throw new RequestError('abiParameters must be an array.')
    }
    input = {
      ...base,
      abiFunctionSignature: body.abiFunctionSignature,
      abiParameters: body.abiParameters
    }
  } else {
    throw new RequestError('Either callData or abiFunctionSignature is required.')
  }

  const circle = getCircleClient()
  const res = await circle.createUserTransactionContractExecutionChallenge(input)

  const challengeId = res?.data?.challengeId
  if (!challengeId) {
    throw new RequestError('Wallet service did not return a challenge.', 502)
  }
  return { challengeId }
})
