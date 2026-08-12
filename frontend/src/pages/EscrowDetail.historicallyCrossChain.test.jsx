import { describe, it, expect } from 'vitest'

/* historicallyCrossChain — Round 21 Phase C.

   MilestoneRow used to gate the cross-chain delivery tracker on
   trackingDomain, re-derived from the escrow/splits' CURRENT config every
   render. But the contract allows redirecting an active escrow's
   destination to Arc (updateReceivingAddress / updateSplitReceivingAddress)
   AFTER a milestone has already released cross-chain — recomputing "is this
   cross-chain" from today's config for an already-released milestone would
   then hide that milestone's real, still-possibly-unrecovered CCTP message.

   cctpTrack (this device's own localStorage record, written only when a
   release was cross-chain at submission time) is proof-positive of history,
   independent of what the config says now. This tests exactly that
   property — and, just as importantly, that the honest LIMIT of the fix
   stays covered: with no local record, the function still falls back to
   trackingDomain (today's imperfect, current-config-derived signal), so a
   different device with a genuinely-redirected-to-Arc config correctly
   stays hidden rather than accidentally showing a false positive. */
import { historicallyCrossChain } from './EscrowDetail.jsx'

describe('historicallyCrossChain', () => {
  it('stays true when a local cctpTrack record exists, even though current config has since been redirected to Arc-only', () => {
    // The exact bug this closes: cctpTrack is truthy (this device submitted
    // a cross-chain release), but trackingDomain is now null because the
    // escrow was redirected to Arc afterward.
    const cctpTrack = { txHash: '0xabc123', ts: Date.now() }
    const trackingDomainAfterRedirect = null
    expect(historicallyCrossChain(cctpTrack, trackingDomainAfterRedirect)).toBe(true)
  })

  it('stays true when a local cctpTrack record exists and current config is still genuinely cross-chain too', () => {
    const cctpTrack = { txHash: '0xabc123', ts: Date.now() }
    expect(historicallyCrossChain(cctpTrack, 6)).toBe(true)
  })

  /* The honest limit: with no local record (a different device, or this one
     past the 24h localStorage eviction — see readCctpTrack), there is no
     historical signal to fall back on, so this correctly defers to
     trackingDomain — including the false-negative case a redirect causes,
     which Round 21 Phase C does NOT close for this path. This must stay
     covered so it can't silently start "passing" the historical case for
     the wrong reason (e.g. a future edit that makes this always return true
     regardless of cctpTrack). */
  it('falls back to trackingDomain when there is no local record, and correctly stays false for a genuinely Arc-only config', () => {
    expect(historicallyCrossChain(null, null)).toBe(false)
  })

  it('falls back to trackingDomain when there is no local record, and correctly stays true for a genuinely cross-chain config', () => {
    expect(historicallyCrossChain(null, 6)).toBe(true)
  })

  it('falls back to trackingDomain when cctpTrack is undefined (no state initialized yet), not just null', () => {
    expect(historicallyCrossChain(undefined, null)).toBe(false)
    expect(historicallyCrossChain(undefined, 6)).toBe(true)
  })
})
