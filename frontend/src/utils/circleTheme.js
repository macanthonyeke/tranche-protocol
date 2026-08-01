// Tranche's theming for Circle's hosted wallet widget.
//
// Lives in its own module purely so the config is inspectable and drivable on
// its own — useAuth.jsx just calls applyTrancheTheme(sdk) after constructing
// the SDK. Nothing here touches app-side rendering; it only configures the
// widget.

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
  // takes plain hex, so these are the converted equivalents.
  //
  // NOTE: #c4622d is the value specified for this work. The --clay token
  // itself, oklch(58% 0.165 38), actually converts to #c84e25 — a slightly
  // redder, more saturated terracotta. Kept as specified rather than
  // silently substituted; swap to #c84e25 to track the token exactly.
  mainBtnBg: '#c4622d',
  mainBtnBgOnHover: '#b73500',   // --clay-hover
  mainBtnText: '#f8f1e5',        // --paper, matching .btn-primary's text
  mainBtnTextOnHover: '#f8f1e5',

  secondBtnText: '#231814',      // --ink
  secondBtnBorder: '#bfb2a3',    // --rule-2, as .btn-secondary uses
  secondBtnBorderOnHover: '#c4622d',
  secondBtnBgOnHover: '#f0e7d8', // --sunk

  plainBtnText: '#c4622d',
  plainBtnTextOnHover: '#b73500',

  bg: '#f8f1e5',                 // --paper
  divider: '#dcd3c6',            // --rule
  textMain: '#231814',           // --ink
  textAuxiliary: '#5c4f4b',      // --ink-2
  textSummary: '#5c4f4b',
  textPlaceholder: '#6c605c',    // --ink-3
  textInteractive: '#c4622d',
  textSummaryHighlight: '#c4622d',

  inputText: '#231814',
  inputBg: '#f0e7d8',            // --sunk, as .input uses
  inputBorderFocused: '#c4622d',
  inputBorderFocusedError: '#c9222b',

  pinDotActivated: '#c4622d',
  pinDotBaseBorder: '#bfb2a3',

  success: '#007840',            // --ok
  error: '#c9222b'               // --bad

  // titleGradients is deliberately absent. The SDK supports it; the design
  // system has exactly one saturated colour and no gradients, so setting it
  // would import a treatment that appears nowhere else in the product.
}

/* Switzer is the UI face (tailwind.config.js `sans`). The SDK's fontFamily
   takes a single { name, url } pointing at a CSS stylesheet — the same shape
   as the Google Fonts URL in its own docs — so this reuses the exact Fontshare
   stylesheet index.html already loads rather than re-hosting anything. Nothing
   is self-hosted in public/; both faces come from CDNs today.
   Only one family can be passed, so Fraunces (display) is not sent — the
   widget is UI chrome, not a place display type would appear. */
export const TRANCHE_FONT = {
  name: 'Switzer',
  url: 'https://api.fontshare.com/v2/css?f[]=switzer@300,400,500,600,700&display=swap'
}

/* Replaces Circle's default disclaimer on the security-question screen.
   Plain and factual: what the answers are for, and the one consequence that
   actually matters — losing them means losing the wallet, which no one at
   Tranche can undo. Passed as the third argument of
   setCustomSecurityQuestions; there is no standalone setter for it. */
export const SECURITY_CONFIRM_ITEMS = [
  'Your recovery answers are the only way back into this wallet if you forget your PIN.',
  'Tranche cannot see your answers and cannot reset them for you.',
  'If you lose both your PIN and these answers, the funds in this wallet cannot be recovered.'
]

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
  try {
    // null keeps Circle's default question set; only the disclaimer copy is
    // ours. The middle argument is requiredCount, left at the default 1.
    sdk.setCustomSecurityQuestions(null, 1, SECURITY_CONFIRM_ITEMS)
  } catch (err) {
    console.warn('Circle widget security copy skipped:', err)
  }
}
