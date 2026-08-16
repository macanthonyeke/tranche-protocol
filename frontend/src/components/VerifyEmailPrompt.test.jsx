import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// Explicit: RTL only auto-registers its afterEach cleanup when vitest runs
// with `globals: true`, and this project does not.
afterEach(cleanup)

const auth = vi.hoisted(() => ({
  isSca: true,
  email: 'alice@example.com',
  pendingVerification: { verificationId: 'v1', email: 'alice@example.com', expiresInMinutes: 15 },
  confirmEmailVerification: vi.fn().mockResolvedValue({ verified: true }),
  resendEmailVerification: vi.fn().mockResolvedValue({ sent: true }),
  dismissEmailVerification: vi.fn(),
  startDirectoryClaim: vi.fn().mockResolvedValue({ verificationRequired: true })
}))

vi.mock('../hooks/useAuth.jsx', () => ({ useAuth: () => auth }))

const VerifyEmailPrompt = (await import('./VerifyEmailPrompt.jsx')).default

beforeEach(() => {
  auth.confirmEmailVerification.mockClear()
  auth.resendEmailVerification.mockClear()
  auth.dismissEmailVerification.mockClear()
  auth.startDirectoryClaim.mockClear()
  auth.isSca = true
  auth.email = 'alice@example.com'
  auth.pendingVerification = { verificationId: 'v1', email: 'alice@example.com', expiresInMinutes: 15 }
})

describe('VerifyEmailPrompt framing', () => {
  // Arriving mid-onboarding, a code field reads as a second mandatory login
  // step. Most people signing in are payers, for whom this does nothing.
  it('says up front that the step is optional and who can ignore it', () => {
    render(<VerifyEmailPrompt />)
    expect(screen.getByText(/optional/i)).toBeInTheDocument()
    expect(screen.getByText(/skip this if you're just paying someone/i)).toBeInTheDocument()
    expect(screen.getByText(/find you by email/i)).toBeInTheDocument()
  })

  it('still names the address the code went to', () => {
    render(<VerifyEmailPrompt />)
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
  })

  // "Exactly as prominent" — both are real buttons, same size, same row.
  // Previously Skip was a bare text link tucked under a tertiary action.
  it('gives Skip the same weight as Verify', () => {
    render(<VerifyEmailPrompt />)
    const verify = screen.getByRole('button', { name: /verify/i })
    const skip = screen.getByRole('button', { name: /skip for now/i })

    expect(verify.tagName).toBe('BUTTON')
    expect(skip.tagName).toBe('BUTTON')
    // Same container, so neither can drift into a footer or a smaller row.
    expect(skip.parentElement).toBe(verify.parentElement)
    // Same type scale and vertical padding as the primary action.
    for (const cls of ['text-sm', 'py-2']) {
      expect(verify.className).toContain(cls)
      expect(skip.className).toContain(cls)
    }
    // A styled button, not a text link pretending to be one.
    expect(skip.className).toContain('btn-secondary')
  })

  it('skipping dismisses without touching verification', () => {
    render(<VerifyEmailPrompt />)
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }))
    expect(auth.dismissEmailVerification).toHaveBeenCalledTimes(1)
    expect(auth.confirmEmailVerification).not.toHaveBeenCalled()
  })
})

/* The copy change must not have moved any behaviour. Skip now sits inside the
   <form>, so a wrong `type` would submit it. */
describe('VerifyEmailPrompt behaviour is unchanged', () => {
  it('submits the typed code to confirmEmailVerification', async () => {
    render(<VerifyEmailPrompt />)
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /verify/i }))
    await waitFor(() => expect(auth.confirmEmailVerification).toHaveBeenCalledWith('123456'))
  })

  it('keeps Verify disabled until six digits are entered', () => {
    render(<VerifyEmailPrompt />)
    const verify = screen.getByRole('button', { name: /verify/i })
    expect(verify).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '12345' } })
    expect(verify).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } })
    expect(verify).toBeEnabled()
  })

  it('strips non-digits from the code field', () => {
    render(<VerifyEmailPrompt />)
    const input = screen.getByLabelText(/verification code/i)
    fireEvent.change(input, { target: { value: '12a3b4' } })
    expect(input.value).toBe('1234')
  })

  it('Skip does not submit the form', () => {
    render(<VerifyEmailPrompt />)
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }))
    expect(auth.confirmEmailVerification).not.toHaveBeenCalled()
  })

  it('still offers a resend', async () => {
    render(<VerifyEmailPrompt />)
    fireEvent.click(screen.getByRole('button', { name: /send a new code/i }))
    await waitFor(() => expect(auth.resendEmailVerification).toHaveBeenCalledTimes(1))
  })

  it('offers an explicit directory claim when there is no pending verification', async () => {
    auth.pendingVerification = null
    render(<VerifyEmailPrompt />)
    fireEvent.click(screen.getByRole('button', { name: /verify for email payments/i }))
    await waitFor(() => expect(auth.startDirectoryClaim).toHaveBeenCalledTimes(1))
  })

  it('renders nothing for an EOA', () => {
    auth.pendingVerification = null
    auth.isSca = false
    const { container } = render(<VerifyEmailPrompt />)
    expect(container).toBeEmptyDOMElement()
  })
})
