import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { InvoiceUploader } from './CreateEscrow.jsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// A pinned invoice with a real ipfs:// uri, so toGatewayUrl() and
// InvoiceViewer's own fetch have something plausible to work with. The
// fetch is stubbed to hang deliberately — these tests only care whether the
// viewer modal opened, not what it renders once its own fetch resolves
// (that's InvoiceViewer.test.jsx's job).
const PINNED_PROPS = {
  invoice: { mode: 'file', status: 'pinned', name: 'invoice.pdf', size: 1234, error: '' },
  attachmentURI: 'ipfs://bafyMOCKCID',
  attachmentHash: '0x' + 'ab'.repeat(32),
  onPinFile: () => {},
  onPinUrl: () => {},
  onRemove: () => {}
}

describe('InvoiceUploader — "View" link opens InvoiceViewer', () => {
  it('opens InvoiceViewer on a plain left-click', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<InvoiceUploader {...PINNED_PROPS} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: /view/i }))
    expect(screen.getByRole('dialog', { name: /invoice attachment/i })).toBeInTheDocument()
  })

  it('does not open InvoiceViewer on a modifier click, leaving native "open in new tab" alone', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<InvoiceUploader {...PINNED_PROPS} />)

    fireEvent.click(screen.getByRole('link', { name: /view/i }), { metaKey: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the "View" link\'s href resolves through the gateway, never the raw ipfs:// uri', () => {
    render(<InvoiceUploader {...PINNED_PROPS} />)
    const link = screen.getByRole('link', { name: /view/i })
    expect(link).toHaveAttribute('href', expect.stringMatching(/^https:\/\//))
    expect(link.getAttribute('href')).not.toBe(PINNED_PROPS.attachmentURI)
  })
})
