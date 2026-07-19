import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useAccount, useReadContract, useSignMessage } from 'wagmi'
import InvoiceCard from './InvoiceCard.jsx'

// InvoiceCard's external wagmi dependencies — useReadContract (via its
// internal useOnChainHash) and useAccount/useSignMessage (via the private-
// invoice unlock flow) — are mocked so this can render without a live
// WagmiProvider/RPC connection. Everything else from wagmi is passed through
// unchanged: config/wagmi.js (imported transitively via config/contract.js)
// calls the real createConfig() at module load time.
vi.mock('wagmi', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useReadContract: vi.fn(),
    useAccount: vi.fn(() => ({ address: undefined })),
    useSignMessage: vi.fn(() => ({ signMessageAsync: vi.fn() }))
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('InvoiceCard — malformed attachment resilience', () => {
  it('treats a malformed (non-string uri/sha256) attachment as no-attachment instead of crashing', () => {
    useReadContract.mockReturnValue({ data: undefined })

    // attachments[0] comes from depositor-controlled JSON (the invoice
    // envelope, pinned off-chain) — nothing on-chain constrains its shape.
    const invoiceData = JSON.stringify({
      version: 1,
      invoiceNumber: 'INV-0001',
      attachments: [{ uri: 12345, sha256: { not: 'a string' } }]
    })

    expect(() => {
      render(
        <InvoiceCard
          escrowId={1}
          invoiceData={invoiceData}
          invoiceURI="ipfs://bafyMOCK"
          invoiceAcknowledgedAt={null}
          role="payer"
        />
      )
    }).not.toThrow()

    // The rest of the invoice still renders normally...
    expect(screen.getByText('INV-0001')).toBeInTheDocument()
    // ...but the Attachment section is simply absent, same as an invoice
    // with no attachments at all — malformed data degrades to "no
    // attachment" instead of crashing the render.
    expect(screen.queryByText('Attachment')).not.toBeInTheDocument()
  })

  it('drops only a malformed sha256 while keeping a valid uri, hiding the fingerprint chip and verify affordance', () => {
    useReadContract.mockReturnValue({ data: undefined })

    const invoiceData = JSON.stringify({
      version: 1,
      invoiceNumber: 'INV-0002',
      attachments: [{ uri: 'ipfs://bafyREALCID', sha256: 999 }]
    })

    render(
      <InvoiceCard
        escrowId={2}
        invoiceData={invoiceData}
        invoiceURI="ipfs://bafyMOCK"
        invoiceAcknowledgedAt={null}
        role="payer"
      />
    )

    // Attachment section renders (uri was valid)...
    expect(screen.getByText('Attachment')).toBeInTheDocument()
    // ...but nothing tries to slice/lowercase the malformed sha256 — no
    // fingerprint chip, no "Drop original file to verify" affordance, both
    // of which are gated on attachment.sha256 being present.
    expect(screen.queryByTitle('Content fingerprint')).not.toBeInTheDocument()
    expect(screen.queryByText(/drop original file to verify/i)).not.toBeInTheDocument()
  })
})

describe('AttachmentRow — link opens InvoiceViewer', () => {
  const VALID_URI = 'ipfs://bafyREALCID'

  function renderWithAttachment() {
    useReadContract.mockReturnValue({ data: undefined })
    const invoiceData = JSON.stringify({
      version: 1,
      invoiceNumber: 'INV-0003',
      attachments: [{ uri: VALID_URI, sha256: '0x' + 'ab'.repeat(32) }]
    })
    return render(
      <InvoiceCard
        escrowId={3}
        invoiceData={invoiceData}
        invoiceURI="ipfs://bafyMOCK"
        invoiceAcknowledgedAt={null}
        role="payer"
      />
    )
  }

  it('opens InvoiceViewer on a plain left-click', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderWithAttachment()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: new RegExp(VALID_URI) }))
    expect(screen.getByRole('dialog', { name: /invoice attachment/i })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('does not open InvoiceViewer on a modifier click, leaving native "open in new tab" alone', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderWithAttachment()

    fireEvent.click(screen.getByRole('link', { name: new RegExp(VALID_URI) }), { metaKey: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    vi.unstubAllGlobals()
  })
})
