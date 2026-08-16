# UCW browser credential storage follow-up

This auth-hardening change does **not** delete, rename, or migrate the Circle
SDK storage keys. The Tranche cookie is now the authoritative application
session, but the browser still needs Circle credentials for the current hosted
SDK flow.

## What the browser SDK currently requires

- `VITE_CIRCLE_APP_ID` at build time to construct `W3SSdk`.
- `deviceId` from `sdk.getDeviceId()` before requesting or using the email OTP
  configuration.
- The values returned by `/api/wallet/email-token`:
  `deviceToken`, `deviceEncryptionKey`, and `otpToken`, plus the entered email,
  for `sdk.updateConfigs()` and `sdk.verifyOtp()`.
- The Circle login result's `userToken` and `encryptionKey` for
  `sdk.setAuthentication()` before `sdk.execute(challengeId)` completes wallet
  initialization or a Circle-hosted transaction challenge.
- The current browser-to-server Circle API calls still carry `userToken` as a
  bearer credential. The server now checks it against the HttpOnly Tranche
  session and derives the wallet identity from that session; it never trusts a
  browser wallet ID or address.

The current `tranche.circleSession` localStorage record contains the Circle
`userToken` and `encryptionKey`, along with the wallet display metadata. The
separate `tranche.circleActivity` record supports the existing client-side
inactivity compatibility check. Both remain unchanged in this change.

## Separate follow-up before changing storage

Do not remove or move these values until a separate change proves, in a real
browser, how the SDK can re-authenticate after reload and how an approved
Circle challenge remains executable. That follow-up must cover token expiry,
logout/revocation, multiple tabs, initialization challenges, Phase 1 compare
mode, and the remaining XSS exposure. A possible direction is an in-memory
SDK credential lease or a server-side token broker, but this document does not
select or implement one.
