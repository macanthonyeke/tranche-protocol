import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const auth = vi.hoisted(() => ({
  isConnected: false,
  onboarding: false,
  completeOnboarding: vi.fn()
}))
const emailProps = vi.hoisted(() => ({ current: null }))

vi.mock('../hooks/useAuth.jsx', () => ({ useAuth: () => auth }))
vi.mock('./WalletButton.jsx', () => ({ default: () => <button type="button">Connect Wallet</button> }))
vi.mock('./EmailSignIn.jsx', () => ({
  default: (props) => {
    emailProps.current = props
    return <button type="button" onClick={() => props.onAccountNotFound?.('alice@example.com')}>
      {props.intent === 'signup' ? 'Create account' : 'Sign in'}
    </button>
  }
}))

const ConnectGate = (await import('./ConnectGate.jsx')).default

beforeEach(() => {
  auth.isConnected = false
  auth.onboarding = false
  auth.completeOnboarding.mockClear()
  emailProps.current = null
})

afterEach(() => cleanup())

describe('ConnectGate UCW account choices', () => {
  it('shows separate Sign in and Create account choices while retaining EOA connect', () => {
    render(<ConnectGate><p>protected</p></ConnectGate>)

    expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Create account' })).toHaveAttribute('aria-selected', 'false')
    fireEvent.click(screen.getByRole('button', { name: /connect a wallet instead/i }))
    expect(screen.getByRole('button', { name: 'Connect Wallet' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Create account' }))
    expect(emailProps.current.intent).toBe('signup')
    expect(screen.getByRole('heading', { name: /create a tranche account/i })).toBeInTheDocument()
  })

  it('moves an authenticated not-found result to explicit account setup', () => {
    render(<ConnectGate><p>protected</p></ConnectGate>)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('status')).toHaveTextContent(/older arc wallet/i)
    expect(emailProps.current.intent).toBe('signup')
  })

  it('shows the onboarding handoff after signup', () => {
    auth.onboarding = true
    render(<ConnectGate><p>protected</p></ConnectGate>)

    expect(screen.getByRole('heading', { name: /tranche account is ready/i })).toBeInTheDocument()
    expect(screen.getByText(/linked to an arc wallet on arc testnet/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /continue to tranche/i }))
    expect(auth.completeOnboarding).toHaveBeenCalledTimes(1)
  })
})
