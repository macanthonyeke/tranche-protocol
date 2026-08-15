# Native UCW confirmation security requirements

Status: Phase 2 prerequisite. Native mode is not implemented or available.
Phase 1 compare mode keeps Circle's hosted confirmation UI enabled.

## Current Phase 1 boundary

The private JavaScript lease means **no normal production React call-site
bypass exists**: the intended `useTx` → `useTransactionConfirm` → `useAuth`
path must reach the review/continuation gate before `executeContractCall`
creates a Circle challenge. The lease is an in-process UI capability, not a
server-verifiable authorization.

The current endpoint, `frontend/api/_lib/wallet/execute-contract-call.js`,
still receives browser-supplied `userToken`, `walletId`, `contractAddress`,
and `callData`. It validates their shape and forwards them to Circle. A
browser UI alone cannot defend against XSS; in particular, this app currently
keeps the UCW `userToken` and `encryptionKey` in `localStorage`, where injected
same-origin JavaScript could read and use them.

## Required before native mode

Native mode must not be enabled by changing the frontend feature flag until
all of these server-side controls exist and are tested:

1. **Canonical wallet resolution.** Authenticate the app user on the server
   and resolve the Circle user/wallet identity from that authenticated
   identity. Do not treat browser-provided `walletId` or address as authority;
   verify the resolved wallet belongs to the authenticated user and is the
   wallet being reviewed.

2. **Contract and function allowlisting.** Permit only registered chain,
   contract, function selector, and parameter schemas. Validate the exact
   calldata, recipient, amount, and other policy limits server-side rather
   than trusting the descriptor or a browser-provided contract address.

3. **Action/challenge audit records.** Before creating a Circle challenge,
   persist an immutable action digest plus the authenticated user, resolved
   Circle user/wallet identifiers, exact calldata, chain/contract/function,
   and creation time. Bind the resulting `challengeId`, status transitions,
   and eventual transaction hash to that record. Reject reuse, mismatch, and
   stale or already-terminal actions.

4. **Strict transaction-intent protocol.** The browser should submit a
   server-verifiable intent or action identifier, not an authority-bearing
   bundle of raw `walletId`, `contractAddress`, and `callData`. The server
   must canonicalize the intent, compute/verify the digest, resolve the
   wallet, enforce the allowlist, create exactly one challenge, and return
   only the challenge data needed by the supported Circle SDK completion
   path. Prefer a server-managed/HttpOnly authenticated session or token
   broker so native mode does not depend on accepting the raw UCW credential
   from arbitrary browser JavaScript.

These controls are defense-in-depth, not a claim that a web UI can make a
compromised browser safe. Add browser-side protections such as a strict CSP,
dependency and output sanitization controls, and careful secret/logging
hygiene, but do not treat them as a substitute for server authorization.
