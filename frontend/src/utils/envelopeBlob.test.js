import { describe, it, expect } from 'vitest'
import { packEnvelopeBlob, unpackEnvelopeBlob, parseEnvelopeSalt, SALT_LEN, IV_LEN } from './envelopeBlob.js'

function randomBytes(n) {
  const b = new Uint8Array(n)
  for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256)
  return b
}

describe('envelopeBlob pack/unpack', () => {
  it('round-trips without an attachment salt', () => {
    const iv = randomBytes(IV_LEN)
    const ciphertextAndTag = randomBytes(50)

    const blob = packEnvelopeBlob({ iv, ciphertextAndTag })
    const unpacked = unpackEnvelopeBlob(blob)

    expect(Array.from(unpacked.iv)).toEqual(Array.from(iv))
    expect(Array.from(unpacked.ciphertextAndTag)).toEqual(Array.from(ciphertextAndTag))
    expect(unpacked.attachmentSalt).toBeNull()
  })

  it('round-trips with an attachment salt embedded', () => {
    const iv = randomBytes(IV_LEN)
    const ciphertextAndTag = randomBytes(64)
    const attachmentSalt = randomBytes(SALT_LEN)

    const blob = packEnvelopeBlob({ iv, ciphertextAndTag, attachmentSalt })
    const unpacked = unpackEnvelopeBlob(blob)

    expect(Array.from(unpacked.iv)).toEqual(Array.from(iv))
    expect(Array.from(unpacked.ciphertextAndTag)).toEqual(Array.from(ciphertextAndTag))
    expect(Array.from(unpacked.attachmentSalt)).toEqual(Array.from(attachmentSalt))
  })

  it('the attachment salt is extractable via parseEnvelopeSalt without touching iv/ciphertext at all', () => {
    const attachmentSalt = randomBytes(SALT_LEN)
    const blob = packEnvelopeBlob({ iv: randomBytes(IV_LEN), ciphertextAndTag: randomBytes(40), attachmentSalt })

    // parseEnvelopeSalt is a pure byte read — no decryption, no key of any
    // kind, exactly what lets a client discover it before authorizing.
    const salt = parseEnvelopeSalt(blob)
    expect(Array.from(salt)).toEqual(Array.from(attachmentSalt))
  })

  it('parseEnvelopeSalt returns null when the blob has no embedded salt', () => {
    const blob = packEnvelopeBlob({ iv: randomBytes(IV_LEN), ciphertextAndTag: randomBytes(40) })
    expect(parseEnvelopeSalt(blob)).toBeNull()
  })

  it('works on a Node Buffer input the same as a plain Uint8Array (server-side use)', () => {
    const iv = Buffer.from(randomBytes(IV_LEN))
    const ciphertextAndTag = Buffer.from(randomBytes(30))
    const attachmentSalt = Buffer.from(randomBytes(SALT_LEN))

    const blob = packEnvelopeBlob({ iv, ciphertextAndTag, attachmentSalt })
    const unpacked = unpackEnvelopeBlob(Buffer.from(blob))

    expect(Buffer.from(unpacked.attachmentSalt).equals(attachmentSalt)).toBe(true)
  })

  it('throws on a truncated blob', () => {
    expect(() => unpackEnvelopeBlob(new Uint8Array([0]))).toThrow(/too short/i)
  })

  it('throws when the salt flag is set but the blob is too short to actually contain one', () => {
    const truncated = packEnvelopeBlob({ iv: randomBytes(IV_LEN), ciphertextAndTag: randomBytes(10), attachmentSalt: randomBytes(SALT_LEN) })
      .slice(0, 5) // flag byte says "salt present" but the bytes aren't there
    expect(() => unpackEnvelopeBlob(truncated)).toThrow(/too short/i)
  })
})
