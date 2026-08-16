import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { applyTrancheTheme, applyConfirmLocalization } from '../utils/circleTheme.js'
import { isTransactionAction } from '../confirm/action.js'
import { isCircleExecutionLease } from './useTransactionConfirm.js'

/* One source of truth for "who is the current user and how do they sign".
   Both sign-in paths land here, and the rest of the app reads identity from
   useAuth() rather than from wagmi directly:

     - 'eoa'        an existing wallet connected through wagmi. Signs in the
                    wallet, pays its own gas.
     - 'circle-sca' a Circle User-Controlled Wallet created from an email.
                    Authenticated by email OTP, and there is no PIN — Circle
                    does not issue one for email auth. Signing goes through
                    Circle's hosted confirm screen; gas is sponsored by
                    Circle's Gas Station.

   This is not role-based. A payer and a freelancer each pick either one
   independently, and neither the contract nor the UI knows the difference —
   executeContractCall sends identical calldata either way (see the note on
   callData in api/wallet/execute-contract-call.js).

   wagmi stays the source of truth for the EOA case rather than this file
   mirroring its state, so the connect/disconnect/account-switch behaviour of
   an injected wallet keeps working exactly as before. */

const STORAGE_KEY = 'tranche.circleSession'
// Last meaningful action, in its own key so recording activity never rewrites
// (and so can never corrupt) the session blob itself.
const ACTIVITY_KEY = 'tranche.circleActivity'

/* Circle's email/social userToken lives 14 days from issuance. MEASURED, not
   read off documentation: a real UCW userToken was taken from this app's own
   localStorage on 2026-08-06 and its JWT `iat`/`exp` claims decoded, giving
   exactly 336 hours. 13 days here keeps a day of margin, so a session is never
   trusted right up to the edge of a token Circle has already stopped accepting.

   DO NOT "correct" this back to 60 minutes. That figure is real but belongs to
   a DIFFERENT token — the session token from createUserToken
   (POST /users/token), which is the PIN flow's, not ours. It leaks into this
   area from two directions: Circle's reset-account-pin page, where it is
   accurate; and the OpenAPI-generated comment "The token will expire after 60
   minutes", which @circle-fin/user-controlled-wallets repeats verbatim on
   every field typed as a userToken — including email-login responses it does
   not describe. This app authenticates with email OTP (see signInWithEmail),
   so 14 days is the applicable lifetime and the measurement above is the
   authority over both. */
const SESSION_TTL_MS = 13 * 24 * 60 * 60 * 1000

/* The boundary that actually bites. Being shorter than the token's own life,
   this is what ends a session first for anyone not using the app continuously
   — SESSION_TTL_MS above is effectively just the ceiling's own backstop.

   The tradeoff is deliberate and it is not free. A stolen device, or a copied
   localStorage session, stays usable for up to a week of the owner's
   inactivity before Circle's OTP is required again. These wallets have no PIN
   (email auth doesn't have one — see the 'circle-sca' note in the file
   header), so this window is the only thing between a lifted session and the
   funds it can move. A week is chosen against the cost of re-OTPing people in
   the middle of a multi-day project. Shorten it if that balance ever looks
   wrong; do not lengthen it toward SESSION_TTL_MS without deciding a
   fortnight of that exposure is acceptable. */
const INACTIVITY_CEILING_MS = 7 * 24 * 60 * 60 * 1000

const AuthContext = createContext(null)

function readActivityAt() {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY)
    const ts = raw ? Number(JSON.parse(raw)?.lastActivityAt) : NaN
    return Number.isFinite(ts) ? ts : null
  } catch {
    return null
  }
}

function writeActivityAt(ts = Date.now()) {
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify({ lastActivityAt: ts }))
  } catch {
    // Private-mode storage failure. The ceiling then measures from issuedAt
    // (see below), which is stricter rather than looser — nothing to recover.
  }
}

function readStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s?.userToken || !s?.address) return null
    if (!s.issuedAt) return null
    // Two independent gates, both hard: the token's own life, and the
    // inactivity ceiling. Either one lapsing means a full OTP round trip —
    // there is no refresh path, by design (refreshUserToken exists in Circle's
    // API but is only needed to outlive the 14 days, which the ceiling makes
    // unreachable).
    if (Date.now() - s.issuedAt > SESSION_TTL_MS) return null
    // No activity record — a session written before this key existed, or
    // storage that dropped it — falls back to issuedAt. Signing in IS an
    // activity, and the fallback can only shorten the window, never extend it,
    // so deleting the activity key is not a way to revive a stale session.
    const lastActivityAt = readActivityAt() ?? s.issuedAt
    if (Date.now() - lastActivityAt > INACTIVITY_CEILING_MS) return null
    return s
  } catch {
    return null
  }
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    // fall through to the status-based error below
  }
  if (!res.ok) {
    const err = new Error(data?.error || 'Something went wrong. Please try again.')
    err.status = res.status
    err.code = data?.code
    throw err
  }
  return data ?? {}
}

export function AuthProvider({ children }) {
  const { address: eoaAddress, isConnected: eoaConnected } = useAccount()
  const { disconnect } = useDisconnect()

  const [circle, setCircle] = useState(() => readStoredSession())
  const [sdkReady, setSdkReady] = useState(false)
  // Set only by the explicit email-directory claim flow. It is never created
  // as a side effect of Circle sign-in.
  const [pendingVerification, setPendingVerification] = useState(null)
  // A localStorage Circle blob is only a credential cache. The server cookie
  // must validate before the app treats the UCW as connected.
  const [serverSessionState, setServerSessionState] = useState(() => (
    readStoredSession() ? 'checking' : 'ready'
  ))
  const sdkRef = useRef(null)
  const deviceIdRef = useRef(null)
  // Resolves the in-flight OTP dialog. Circle reports the login result through
  // a callback handed to the SDK constructor, not as a promise from
  // verifyOtp(), so the callback needs somewhere to deliver it.
  const loginWaiterRef = useRef(null)

  // Lazily construct the SDK the first time the email path is actually used.
  // Importing it eagerly would pull Circle's bundle into the landing page for
  // every visitor, including the majority who connect a wallet instead.
  const getSdk = useCallback(async () => {
    if (sdkRef.current) return sdkRef.current

    const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk')

    // BUILD-TIME, NOT RUNTIME. Vite substitutes import.meta.env.VITE_* with a
    // string literal while bundling, so this reads whatever was in the build
    // environment — never what is set on the server now. When the variable is
    // absent at build time the expression becomes `undefined`, the minifier
    // folds `if (!undefined)` to always-true, and the branch below is emitted
    // as an unconditional throw with no check left in the shipped code.
    //
    // The practical consequence, which has already cost one debugging round:
    // adding VITE_CIRCLE_APP_ID in the hosting dashboard does nothing to an
    // already-built deployment. It has to be rebuilt. Hence the wording of
    // the message — "not configured" alone sends people to re-check a
    // dashboard that is already correct.
    const appId = import.meta.env.VITE_CIRCLE_APP_ID
    if (!appId) {
      throw new Error(
        'Email sign-in is unavailable in this build: VITE_CIRCLE_APP_ID was not set ' +
        'when it was compiled. Setting it now requires a redeploy. Connect a wallet instead.'
      )
    }

    const sdk = new W3SSdk({ appSettings: { appId } }, (error, result) => {
      const waiter = loginWaiterRef.current
      loginWaiterRef.current = null
      if (!waiter) return
      if (error || !result?.userToken) {
        waiter.reject(new Error(error?.message || 'Email verification failed.'))
        return
      }
      waiter.resolve(result)
    })

    applyTrancheTheme(sdk)

    // getDeviceId() must run before anything else touches the SDK. The device
    // token minted server-side is bound to this id, and calling execute() or
    // verifyOtp() without having established one fails silently — no error,
    // no dialog, nothing.
    deviceIdRef.current = await sdk.getDeviceId()

    sdkRef.current = sdk
    setSdkReady(true)
    return sdk
  }, [])

  const persist = useCallback((session) => {
    setCircle(session)
    setServerSessionState('ready')
    try {
      if (session) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
        // Signing in is itself an activity, so the ceiling starts here rather
        // than relying on the first transaction to open the window.
        writeActivityAt()
      } else {
        // Both keys, always together: a session cleared without its activity
        // stamp, or vice versa, is a half-state nothing else here expects.
        localStorage.removeItem(STORAGE_KEY)
        localStorage.removeItem(ACTIVITY_KEY)
      }
    } catch {
      // Private-mode storage failures shouldn't break an otherwise-valid
      // session; it just won't survive a reload.
    }
  }, [])

  /* Full email onboarding: Circle OTP -> wallet provisioning -> canonical
     Circle identity/wallet validation -> Tranche cookie-backed session.
     Email-directory binding is deliberately not part of this path. */
  const signInWithEmail = useCallback(async (rawEmail, { onStage } = {}) => {
    const email = String(rawEmail || '').trim().toLowerCase()
    if (!email) throw new Error('Enter your email address.')

    const sdk = await getSdk()
    const deviceId = deviceIdRef.current
    if (!deviceId) throw new Error('Could not identify this device. Please reload and try again.')

    onStage?.('sending')
    const otpSession = await postJson('/api/wallet/email-token', { deviceId, email })

    sdk.updateConfigs({
      appSettings: { appId: import.meta.env.VITE_CIRCLE_APP_ID },
      loginConfigs: {
        deviceToken: otpSession.deviceToken,
        deviceEncryptionKey: otpSession.deviceEncryptionKey,
        otpToken: otpSession.otpToken,
        email: { email }
      }
    })

    sdk.setOnResendOtpEmail(async () => {
      try {
        await postJson('/api/wallet/email-resend', {
          deviceId,
          email,
          otpToken: otpSession.otpToken
        })
      } catch {
        // Circle's dialog owns this interaction; surfacing our own error on
        // top of it would fight with its UI. The user can request again.
      }
    })

    onStage?.('verifying')
    const login = await new Promise((resolve, reject) => {
      loginWaiterRef.current = { resolve, reject }
      sdk.verifyOtp()
    })

    onStage?.('creating')
    const init = await postJson('/api/wallet/initialize', {
      sessionId: otpSession.sessionId,
      userToken: login.userToken
    })

    if (init.challengeId) {
      sdk.setAuthentication({ userToken: login.userToken, encryptionKey: login.encryptionKey })
      await new Promise((resolve, reject) => {
        sdk.execute(init.challengeId, (error) => {
          if (error) reject(new Error(error?.message || 'Wallet setup was not completed.'))
          else resolve()
        })
      })
    }

    onStage?.('linking')
    // Circle needs a moment to index a freshly created wallet, and
    // complete-login 409s until the address exists. Retry rather than
    // dumping that normal race on the user as a failure.
    let authenticated = null
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        authenticated = await postJson('/api/wallet/complete-login', {
          sessionId: otpSession.sessionId,
          userToken: login.userToken
        })
        break
      } catch (err) {
        if (err.status !== 409 || attempt === 4) throw err
        await new Promise((r) => setTimeout(r, 1500))
      }
    }

    const wallet = authenticated?.session
    if (!wallet?.walletId || !wallet?.walletAddress) {
      throw new Error('Your wallet was verified but the Tranche session could not be created.')
    }

    const next = {
      userToken: login.userToken,
      encryptionKey: login.encryptionKey,
      address: wallet.walletAddress,
      walletId: wallet.walletId,
      email,
      issuedAt: Date.now()
    }
    setPendingVerification(null)
    persist(next)
    onStage?.('done')
    return next
  }, [getSdk, persist])

  /* Hand back the code from Tranche's own verification email. Only on
     success does the email -> address binding actually get written, so this
     is the step that makes someone findable by email. */
  const confirmEmailVerification = useCallback(async (code) => {
    if (!pendingVerification) throw new Error('There is nothing waiting to be verified.')
    const res = await postJson('/api/wallet/verify-email', {
      verificationId: pendingVerification.verificationId,
      code
    })
    setPendingVerification(null)
    return res
  }, [pendingVerification])

  const resendEmailVerification = useCallback(async () => {
    if (!pendingVerification) throw new Error('There is nothing waiting to be verified.')
    return postJson('/api/wallet/resend-verification', {
      verificationId: pendingVerification.verificationId
    })
  }, [pendingVerification])

  // Leaves the user signed in and able to use the app; they simply aren't
  // listed in the email directory until they verify.
  const dismissEmailVerification = useCallback(() => setPendingVerification(null), [])

  /* Explicit product-email opt-in. Circle sign-in never calls this. The
     requested address is only an email-directory alias; the server derives
     the wallet and Circle user from the cookie session before sending code. */
  const startDirectoryClaim = useCallback(async () => {
    if (!circle?.email || serverSessionState !== 'ready') {
      throw new Error('Sign in with Circle before claiming an email address.')
    }
    const verification = await postJson('/api/wallet/directory-claim', { email: circle.email })
    if (verification.verificationRequired) {
      setPendingVerification({
        verificationId: verification.verificationId,
        email: verification.email,
        expiresInMinutes: verification.expiresInMinutes
      })
    }
    return verification
  }, [circle, serverSessionState])

  const signOut = useCallback(() => {
    // Unconditional, where this used to be guarded on `circle`: persist(null)
    // is what clears the activity stamp as well, and logout has to be terminal
    // — leaving a stamp behind would be leaving a session half-revived.
    // Harmless when there was no Circle session; setCircle(null) on already-null
    // state doesn't re-render, and removeItem on an absent key is a no-op.
    const hadCircleSession = !!circle
    persist(null)
    if (hadCircleSession) {
      // Best effort: local sign-out remains terminal even if the network is
      // unavailable, while the server revocation closes the cookie session.
      void postJson('/api/wallet/logout', {}).catch(() => {})
    }
    if (eoaConnected) disconnect()
    setPendingVerification(null)
  }, [circle, eoaConnected, persist, disconnect])

  /* The only Circle contract-write boundary in the intended React call graph.
     useTx supplies an immutable action plus the private lease minted by
     useTransactionConfirm after the user has continued. The bounded claim is:
     no normal production React call-site bypass exists. A raw request, stale
     descriptor, or invalid lease is rejected before the server challenge
     endpoint is reached. The lease is JavaScript-only, not server-verifiable;
     the current endpoint still receives a browser-supplied userToken plus
     contractAddress and callData; the server derives wallet identity from the
     cookie session. Native mode must add the server-side
     intent and identity controls documented in confirm/native-mode-security.md. */
  const executeContractCall = useCallback(async (action, { lease } = {}) => {
    if (!circle) return null
    if (!isTransactionAction(action) || !isCircleExecutionLease(lease, action)) {
      throw new Error('Circle transaction requires confirmation.')
    }
    if (!action.walletAddress || !circle.address ||
      action.walletAddress.toLowerCase() !== circle.address.toLowerCase() ||
      !action.walletId || action.walletId !== circle.walletId) {
      throw new Error('Circle wallet session changed. Please review the transaction again.')
    }

    const { challengeId } = await postJson('/api/wallet/execute-contract-call', {
      userToken: circle.userToken,
      contractAddress: action.request.address,
      callData: action.callData
    })

    const sdk = await getSdk()
    sdk.setAuthentication({ userToken: circle.userToken, encryptionKey: circle.encryptionKey })
    // Unconditional, and it must stay that way: the SDK is a singleton, so
    // skipping this when the descriptor is absent would leave the last
    // transaction's amount on this one's signing screen.
    applyConfirmLocalization(sdk, action.descriptor)

    await new Promise((resolve, reject) => {
      sdk.execute(challengeId, (error) => {
        if (error) reject(new Error(error?.message || 'Transaction was not approved.'))
        else resolve()
      })
    })

    // Approving a transaction is the clearest signal a session is in live use.
    // Stamped after approval and never before, so a challenge the user
    // abandoned or rejected does not extend the inactivity ceiling.
    writeActivityAt()

    return { challengeId, userToken: circle.userToken }
  }, [circle, serverSessionState, getSdk])

  /* Test-only read path. The canary page receives only the sanitized report;
     the Circle bearer token stays inside this auth closure and is never part
     of the page's props, route state, or rendered data. This deliberately
     does not stamp activity: inspecting a preflight is not approving a
     transaction. */
  const runCanaryPreflight = useCallback(async () => {
    if (!circle?.userToken || serverSessionState !== 'ready') {
      throw new Error('Sign in with a Circle UCW before opening the canary.')
    }
    return postJson('/api/wallet/canary-preflight', { userToken: circle.userToken })
  }, [circle, serverSessionState])

  // Validate the app session on reload. This deliberately does not alter or
  // delete the Circle SDK storage; that credential-lifecycle change is a
  // separate follow-up documented in confirm/ucw-auth-storage-follow-up.md.
  useEffect(() => {
    const stored = readStoredSession()
    if (!stored) {
      setServerSessionState('ready')
      return undefined
    }

    let cancelled = false
    Promise.resolve()
      .then(() => fetch('/api/wallet/session', { credentials: 'same-origin' }))
      .then(async (res) => {
        let data = {}
        try {
          if (typeof res?.json === 'function') data = await res.json()
        } catch {
          // Treat an unreadable response as an invalid server session.
        }
        return { ok: res?.ok === true, data }
      })
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok || !data.authenticated || !data.session) {
          persist(null)
          return
        }
        setCircle((current) => current ? {
          ...current,
          address: data.session.walletAddress,
          walletId: data.session.walletId
        } : current)
        setServerSessionState('ready')
      })
      .catch(() => {
        if (!cancelled) persist(null)
      })

    return () => { cancelled = true }
  }, [persist])

  /* Opening the app on a session that survived BOTH gates in readStoredSession
     counts as activity: the owner came back. Mount-only, and deliberately not
     keyed on `circle` — a tab left open for a week would otherwise keep
     renewing its own stamp on every state change and the ceiling would never
     bind. Sign-in is stamped by persist() instead, so nothing is missed here. */
  useEffect(() => {
    if (circle) writeActivityAt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Expire a stale Circle session in place rather than letting the app act as
     though a dead userToken is still good.

     This timer watches SESSION_TTL_MS only. The inactivity ceiling is enforced
     at restore (readStoredSession), not on a timer — by design: an open tab
     belongs to someone who already got past the device, and logging them out
     from under a form they are filling in buys nothing. The ceiling's job is to
     stop a session being *resumed* later, and that is a restore-time question.
     13 days is also comfortably inside setTimeout's ~24.8-day ceiling, so this
     needs no chunking. */
  useEffect(() => {
    if (!circle) return
    const remaining = SESSION_TTL_MS - (Date.now() - circle.issuedAt)
    if (remaining <= 0) {
      persist(null)
      return
    }
    const t = setTimeout(() => persist(null), remaining)
    return () => clearTimeout(t)
  }, [circle, persist])

  const value = useMemo(() => {
    // A Circle session wins when both exist: choosing email sign-in is an
    // explicit act, whereas an injected wallet may have auto-reconnected.
    const activeCircle = circle && serverSessionState === 'ready' ? circle : null
    const walletType = activeCircle ? 'circle-sca' : eoaConnected ? 'eoa' : null
    return {
      walletType,
      address: activeCircle ? activeCircle.address : eoaAddress,
      walletId: activeCircle?.walletId ?? null,
      email: activeCircle?.email ?? null,
      isConnected: !!walletType,
      isSca: walletType === 'circle-sca',
      sdkReady,
      pendingVerification,
      signInWithEmail,
      confirmEmailVerification,
      resendEmailVerification,
      dismissEmailVerification,
      startDirectoryClaim,
      signOut,
      executeContractCall,
      runCanaryPreflight
    }
  }, [
    circle, serverSessionState, eoaConnected, eoaAddress, sdkReady, pendingVerification,
    signInWithEmail, confirmEmailVerification, resendEmailVerification,
    dismissEmailVerification, startDirectoryClaim, signOut, executeContractCall, runCanaryPreflight
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
