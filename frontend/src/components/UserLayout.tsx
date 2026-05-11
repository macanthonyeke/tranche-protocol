import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { WalletButton } from "./WalletButton";
import { ThemeToggle } from "./ThemeToggle";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard" },
  { to: "/create", label: "Create" },
  { to: "/withdraw", label: "Refunds" },
];

export function UserLayout() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  return (
    <div className="relative min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-bg/85 border-b border-line">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 sm:gap-6">
          <Link to="/" className="flex items-center gap-2.5 group shrink-0">
            <div className="relative w-8 h-8">
              <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-accent to-accent-deep opacity-90 group-hover:opacity-100 transition-opacity" />
              <div className="absolute inset-[2px] rounded-[7px] bg-bg flex items-center justify-center">
                <div className="w-3 h-3 rounded-sm bg-gradient-to-br from-accent to-accent-soft" />
              </div>
            </div>
            <div className="leading-tight hidden sm:block">
              <div className="font-display font-semibold text-fg-strong tracking-tight">
                CrossChainEscrow
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted">
                Protocol · v2
              </div>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1 ml-2">
            {NAV_ITEMS.map((item) => (
              <NavTab key={item.to} to={item.to} label={item.label} />
            ))}
          </nav>

          <div className="flex-1" />

          <ThemeToggle />
          <WalletButton />

          {/* Hamburger (mobile/tablet only) */}
          <div className="md:hidden relative" ref={menuRef}>
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMenuOpen((o) => !o)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-muted-soft hover:text-fg-strong border border-line-strong hover:border-accent/40 transition-colors"
            >
              <AnimatePresence mode="wait" initial={false}>
                {menuOpen ? (
                  <motion.svg
                    key="x"
                    initial={{ opacity: 0, rotate: -90 }}
                    animate={{ opacity: 1, rotate: 0 }}
                    exit={{ opacity: 0, rotate: 90 }}
                    transition={{ duration: 0.15 }}
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </motion.svg>
                ) : (
                  <motion.svg
                    key="bars"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </motion.svg>
                )}
              </AnimatePresence>
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 mt-2 w-56 popover-surface p-2 z-50"
                >
                  {NAV_ITEMS.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/"}
                      className={({ isActive }) =>
                        [
                          "block px-3 py-2.5 rounded-lg text-sm transition-colors",
                          isActive
                            ? "bg-surface text-fg-strong"
                            : "text-fg hover:bg-surface/70",
                        ].join(" ")
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <motion.main
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative flex-1 max-w-[1240px] w-full mx-auto px-4 sm:px-6 py-8 sm:py-10 z-10"
      >
        <Outlet />
      </motion.main>

      <footer className="border-t border-line mt-12">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <div>Arc Testnet · Chain 5042002</div>
          <div className="font-mono">v2.0</div>
        </div>
      </footer>
    </div>
  );
}

function NavTab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        [
          "px-3.5 py-2 rounded-lg text-sm transition-colors",
          isActive
            ? "bg-surface/70 text-fg-strong"
            : "text-muted-soft hover:text-fg-strong",
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}
