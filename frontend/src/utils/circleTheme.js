// Tranche's theming and confirm-screen copy for Circle's hosted wallet widget.
//
// Lives in its own module purely so the config is inspectable and drivable on
// its own — useAuth.jsx just calls applyTrancheTheme(sdk) after constructing
// the SDK, and applyConfirmLocalization(sdk, confirm) before each execute().
// Nothing here touches app-side rendering; it only configures the widget.

import { formatUSDC, formatUSDCNumber } from './format.js'

/* Circle's widget renders inside a security iframe we cannot style, so this is
   theming through the options Circle actually exposes — not a CSS override,
   and not a pixel match. The aim is only that the handoff doesn't feel like
   leaving the product.
 *
 * Shapes here were read off the installed SDK's own type definitions
 * (@circle-fin/w3s-pw-web-sdk 1.1.11, dist/src/types.d.ts), because this API
 * has drifted: there is no `appearanceConfig` and no theming in the
 * constructor's `Configs` at all — that interface carries only appSettings,
 * authentication and loginConfigs. Everything below goes through setters.
 * Re-check the types before changing any of it on an SDK bump. */
export const TRANCHE_THEME = {
  // Design tokens are authored in oklch (see styles/globals.css); the SDK
  // takes plain hex, so these are the converted equivalents. #c84e25 is
  // --clay, oklch(58% 0.165 38), converted through oklab to sRGB — not an
  // eyeballed approximation. Recompute rather than nudge by hand if the token
  // ever moves.
  mainBtnBg: '#c84e25',
  mainBtnBgOnHover: '#b73500',   // --clay-hover
  mainBtnText: '#f8f1e5',        // --paper, matching .btn-primary's text
  mainBtnTextOnHover: '#f8f1e5',

  secondBtnText: '#231814',      // --ink
  secondBtnBorder: '#bfb2a3',    // --rule-2, as .btn-secondary uses
  secondBtnBorderOnHover: '#c84e25',
  secondBtnBgOnHover: '#f0e7d8', // --sunk

  plainBtnText: '#c84e25',
  plainBtnTextOnHover: '#b73500',

  bg: '#f8f1e5',                 // --paper
  divider: '#dcd3c6',            // --rule
  textMain: '#231814',           // --ink
  textAuxiliary: '#5c4f4b',      // --ink-2
  textSummary: '#5c4f4b',
  textPlaceholder: '#6c605c',    // --ink-3
  textInteractive: '#c84e25',
  textSummaryHighlight: '#c84e25',

  inputText: '#231814',
  inputBg: '#f0e7d8',            // --sunk, as .input uses
  inputBorderFocused: '#c84e25',
  inputBorderFocusedError: '#c9222b',

  pinDotActivated: '#c84e25',
  pinDotBaseBorder: '#bfb2a3',

  success: '#007840',            // --ok
  error: '#c9222b'               // --bad

  // titleGradients is deliberately absent. The SDK supports it; the design
  // system has exactly one saturated colour and no gradients, so setting it
  // would import a treatment that appears nowhere else in the product.
}

/* Switzer is the UI face (tailwind.config.js `sans`). The SDK's fontFamily
   takes a single { name, url } pointing at a CSS stylesheet, and this is the
   same self-hosted file index.html loads — public/fonts/tranche-fonts.css.
   Only one family can be passed, so the widget gets the UI face; Fraunces is
   display type and would not appear in this chrome anyway.

   ABSOLUTE, and pinned to the production domain on purpose. The widget runs
   in an iframe on pw-auth.circle.com, so a relative path would resolve
   against Circle's origin and find nothing. It must also be a URL that
   outlives this branch: a Vercel preview URL stops existing once the
   deployment is cleaned up, which would leave the widget silently unstyled
   long after anyone remembered why. That does mean previews and localhost
   load the widget's font from production — correct, since it is the only
   address Circle can reach, and the file is immutable and CORS-open
   (see the /fonts/* headers in vercel.json).

   The app itself does NOT use this constant; index.html links the same
   stylesheet by relative path, so local and preview builds serve their own
   copy. Only the cross-origin iframe needs the absolute form. */
export const TRANCHE_FONT = {
  name: 'Switzer',
  url: 'https://trancheprotocol.xyz/fonts/tranche-fonts.css'
}

/* NO setCustomSecurityQuestions CALL, DELIBERATELY — do not re-add one.
 *
 * There used to be a SECURITY_CONFIRM_ITEMS constant here, replacing Circle's
 * default disclaimer on the security-questions screen. It was removed because
 * these users never see that screen, and its copy had gone stale in a way that
 * proved it: it talked about forgetting "your PIN", and email-auth wallets have
 * no PIN at all.
 *
 * Why the screen is unreachable, traced through the installed SDK (1.1.11)
 * rather than assumed:
 *
 *  - The only wallet-creation call in this codebase is
 *    createUserPinWithWallets (api/_lib/wallet/initialize.js), whose challenge
 *    is the sole thing that could surface security questions.
 *  - dist/src/index.js:243-247 — the public execute() we use for that
 *    challenge (and for every contract execution) calls exec(onCompleted,
 *    false), i.e. showIframe = false unconditionally. appendIframe then sizes
 *    the iframe 0%/0% at z-index -1 with display:none (index.js:346-361).
 *  - index.js:98-106 — it becomes visible ONLY when Circle's own iframe posts
 *    { showUi: true } back. So Circle decides server-side, per challenge and
 *    per auth mode, whether any UI appears at all.
 *  - For email auth Circle sends no showUi for the initialization challenge:
 *    a confirmed first-time signup produced no PIN-or-security-questions
 *    dialog (the investigation behind commits b2d709f..42c387f). Contract
 *    executions DO get showUi — that is the confirm screen this module
 *    themes — which shows the mechanism genuinely discriminates rather than
 *    the UI being globally suppressed.
 *
 * Removing the call is a clean no-op for that screen: setCustomSecurityQuestions
 * writes only three fields, all read at one place —
 * customizations.securityQuestions.{questions, requiredCount,
 * securityConfirmItems} (index.js:60-63). One consequence if that screen ever
 * does render: requiredCount falls back to the SDK's default of 2
 * (index.js:39) where we used to pass 1, and Circle's default questions and
 * disclaimer apply. Cosmetic, and only reachable if the premise above stops
 * holding — which is what to re-check first if you find yourself wanting this
 * back. */

/** Apply Tranche's theming to a freshly constructed SDK instance. */
export function applyTrancheTheme(sdk) {
  // Each call is independently guarded: these are cosmetic, and a shape change
  // on an SDK bump must not be able to stop someone signing in.
  try {
    sdk.setThemeColor(TRANCHE_THEME)
  } catch (err) {
    console.warn('Circle widget theming skipped:', err)
  }
  try {
    sdk.setResources({ fontFamily: TRANCHE_FONT })
  } catch (err) {
    console.warn('Circle widget font skipped:', err)
  }
}

/* ----- The CONTRACT_EXECUTION confirm screen -------------------------------
 *
 * This screen is the actual signing moment, and left to itself it is generic:
 * headed "Contract Interaction", identifying the callee by a truncated
 * address, with Total blank. Blank is not a bug — we send pre-encoded
 * calldata (see api/_lib/wallet/execute-contract-call.js on why), so Circle
 * genuinely cannot know what the call is worth and has nothing to put there.
 * Only the caller knows, so the caller supplies it.
 *
 * Two things about the SDK's model drive the shape of this code, both read off
 * the installed package rather than the docs (1.1.11):
 *
 *  - Localizations are read off the SDK instance when the challenge iframe
 *    reports ready — index.js's messageHandler posts `this.localizations`
 *    inside `customizations` on `onFrameReady`. So they must be set BEFORE
 *    execute(), and what is set then applies to that challenge.
 *
 *  - The instance is a long-lived singleton (sdkRef in useAuth) and setters
 *    just overwrite fields. A call that left localizations alone would show
 *    the PREVIOUS transaction's amount on the next signing screen — a stale
 *    figure being far worse than a blank one. applyConfirmLocalization
 *    therefore always writes, falling back to GENERIC_CONFIRM.
 *
 * networkFee is deliberately not set. Gas is sponsored by Circle's Gas
 * Station for these wallets, but a fee row is a factual claim on a signing
 * screen and we don't compute one — Circle's own value, whatever it shows,
 * beats a number we invented. Same reason `total` here is labelled per call
 * site ("Amount authorised" / "Total locked") instead of a bare "Total":
 * it is the USDC figure, and it does not pretend to be value-plus-fees.
 *
 * Shapes below are ContractInteraction from dist/src/types.d.ts. Re-check
 * them on an SDK bump, as with the theme above. */

const GENERIC_CONFIRM = {
  title: 'Confirm this transaction',
  subtitle: 'Check the details below, then confirm to sign.',
  contractAddressLabel: 'Contract',
  contractInfo: ['Tranche Protocol']
}

/* Maps an app-level descriptor to Circle's ContractInteraction shape.
 *
 *   title, subtitle   plain copy for this specific action
 *   amount            USDC in base units (bigint) — formatted here, once, so
 *                     the signing screen can't drift from the app's own
 *                     rendering of the same number
 *   amountLabel       what that figure IS, e.g. 'Total locked'
 *   contractName      who is being called, in words
 *   contractAddress   ...and its address, kept: this is a signing screen
 *   functionName      the real function, for anyone who opens the details
 *   parameters        human-readable arg lines
 */
export function buildContractInteraction(confirm) {
  if (!confirm) return GENERIC_CONFIRM

  const hasAmount = confirm.amount !== undefined && confirm.amount !== null

  return {
    title: confirm.title || GENERIC_CONFIRM.title,
    subtitle: confirm.subtitle || GENERIC_CONFIRM.subtitle,
    contractAddressLabel: 'Contract',
    contractInfo: [confirm.contractName, confirm.contractAddress].filter(Boolean),

    // amount and symbol are set together or not at all — a symbol with no
    // figure beside it reads as a currency label attached to nothing.
    ...(hasAmount
      ? {
          mainCurrency: { amount: formatUSDCNumber(confirm.amount), symbol: 'USDC' },
          totalLabel: confirm.amountLabel || 'Amount',
          total: [formatUSDC(confirm.amount)]
        }
      : {}),

    ...(confirm.functionName
      ? {
          dataDetails: {
            dataDetailsLabel: 'Transaction details',
            abiInfo: {
              functionNameLabel: 'Function',
              functionName: confirm.functionName,
              parametersLabel: 'Parameters',
              parameters: confirm.parameters || []
            }
          }
        }
      : {})
  }
}

/** Set the confirm-screen copy for the challenge about to be executed. Always
 *  call this before execute(), with or without a descriptor — see above for
 *  why passing nothing still has to overwrite. */
export function applyConfirmLocalization(sdk, confirm) {
  try {
    sdk.setLocalizations({ contractInteraction: buildContractInteraction(confirm) })
  } catch (err) {
    // Cosmetic, like the rest of this module: a shape change on an SDK bump
    // must not be able to block a signature.
    console.warn('Circle confirm-screen copy skipped:', err)
  }
}
