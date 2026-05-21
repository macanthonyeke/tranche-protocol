import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The wallet stack (wagmi + viem + @reown + ox + abitype) dominates the
// initial download. Splitting it into its own chunk lets the landing page
// boot from a much smaller entry while authenticated routes still pay the
// same total cost on their first visit (the wallet chunk loads in parallel
// with the route chunk).
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // Wallet stack is the heaviest dependency and is only needed once
          // the user enters a wallet-gated route. Splitting it leaves react +
          // router + query in the entry chunk (where main.jsx imports them
          // eagerly anyway), avoiding the wallet<->react cycle that a finer
          // split produces.
          if (/[\\/]node_modules[\\/](wagmi|viem|@wagmi|@reown|@walletconnect|ox|abitype|@coinbase|@safe-global|@metamask)[\\/]/.test(id)) {
            return 'wallet'
          }
          if (/[\\/]node_modules[\\/](framer-motion|motion-utils|motion-dom)[\\/]/.test(id)) {
            return 'motion'
          }
        }
      }
    }
  }
})
