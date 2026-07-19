// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { keccak256, toHex } from 'viem'
import { deriveInvoiceKey, encryptInvoiceEnvelope, decryptInvoiceEnvelope } from './invoiceCrypto.js'

beforeEach(() => { process.env.INVOICE_KEY_SECRET = 'test-secret' })
afterEach(() => { delete process.env.INVOICE_KEY_SECRET })

describe('invoiceCrypto', () => {
  it('encrypt -> decrypt round-trip is byte-exact', () => {
    const plaintext = JSON.stringify({ version: 1, notes: 'ünïcödé ✓ test', lineItems: [{ amount: '100.00' }] })
    const invoiceHash = keccak256(toHex(plaintext))
    const key = deriveInvoiceKey(invoiceHash)

    const blob = encryptInvoiceEnvelope(plaintext, key)
    const decrypted = decryptInvoiceEnvelope(blob, key)

    expect(decrypted.toString('utf8')).toBe(plaintext)
  })

  it('hash verification passes on the decrypted content, matching the original invoiceHash', () => {
    const plaintext = JSON.stringify({ version: 1, invoiceNumber: 'INV-1' })
    const invoiceHash = keccak256(toHex(plaintext))
    const key = deriveInvoiceKey(invoiceHash)

    const blob = encryptInvoiceEnvelope(plaintext, key)
    const decrypted = decryptInvoiceEnvelope(blob, key).toString('utf8')

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
    const blob = Buffer.from(encryptInvoiceEnvelope(plaintext, key))
    blob[blob.length - 1] ^= 0xff // flip a bit in the trailing auth tag
    expect(() => decryptInvoiceEnvelope(blob, key)).toThrow()
  })

  it('throws a clear error when INVOICE_KEY_SECRET is not configured', () => {
    delete process.env.INVOICE_KEY_SECRET
    expect(() => deriveInvoiceKey('0x' + '11'.repeat(32))).toThrow(/not configured/i)
  })
})
