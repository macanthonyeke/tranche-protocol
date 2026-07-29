import { useState } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import EmailSignIn from './EmailSignIn.jsx'
import WalletButton from './WalletButton.jsx'

/* The sign-in wall in front of every authenticated route.

   Both ways in are offered to everyone. Email is the default because it's the
   one that works for someone who has never held crypto; connecting an existing
   wallet is a step down the page for people who already have one. Nothing
   here is role-aware — a payer and a freelancer see the same choice and pick
   independently.

   Gating on useAuth rather than wagmi's useAccount is what makes that true.
   An email user has no wagmi connection at all, so the old isConnected check
   would have shown them this wall forever, on every page, no matter how
   thoroughly they'd signed in. */
export default function ConnectGate({
  children,
  title = 'Sign in to continue',
  message = 'Use your email, or connect a wallet you already have.'
}) {
  const { isConnected } = useAuth()
  const [showWallet, setShowWallet] = useState(false)

  if (isConnected) return children

  return (
    <div className="card-surface p-10 text-center max-w-md mx-auto">
      <h2 className="text-xl font-semibold mb-2 text-ink">{title}</h2>
      <p className="text-sm text-ink-2 mb-6">{message}</p>

      <EmailSignIn />

      <div className="mt-6 pt-5 border-t border-rule">
        {!showWallet ? (
          <button
            type="button"
            onClick={() => setShowWallet(true)}
            className="text-[13px] text-clay hover:opacity-80 underline-offset-2 hover:underline"
          >
            Connect a wallet instead
          </button>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <WalletButton />
            <p className="text-[12.5px] text-ink-3 leading-relaxed">
              Gas on Arc is paid in USDC.{' '}
              <a
                href="https://faucet.circle.com"
                target="_blank"
                rel="noreferrer"
                className="text-clay hover:opacity-80 underline-offset-2 hover:underline"
              >
                Get testnet USDC ↗
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
