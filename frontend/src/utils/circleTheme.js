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
