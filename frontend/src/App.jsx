import { lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'

import AppShell from './components/AppShell.jsx'
import ToastViewport from './components/Toast.jsx'
import PageTransition from './components/PageTransition.jsx'
import Skeleton from './components/Skeleton.jsx'
import BackgroundDrift from './components/BackgroundDrift.jsx'

// Landing is the first-paint surface for unauthenticated visitors and
// should ship in the entry chunk. Everything behind the app shell is
// authenticated/role-gated and can stream in on navigation.
import Home from './pages/Home.jsx'

const Docs             = lazy(() => import('./pages/Docs.jsx'))
const CreateEscrow     = lazy(() => import('./pages/CreateEscrow.jsx'))
const Dashboard        = lazy(() => import('./pages/Dashboard.jsx'))
const EscrowDetail     = lazy(() => import('./pages/EscrowDetail.jsx'))
const Settings         = lazy(() => import('./pages/Settings.jsx'))
const Ledger           = lazy(() => import('./pages/Ledger.jsx'))
const ArbiterPanel     = lazy(() => import('./pages/ArbiterPanel.jsx'))
const ProtocolSettings = lazy(() => import('./pages/ProtocolSettings.jsx'))
const NotFound         = lazy(() => import('./pages/NotFound.jsx'))

function RouteFallback() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

function Shelled({ children, maxWidth }) {
  return (
    <AppShell maxWidth={maxWidth}>
      <PageTransition>
        <Suspense fallback={<RouteFallback />}>{children}</Suspense>
      </PageTransition>
    </AppShell>
  )
}

export default function App() {
  const location = useLocation()
  return (
    <>
      {/* Ambient background — fixed at z-0, behind all content (z-1 below) */}
      <BackgroundDrift />
      {/* z-index: 1 creates a stacking context that sits above BackgroundDrift.
          position: relative is required to activate z-index on a non-fixed element.
          No transform here — transform ancestors break position: sticky on nav headers. */}
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh' }}>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            {/* Landing: outside app shell. Home runs its own entrance animation
                internally (below its sticky header) — wrapping the whole page in
                PageTransition here would put a transform ancestor above the
                header and silently break its position: sticky. */}
            <Route path="/" element={<Home />} />

            {/* Docs: public, no-wallet-required — outside the app shell like Home */}
            <Route
              path="/docs"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <Docs />
                </Suspense>
              }
            />

            {/* App routes: wrapped in shell */}
            <Route path="/dashboard" element={<Shelled><Dashboard /></Shelled>} />
            <Route path="/create" element={<Shelled><CreateEscrow /></Shelled>} />
            <Route path="/escrow/:id" element={<Shelled><EscrowDetail /></Shelled>} />
            <Route path="/ledger" element={<Shelled><Ledger /></Shelled>} />
            <Route path="/arbiter" element={<Shelled><ArbiterPanel /></Shelled>} />
            <Route path="/protocol" element={<Shelled><ProtocolSettings /></Shelled>} />
            <Route path="/settings" element={<Shelled><Settings /></Shelled>} />

            <Route path="*" element={<Shelled><NotFound /></Shelled>} />
          </Routes>
        </AnimatePresence>
        <ToastViewport />
      </div>
    </>
  )
}
