import { useState } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import EmailSignIn from './EmailSignIn.jsx'
import WalletButton from './WalletButton.jsx'
import UcwOnboarding from './UcwOnboarding.jsx'

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
  const { isConnected, onboarding, completeOnboarding } = useAuth()
  const [showWallet, setShowWallet] = useState(false)
  const [intent, setIntent] = useState('signin')
  const [accountNotice, setAccountNotice] = useState(null)

  if (onboarding) return <UcwOnboarding onContinue={completeOnboarding} />
  if (isConnected) return children

  const selectIntent = (nextIntent) => {
    setIntent(nextIntent)
    setAccountNotice(null)
  }

  return (
    <div className="card-surface p-10 text-center max-w-md mx-auto">
      <h2 className="text-xl font-semibold mb-2 text-ink">{title}</h2>
      <p className="text-sm text-ink-2 mb-6">{message}</p>

      <div role="tablist" aria-label="Circle wallet account flow" className="grid grid-cols-2 gap-1 p-1 mb-5 rounded-xl bg-sunk border border-rule">
        <button
          type="button"
          role="tab"
          aria-selected={intent === 'signin'}
          onClick={() => selectIntent('signin')}
          className={`rounded-lg px-3 py-2 text-sm transition-colors ${intent === 'signin' ? 'bg-paper text-ink border border-rule' : 'text-ink-2 hover:text-ink'}`}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={intent === 'signup'}
          onClick={() => selectIntent('signup')}
          className={`rounded-lg px-3 py-2 text-sm transition-colors ${intent === 'signup' ? 'bg-paper text-ink border border-rule' : 'text-ink-2 hover:text-ink'}`}
        >
          Create account
        </button>
      </div>

      <div className="mb-4 text-left">
        <h3 className="text-base font-semibold text-ink">
          {intent === 'signup' ? 'Create a Circle wallet account' : 'Sign in to your Circle wallet'}
        </h3>
        <p className="text-[12.5px] text-ink-2 leading-relaxed mt-1">
          {intent === 'signup'
            ? 'Start a new Tranche account with Circle email verification.'
            : 'Use the email that belongs to your existing Tranche account.'}
        </p>
      </div>

      {accountNotice && (
        <p role="status" className="mb-4 text-left text-[12.5px] text-ink-2 leading-relaxed">
          {accountNotice}
        </p>
      )}

      <EmailSignIn
        intent={intent}
        onAccountNotFound={() => {
          setAccountNotice('No Tranche account was found after verification. Choose Create account to set one up. If you have an older Circle wallet, Tranche will link it instead of creating another wallet.')
          setIntent('signup')
        }}
      />

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
