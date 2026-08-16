import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const auth = vi.hoisted(() => ({
  signInWithEmail: vi.fn(),
  createAccountWithEmail: vi.fn()
}))

vi.mock('../hooks/useAuth.jsx', () => ({ useAuth: () => auth }))

const EmailSignIn = (await import('./EmailSignIn.jsx')).default

beforeEach(() => {
  auth.signInWithEmail.mockReset()
  auth.createAccountWithEmail.mockReset()
})

afterEach(() => cleanup())

describe('EmailSignIn', () => {
  it('renders a distinct sign-in action and uses the signin transport', async () => {
    auth.signInWithEmail.mockResolvedValue({ next: 'app', session: { walletId: 'wallet-1' } })
    const onDone = vi.fn()
    render(<EmailSignIn onDone={onDone} />)

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText(/never creates or initializes an arc wallet/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'Alice@Example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(auth.signInWithEmail).toHaveBeenCalledWith(
      'Alice@Example.com', expect.objectContaining({ onStage: expect.any(Function) })
    ))
    expect(auth.createAccountWithEmail).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ next: 'app' }))
  })

  it('renders a distinct create-account action and uses signup transport', async () => {
    auth.createAccountWithEmail.mockResolvedValue({ next: 'onboarding', session: { walletId: 'wallet-1' } })
    const onDone = vi.fn()
    render(<EmailSignIn intent="signup" onDone={onDone} />)

    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
    expect(screen.getByText(/create an arc wallet/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(auth.createAccountWithEmail).toHaveBeenCalledWith(
      'alice@example.com', expect.objectContaining({ onStage: expect.any(Function) })
    ))
    expect(auth.signInWithEmail).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ next: 'onboarding' }))
  })

  it('hands the post-auth not-found result to the recovery UI', async () => {
    auth.signInWithEmail.mockResolvedValue({ code: 'TRANCHE_ACCOUNT_NOT_FOUND', next: 'signup' })
    const onAccountNotFound = vi.fn()
    render(<EmailSignIn onAccountNotFound={onAccountNotFound} />)

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(onAccountNotFound).toHaveBeenCalledWith('new@example.com'))
  })
})
