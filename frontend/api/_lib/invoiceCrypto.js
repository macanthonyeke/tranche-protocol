// Encryption for private-mode invoice envelopes and their attachments.
//
// There is no key store. Every key here is deterministically derived via
// HKDF-SHA256 from a server-only secret (INVOICE_KEY_SECRET) — never
// generated randomly and never persisted anywhere. Tradeoff, accepted: one
// leaked INVOICE_KEY_SECRET decrypts every private invoice/attachment ever
// pinned, and there is no per-escrow revocation. If that ever becomes a
// real requirement, the fix is a real key store (e.g. Turso) keyed by
// escrowId, not a change to this derivation. This hasn't been needed yet.
//
// Two distinct keys, two distinct derivation inputs:
//
// - Envelope key: HKDF(INVOICE_KEY_SECRET, invoiceHash). invoiceHash — not
//   escrowId — because pin-invoice.js must produce the envelope's ciphertext
//   IPFS URI *before* deposit() is called (the URI becomes a deposit()
//   argument), so escrowId doesn't exist yet at pin time. invoiceHash is
//   available at both ends: computed once client-side before minting
//   (frontend/src/utils/invoiceHash.js) and readable on-chain afterward via
//   getEscrow(escrowId)/getEscrowDetail(escrowId, ...).
//
// - Attachment key: HKDF(INVOICE_KEY_SECRET, attachmentSalt), where
//   attachmentSalt is random, generated at attachment-pin time — NOT
//   derived from invoiceHash. It can't be: invoiceHash is computed over the
//   full invoiceObject, which embeds the attachment's own (ciphertext) URI,
//   so the attachment must already be pinned before invoiceHash exists —
//   circular if the attachment's key also depended on invoiceHash. The
//   random salt breaks that cycle. It isn't secret (HKDF salts don't need
//   to be) — it's embedded in the ENVELOPE's own ciphertext header (see
//   envelopeBlob.js), so a client can read it the moment it fetches the
//   envelope blob and fold it into the same signed request-invoice-key.js
//   call that unlocks the envelope, rather than requiring a second wallet
//   signature once the attachment's existence is discovered.
//
// Distinct HKDF `info` strings keep the two key spaces separate even in the
// (astronomically unlikely) case invoiceHash and some attachmentSalt ever
// collided as byte strings.

import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { packEnvelopeBlob, unpackEnvelopeBlob, SALT_LEN } from '../../src/utils/envelopeBlob.js'

const KEY_LEN = 32 // AES-256
const IV_LEN = 12 // GCM standard nonce size
const AUTH_TAG_LEN = 16
const ENVELOPE_HKDF_INFO = Buffer.from('tranche-invoice-key-v1')
const ATTACHMENT_HKDF_INFO = Buffer.from('tranche-attachment-key-v1')

export class InvoiceCryptoError extends Error {}

function requireSecret() {
  const secret = process.env.INVOICE_KEY_SECRET
  if (!secret) throw new InvoiceCryptoError('Private invoices are not configured on the server.')
  return secret
}

function hashToSalt(invoiceHash) {
  const hex = String(invoiceHash || '').replace(/^0x/, '')
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new InvoiceCryptoError('invoiceHash must be a 32-byte 0x-prefixed hex string.')
  }
  return Buffer.from(hex, 'hex')
}

function hexToSaltBuffer(hex) {
  const clean = String(hex || '').replace(/^0x/, '')
  if (!new RegExp(`^[0-9a-fA-F]{${SALT_LEN * 2}}$`).test(clean)) {
    throw new InvoiceCryptoError(`attachmentSalt must be a ${SALT_LEN}-byte hex string.`)
  }
  return Buffer.from(clean, 'hex')
}

/**
 * Derive the per-escrow AES-256 envelope key for `invoiceHash`. Same output
 * every time for the same (INVOICE_KEY_SECRET, invoiceHash) pair — no state.
 * @param {string} invoiceHash 0x-prefixed 32-byte hex
 * @returns {Buffer}
 */
export function deriveInvoiceKey(invoiceHash) {
  const secret = requireSecret()
  const salt = hashToSalt(invoiceHash)
  return Buffer.from(hkdfSync('sha256', secret, salt, ENVELOPE_HKDF_INFO, KEY_LEN))
}

/**
 * Derive the per-attachment AES-256 key for `attachmentSalt`. Same output
 * every time for the same (INVOICE_KEY_SECRET, attachmentSalt) pair.
 * @param {string|Buffer} attachmentSalt hex string or raw 16-byte buffer
 * @returns {Buffer}
 */
export function deriveAttachmentKey(attachmentSalt) {
  const secret = requireSecret()
  const salt = typeof attachmentSalt === 'string' ? hexToSaltBuffer(attachmentSalt) : Buffer.from(attachmentSalt)
  if (salt.length !== SALT_LEN) throw new InvoiceCryptoError(`attachmentSalt must be ${SALT_LEN} bytes.`)
  return Buffer.from(hkdfSync('sha256', secret, salt, ATTACHMENT_HKDF_INFO, KEY_LEN))
}

/** Fresh random salt for a new attachment pin. @returns {Buffer} */
export function generateAttachmentSalt() {
  return randomBytes(SALT_LEN)
}

/**
 * Generic AES-256-GCM encryption for a single self-contained blob (used for
 * attachments — the envelope has its own wrapper, see encryptEnvelope).
 * Returns iv || ciphertext || authTag.
 * @param {string|Buffer} plaintext
 * @param {Buffer} key
 * @returns {Buffer}
 */
export function encryptBytes(plaintext, key) {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, ciphertext, authTag])
}

/**
 * Inverse of encryptBytes. Used server-side only for tests — in production,
 * attachment decryption happens client-side via Web Crypto.
 * @param {Buffer} blob iv || ciphertext || authTag
 * @param {Buffer} key
 * @returns {Buffer}
 */
export function decryptBytes(blob, key) {
  if (blob.length < IV_LEN + AUTH_TAG_LEN) {
    throw new InvoiceCryptoError('Ciphertext blob is too short.')
  }
  const iv = blob.subarray(0, IV_LEN)
  const authTag = blob.subarray(blob.length - AUTH_TAG_LEN)
  const ciphertext = blob.subarray(IV_LEN, blob.length - AUTH_TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/**
 * Encrypt the invoice envelope. When `attachmentSalt` is given, it's
 * embedded in the blob's public header (see envelopeBlob.js) so a viewer
 * can read it before decrypting anything.
 * @param {string} plaintext
 * @param {Buffer} key
 * @param {{ attachmentSalt?: Buffer|null }} [opts]
 * @returns {Buffer}
 */
export function encryptEnvelope(plaintext, key, { attachmentSalt } = {}) {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.from(packEnvelopeBlob({ iv, ciphertextAndTag: Buffer.concat([ciphertext, authTag]), attachmentSalt }))
}

/**
 * Inverse of encryptEnvelope. Used server-side only for tests — in
 * production, envelope decryption happens client-side via Web Crypto.
 * @param {Buffer} blob
 * @param {Buffer} key
 * @returns {{ plaintext: Buffer, attachmentSalt: Buffer|null }}
 */
export function decryptEnvelope(blob, key) {
  const { iv, ciphertextAndTag, attachmentSalt } = unpackEnvelopeBlob(blob)
  if (ciphertextAndTag.length < AUTH_TAG_LEN) {
    throw new InvoiceCryptoError('Ciphertext blob is too short.')
  }
  const ciphertext = ciphertextAndTag.subarray(0, ciphertextAndTag.length - AUTH_TAG_LEN)
  const authTag = ciphertextAndTag.subarray(ciphertextAndTag.length - AUTH_TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv))
  decipher.setAuthTag(Buffer.from(authTag))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()])
  return { plaintext, attachmentSalt: attachmentSalt ? Buffer.from(attachmentSalt) : null }
}

/**
 * Reads just the attachment salt (or null) out of an envelope blob, without
 * needing any key — the salt is public. Re-exported from envelopeBlob.js
 * for callers that only import from invoiceCrypto.js.
 * @param {Buffer} blob
 * @returns {Buffer|null}
 */
export function parseEnvelopeSalt(blob) {
  const { attachmentSalt } = unpackEnvelopeBlob(blob)
  return attachmentSalt ? Buffer.from(attachmentSalt) : null
}
