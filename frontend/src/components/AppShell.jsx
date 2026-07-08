import { useEffect, useRef, useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import IconButton from './IconButton.jsx'
import WalletButton from './WalletButton.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import { useRoles } from '../hooks/useRoles.jsx'
import { useTheme } from '../hooks/useTheme.jsx'
import { useActivityFeed } from '../hooks/useActivityFeed.js'
import { Logo } from './Logo.jsx'
import { arcTestnet } from '../config/wagmi'
import { countdown } from '../utils/format.js'
import { GOLDSKY_ENABLED } from '../lib/goldsky.js'

const CONSUMER_NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/create',    label: 'Create' },
  { to: '/ledger',    label: 'History' },
  { to: '/settings',  label: 'Settings' }
]

const ARBITER_NAV = [{ to: '/arbiter',  label: 'Arbiter Panel' }]
const ADMIN_NAV   = [{ to: '/protocol', label: 'Protocol Settings' }]

function useNavLinks() {
  const { isArbiter, isAdmin, isConnected, isLoading } = useRoles()
  if (!isConnected || isLoading) return CONSUMER_NAV
  const links = [...CONSUMER_NAV]
  if (isArbiter) links.push(...ARBITER_NAV)
  if (isAdmin) links.push(...ADMIN_NAV)
  return links
}

const ShieldMobileIcon = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M10 2.5 4 4.5v4c0 3.4 2.6 6.5 6 7.5 3.4-1 6-4.1 6-7.5v-4l-6-2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
  </svg>
)

const SlidersMobileIcon = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M4 6h12M4 10h12M4 14h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="8"  cy="6"  r="1.6" fill="currentColor"/>
    <circle cx="13" cy="10" r="1.6" fill="currentColor"/>
    <circle cx="6"  cy="14" r="1.6" fill="currentColor"/>
  </svg>
)

const MOBILE_NAV_CONSUMER = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="11" y="3" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="3" y="11" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="11" y="11" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.4"/>
      </svg>
    )
  },
  {
    to: '/create',
    label: 'Create',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    )
  },
  {
    to: '/ledger',
    label: 'History',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M4 4h12v12H4z" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M7 8h6M7 11h6M7 14h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    )
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    )
  }
]

const MOBILE_NAV_ARBITER = [{ to: '/arbiter',  label: 'Arbiter',  icon: ShieldMobileIcon }]
const MOBILE_NAV_ADMIN   = [{ to: '/protocol', label: 'Protocol', icon: SlidersMobileIcon }]

function useMobileNavLinks() {
  const { isArbiter, isAdmin, isConnected, isLoading } = useRoles()
  if (!isConnected || isLoading) return MOBILE_NAV_CONSUMER
  const links = [...MOBILE_NAV_CONSUMER]
  if (isArbiter) links.push(...MOBILE_NAV_ARBITER)
  if (isAdmin) links.push(...MOBILE_NAV_ADMIN)
  return links
}

function TopNav() {
  const navLinks = useNavLinks()
  const { address, isConnected } = useAccount()
  const [feedOpen, setFeedOpen] = useState(false)
  const feedRef = useRef(null)
  const { items, unreadCount, markRead } = useActivityFeed(isConnected ? address : null)

  // Close feed when clicking outside
  useEffect(() => {
    if (!feedOpen) return
    const handler = (e) => {
      if (feedRef.current && !feedRef.current.contains(e.target)) setFeedOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [feedOpen])

  const toggleFeed = () => {
    if (!feedOpen && unreadCount > 0) markRead()
    setFeedOpen((v) => !v)
  }

  return (
    <header className="sticky top-0 z-50 w-full bg-paper/85 backdrop-blur-md border-b border-rule h-16 flex items-center px-6 md:px-12 justify-between">
      {/* Left — Branding & Environment.
          Below sm the full wordmark would overlap the utility cluster, so we
          fall back to the "C" badge (same glyph used on the marketing nav).
          The Arc Testnet chip is held at lg+ — at md it competes with the
          center nav links for the same horizontal space. */}
      <div className="flex items-center min-w-0">
        <Link to="/" className="flex items-center gap-2.5 group" aria-label="Tranche Protocol home">
          <Logo variant="nav-tile" />
          <span className="hidden sm:inline md:hidden lg:inline display text-[22px] tracking-tightest leading-none">Tranche</span>
        </Link>
        <div className="hidden lg:flex items-center gap-2 px-2.5 py-1 ml-4 rounded-sm bg-sunk border border-rule">
          <span className="relative flex items-center">
            <span className="absolute inline-flex h-2 w-2 rounded-full bg-ok/30 animate-ping" />
            <span className="relative w-1.5 h-1.5 bg-ok rounded-full" />
          </span>
          <span className="text-[10.5px] num text-ink-2 uppercase tracking-[0.18em]">Arc Testnet</span>
        </div>
      </div>

      {/* Center — Navigation Links */}
      <nav className="hidden md:flex items-center gap-7">
        {navLinks.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `relative text-sm font-medium pb-0.5 ${isActive ? 'text-ink' : 'text-ink-2 hover:text-ink transition-colors'}`
            }
          >
            {({ isActive }) => (
              <>
                {item.label}
                {isActive && (
                  <motion.span
                    layoutId="nav-underline"
                    className="absolute bottom-0 left-0 right-0 h-px bg-clay rounded-full"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Right — Utility & Wallet.
          Below md, the social links + theme toggle move into MobileMoreMenu:
          six full-width controls (X, GitHub, bell, theme, wallet, plus the
          logo on the left) don't fit a ~360px header without clipping the
          wallet pill — the one piece of chrome that actually matters
          mid-task. Bell and wallet stay always-visible on every breakpoint. */}
      <div className="flex items-center gap-1.5">
        <div className="hidden md:flex items-center gap-1">
          <IconButton
            as="a"
            href="https://x.com/trancheprotocol"
            target="_blank"
            rel="noreferrer"
            label="X (Twitter)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
            </svg>
          </IconButton>
          <IconButton
            as="a"
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            label="GitHub"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56C20.21 21.38 23.5 17.08 23.5 12 23.5 5.73 18.27.5 12 .5Z" />
            </svg>
          </IconButton>
        </div>

        {/* Activity bell — only when Goldsky is enabled and wallet is connected */}
        {GOLDSKY_ENABLED && isConnected && (
          <div className="relative" ref={feedRef}>
            <IconButton
              onClick={toggleFeed}
              label={`Activity feed${unreadCount > 0 ? ` — ${unreadCount} new` : ''}`}
            >
              <span className="relative inline-flex">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-clay text-paper text-[9px] font-bold flex items-center justify-center tabular-nums leading-none">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </span>
            </IconButton>

            {feedOpen && (
              <ActivityFeedPanel items={items} onClose={() => setFeedOpen(false)} />
            )}
          </div>
        )}

        <div className="hidden md:block"><ThemeToggle /></div>
        <MobileMoreMenu />
        <WalletButton />
      </div>
    </header>
  )
}

/* Mobile-only (below md) overflow menu holding what the desktop header shows
   inline: theme toggle, X, GitHub. These are preference/marketing links, not
   task-relevant on a screen where BottomNav already owns primary navigation
   — collapsing them here is what actually frees the room the wallet pill
   needs on a ~360px viewport, rather than shrinking every control equally. */
function MobileMoreMenu() {
  const { theme, toggle } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const isDark = theme === 'dark'

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative md:hidden" ref={ref}>
      <IconButton onClick={() => setOpen((v) => !v)} label="More" aria-expanded={open}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <circle cx="10" cy="4" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="10" cy="16" r="1.6" />
        </svg>
      </IconButton>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.97 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-48 bg-paper border border-rule rounded-2xl shadow-lg overflow-hidden py-1.5"
        >
          <button
            type="button"
            onClick={() => { toggle(); setOpen(false) }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-sunk transition-colors"
          >
            {isDark ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M12 9.5a4.5 4.5 0 0 1-5.5-5.5A5 5 0 1 0 12 9.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            )}
            {isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          </button>
          <a
            href="https://x.com/trancheprotocol"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-sunk transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
            </svg>
            X (Twitter)
          </a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-sunk transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56C20.21 21.38 23.5 17.08 23.5 12 23.5 5.73 18.27.5 12 .5Z" />
            </svg>
            GitHub
          </a>
        </motion.div>
      )}
    </div>
  )
}

const FEED_COPY = {
  delivery_claimed: (item) => ({
    label: `Delivery claimed — Escrow #${item.escrowId}, M${item.milestoneIndex + 1}`,
    sub: item.reviewDeadline
      ? `Review window closes in ${countdown(item.reviewDeadline).replace(' remaining', '')}.`
      : 'Review window now open.',
    urgency: item.reviewDeadline && (item.reviewDeadline - Math.floor(Date.now() / 1000)) < 3600 ? 'high' : 'normal',
  }),
  dispute_raised: (item) => ({
    label: `Dispute raised against you — Escrow #${item.escrowId}, M${item.milestoneIndex + 1}`,
    sub: 'Submit counter-evidence before the arbiter window closes.',
    urgency: 'high',
  }),
  review_expiring: (item) => ({
    label: `Review window expiring soon — Escrow #${item.escrowId}, M${item.milestoneIndex + 1}`,
    sub: `Closes in ${countdown(item.reviewDeadline).replace(' remaining', '')}. Approve or dispute before it auto-releases.`,
    urgency: 'high',
  }),
  arbiter_expiring: (item) => ({
    label: `Arbiter window expiring — Escrow #${item.escrowId}, M${item.milestoneIndex + 1}`,
    sub: item.expiresAt
      ? `Closes in ${countdown(item.expiresAt).replace(' remaining', '')}. The 50/50 timeout can then be triggered.`
      : 'Arbiter window closing soon.',
    urgency: 'warn',
  }),
}

function ActivityFeedPanel({ items, onClose }) {
  return (
    <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-paper border border-rule rounded-2xl shadow-lg z-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-rule">
        <span className="text-sm font-semibold">Activity</span>
        <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink transition-colors text-xs">
          Close
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-ink-3 text-center">No recent activity.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-rule">
            {items.map((item, i) => (
              <ActivityFeedItem key={i} item={item} onClose={onClose} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ActivityFeedItem({ item, onClose }) {
  const copy = FEED_COPY[item.type]?.(item)
  if (!copy) return null
  const isHigh = copy.urgency === 'high'
  const isWarn = copy.urgency === 'warn'
  return (
    <li>
      <Link
        to={`/escrow/${item.escrowId}`}
        onClick={onClose}
        className="flex items-start gap-3 px-4 py-3 hover:bg-sunk transition-colors"
      >
        <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
          isHigh ? 'bg-warn' : isWarn ? 'bg-clay' : item.isNew ? 'bg-ok' : 'bg-ink-3/40'
        }`} />
        <div className="flex flex-col gap-0.5 min-w-0">
          <p className={`text-[12.5px] font-medium leading-snug ${isHigh || isWarn ? 'text-ink' : 'text-ink'}`}>
            {copy.label}
          </p>
          <p className="text-[11.5px] text-ink-3 leading-relaxed">{copy.sub}</p>
        </div>
      </Link>
    </li>
  )
}

function BottomNav() {
  const mobileLinks = useMobileNavLinks()
  if (mobileLinks.length === 0) return null
  return (
    <nav className="flex md:hidden fixed bottom-0 inset-x-0 z-50 h-16 w-full border-t border-rule bg-paper justify-around items-stretch">
      {mobileLinks.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium px-2 pt-1 pb-1 transition-colors ${
              isActive
                ? 'text-clay border-t-2 border-clay -mt-[1px]'
                : 'text-ink-2 border-t-2 border-transparent -mt-[1px]'
            }`
          }
        >
          <span>{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

function WrongNetworkBanner() {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain, isPending } = useSwitchChain()

  if (!isConnected || chainId === arcTestnet.id) return null

  return (
    <div className="bg-warn/10 border-b border-warn/30 px-6 py-2.5 flex items-center justify-between gap-4 flex-wrap">
      <p className="text-[13px] text-warn">
        Your wallet is on the wrong network. Switch to Arc Testnet to use Tranche Protocol.
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={() => switchChain({ chainId: arcTestnet.id })}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-warn/40 px-3 py-1.5 text-xs font-medium text-warn hover:bg-warn/10 transition-colors disabled:opacity-60"
      >
        {isPending ? 'Switching…' : 'Switch to Arc Testnet'}
      </button>
    </div>
  )
}

export default function AppShell({ children, maxWidth = 'content' }) {
  const mainCls =
    maxWidth === 'full'
      ? 'flex-1 w-full px-6 lg:px-10 pt-10 pb-28 md:pb-20 flex flex-col gap-8'
      : 'w-full max-w-page mx-auto px-6 lg:px-10 pt-10 pb-28 md:pb-20 flex flex-col gap-8 flex-1'
  return (
    <div className="min-h-screen flex flex-col text-ink">
      <TopNav />
      <WrongNetworkBanner />
      <main className={mainCls}>{children}</main>
      <BottomNav />
    </div>
  )
}
