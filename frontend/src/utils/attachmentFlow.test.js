import { describe, it, expect, vi } from 'vitest'
import { resolveFileAttachment, resolveUrlAttachment, resolveRemoveAttachment, preparePrivateInvoiceData } from './attachmentFlow.js'

describe('resolveFileAttachment', () => {
  it('public mode pins immediately — exact pre-existing behavior, regression check', async () => {
    const pinFile = vi.fn().mockResolvedValue({ ipfsUri: 'ipfs://bafyPUBLIC', sha256: '0xaa' })
    const file = { name: 'invoice.pdf' }

    const result = await resolveFileAttachment({ file, privateMode: false, pinFile })

    expect(pinFile).toHaveBeenCalledWith(file)
    expect(result).toEqual({ deferred: false, attachmentURI: 'ipfs://bafyPUBLIC', attachmentHash: '0xaa' })
  })

  it('private mode defers — never calls pinFile, just holds the File', async () => {
    const pinFile = vi.fn()
    const file = { name: 'invoice.pdf' }

    const result = await resolveFileAttachment({ file, privateMode: true, pinFile })

    expect(pinFile).not.toHaveBeenCalled()
    expect(result).toEqual({ deferred: true, pendingFile: file })
  })

  it('Replace: unpins the outgoing attachment only AFTER the new one has successfully pinned', async () => {
    const pinFile = vi.fn().mockResolvedValue({ ipfsUri: 'ipfs://bafyNEW', sha256: '0xnew', unpinToken: 'tokenNEW' })
    const unpinAttachment = vi.fn()
    const file = { name: 'replacement.pdf' }

    const result = await resolveFileAttachment({
      file, privateMode: false, pinFile,
      previousAttachmentURI: 'ipfs://bafyOLD', previousAttachmentUnpinToken: 'tokenOLD',
      unpinAttachment
    })

    expect(pinFile).toHaveBeenCalledWith(file)
    expect(unpinAttachment).toHaveBeenCalledTimes(1)
    expect(unpinAttachment).toHaveBeenCalledWith('ipfs://bafyOLD', 'tokenOLD')
    expect(result.attachmentURI).toBe('ipfs://bafyNEW') // the new one, not clobbered by cleanup of the old
  })

  it('Replace: does NOT unpin the outgoing attachment if the new pin fails', async () => {
    const pinFile = vi.fn().mockRejectedValue(new Error('Pinning service unavailable.'))
    const unpinAttachment = vi.fn()

    await expect(resolveFileAttachment({
      file: { name: 'replacement.pdf' }, privateMode: false, pinFile,
      previousAttachmentURI: 'ipfs://bafyOLD', previousAttachmentUnpinToken: 'tokenOLD',
      unpinAttachment
    })).rejects.toThrow('Pinning service unavailable.')

    // The still-good original must not be destroyed by a failed replace.
    expect(unpinAttachment).not.toHaveBeenCalled()
  })

  it('a fresh attach (no previous attachment) never calls unpinAttachment', async () => {
    const pinFile = vi.fn().mockResolvedValue({ ipfsUri: 'ipfs://bafyFRESH', sha256: '0xfresh' })
    const unpinAttachment = vi.fn()

    await resolveFileAttachment({
      file: { name: 'first.pdf' }, privateMode: false, pinFile,
      previousAttachmentURI: '', previousAttachmentUnpinToken: '',
      unpinAttachment
    })

    expect(unpinAttachment).not.toHaveBeenCalled()
  })
})

describe('resolveUrlAttachment', () => {
  it('public mode pins immediately — exact pre-existing behavior, regression check', async () => {
    const pinUrl = vi.fn().mockResolvedValue({ ipfsUri: 'ipfs://bafyPUBLICURL', sha256: '0xbb' })

    const result = await resolveUrlAttachment({ url: 'https://example.com/invoice.pdf', privateMode: false, pinUrl })

    expect(pinUrl).toHaveBeenCalledWith('https://example.com/invoice.pdf')
    expect(result).toEqual({ deferred: false, attachmentURI: 'ipfs://bafyPUBLICURL', attachmentHash: '0xbb' })
  })

  it('private mode defers — never calls pinUrl, just holds the URL', async () => {
    const pinUrl = vi.fn()

    const result = await resolveUrlAttachment({ url: 'https://example.com/invoice.pdf', privateMode: true, pinUrl })

    expect(pinUrl).not.toHaveBeenCalled()
    expect(result).toEqual({ deferred: true, pendingUrl: 'https://example.com/invoice.pdf' })
  })

  it('Replace: unpins the outgoing attachment only AFTER the new one has successfully pinned', async () => {
    const pinUrl = vi.fn().mockResolvedValue({ ipfsUri: 'ipfs://bafyNEWURL', sha256: '0xnew', unpinToken: 'tokenNEW' })
    const unpinAttachment = vi.fn()

    const result = await resolveUrlAttachment({
      url: 'https://example.com/new.pdf', privateMode: false, pinUrl,
      previousAttachmentURI: 'ipfs://bafyOLDURL', previousAttachmentUnpinToken: 'tokenOLD',
      unpinAttachment
    })

    expect(unpinAttachment).toHaveBeenCalledTimes(1)
    expect(unpinAttachment).toHaveBeenCalledWith('ipfs://bafyOLDURL', 'tokenOLD')
    expect(result.attachmentURI).toBe('ipfs://bafyNEWURL')
  })

  it('Replace: does NOT unpin the outgoing attachment if the new pin fails', async () => {
    const pinUrl = vi.fn().mockRejectedValue(new Error('Could not reach the pinning service.'))
    const unpinAttachment = vi.fn()

    await expect(resolveUrlAttachment({
      url: 'https://example.com/new.pdf', privateMode: false, pinUrl,
      previousAttachmentURI: 'ipfs://bafyOLDURL', previousAttachmentUnpinToken: 'tokenOLD',
      unpinAttachment
    })).rejects.toThrow('Could not reach the pinning service.')

    expect(unpinAttachment).not.toHaveBeenCalled()
  })
})

describe('resolveRemoveAttachment', () => {
  it('unpins the current attachment with its exact CID and token', () => {
    const unpinAttachment = vi.fn()

    resolveRemoveAttachment({ attachmentURI: 'ipfs://bafyREMOVE', attachmentUnpinToken: 'tokenREMOVE', unpinAttachment })

    expect(unpinAttachment).toHaveBeenCalledTimes(1)
    expect(unpinAttachment).toHaveBeenCalledWith('ipfs://bafyREMOVE', 'tokenREMOVE')
  })

  it('no-ops without error when there is nothing pinned yet (e.g. a private-mode attachment still pending)', () => {
    const unpinAttachment = vi.fn()

    expect(() => resolveRemoveAttachment({ attachmentURI: '', attachmentUnpinToken: '', unpinAttachment })).not.toThrow()
    expect(unpinAttachment).not.toHaveBeenCalled()
  })

  it('no-ops when there is a URI but no token (defensive — should not happen in practice)', () => {
    const unpinAttachment = vi.fn()

    resolveRemoveAttachment({ attachmentURI: 'ipfs://bafySOMETHING', attachmentUnpinToken: '', unpinAttachment })

    expect(unpinAttachment).not.toHaveBeenCalled()
  })
})

describe('preparePrivateInvoiceData', () => {
  const invoiceObjectBase = { version: 1, invoiceNumber: 'INV-1', lineItems: [] }
  const computeInvoiceHash = (json) => `0xhash(${json.length})`

  it('with a pending file: pins the attachment first, folds its URI/hash/mime into the envelope, hashes the final envelope, then pins the envelope with the attachment salt', async () => {
    const pinPrivateAttachmentFile = vi.fn().mockResolvedValue({
      ipfsUri: 'ipfs://bafyATTACHMENT', sha256: '0xattsha', salt: '0xsalt123', mime: 'application/pdf'
    })
    const pinPrivateAttachmentUrl = vi.fn()
    const pinPrivateInvoice = vi.fn().mockResolvedValue({ ipfsUri: 'ipfs://bafyENVELOPE' })
    const file = { name: 'contract.pdf' }

    const result = await preparePrivateInvoiceData({
      invoiceObjectBase,
      pendingAttachmentFile: file,
      pendingAttachmentUrl: null,
      pinPrivateAttachmentFile,
      pinPrivateAttachmentUrl,
      pinPrivateInvoice,
      computeInvoiceHash
    })

    expect(pinPrivateAttachmentFile).toHaveBeenCalledWith(file)
    expect(pinPrivateAttachmentUrl).not.toHaveBeenCalled()

    const [invoiceJsonArg, invoiceHashArg, attachmentSaltArg] = pinPrivateInvoice.mock.calls[0]
    const parsedEnvelope = JSON.parse(invoiceJsonArg)
    expect(parsedEnvelope.attachments).toEqual([{ uri: 'ipfs://bafyATTACHMENT', sha256: '0xattsha', mime: 'application/pdf' }])
    expect(invoiceHashArg).toBe(computeInvoiceHash(invoiceJsonArg))
    expect(attachmentSaltArg).toBe('0xsalt123')

    expect(result).toEqual({ invoiceHash: computeInvoiceHash(invoiceJsonArg), invoiceDataArg: 'ipfs://bafyENVELOPE' })
  })

  it('with a pending url: pins the attachment via the url path, same sequencing', async () => {
    const pinPrivateAttachmentFile = vi.fn()
    const pinPrivateAttachmentUrl = vi.fn().mockResolvedValue({
      ipfsUri: 'ipfs://bafyURLATTACHMENT', sha256: '0xurlsha', salt: '0xurlsalt', mime: 'image/png'
    })
    const pinPrivateInvoice = vi.fn().mockResolvedValue({ ipfsUri: 'ipfs://bafyENVELOPE2' })

    await preparePrivateInvoiceData({
      invoiceObjectBase,
      pendingAttachmentFile: null,
      pendingAttachmentUrl: 'https://example.com/contract.pdf',
      pinPrivateAttachmentFile,
      pinPrivateAttachmentUrl,
      pinPrivateInvoice,
      computeInvoiceHash
    })

    expect(pinPrivateAttachmentUrl).toHaveBeenCalledWith('https://example.com/contract.pdf')
    expect(pinPrivateAttachmentFile).not.toHaveBeenCalled()
    const [, , attachmentSaltArg] = pinPrivateInvoice.mock.calls[0]
    expect(attachmentSaltArg).toBe('0xurlsalt')
  })

  it('with no attachment: skips both attachment pin functions, pins the envelope with no attachmentSalt', async () => {
    const pinPrivateAttachmentFile = vi.fn()
    const pinPrivateAttachmentUrl = vi.fn()
    const pinPrivateInvoice = vi.fn().mockResolvedValue({ ipfsUri: 'ipfs://bafyENVELOPE3' })

    await preparePrivateInvoiceData({
      invoiceObjectBase,
      pendingAttachmentFile: null,
      pendingAttachmentUrl: null,
      pinPrivateAttachmentFile,
      pinPrivateAttachmentUrl,
      pinPrivateInvoice,
      computeInvoiceHash
    })

    expect(pinPrivateAttachmentFile).not.toHaveBeenCalled()
    expect(pinPrivateAttachmentUrl).not.toHaveBeenCalled()
    const [invoiceJsonArg, , attachmentSaltArg] = pinPrivateInvoice.mock.calls[0]
    expect(JSON.parse(invoiceJsonArg).attachments).toEqual([])
    expect(attachmentSaltArg).toBeUndefined()
  })

  it('a mid-pin failure throws and never reaches pinPrivateInvoice — the caller can halt before depositTx.run()', async () => {
    const pinPrivateAttachmentFile = vi.fn().mockRejectedValue(new Error('Pinning service unavailable.'))
    const pinPrivateAttachmentUrl = vi.fn()
    const pinPrivateInvoice = vi.fn()

    await expect(preparePrivateInvoiceData({
      invoiceObjectBase,
      pendingAttachmentFile: { name: 'x.pdf' },
      pendingAttachmentUrl: null,
      pinPrivateAttachmentFile,
      pinPrivateAttachmentUrl,
      pinPrivateInvoice,
      computeInvoiceHash
    })).rejects.toThrow('Pinning service unavailable.')

    expect(pinPrivateInvoice).not.toHaveBeenCalled()
  })

  it('an envelope-pin failure (after a successful attachment pin) also throws, still never producing deposit args', async () => {
    const pinPrivateAttachmentFile = vi.fn().mockResolvedValue({
      ipfsUri: 'ipfs://bafyOK', sha256: '0xok', salt: '0xoksalt', mime: 'application/pdf'
    })
    const pinPrivateInvoice = vi.fn().mockRejectedValue(new Error('invoiceHash does not match the provided invoice JSON.'))

    await expect(preparePrivateInvoiceData({
      invoiceObjectBase,
      pendingAttachmentFile: { name: 'x.pdf' },
      pendingAttachmentUrl: null,
      pinPrivateAttachmentFile,
      pinPrivateAttachmentUrl: vi.fn(),
      pinPrivateInvoice,
      computeInvoiceHash
    })).rejects.toThrow(/invoiceHash does not match/)
  })
})
