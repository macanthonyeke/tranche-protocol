import { lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'

import AppShell from './components/AppShell.jsx'
import ToastViewport from './components/Toast.jsx'
import PageTransition from './components/PageTransition.jsx'
import Skeleton from './components/Skeleton.jsx'

// Landing is the first-paint surface for unauthenticated visitors and
// should ship in the entry chunk. Everything behind the app shell is
// authenticated/role-gated and can stream in on navigation.
import Home from './pages/Home.jsx'

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
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          {/* Landing: outside app shell. Home runs its own entrance animation
              internally (below its sticky header) — wrapping the whole page in
              PageTransition here would put a transform ancestor above the
              header and silently break its position: sticky. */}
          <Route path="/" element={<Home />} />

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
    </>
  )
}
