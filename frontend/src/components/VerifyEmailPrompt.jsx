import { useState } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'

/* Starts and collects Tranche's own directory verification code.

   This is deliberately skippable. The user is already signed in and can use
   every part of the app; what's gated is only whether other people can find
   them by email, so blocking the whole UI over it would punish them for a
   protection that exists to defend them. The copy says exactly what verifying
   buys, so skipping is an informed choice rather than a shrug. */
export default function VerifyEmailPrompt() {
  const {
    isSca,
    email,
    pendingVerification,
    confirmEmailVerification,
    resendEmailVerification,
    dismissEmailVerification,
    startDirectoryClaim
  } = useAuth()

  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [resent, setResent] = useState(false)

  if (!isSca || !email) return null

  if (!pendingVerification) {
    const start = async () => {
      if (busy) return
      setBusy(true)
      setError(null)
      try {
        await startDirectoryClaim()
      } catch (err) {
        setError(err.message || 'Could not start email-directory verification.')
      } finally {
        setBusy(false)
      }
    }

    return (
      <div className="card-surface p-5 flex flex-col gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-ink">Be findable by email</h3>
            <span className="text-[11px] uppercase tracking-wide text-ink-3">Optional</span>
          </div>
          <p className="text-[12.5px] text-ink-2 leading-relaxed mt-1">
            Sign-in is complete. Verify your email only if you want people to find this wallet when they create an escrow.
          </p>
        </div>
        <button type="button" onClick={start} disabled={busy} className="btn-secondary text-sm py-2">
          {busy ? 'Sending…' : 'Verify for email payments'}
        </button>
        {error && <p role="alert" className="text-[12.5px] text-danger leading-relaxed">{error}</p>}
      </div>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await confirmEmailVerification(code)
    } catch (err) {
      setError(err.message || 'Could not verify that code.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setError(null)
    setResent(false)
    try {
      await resendEmailVerification()
      setResent(true)
      setCode('')
    } catch (err) {
      setError(err.message || 'Could not send a new code.')
    }
  }

  return (
    <div className="card-surface p-5 flex flex-col gap-3">
      <div>
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-ink">Verify your email</h3>
          <span className="text-[11px] uppercase tracking-wide text-ink-3">Optional</span>
        </div>
        {/* Leads with who can ignore this. Arriving mid-onboarding, a code
            field reads as a second mandatory login step unless it says
            otherwise — and most people signing in are payers, for whom it
            does nothing at all. */}
        <p className="text-[12.5px] text-ink-2 leading-relaxed mt-1">
          Skip this if you're just paying someone. You'll only need it if you want
          people to find you by email to send you an escrow.
        </p>
        <p className="text-[12.5px] text-ink-2 leading-relaxed mt-1.5">
          We sent a code to <span className="text-ink">{pendingVerification.email}</span>.
          Your wallet works either way — without it, people just can't look you up by email.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor="verify-code" className="sr-only">Verification code</label>
        <input
          id="verify-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          disabled={busy}
          placeholder="000000"
          className="input num w-full tracking-[0.3em]"
        />
        {/* Equal weight, side by side and same size: skipping is a legitimate
            outcome here, not a way out of a task. Neither is the "real"
            button. */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="btn-primary text-sm py-2"
          >
            {busy ? 'Checking…' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={dismissEmailVerification}
            disabled={busy}
            className="btn-secondary text-sm py-2"
          >
            Skip for now
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="text-[12.5px] text-danger leading-relaxed">{error}</p>
      )}
      {resent && !error && (
        <p className="text-[12.5px] text-ink-2">A new code is on its way.</p>
      )}

      <div className="text-[12.5px]">
        <button type="button" onClick={resend} className="text-clay hover:opacity-80 underline-offset-2 hover:underline">
          Send a new code
        </button>
      </div>
    </div>
  )
}
