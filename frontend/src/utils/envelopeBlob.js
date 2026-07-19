// Pure byte-framing for the private-invoice envelope blob — no node:crypto,
// no Web Crypto, just slicing/concatenation. That's what lets this same
// file be imported both server-side (api/_lib/invoiceCrypto.js, for the
// actual encrypt/decrypt) and client-side (InvoiceCard.jsx, to read the
// embedded attachment salt out of a fetched envelope blob BEFORE any key
// exists) without duplicating the format logic in two places that could
// drift.
//
// Format: flags(1) || [attachmentSalt(16) if flags & FLAG_HAS_ATTACHMENT_SALT] || iv(12) || ciphertext+authTag
//
// The attachment salt is embedded here — in the envelope's own public
// header — rather than travelling with the attachment's own ciphertext,
// specifically so a client can read it without decrypting anything, and
// fold it into the SAME signed request-invoice-key.js call that unlocks the
// envelope. That's what lets one wallet signature authorize both the
// envelope key and the attachment key, instead of requiring a second
// signature once the attachment's location is discovered.
export const SALT_LEN = 16
export const IV_LEN = 12
export const FLAG_HAS_ATTACHMENT_SALT = 0b1

function toUint8(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
}

function concatBytes(arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

/**
 * @param {{ iv: Uint8Array, ciphertextAndTag: Uint8Array, attachmentSalt?: Uint8Array|null }} parts
 * @returns {Uint8Array}
 */
export function packEnvelopeBlob({ iv, ciphertextAndTag, attachmentSalt }) {
  const flags = new Uint8Array([attachmentSalt ? FLAG_HAS_ATTACHMENT_SALT : 0])
  const parts = [flags]
  if (attachmentSalt) parts.push(toUint8(attachmentSalt))
  parts.push(toUint8(iv), toUint8(ciphertextAndTag))
  return concatBytes(parts)
}

/**
 * @param {Uint8Array|Buffer} blob
 * @returns {{ iv: Uint8Array, ciphertextAndTag: Uint8Array, attachmentSalt: Uint8Array|null }}
 */
export function unpackEnvelopeBlob(blob) {
  const bytes = toUint8(blob)
  if (bytes.length < 1 + IV_LEN) {
    throw new Error('Envelope blob is too short.')
  }
  const flags = bytes[0]
  let offset = 1
  let attachmentSalt = null
  if (flags & FLAG_HAS_ATTACHMENT_SALT) {
    if (bytes.length < offset + SALT_LEN + IV_LEN) {
      throw new Error('Envelope blob is too short for its declared attachment salt.')
    }
    attachmentSalt = bytes.slice(offset, offset + SALT_LEN)
    offset += SALT_LEN
  }
  const iv = bytes.slice(offset, offset + IV_LEN)
  offset += IV_LEN
  const ciphertextAndTag = bytes.slice(offset)
  return { iv, ciphertextAndTag, attachmentSalt }
}

/**
 * Reads just the attachment salt (or null) without touching iv/ciphertext —
 * the salt is not secret, so this needs no key.
 * @param {Uint8Array|Buffer} blob
 * @returns {Uint8Array|null}
 */
export function parseEnvelopeSalt(blob) {
  return unpackEnvelopeBlob(blob).attachmentSalt
}
