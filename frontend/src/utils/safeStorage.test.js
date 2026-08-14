import { describe, it, expect, afterEach, vi } from 'vitest'
import { safeGetItem, safeSetItem, safeRemoveItem } from './safeStorage.js'

/* Round 29 — Medium finding: an unguarded localStorage call can throw
   uncaught. Privacy settings, a SecurityError on a denied origin, or quota
   exhaustion can make getItem/setItem/removeItem throw for real, not just
   return undefined. Every caller in this app treats the cctp tracker as
   disposable (re-derivable from the chain), so a storage failure must
   degrade to "no local record" — never propagate into a render (readCctpTrack
   runs inside a useState initializer) or a tx-confirmation callback. */
describe('safeStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('safeGetItem returns null instead of throwing when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => safeGetItem('k')).not.toThrow()
    expect(safeGetItem('k')).toBeNull()
  })

  it('safeSetItem does not throw when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => safeSetItem('k', 'v')).not.toThrow()
  })

  it('safeRemoveItem does not throw when localStorage.removeItem throws', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => safeRemoveItem('k')).not.toThrow()
  })

  it('safeGetItem/safeSetItem/safeRemoveItem still work normally when storage is healthy', () => {
    safeSetItem('k', 'v')
    expect(safeGetItem('k')).toBe('v')
    safeRemoveItem('k')
    expect(safeGetItem('k')).toBeNull()
  })
})
