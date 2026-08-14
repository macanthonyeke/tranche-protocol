import { describe, it, expect, vi, afterEach } from 'vitest'

/* worstCaseRemainder — the arithmetic Round 20 Phase C's dominating-fee
   design depends on for fund safety, so it gets tested directly rather than
   only inferred from which code path fires.

   escrowFeeBps (the per-escrow snapshot the contract actually deducts,
   TrancheProtocol.sol:1268) has no getter, so the frontend cannot read the
   real rate for a given escrow. What it CAN read is maxProtocolFeeBps
   (getProtocolConfig().maxProtocolFeeBps, mirroring the contract's hardcoded
   MAX_PROTOCOL_FEE = 500 at TrancheProtocol.sol:23) — an immutable ceiling
   every escrow's snapshot was checked against at set time
   (TrancheProtocol.sol:191's `if (_newFeeBps > MAX_PROTOCOL_FEE) revert`).
   Because the real rate can never exceed the ceiling, the real fee can never
   exceed the ceiling-based fee, so this function's output is a proven lower
   bound on the real remainder — never an upper bound, never a guess.

   The MATH is unchanged from Round 18's original version. What changed is
   the ROLE: Round 18 fed this straight into a reject-on-unsafe-estimate
   check; Round 19 deleted it because that role was unsound (a conservative
   estimate landing below the floor doesn't mean the real remainder does).
   Round 20 Phase C re-adds it purely as a safety gate inside
   resolveDominantMaxFee, deciding whether a live quote is trustworthy
   enough to prefer over the floor — see that function's own tests below for
   how the new role is exercised. */
import { worstCaseRemainder, resolveDominantMaxFee, fetchForwardFee } from './cctpFee.js'

const MAX_PROTOCOL_FEE_BPS = 500n // mirrors TrancheProtocol.sol:23

// What the contract itself computes for a given (real) snapshotted rate —
// TrancheProtocol.sol:1268-1271's `fee`/`remainder` arithmetic, reproduced
// here only to check worstCaseRemainder against it, not to duplicate
// production logic.
const actualRemainder = (amount, feeBps) => {
  const fee = (amount * feeBps) / 10_000n
  return amount - fee
}

describe('worstCaseRemainder', () => {
  it('is a proven lower bound on the actual remainder for every legal snapshot rate', () => {
    const sampleRates = [0n, 1n, 100n, 199n, 300n, 499n, 500n]
    const sampleAmounts = [1n, 999n, 1_000_000n, 250_000_000n, 999_999_999n]

    for (const amount of sampleAmounts) {
      for (const realBps of sampleRates) {
        const worstCase = worstCaseRemainder(amount, MAX_PROTOCOL_FEE_BPS)
        const actual = actualRemainder(amount, realBps)
        expect(worstCase).toBeLessThanOrEqual(actual)
      }
    }
  })

  it('is exactly equal to the actual remainder at the ceiling rate itself', () => {
    const amount = 250_000_000n
    expect(worstCaseRemainder(amount, MAX_PROTOCOL_FEE_BPS)).toBe(actualRemainder(amount, MAX_PROTOCOL_FEE_BPS))
  })

  it('is strictly less than the gross amount whenever the ceiling is nonzero', () => {
    expect(worstCaseRemainder(250_000_000n, MAX_PROTOCOL_FEE_BPS)).toBeLessThan(250_000_000n)
  })

  it('defaults to the contract ceiling (500 bps), not zero, when maxProtocolFeeBps is unavailable', () => {
    const amount = 250_000_000n
    expect(worstCaseRemainder(amount, undefined)).toBe(worstCaseRemainder(amount, MAX_PROTOCOL_FEE_BPS))
    expect(worstCaseRemainder(amount, undefined)).toBeLessThanOrEqual(actualRemainder(amount, 0n))
  })

  it('returns the full amount when the ceiling itself is zero', () => {
    expect(worstCaseRemainder(250_000_000n, 0n)).toBe(250_000_000n)
  })
})

/* resolveDominantMaxFee — Round 20 Phase C's live-quote-when-safe,
   floor-fallback-otherwise design. Mocks the global fetch fetchForwardFee
   reads from, the same pattern InvoiceCard.test.jsx already uses for
   network-dependent components. */
const mockFeeResponse = (feeBaseUnits) => ({
  ok: true,
  json: async () => [{ finalityThreshold: 2000, forwardFee: { high: String(feeBaseUnits) } }]
})

describe('resolveDominantMaxFee', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('attempts the live quote (and clamps it up to the floor via max()) when the quote is provably below worstCaseRemainder but below the floor itself', () => {
    // recipientAmount 250_000_000 (250 USDC) → worstCaseRemainder at the
    // default 500bps ceiling = 237_500_000. A live quote of 150000 is far
    // below that, so it's provably safe — but also below the floor, so
    // max(liveQuote, floor) clamps up to the floor. The returned value alone
    // can't distinguish this from a pure floor-only fallback (see the next
    // test for that), so this also asserts the quote was actually fetched.
    const fetchMock = vi.fn(() => Promise.resolve(mockFeeResponse(150000)))
    vi.stubGlobal('fetch', fetchMock)
    return resolveDominantMaxFee({
      destinationDomain: 6, floor: 200000n, recipientAmount: 250_000_000n, maxProtocolFeeBps: 500n
    }).then((maxFee) => {
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(maxFee).toBe(200000n) // max(150000, floor 200000) = floor
    })
  })

  it('uses the live quote itself when it exceeds the floor but is still provably safe', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockFeeResponse(300000))))
    return resolveDominantMaxFee({
      destinationDomain: 6, floor: 200000n, recipientAmount: 250_000_000n, maxProtocolFeeBps: 500n
    }).then((maxFee) => {
      expect(maxFee).toBe(300000n) // max(300000, floor 200000) = live quote
    })
  })

  it('falls back to the floor when the quote is NOT provably below worstCaseRemainder, without rejecting', () => {
    // worstCaseRemainder(1000, 500) = 950. A "live" quote at or above that
    // is not provably safe, even though it might be safe in reality — the
    // design falls back rather than gambling on an unproven value.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockFeeResponse(950))))
    return resolveDominantMaxFee({
      destinationDomain: 6, floor: 200000n, recipientAmount: 1000n, maxProtocolFeeBps: 500n
    }).then((maxFee) => {
      expect(maxFee).toBe(200000n)
    })
  })

  it('falls back to the floor, without throwing, when the quote fetch fails', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))
    return expect(
      resolveDominantMaxFee({
        destinationDomain: 6, floor: 200000n, recipientAmount: 250_000_000n, maxProtocolFeeBps: 500n
      })
    ).resolves.toBe(200000n)
  })

  it('falls back to the floor, without throwing, when the response is malformed', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ not: 'an array' }) })))
    return expect(
      resolveDominantMaxFee({
        destinationDomain: 6, floor: 200000n, recipientAmount: 250_000_000n, maxProtocolFeeBps: 500n
      })
    ).resolves.toBe(200000n)
  })

  it('falls back to the floor, without throwing, when the HTTP response is not ok', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })))
    return expect(
      resolveDominantMaxFee({
        destinationDomain: 6, floor: 200000n, recipientAmount: 250_000_000n, maxProtocolFeeBps: 500n
      })
    ).resolves.toBe(200000n)
  })

  /* Round 21 Phase B: a request that simply hangs never resolves and never
     rejects on its own — an unprotected fetch here would make
     resolveDominantMaxFee's "never blocks the transaction" guarantee false
     for a network partial-connection or unusually slow response, not just an
     outright failure. This mock respects AbortSignal the way real fetch does
     (rejects with an AbortError once the signal fires), so it can only
     resolve this test if fetchForwardFee's own timeout actually aborts it. */
  it('falls back to the floor, without throwing, when the quote request hangs past its timeout', async () => {
    vi.useFakeTimers()
    const hangingFetch = vi.fn((url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        reject(err)
      })
    }))
    vi.stubGlobal('fetch', hangingFetch)

    const resultPromise = resolveDominantMaxFee({
      destinationDomain: 6, floor: 200000n, recipientAmount: 250_000_000n, maxProtocolFeeBps: 500n
    })
    await vi.advanceTimersByTimeAsync(8_000)
    const maxFee = await resultPromise

    expect(maxFee).toBe(200000n)
    vi.useRealTimers()
  })
})

describe('fetchForwardFee — timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('throws a clean, catchable error once the request hangs past FEE_QUOTE_TIMEOUT_MS, rather than never resolving', async () => {
    vi.useFakeTimers()
    const hangingFetch = vi.fn((url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        reject(err)
      })
    }))
    vi.stubGlobal('fetch', hangingFetch)

    const resultPromise = fetchForwardFee(26, 6)
    let settled = false
    resultPromise.catch(() => {}).finally(() => { settled = true })

    // Well before the timeout: still hanging, exactly the failure mode a
    // missing timeout would leave forever.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(3_001)
    await expect(resultPromise).rejects.toThrow(/timed out/i)
  })

  it('passes an AbortSignal to fetch so a real hang can actually be cancelled', () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => [{ finalityThreshold: 2000, forwardFee: { high: '150000' } }]
    }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchForwardFee(26, 6).then(() => {
      const [, opts] = fetchMock.mock.calls[0]
      expect(opts.signal).toBeInstanceOf(AbortSignal)
    })
  })

  /* Round 22 Phase B: fetch() resolves once HEADERS arrive — well before the
     body is read. The old code cleared the timeout in a `finally` right
     after that `await fetch(...)` line, so a server that sent headers and
     then stalled the body was completely unprotected: res.json() had no
     timeout left to race against and could hang forever. This is
     deliberately a DIFFERENT failure mode than the hanging-fetch tests
     above — here `fetch()` itself resolves immediately (`ok: true` synchronously
     available); only the body-read promise stalls, which is exactly the gap
     those tests don't exercise. The mock's json() only settles once the
     same AbortSignal fires, so this can only pass if the timeout is still
     alive across the res.json() call. */
  it('keeps the timeout alive through res.json() — a stalled body must time out, not hang forever', async () => {
    vi.useFakeTimers()
    const hangingBodyFetch = vi.fn((url, opts) => Promise.resolve({
      ok: true,
      json: () => new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    }))
    vi.stubGlobal('fetch', hangingBodyFetch)

    const resultPromise = fetchForwardFee(26, 6)
    let settled = false
    resultPromise.catch(() => {}).finally(() => { settled = true })

    // fetch() has already resolved (headers) at this point — only the body
    // read is stalled. Well before the timeout: still hanging.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(3_001)
    await expect(resultPromise).rejects.toThrow(/timed out/i)
  })
})
