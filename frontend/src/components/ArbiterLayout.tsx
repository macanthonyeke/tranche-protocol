import { Link, Outlet } from "react-router-dom";
import { motion } from "framer-motion";
import { WalletButton } from "./WalletButton";
import { ThemeToggle } from "./ThemeToggle";

export function ArbiterLayout() {
  return (
    <div className="relative min-h-screen flex flex-col bg-bg-deep">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-bg-deep/85 border-b border-gold/10">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 sm:gap-6">
          <Link to="/arbiter" className="flex items-center gap-3 group shrink-0">
            <div className="relative w-8 h-8">
              <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-gold to-gold-soft opacity-90" />
              <div className="absolute inset-[2px] rounded-[7px] bg-bg-deep flex items-center justify-center">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  className="text-gold"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2 4 6l8 4 8-4-8-4z" />
                  <path d="M4 14l8 4 8-4" />
                  <path d="M4 10l8 4 8-4" />
                </svg>
              </div>
            </div>
            <div className="leading-tight">
              <div className="font-display font-semibold text-gold-soft tracking-tight uppercase">
                Arbiter Panel
              </div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted hidden sm:block">
                Restricted access
              </div>
            </div>
          </Link>

          <div className="flex-1" />
          <Link
            to="/"
            className="text-xs text-muted hover:text-fg hidden sm:inline"
          >
            ← Back to app
          </Link>
          <ThemeToggle />
          <WalletButton tone="gold" />
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative flex-1 max-w-[1240px] w-full mx-auto px-4 sm:px-6 py-8 sm:py-10 z-10"
      >
        <Outlet />
      </motion.main>

      <footer className="border-t border-gold/10 mt-12">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-6 flex items-center justify-between text-xs text-muted">
          <div>Arbiter mode, resolves on-chain disputes.</div>
          <div className="font-mono">ARBITER · v2</div>
        </div>
      </footer>
    </div>
  );
}
