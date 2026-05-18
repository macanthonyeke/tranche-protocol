import { NavLink, Link } from 'react-router-dom'
import WalletButton from './WalletButton.jsx'
import ThemeToggle from './ThemeToggle.jsx'

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/create',    label: 'Create' },
  { to: '/ledger',    label: 'History' },
  { to: '/tribunal',  label: 'Arbiter Panel' },
  { to: '/settings',  label: 'Settings' }
]

const MOBILE_NAV = [
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
    to: '/tribunal',
    label: 'Arbiter',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 3v3M5 7h10M6 7l-2 9h12L14 7M9 11v3M11 11v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
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

function TopNav() {
  return (
    <header className="sticky top-0 z-50 w-full bg-background-primary/80 backdrop-blur-md border-b border-border-subtle h-16 flex items-center px-6 md:px-12 justify-between">
      {/* Left — Branding & Environment */}
      <div className="flex items-center min-w-0">
        <Link to="/" className="font-bold text-text-primary tracking-tight whitespace-nowrap">
          CrossChainEscrow
        </Link>
        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 bg-background-tertiary border border-border-subtle rounded-md ml-4">
          <span className="w-1.5 h-1.5 bg-status-success rounded-full animate-pulse" />
          <span className="text-[11px] font-mono text-text-secondary uppercase tracking-wider">Arc Testnet</span>
        </div>
      </div>

      {/* Center — Navigation Links */}
      <nav className="hidden md:flex items-center gap-8">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              isActive
                ? "text-sm font-medium text-text-primary relative after:content-[''] after:absolute after:-bottom-[22px] after:left-0 after:right-0 after:h-0.5 after:bg-accent-blue"
                : 'text-sm font-medium text-text-secondary hover:text-text-primary transition-colors'
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Right — Utility & Wallet */}
      <div className="flex items-center gap-4">
        <a
          href="https://twitter.com"
          target="_blank"
          rel="noreferrer"
          aria-label="X (Twitter)"
          className="text-text-tertiary hover:text-text-primary transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
          </svg>
        </a>
        <a
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          className="text-text-tertiary hover:text-text-primary transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56C20.21 21.38 23.5 17.08 23.5 12 23.5 5.73 18.27.5 12 .5Z" />
          </svg>
        </a>
        <ThemeToggle />
        <WalletButton />
      </div>
    </header>
  )
}

function BottomNav() {
  return (
    <nav className="flex md:hidden fixed bottom-0 inset-x-0 z-50 h-16 w-full border-t border-border-subtle bg-background-secondary justify-around items-stretch">
      {MOBILE_NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium px-2 pt-1 pb-1 transition-colors ${
              isActive
                ? 'text-accent border-t-2 border-accent-blue -mt-[1px]'
                : 'text-text-secondary border-t-2 border-transparent -mt-[1px]'
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

export default function AppShell({ children, maxWidth = 'content' }) {
  const mainCls =
    maxWidth === 'full'
      ? 'flex-1 w-full px-6 md:px-12 py-12 pb-28 md:pb-12 flex flex-col gap-8'
      : 'w-full max-w-7xl mx-auto px-6 md:px-12 py-12 pb-28 md:pb-12 flex flex-col gap-8 flex-1'
  return (
    <div className="min-h-screen bg-background-primary flex flex-col text-text-primary">
      <TopNav />
      <main className={mainCls}>{children}</main>
      <BottomNav />
    </div>
  )
}
