import { Routes, Route } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import ToastViewport from './components/Toast.jsx'

import Home from './pages/Home.jsx'
import CreateEscrow from './pages/CreateEscrow.jsx'
import Dashboard from './pages/Dashboard.jsx'
import EscrowDetail from './pages/EscrowDetail.jsx'
import Settings from './pages/Settings.jsx'
import Ledger from './pages/Ledger.jsx'
import DisputeTribunal from './pages/DisputeTribunal.jsx'
import NotFound from './pages/NotFound.jsx'

function Shelled({ children, maxWidth }) {
  return <AppShell maxWidth={maxWidth}>{children}</AppShell>
}

export default function App() {
  return (
    <>
      <Routes>
        {/* Landing: outside app shell */}
        <Route path="/" element={<Home />} />

        {/* App routes: wrapped in shell */}
        <Route path="/dashboard" element={<Shelled><Dashboard /></Shelled>} />
        <Route path="/create" element={<Shelled><CreateEscrow /></Shelled>} />
        <Route path="/escrow/:id" element={<Shelled><EscrowDetail /></Shelled>} />
        <Route path="/ledger" element={<Shelled><Ledger /></Shelled>} />
        <Route path="/tribunal" element={<Shelled><DisputeTribunal /></Shelled>} />
        <Route path="/tribunal/:id/:milestone" element={<Shelled maxWidth="full"><DisputeTribunal /></Shelled>} />
        <Route path="/settings" element={<Shelled><Settings /></Shelled>} />

        <Route path="*" element={<Shelled><NotFound /></Shelled>} />
      </Routes>
      <ToastViewport />
    </>
  )
}
