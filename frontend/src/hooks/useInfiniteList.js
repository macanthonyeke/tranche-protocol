import { useEffect, useMemo, useRef, useState } from 'react'

/* Tiny client-side pagination over an array, with an IntersectionObserver
   sentinel that bumps the visible slice. The contract returns full arrays —
   this gives us "infinite scroll" UX without round-tripping for each page. */
export function useInfiniteList(items, { pageSize = 12, deps = [] } = {}) {
  const [count, setCount] = useState(pageSize)
  const sentinelRef = useRef(null)

  // Reset when source identity changes (e.g. filters changed).
  useEffect(() => {
    setCount(pageSize)
  }, [items, pageSize, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => items.slice(0, count), [items, count])
  const hasMore = count < items.length
  const remaining = Math.max(items.length - count, 0)

  useEffect(() => {
    if (!hasMore) return
    const node = sentinelRef.current
    if (!node) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setCount((c) => Math.min(c + pageSize, items.length))
        }
      },
      { rootMargin: '300px 0px' }
    )
    obs.observe(node)
    return () => obs.disconnect()
  }, [hasMore, items.length, pageSize])

  return { visible, hasMore, remaining, sentinelRef }
}
