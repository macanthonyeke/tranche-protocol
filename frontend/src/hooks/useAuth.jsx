import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { encodeFunctionData } from 'viem'
import { applyTrancheTheme } from '../utils/circleTheme.js'

/* One source of truth for "who is the current user and how do they sign".
   Both sign-in paths land here, and the rest of the app reads identity from
   useAuth() rather than from wagmi directly:

     - 'eoa'        an existing wallet connected through wagmi. Signs in the
                    wallet, pays its own gas.
     - 'circle-sca' a Circle User-Controlled Wallet created from an email.
                    Signs with a PIN in Circle's hosted dialog; gas is
                    sponsored by Circle's Gas Station.

   This is not role-based. A payer and a freelancer each pick either one
   independently, and neither the contract nor the UI knows the difference —
   executeContractCall sends identical calldata either way (see the note on
   callData in api/wallet/execute-contract-call.js).

   wagmi stays the source of truth for the EOA case rather than this file
   mirroring its state, so the connect/disconnect/account-switch behaviour of
   an injected wallet keeps working exactly as before. */

const STORAGE_KEY = 'tranche.circleSession'
// Circle's userToken expires after 60 minutes. Re-authenticating is a full
// OTP round trip, so a session restored from storage is only trusted while
// comfortably inside that window.
const SESSION_TTL_MS = 55 * 60 * 1000

const AuthContext = createContext(null)

function readStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s?.userToken || !s?.address) return null
    if (!s.issuedAt || Date.now() - s.issuedAt > SESSION_TTL_MS) return null
    return s
  } catch {
    return null
  }
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
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
  // Set when this email has never been bound to an address before and is
  // waiting on Tranche's own verification code. Held in memory only: it
  // guards a write, so letting it survive a reload would be handing the
  // pending binding to whoever next opens the browser.
  const [pendingVerification, setPendingVerification] = useState(null)
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
    try {
      if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Private-mode storage failures shouldn't break an otherwise-valid
      // session; it just won't survive a reload.
    }
  }, [])

  /* Full email onboarding: OTP -> verify -> wallet -> directory entry.
     Safe to call for a returning user; Circle reports the wallet already
     exists and we skip straight to looking it up. */
  const signInWithEmail = useCallback(async (rawEmail, { onStage } = {}) => {
    const email = String(rawEmail || '').trim().toLowerCase()
    if (!email) throw new Error('Enter your email address.')

    const sdk = await getSdk()
    const deviceId = deviceIdRef.current
    if (!deviceId) throw new Error('Could not identify this device. Please reload and try again.')

    onStage?.('sending')
    const session = await postJson('/api/wallet/email-token', { deviceId, email })

    sdk.updateConfigs({
      appSettings: { appId: import.meta.env.VITE_CIRCLE_APP_ID },
      loginConfigs: {
        deviceToken: session.deviceToken,
        deviceEncryptionKey: session.deviceEncryptionKey,
        otpToken: session.otpToken,
        email: { email }
      }
    })

    sdk.setOnResendOtpEmail(async () => {
      try {
        await postJson('/api/wallet/email-resend', {
          deviceId,
          email,
          otpToken: session.otpToken
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
    const init = await postJson('/api/wallet/initialize', { userToken: login.userToken })

    // TEMP DEBUG — remove before merging. Confirms whether execute()'s
    // callback actually fires and with what, for the missing-PIN-dialog
    // investigation.
    console.log('[tranche-debug] initialize response', { challengeId: init.challengeId, alreadyInitialized: init.alreadyInitialized })
    try {
      localStorage.setItem('tranche-debug-initialize', JSON.stringify({
        challengeId: init.challengeId, alreadyInitialized: init.alreadyInitialized,
        timestamp: Date.now()
      }))
    } catch {}
    if (init.challengeId) {
      sdk.setAuthentication({ userToken: login.userToken, encryptionKey: login.encryptionKey })
      await new Promise((resolve, reject) => {
        sdk.execute(init.challengeId, (error, result) => {
          console.log('[tranche-debug] execute() callback fired', { error, status: result?.status })
          try {
            localStorage.setItem('tranche-debug-execute', JSON.stringify({
              fired: true, error: error ? String(error.message || error) : null,
              status: result?.status ?? null,
              timestamp: Date.now()
            }))
          } catch {}
          if (error) reject(new Error(error?.message || 'Wallet setup was not completed.'))
          else resolve()
        })
      })
    }

    onStage?.('linking')
    // Circle needs a moment to index a freshly created wallet, and register
    // 409s until the address exists. Retry rather than dumping that race on
    // the user as a failure.
    let registered = null
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        registered = await postJson('/api/wallet/register', {
          sessionId: session.sessionId,
          userToken: login.userToken
        })
        break
      } catch (err) {
        if (err.status !== 409 || attempt === 4) throw err
        await new Promise((r) => setTimeout(r, 1500))
      }
    }

    // First time on this email: the wallet exists and the user is signed in,
    // but they are not in the payable-by-email directory until they return
    // the code we just mailed them. Deliberately not fatal — they can use the
    // whole app meanwhile; the only thing gated is other people being able to
    // find them by email.
    if (registered?.verificationRequired) {
      setPendingVerification({
        verificationId: registered.verificationId,
        email: registered.email,
        expiresInMinutes: registered.expiresInMinutes
      })
    }

    const { wallets } = await postJson('/api/wallet/list', { userToken: login.userToken })
    const wallet = wallets?.find((w) => w.state === 'LIVE') ?? wallets?.[0]
    if (!wallet?.address) throw new Error('Your wallet was created but could not be loaded.')

    const next = {
      userToken: login.userToken,
      encryptionKey: login.encryptionKey,
      // registered.address is absent while verification is pending — the
      // directory entry is what's withheld, not the wallet itself, so the
      // user still signs in at their real Circle address.
      address: registered?.address ?? wallet.address,
      walletId: wallet.id,
      email,
      issuedAt: Date.now()
    }
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

  const signOut = useCallback(() => {
    if (circle) persist(null)
    if (eoaConnected) disconnect()
    setPendingVerification(null)
  }, [circle, eoaConnected, persist, disconnect])

  /* The single write path. Callers hand over exactly what wagmi's
     writeContract takes, and this decides how it gets signed.

     For 'eoa' it returns null, which tells useTx to run its existing wagmi
     path untouched — keeping that path literally unchanged rather than
     re-implementing it here. For 'circle-sca' it encodes the call, opens
     Circle's PIN dialog, and hands back the challengeId that useTx polls to a
     transaction hash. */
  const executeContractCall = useCallback(async ({ address, abi, functionName, args }) => {
    if (!circle) return null

    const callData = encodeFunctionData({ abi, functionName, args })

    const { challengeId } = await postJson('/api/wallet/execute-contract-call', {
      userToken: circle.userToken,
      walletId: circle.walletId,
      contractAddress: address,
      callData
    })

    const sdk = await getSdk()
    sdk.setAuthentication({ userToken: circle.userToken, encryptionKey: circle.encryptionKey })

    await new Promise((resolve, reject) => {
      sdk.execute(challengeId, (error) => {
        if (error) reject(new Error(error?.message || 'Transaction was not approved.'))
        else resolve()
      })
    })

    return { challengeId, userToken: circle.userToken }
  }, [circle, getSdk])

  // Expire a stale Circle session in place rather than letting the app act as
  // though a dead userToken is still good.
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
    const walletType = circle ? 'circle-sca' : eoaConnected ? 'eoa' : null
    return {
      walletType,
      address: circle ? circle.address : eoaAddress,
      email: circle?.email ?? null,
      isConnected: !!walletType,
      isSca: walletType === 'circle-sca',
      sdkReady,
      pendingVerification,
      signInWithEmail,
      confirmEmailVerification,
      resendEmailVerification,
      dismissEmailVerification,
      signOut,
      executeContractCall
    }
  }, [
    circle, eoaConnected, eoaAddress, sdkReady, pendingVerification,
    signInWithEmail, confirmEmailVerification, resendEmailVerification,
    dismissEmailVerification, signOut, executeContractCall
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
