import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// The wallet stack (wagmi + viem + @reown + ox + abitype) dominates the
// initial download. Splitting it into its own chunk lets the landing page
// boot from a much smaller entry while authenticated routes still pay the
// same total cost on their first visit (the wallet chunk loads in parallel
// with the route chunk).
export default defineConfig({
  // Circle's browser SDK (@circle-fin/w3s-pw-web-sdk) reaches for Node
  // globals — Buffer above all — that Vite does not provide in a browser
  // build. Without these shims the SDK throws on import and takes the whole
  // app's entry chunk down with it, so the failure is not confined to the
  // email sign-in path.
  //
  // Circle's own SDK notes claim this plugin supports only Vite 2-5 and tell
  // you to pin vite@^5.4.0. That is out of date: the published package
  // declares vite ^2 || ^3 || ^4 || ^5 || ^6 || ^7 || ^8, and it works on the
  // Vite 7 this project already uses. Downgrading would have meant giving up
  // the manualChunks setup below and @vitejs/plugin-react 5.
  plugins: [nodePolyfills(), react()],
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
          // Circle's web SDK is only pulled in once someone chooses the email
          // sign-in path. Its own chunk keeps it off the landing page's
          // critical path, matching how the wallet stack is treated above.
          if (/[\\/]node_modules[\\/]@circle-fin[\\/]/.test(id)) {
            return 'circle'
          }

          // DO NOT add a manual chunk for framer-motion here. There used to be
          // one, and combined with nodePolyfills above it white-screened the
          // entire app: the forced motion chunk was evaluated before the entry
          // chunk had initialised React's exports, so framer-motion's
          // top-level createContext call hit an undefined React namespace and
          // threw before anything rendered. It failed at runtime only — the
          // build succeeded and every unit test passed, which is why it
          // reached a deployment.
          //
          // Rollup still emits a motion chunk on its own; the difference is
          // that it then owns the ordering and gets it right. Forcing the
          // split bought nothing anyway, since main.jsx imports MotionConfig
          // eagerly, so framer-motion is on the critical path either way.
        }
      }
    }
  }
})
