import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

afterEach(cleanup)

const auth = vi.hoisted(() => ({
  isSca: true,
  email: 'alice@example.com',
  pendingVerification: null,
  directoryBinding: null,
  directoryBindingStatus: 'unverified',
  directoryChoice: 'undecided',
  confirmEmailVerification: vi.fn().mockResolvedValue({ verified: true }),
  resendEmailVerification: vi.fn().mockResolvedValue({ sent: true }),
  dismissEmailVerification: vi.fn().mockResolvedValue({ choice: 'skipped' }),
  skipDirectoryPrompt: vi.fn().mockResolvedValue({ choice: 'skipped' }),
  startDirectoryClaim: vi.fn().mockResolvedValue({ verificationRequired: true }),
  refreshDirectoryBinding: vi.fn().mockResolvedValue({ verified: false, choice: 'undecided' }),
  removeDirectoryBinding: vi.fn().mockResolvedValue({ removed: true, choice: 'removed' })
}))

vi.mock('../hooks/useAuth.jsx', () => ({ useAuth: () => auth }))

const { default: VerifyEmailPrompt, maskEmail } = await import('./VerifyEmailPrompt.jsx')

beforeEach(() => {
  auth.confirmEmailVerification.mockClear()
  auth.resendEmailVerification.mockClear()
  auth.dismissEmailVerification.mockClear()
  auth.skipDirectoryPrompt.mockClear()
  auth.startDirectoryClaim.mockClear()
  auth.refreshDirectoryBinding.mockClear()
  auth.removeDirectoryBinding.mockClear()
  auth.isSca = true
  auth.email = 'alice@example.com'
  auth.pendingVerification = null
  auth.directoryBinding = null
  auth.directoryBindingStatus = 'unverified'
  auth.directoryChoice = 'undecided'
})

describe('dashboard email discoverability prompt', () => {
  it('shows the initial prompt and both explicit choices', () => {
    render(<VerifyEmailPrompt />)

    expect(screen.getByRole('heading', { name: 'Be findable by email' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify for email payments' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()
  })

  it('persists Skip for now without starting verification', async () => {
    render(<VerifyEmailPrompt />)

    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))

    await waitFor(() => expect(auth.skipDirectoryPrompt).toHaveBeenCalledTimes(1))
    expect(auth.startDirectoryClaim).not.toHaveBeenCalled()
    expect(auth.confirmEmailVerification).not.toHaveBeenCalled()
    expect(auth.removeDirectoryBinding).not.toHaveBeenCalled()
  })

  it('keeps a pending verification state distinct and skippable', async () => {
    auth.pendingVerification = {
      verificationId: 'v1', email: 'alice@example.com', expiresInMinutes: 15
    }
    render(<VerifyEmailPrompt />)

    expect(screen.getByRole('heading', { name: /email verification pending/i })).toBeInTheDocument()
    expect(screen.getByText(/skip this if you're just paying someone/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))

    await waitFor(() => expect(auth.skipDirectoryPrompt).toHaveBeenCalledTimes(1))
  })

  it('hides the dashboard prompt after verification', () => {
    auth.directoryChoice = 'verified'
    auth.directoryBindingStatus = 'verified'
    auth.directoryBinding = { verified: true, email: 'alice@example.com' }

    const { container } = render(<VerifyEmailPrompt />)

    expect(container).toBeEmptyDOMElement()
  })

  it('does not render for an EOA', () => {
    auth.isSca = false
    const { container } = render(<VerifyEmailPrompt />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('Settings email discoverability states', () => {
  it.each(['skipped', 'undecided', 'removed'])(
    'shows the opt-in state for %s', (choice) => {
      auth.directoryChoice = choice
      render(<VerifyEmailPrompt settings />)

      expect(screen.getByRole('heading', { name: /email discoverability is off/i })).toBeInTheDocument()
      expect(screen.getByText(/find your tranche account by email/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Verify for email payments' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument()
    }
  )

  it('shows verified status with a masked email and removal', async () => {
    auth.directoryChoice = 'verified'
    auth.directoryBindingStatus = 'verified'
    auth.directoryBinding = { verified: true, email: 'alice@example.com' }
    render(<VerifyEmailPrompt settings />)

    expect(screen.getByRole('heading', { name: /email discoverability is on/i })).toBeInTheDocument()
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.getByText('a•••e@example.com')).toBeInTheDocument()
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove email discoverability' }))
    await waitFor(() => expect(auth.removeDirectoryBinding).toHaveBeenCalledTimes(1))
  })

  it('allows opt-in again after removal', async () => {
    auth.directoryChoice = 'removed'
    auth.directoryBindingStatus = 'unverified'
    render(<VerifyEmailPrompt settings />)

    fireEvent.click(screen.getByRole('button', { name: 'Verify for email payments' }))
    await waitFor(() => expect(auth.startDirectoryClaim).toHaveBeenCalledTimes(1))
  })
})

describe('verification controls', () => {
  beforeEach(() => {
    auth.pendingVerification = {
      verificationId: 'v1', email: 'alice@example.com', expiresInMinutes: 15
    }
  })

  it('submits the typed code', async () => {
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

  it('offers resend without changing the pending state', async () => {
    render(<VerifyEmailPrompt />)
    fireEvent.click(screen.getByRole('button', { name: /send a new code/i }))
    await waitFor(() => expect(auth.resendEmailVerification).toHaveBeenCalledTimes(1))
  })
})

describe('email masking', () => {
  it('keeps only a recognizable local-part edge and the domain', () => {
    expect(maskEmail('alice@example.com')).toBe('a•••e@example.com')
    expect(maskEmail('not-an-email')).toBe('Hidden')
  })
})
