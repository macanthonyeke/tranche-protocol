import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'

const authMock = vi.hoisted(() => ({ current: null }))

vi.mock('../hooks/useAuth.jsx', () => ({
  useAuth: () => authMock.current
}))

vi.mock('../components/ConnectGate.jsx', () => ({
  default: ({ children, title, message }) => (
    <div data-testid="connect-gate"><h1>{title}</h1><p>{message}</p>{children}</div>
  )
}))

const { default: UcwCanary } = await import('./UcwCanary.jsx')

const REPORT = {
  status: 'NOT EXECUTED',
  pass: false,
  identity: {
    source: 'authenticated Tranche session',
    circleUserId: 'circle-user-1',
    walletId: 'wallet-canary-1',
    walletAddress: '0x1111111111111111111111111111111111111111',
    blockchain: 'ARC-TESTNET',
    accountType: 'SCA',
    matchesSession: true
  },
  wallet: {
    id: 'wallet-canary-1',
    address: '0x1111111111111111111111111111111111111111',
    blockchain: 'ARC-TESTNET',
    state: 'LIVE',
    accountType: 'SCA',
    scaCore: 'circle_6900_singleowner_v3',
    implementationAddress: '0xd206ac7fef53d83ed4563e770b28dba90d0d9ec8'
  },
  balances: {
    erc20: { balanceBaseUnits: '2000000', balanceUsdc: '2', decimals: 6, requiredBaseUnits: '1100000' },
    native: { balanceNative18: '200000000000000000', balanceUsdc: '0.2', decimals: 18, requiredNative18: '100000000000000000' },
    allowanceToTrancheBaseUnits: '0'
  },
  gasStation: {
    gasPayer: 'unconfirmed',
    fallbackGasPayer: 'disposable SCA native Arc USDC',
    documentedArcTestnetSCA: true,
    exactPath: 'unproven',
    paymasterAddress: '0x7ceA357B5AC0639F89f9e378a1f03Aa5005C0a25',
    priorPhase1Evidence: { available: false },
    feeEstimate: { available: false }
  },
  payload: {
    contractAddress: '0x1111111111111111111111111111111111111111',
    callData: '0xdeadbeef'
  },
  actionDigest: `0x${'ab'.repeat(32)}`,
  refId: 'phase2-ucw-atomic-batch-canary-v1',
  proposedIdempotencyKey: '00000000-0000-4000-8000-000000000001',
  innerCalls: [
    { target: '0x3600000000000000000000000000000000000000', value: '0', data: '0xapprove' },
    { target: '0x6bf5e723b5a542b8d49bedab7c8eb2791af00d3d', value: '0', data: '0xdeposit' }
  ],
  decodedExecuteBatch: { functionName: 'executeBatch', calls: [] },
  gates: [
    { id: 'wallet-sca-core', label: 'Circle scaCore is exactly one supported core', pass: true, detail: 'circle_6900_singleowner_v3', critical: true },
    { id: 'gas-station-exact-path', label: 'Gas Station sponsorship is proven for this exact UCW executeBatch path', pass: false, detail: 'unconfirmed', critical: false }
  ]
}

beforeEach(() => {
  authMock.current = {
    isConnected: true,
    isSca: true,
    address: REPORT.wallet.address,
    runCanaryPreflight: vi.fn().mockResolvedValue(REPORT)
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UcwCanary', () => {
  it('renders sanitized review data and a hard NOT EXECUTED state', async () => {
    render(<UcwCanary />)

    await waitFor(() => expect(screen.getByText('wallet-canary-1')).toBeInTheDocument())
    expect(screen.getAllByText('NOT EXECUTED')).toHaveLength(2)
    expect(screen.getAllByText('circle_6900_singleowner_v3')).toHaveLength(2)
    expect(screen.getByText('phase2-ucw-atomic-batch-canary-v1')).toBeInTheDocument()
    expect(screen.getByText('circle-user-1')).toBeInTheDocument()
    expect(screen.getByText('matched')).toBeInTheDocument()
    expect(screen.getByText('executeBatch')).toBeInTheDocument()
    expect(screen.queryByText('secret-token')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /execute|submit|challenge|approve|deposit/i })).not.toBeInTheDocument()
  })

  it('does not expose the canary to an EOA session', () => {
    authMock.current = { isConnected: true, isSca: false, runCanaryPreflight: vi.fn() }

    render(<UcwCanary />)

    expect(screen.getByText('SCA wallet required')).toBeInTheDocument()
    expect(authMock.current.runCanaryPreflight).not.toHaveBeenCalled()
  })
})
