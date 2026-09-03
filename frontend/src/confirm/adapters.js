/* The wallet-type adapter seam — Round 1 of the custom confirmation flow.

   Two wallet types sign transactions in this app (see hooks/useAuth.jsx's
   file header): a Circle UCW ('circle-sca'), whose sole security boundary is
   Circle's own hosted iframe, and an injected wallet or Safe multisig
   ('eoa'), which renders its own confirmation with zero input from Tranche.
   useTransactionConfirm.js is wallet-agnostic — it drives Stage A (this
   app's own confirm screen, built from a ConfirmDescriptor) and then hands
   off to whichever adapter matches the signed-in wallet type for Stage B
   (the minimal, wallet-owned hand-off).

   THIS FILE IS THE SEAM, NOT THE WIRING. Nothing here is imported by any
   page yet, and nothing here calls executeContractCall or wagmi's
   writeContract — that is Round 2's job, once Stage A has been reviewed in
   isolation. Both factories below are real, typed, and unit-testable, but
   their send() intentionally throws until Round 2 replaces the body. This
   keeps the interface honest: a caller that reaches for one before Round 2
   wires it gets a clear, immediate error, not a silent no-op or an
   accidental production call. */

/**
 * @typedef {Object} TransactionRequest
 * @property {`0x${string}`} address
 * @property {readonly unknown[]} abi
 * @property {string} functionName
 * @property {readonly unknown[]} args
 */

/**
 * @typedef {Object} SendResult
 * @property {`0x${string}`} [hash]         Present once a real tx hash is known.
 * @property {string} [challengeId]         Circle-only: the challenge polled
 *                                          for a hash (see useTx.js's
 *                                          awaitScaTxHash). Absent for 'eoa'.
 */

/**
 * @typedef {Object} TransactionAdapter
 * @property {'circle-sca' | 'eoa'} type
 * @property {(request: TransactionRequest, descriptor: import('./descriptors.js').ConfirmDescriptor) => Promise<SendResult>} send
 *   Dispatches the call AFTER Stage A has been confirmed. For 'circle-sca'
 *   this is where Stage B's minimal iframe hand-off happens (Round 2: opens
 *   Circle's confirm iframe with title/subtitle only, no repeated
 *   breakdown, then polls tx-status the way useTx.js's awaitScaTxHash
 *   already does). For 'eoa' this is wagmi's write — Tranche has zero
 *   control over what the wallet shows, by design (see the round's brief).
 * @property {(receiptOrChallenge: SendResult) => Promise<`0x${string}`>} awaitHash
 *   Resolves send()'s result to a real transaction hash. A no-op passthrough
 *   for 'eoa' (send() already returns one); polls Circle's tx-status for
 *   'circle-sca'.
 */

class AdapterNotWiredError extends Error {
  constructor(type, method) {
    super(
      `${type} adapter's ${method}() is a Round 1 seam — Round 2 wires it to the real ` +
      'signing call. If you are seeing this outside a test, useTransactionConfirm ' +
      'is being used from production code before Round 2 landed.'
    )
    this.name = 'AdapterNotWiredError'
  }
}

/** @returns {TransactionAdapter} */
export function createCircleAdapter() {
  return {
    type: 'circle-sca',
    async send() {
      throw new AdapterNotWiredError('circle-sca', 'send')
    },
    async awaitHash() {
      throw new AdapterNotWiredError('circle-sca', 'awaitHash')
    }
  }
}

/** @returns {TransactionAdapter} */
export function createEoaAdapter() {
  return {
    type: 'eoa',
    async send() {
      throw new AdapterNotWiredError('eoa', 'send')
    },
    async awaitHash() {
      throw new AdapterNotWiredError('eoa', 'awaitHash')
    }
  }
}

/** Picks the adapter for the currently signed-in wallet type. Mirrors
 *  useAuth()'s own walletType resolution (circle wins when both exist) so
 *  callers don't have to duplicate that precedence — see useAuth.jsx's
 *  `value` useMemo for the source of truth this mirrors.
 *  @param {'circle-sca' | 'eoa' | null} walletType
 *  @returns {TransactionAdapter | null} */
export function selectAdapter(walletType) {
  if (walletType === 'circle-sca') return createCircleAdapter()
  if (walletType === 'eoa') return createEoaAdapter()
  return null
}
