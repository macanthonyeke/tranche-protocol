// Best-effort localStorage wrapper for the cctp delivery tracker. localStorage
// itself can throw on get/set/remove — privacy-mode browsers, a denied
// origin, quota exhaustion all raise a real SecurityError/DOMException, not
// just return undefined. The cctp tracking data is disposable (a 24h-lived
// local echo, always re-derivable from the chain via
// FallbackCrossChainDelivery), so every failure mode here degrades to
// "no local record" rather than throwing into a render or a tx-confirmation
// callback (onChange, setActiveKey, onCrossChainRelease) and breaking it.
export function safeGetItem(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

export function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key)
  } catch {}
}
