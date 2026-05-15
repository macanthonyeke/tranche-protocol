import { NavLink, Link } from 'react-router-dom'
import WalletButton from './WalletButton.jsx'
import ThemeToggle from './ThemeToggle.jsx'

/* ---------------- Nav items ---------------- */
const NAV = [
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
    label: 'Ledger',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M4 4h12v12H4z" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M7 8h6M7 11h6M7 14h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    )
  },
  {
    to: '/tribunal',
    label: 'Tribunal',
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

/* ---------------- Sidebar (desktop & tablet) ---------------- */
function Sidebar() {
  return (
    <aside className="hidden md:flex sticky top-0 h-screen w-20 lg:w-64 flex-col border-r border-border-subtle bg-background-secondary">
      <div className="h-16 flex items-center justify-center lg:justify-start lg:px-6 border-b border-border-subtle">
        <Link to="/" className="flex items-center gap-2 text-text-primary">
          <span className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-accent text-white font-semibold">C</span>
          <span className="hidden lg:inline font-semibold tracking-tight">CrossChainEscrow</span>
        </Link>
      </div>

      <nav className="flex-1 py-4 px-2 lg:px-3 flex flex-col gap-1">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-accent-muted text-accent'
                  : 'text-text-secondary hover:bg-background-tertiary hover:text-text-primary'
              } justify-center lg:justify-start`
            }
            title={item.label}
          >
            <span className="shrink-0">{item.icon}</span>
            <span className="hidden lg:inline">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="hidden lg:block p-4 border-t border-border-subtle">
        <p className="text-xs text-text-tertiary">
          Arc Testnet · CCTP V2
        </p>
      </div>
    </aside>
  )
}

/* ---------------- Header ---------------- */
function Header() {
  return (
    <header className="sticky top-0 z-40 h-16 bg-background-primary/80 backdrop-blur border-b border-border-subtle">
      <div className="h-full flex items-center justify-between px-4 md:px-8">
        <Link to="/" className="md:hidden flex items-center gap-2 text-text-primary">
          <span className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-accent text-white font-semibold">C</span>
          <span className="font-semibold tracking-tight">CrossChainEscrow</span>
        </Link>
        <div className="hidden md:block" />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>
    </header>
  )
}

/* ---------------- Bottom Nav (mobile only) ---------------- */
function BottomNav() {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 h-16 w-full border-t border-border-subtle bg-background-secondary flex justify-around items-center">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium px-2 py-1 rounded-md ${
              isActive ? 'text-accent' : 'text-text-secondary'
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

/* ---------------- Shell ---------------- */
export default function AppShell({ children, maxWidth = 'content' }) {
  const widthCls = maxWidth === 'full' ? '' : 'max-w-content mx-auto'
  return (
    <div className="min-h-screen flex bg-background-primary text-text-primary">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <Header />
        <main className={`flex-1 p-4 md:p-6 lg:p-8 pb-24 md:pb-8 ${widthCls}`}>
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
