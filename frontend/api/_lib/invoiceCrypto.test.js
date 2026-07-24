// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { keccak256, toHex } from 'viem'
import {
  deriveInvoiceKey, deriveAttachmentKey, generateAttachmentSalt,
  encryptBytes, decryptBytes, encryptEnvelope, decryptEnvelope, parseEnvelopeSalt
} from './invoiceCrypto.js'

beforeEach(() => { process.env.INVOICE_KEY_SECRET = 'test-secret' })
afterEach(() => { delete process.env.INVOICE_KEY_SECRET })

describe('envelope key (deriveInvoiceKey) + generic bytes encrypt/decrypt', () => {
  it('encrypt -> decrypt round-trip is byte-exact', () => {
    const plaintext = JSON.stringify({ version: 1, notes: 'ünïcödé ✓ test', lineItems: [{ amount: '100.00' }] })
    const invoiceHash = keccak256(toHex(plaintext))
    const key = deriveInvoiceKey(invoiceHash)

    const blob = encryptBytes(plaintext, key)
    const decrypted = decryptBytes(blob, key)

    expect(decrypted.toString('utf8')).toBe(plaintext)
  })

  it('hash verification passes on the decrypted content, matching the original invoiceHash', () => {
    const plaintext = JSON.stringify({ version: 1, invoiceNumber: 'INV-1' })
    const invoiceHash = keccak256(toHex(plaintext))
    const key = deriveInvoiceKey(invoiceHash)

    const blob = encryptBytes(plaintext, key)
    const decrypted = decryptBytes(blob, key).toString('utf8')

    expect(keccak256(toHex(decrypted))).toBe(invoiceHash)
  })

  it('derives the same key for the same invoiceHash every time — no randomness, nothing stored', () => {
    const hash = '0x' + 'cd'.repeat(32)
    expect(deriveInvoiceKey(hash).equals(deriveInvoiceKey(hash))).toBe(true)
  })

  it('derives different keys for different invoiceHashes', () => {
    const a = deriveInvoiceKey('0x' + '11'.repeat(32))
    const b = deriveInvoiceKey('0x' + '22'.repeat(32))
    expect(a.equals(b)).toBe(false)
  })

  it('fails closed if the ciphertext is tampered with (GCM auth tag)', () => {
    const plaintext = 'hello'
    const invoiceHash = keccak256(toHex(plaintext))
    const key = deriveInvoiceKey(invoiceHash)
    const blob = Buffer.from(encryptBytes(plaintext, key))
    blob[blob.length - 1] ^= 0xff // flip a bit in the trailing auth tag
    expect(() => decryptBytes(blob, key)).toThrow()
  })

  it('throws a clear error when INVOICE_KEY_SECRET is not configured', () => {
    delete process.env.INVOICE_KEY_SECRET
    expect(() => deriveInvoiceKey('0x' + '11'.repeat(32))).toThrow(/not configured/i)
  })
})

describe('attachment key (deriveAttachmentKey) — independent of the envelope key', () => {
  it('derives the same key for the same salt every time', () => {
    const salt = generateAttachmentSalt()
    expect(deriveAttachmentKey(salt).equals(deriveAttachmentKey(salt))).toBe(true)
  })

  it('derives different keys for different salts', () => {
    const a = deriveAttachmentKey(generateAttachmentSalt())
    const b = deriveAttachmentKey(generateAttachmentSalt())
    expect(a.equals(b)).toBe(false)
  })

  it('produces a different key than deriveInvoiceKey even given byte-identical input material', () => {
    // Same 32-byte value fed to both derivations (as a hash to one, a salt
    // truncated/reused conceptually to the other) must not collide — the
    // HKDF `info` strings are what keep the two key spaces separate.
    const sharedHex = '0x' + 'ab'.repeat(32)
    const envelopeKey = deriveInvoiceKey(sharedHex)
    const attachmentKey = deriveAttachmentKey(sharedHex.slice(2, 2 + 32)) // first 16 bytes as hex
    expect(envelopeKey.equals(attachmentKey)).toBe(false)
  })

  it('generateAttachmentSalt produces fresh, non-repeating 16-byte values', () => {
    const salts = new Set(Array.from({ length: 20 }, () => generateAttachmentSalt().toString('hex')))
    expect(salts.size).toBe(20)
    expect(generateAttachmentSalt().length).toBe(16)
  })

  it('rejects a malformed salt', () => {
    expect(() => deriveAttachmentKey('not-hex')).toThrow(/16-byte hex/i)
    expect(() => deriveAttachmentKey('0x1234')).toThrow(/16-byte hex/i)
  })

  it('attachment encrypt -> decrypt round-trip is byte-exact', () => {
    const salt = generateAttachmentSalt()
    const key = deriveAttachmentKey(salt)
    const plaintext = Buffer.from('%PDF-1.4 fake attachment bytes')

    const blob = encryptBytes(plaintext, key)
    const decrypted = decryptBytes(blob, key)

    expect(decrypted.equals(plaintext)).toBe(true)
  })
})

describe('envelope blob framing (encryptEnvelope / decryptEnvelope / parseEnvelopeSalt)', () => {
  it('round-trips without an attachment salt (no attachment on this escrow)', () => {
    const plaintext = JSON.stringify({ version: 1, invoiceNumber: 'INV-NO-ATTACHMENT' })
    const invoiceHash = keccak256(toHex(plaintext))
    const key = deriveInvoiceKey(invoiceHash)

    const blob = encryptEnvelope(plaintext, key)
    const { plaintext: decrypted, attachmentSalt } = decryptEnvelope(blob, key)

    expect(decrypted.toString('utf8')).toBe(plaintext)
    expect(attachmentSalt).toBeNull()
  })

  it('round-trips with an embedded attachment salt', () => {
    const plaintext = JSON.stringify({ version: 1, invoiceNumber: 'INV-WITH-ATTACHMENT' })
    const invoiceHash = keccak256(toHex(plaintext))
    const key = deriveInvoiceKey(invoiceHash)
    const attachmentSalt = generateAttachmentSalt()

    const blob = encryptEnvelope(plaintext, key, { attachmentSalt })
    const { plaintext: decrypted, attachmentSalt: extractedSalt } = decryptEnvelope(blob, key)

    expect(decrypted.toString('utf8')).toBe(plaintext)
    expect(extractedSalt.equals(attachmentSalt)).toBe(true)
  })

  it('parseEnvelopeSalt reads the attachment salt WITHOUT needing any key', () => {
    const plaintext = JSON.stringify({ version: 1 })
    const invoiceHash = keccak256(toHex(plaintext))
    const key = deriveInvoiceKey(invoiceHash)
    const attachmentSalt = generateAttachmentSalt()

    const blob = encryptEnvelope(plaintext, key, { attachmentSalt })

    // No key passed anywhere in this call — the salt must be readable from
    // the blob's public header alone.
    const extracted = parseEnvelopeSalt(blob)
    expect(extracted.equals(attachmentSalt)).toBe(true)
  })

  it('parseEnvelopeSalt returns null when there was no attachment', () => {
    const plaintext = JSON.stringify({ version: 1 })
    const invoiceHash = keccak256(toHex(plaintext))
    const key = deriveInvoiceKey(invoiceHash)

    const blob = encryptEnvelope(plaintext, key)
    expect(parseEnvelopeSalt(blob)).toBeNull()
  })

  it('the attachment key derived from a salt read via parseEnvelopeSalt matches the one used at encryption time', () => {
    const attachmentPlaintext = Buffer.from('sensitive attachment bytes')
    const attachmentSalt = generateAttachmentSalt()
    const attachmentKeyAtPinTime = deriveAttachmentKey(attachmentSalt)
    const attachmentBlob = encryptBytes(attachmentPlaintext, attachmentKeyAtPinTime)

    const envelopePlaintext = JSON.stringify({ version: 1, attachments: [{ uri: 'ipfs://mock' }] })
    const invoiceHash = keccak256(toHex(envelopePlaintext))
    const envelopeKey = deriveInvoiceKey(invoiceHash)
    const envelopeBlob = encryptEnvelope(envelopePlaintext, envelopeKey, { attachmentSalt })

    // Viewer side: only has the envelope blob and (after authorization) the
    // envelope key — everything else is re-derived from what's public.
    const saltFromEnvelope = parseEnvelopeSalt(envelopeBlob)
    const attachmentKeyAtViewTime = deriveAttachmentKey(saltFromEnvelope)
    const decryptedAttachment = decryptBytes(attachmentBlob, attachmentKeyAtViewTime)

    expect(decryptedAttachment.equals(attachmentPlaintext)).toBe(true)
  })
})
