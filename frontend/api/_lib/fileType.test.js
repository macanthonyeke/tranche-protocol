// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { detectFileType } from './fileType.js'

describe('detectFileType', () => {
  it('detects a real PDF by its %PDF- signature', () => {
    expect(detectFileType(Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\nrest of a real pdf'))).toBe('pdf')
  })

  it('detects a real PNG by its 8-byte signature', () => {
    const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest of a real png')])
    expect(detectFileType(bytes)).toBe('png')
  })

  it('detects a real JPG by its 3-byte signature', () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('rest of a real jpg')])
    expect(detectFileType(bytes)).toBe('jpg')
  })

  it('rejects a plain text file', () => {
    expect(detectFileType(Buffer.from('just some plain text, nothing more'))).toBeNull()
  })

  it('rejects an HTML file, even one that starts by claiming to be a PDF in its own text', () => {
    expect(detectFileType(Buffer.from('<!DOCTYPE html><html><body>%PDF- is not actually here</body></html>'))).toBeNull()
  })

  it('rejects a Windows executable (MZ header)', () => {
    expect(detectFileType(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]))).toBeNull()
  })

  it('rejects an ELF executable', () => {
    expect(detectFileType(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]))).toBeNull()
  })

  it('rejects an empty buffer without crashing', () => {
    expect(detectFileType(Buffer.alloc(0))).toBeNull()
  })

  it('rejects a buffer shorter than any signature without crashing', () => {
    expect(detectFileType(Buffer.from([0x25, 0x50]))).toBeNull() // first 2 bytes of "%PDF-", nothing more
  })

  it('rejects null/undefined input without crashing', () => {
    expect(detectFileType(null)).toBeNull()
    expect(detectFileType(undefined)).toBeNull()
  })
})
