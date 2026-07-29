import { useState } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'

/* Collects Tranche's own verification code, the last step before an email
   becomes payable.

   This is deliberately skippable. The user is already signed in and can use
   every part of the app; what's gated is only whether other people can find
   them by email, so blocking the whole UI over it would punish them for a
   protection that exists to defend them. The copy says exactly what verifying
   buys, so skipping is an informed choice rather than a shrug. */
export default function VerifyEmailPrompt() {
  const {
    pendingVerification,
    confirmEmailVerification,
    resendEmailVerification,
    dismissEmailVerification
  } = useAuth()

  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [resent, setResent] = useState(false)

  if (!pendingVerification) return null

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
        <h3 className="text-sm font-semibold text-ink">Verify your email</h3>
        <p className="text-[12.5px] text-ink-2 leading-relaxed mt-1">
          We sent a code to <span className="text-ink">{pendingVerification.email}</span>.
          Entering it lets clients pay you at this email address. Until then your
          wallet works normally — people just can't look you up by email.
        </p>
      </div>

      <form onSubmit={submit} className="flex gap-2">
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
          className="input num flex-1 tracking-[0.3em]"
        />
        <button
          type="submit"
          disabled={busy || code.length !== 6}
          className="btn-primary text-sm px-4 shrink-0"
        >
          {busy ? 'Checking…' : 'Verify'}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-[12.5px] text-danger leading-relaxed">{error}</p>
      )}
      {resent && !error && (
        <p className="text-[12.5px] text-ink-2">A new code is on its way.</p>
      )}

      <div className="flex items-center gap-4 text-[12.5px]">
        <button type="button" onClick={resend} className="text-clay hover:opacity-80 underline-offset-2 hover:underline">
          Send a new code
        </button>
        <button type="button" onClick={dismissEmailVerification} className="text-ink-3 hover:text-ink-2">
          Skip for now
        </button>
      </div>
    </div>
  )
}
