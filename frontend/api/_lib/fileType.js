// Detects a file's real type from its leading bytes (magic numbers / file
// signature) — never the filename, never the client-reported MIME type,
// both of which are trivially forged by whoever is uploading. Returns one
// of the three types InvoiceViewer.jsx can actually render, or null for
// anything else, so pin-invoice.js can reject a disguised or arbitrary file
// (a renamed .exe, an HTML file dressed up as an invoice) before it's ever
// pinned.
//
// Deliberate scope limit: this blocks a file whose real type isn't in the
// allowlist from being pinned as an invoice attachment. It does NOT scan
// the content of an allowed file for an embedded malicious payload (e.g. a
// well-formed PDF carrying exploit code, or a valid image with polyglot
// content appended after its header) — that's a different, heavier problem
// (real malware/content scanning) intentionally not addressed by this pass.

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPG_SIGNATURE = [0xff, 0xd8, 0xff]

function startsWith(bytes, signature) {
  if (bytes.length < signature.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false
  }
  return true
}

/**
 * @param {Uint8Array|Buffer} bytes
 * @returns {'pdf'|'png'|'jpg'|null}
 */
export function detectFileType(bytes) {
  if (!bytes || bytes.length === 0) return null
  if (startsWith(bytes, PDF_SIGNATURE)) return 'pdf'
  if (startsWith(bytes, PNG_SIGNATURE)) return 'png'
  if (startsWith(bytes, JPG_SIGNATURE)) return 'jpg'
  return null
}
