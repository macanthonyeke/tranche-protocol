// Encryption for private-mode invoice envelopes.
//
// There is no key store. The AES-256-GCM key for a given escrow's invoice is
// deterministically derived via HKDF-SHA256 from a server-only secret
// (INVOICE_KEY_SECRET) and that escrow's invoiceHash — never generated
// randomly and never persisted anywhere. Tradeoff, accepted: one leaked
// INVOICE_KEY_SECRET decrypts every private invoice ever pinned, and there is
// no per-escrow revocation. If that ever becomes a real requirement, the fix
// is a real key store (e.g. Turso) keyed by escrowId, not a change to this
// derivation. This hasn't been needed yet.
//
// invoiceHash — not escrowId — is the derivation input because pin-invoice.js
// must produce the ciphertext's IPFS URI *before* deposit() is called (the
// URI becomes a deposit() argument), so escrowId doesn't exist yet at pin
// time. invoiceHash is available at both ends: computed once client-side
// before minting (frontend/src/utils/invoiceHash.js) and readable on-chain
// afterward via getEscrow(escrowId)/getEscrowDetail(escrowId, ...).
//
// The IV is not derived or stored — it's generated fresh per encryption and
// prepended to the ciphertext blob that gets pinned, so the only thing
// request-invoice-key.js ever needs to hand back is the raw key.

import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const KEY_LEN = 32 // AES-256
const IV_LEN = 12 // GCM standard nonce size
const AUTH_TAG_LEN = 16
const HKDF_INFO = Buffer.from('tranche-invoice-key-v1')

export class InvoiceCryptoError extends Error {}

function hashToSalt(invoiceHash) {
  const hex = String(invoiceHash || '').replace(/^0x/, '')
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new InvoiceCryptoError('invoiceHash must be a 32-byte 0x-prefixed hex string.')
  }
  return Buffer.from(hex, 'hex')
}

/**
 * Derive the per-escrow AES-256 key for `invoiceHash`. Same output every
 * time for the same (INVOICE_KEY_SECRET, invoiceHash) pair — no state.
 * @param {string} invoiceHash 0x-prefixed 32-byte hex
 * @returns {Buffer}
 */
export function deriveInvoiceKey(invoiceHash) {
  const secret = process.env.INVOICE_KEY_SECRET
  if (!secret) throw new InvoiceCryptoError('Private invoices are not configured on the server.')
  const salt = hashToSalt(invoiceHash)
  return Buffer.from(hkdfSync('sha256', secret, salt, HKDF_INFO, KEY_LEN))
}

/**
 * Encrypt `plaintext` under `key`. Returns iv || ciphertext || authTag as one
 * buffer — self-contained, so the pinned blob needs no companion metadata.
 * @param {string|Buffer} plaintext
 * @param {Buffer} key
 * @returns {Buffer}
 */
export function encryptInvoiceEnvelope(plaintext, key) {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, ciphertext, authTag])
}

/**
 * Inverse of encryptInvoiceEnvelope. Used server-side only for tests — in
 * production, decryption happens client-side via Web Crypto after
 * request-invoice-key.js authorizes the caller and returns the raw key.
 * @param {Buffer} blob iv || ciphertext || authTag
 * @param {Buffer} key
 * @returns {Buffer}
 */
export function decryptInvoiceEnvelope(blob, key) {
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
