import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'

import App from './App.jsx'
import { config } from './config/wagmi.js'
import { ThemeProvider } from './hooks/useTheme.jsx'
import { RoleProvider } from './hooks/useRoles.jsx'
import './styles/globals.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RoleProvider>
            <BrowserRouter>
              <MotionConfig reducedMotion="user">
                <App />
              </MotionConfig>
            </BrowserRouter>
          </RoleProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
)
