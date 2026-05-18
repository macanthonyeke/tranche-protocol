import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'

import AppShell from './components/AppShell.jsx'
import ToastViewport from './components/Toast.jsx'
import PageTransition from './components/PageTransition.jsx'

import Home from './pages/Home.jsx'
import CreateEscrow from './pages/CreateEscrow.jsx'
import Dashboard from './pages/Dashboard.jsx'
import EscrowDetail from './pages/EscrowDetail.jsx'
import Settings from './pages/Settings.jsx'
import Ledger from './pages/Ledger.jsx'
import ArbiterPanel from './pages/ArbiterPanel.jsx'
import ProtocolSettings from './pages/ProtocolSettings.jsx'
import NotFound from './pages/NotFound.jsx'

function Shelled({ children, maxWidth }) {
  return (
    <AppShell maxWidth={maxWidth}>
      <PageTransition>{children}</PageTransition>
    </AppShell>
  )
}

export default function App() {
  const location = useLocation()
  return (
    <>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          {/* Landing: outside app shell */}
          <Route path="/" element={<PageTransition>{<Home />}</PageTransition>} />

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
