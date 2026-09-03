import { useState } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'

/* Tranche email-OTP entry for either explicit UCW account flow.

   Circle owns the dialog that matters (email OTP entry — these wallets have
   no PIN), so this component is deliberately thin — an email field, a button,
   and honest progress copy. Everything security-relevant happens in Circle's
   hosted UI or server-side.

   Stage copy is spelled out rather than a generic spinner because the flow
   hands off to Circle's dialog mid-way, and a user who doesn't know a popup is
   coming reads the pause as the app having hung. */

const STAGE_LABEL = {
  sending: 'Sending your verification code…',
  verifying: 'Check your email for a code…',
  creating: 'Creating your Arc wallet…',
  recovering: 'Linking your existing Arc wallet…',
  checking: 'Checking your Tranche account…',
  linking: 'Almost there…',
  'account-not-found': 'No Tranche account found'
}

export default function EmailSignIn({ intent = 'signin', onDone, onAccountNotFound }) {
  const { signInWithEmail, createAccountWithEmail } = useAuth()
  const [email, setEmail] = useState('')
  const [stage, setStage] = useState(null)
  const [error, setError] = useState(null)

  const busy = stage !== null

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    try {
      const result = intent === 'signup'
        ? await createAccountWithEmail(email, { onStage: setStage })
        : await signInWithEmail(email, { onStage: setStage })
      if (result?.code === 'TRANCHE_ACCOUNT_NOT_FOUND') onAccountNotFound?.(email)
      else onDone?.(result)
    } catch (err) {
      setError(err.message || 'Could not sign you in. Please try again.')
    } finally {
      setStage(null)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 text-left">
      <label htmlFor="signin-email" className="text-xs text-ink-2">
        Email address
      </label>
      <input
        id="signin-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={busy}
        placeholder="you@example.com"
        className="w-full rounded-xl border border-rule bg-paper px-3 py-2.5 text-sm
                   placeholder:text-ink-3 disabled:opacity-60
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-clay
                   focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      />

      <button type="submit" disabled={busy || !email} className="btn-primary text-sm py-2.5">
        {busy ? STAGE_LABEL[stage] ?? 'Working…' : intent === 'signup' ? 'Create account' : 'Sign in'}
      </button>

      {error && (
        <p role="alert" className="text-[12.5px] text-danger leading-relaxed">
          {error}
        </p>
      )}

      {intent === 'signup' ? (
        <p className="text-[12.5px] text-ink-3 leading-relaxed">
          Tranche will create an Arc wallet you control after you verify the
          code. If you already have an older Arc wallet, this flow links it
          to Tranche instead of creating a second one. Gas is covered.
        </p>
      ) : (
        <p className="text-[12.5px] text-ink-3 leading-relaxed">
          We’ll verify your Tranche account with a one-time code and sign you
          in. Sign in never creates or initializes an Arc wallet.
        </p>
      )}
    </form>
  )
}
