import { useCallback, useEffect, useMemo, useState } from 'react'
import { GOLDSKY_ENABLED, fetchActivityFeed } from '../lib/goldsky'
import { useDisputeConfig } from './useEscrows'

const POLL_MS = 60_000
const LS_KEY = (address) => `tranche-last-seen-${address?.toLowerCase()}`

export function useActivityFeed(address) {
  const { arbiterWindow } = useDisputeConfig()
  const [items, setItems] = useState([])
  const [lastSeen, setLastSeen] = useState(() => {
    if (!address) return 0
    return Number(localStorage.getItem(LS_KEY(address)) || 0)
  })

  // Re-read lastSeen from localStorage whenever address changes.
  useEffect(() => {
    if (!address) return
    setLastSeen(Number(localStorage.getItem(LS_KEY(address)) || 0))
  }, [address])

  const fetch = useCallback(async () => {
    if (!GOLDSKY_ENABLED || !address) return
    try {
      const arbiterWindowSecs = arbiterWindow ? Number(arbiterWindow) : 0
      const result = await fetchActivityFeed(address, {
        since: Number(localStorage.getItem(LS_KEY(address)) || 0),
        arbiterWindowSecs,
      })
      setItems(result)
    } catch {
      // Swallow — activity feed is non-critical
    }
  }, [address, arbiterWindow])

  // Initial fetch + periodic poll
  useEffect(() => {
    fetch()
    const id = setInterval(fetch, POLL_MS)
    return () => clearInterval(id)
  }, [fetch])

  const markRead = useCallback(() => {
    if (!address) return
    const now = Math.floor(Date.now() / 1000)
    localStorage.setItem(LS_KEY(address), String(now))
    setLastSeen(now)
    // Re-fetch with updated lastSeen so event-based items disappear
    setTimeout(fetch, 50)
  }, [address, fetch])

  // Unread count: event items newer than lastSeen + all time-sensitive alerts
  const unreadCount = useMemo(() => {
    let n = 0
    for (const item of items) {
      if (item.type === 'delivery_claimed' || item.type === 'dispute_raised') {
        if (item.timestamp > lastSeen) n++
      } else {
        // review_expiring and arbiter_expiring always count
        n++
      }
    }
    return n
  }, [items, lastSeen])

  const itemsWithRead = useMemo(() =>
    items.map((item) => ({
      ...item,
      isNew:
        (item.type === 'delivery_claimed' || item.type === 'dispute_raised')
          ? item.timestamp > lastSeen
          : true,
    })),
  [items, lastSeen])

  return { items: itemsWithRead, unreadCount, markRead, refetch: fetch }
}
