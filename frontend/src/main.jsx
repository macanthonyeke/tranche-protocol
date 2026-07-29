import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'

import App from './App.jsx'
import { config } from './config/wagmi.js'
import { ThemeProvider } from './hooks/useTheme.jsx'
import { AuthProvider } from './hooks/useAuth.jsx'
import { RoleProvider } from './hooks/useRoles.jsx'
import './styles/globals.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {/* AuthProvider sits above RoleProvider: role lookups are keyed on
              the active address, and that address now comes from whichever
              sign-in path the user chose, not from wagmi alone. */}
          <AuthProvider>
            <RoleProvider>
              <BrowserRouter>
                <MotionConfig reducedMotion="user">
                  <App />
                </MotionConfig>
              </BrowserRouter>
            </RoleProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
)
