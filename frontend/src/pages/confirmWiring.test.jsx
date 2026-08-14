import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

/* Wiring tests.
 *
 * Every other confirm test in this suite calls a descriptor directly and
 * asserts its output. That proves the descriptor is right; it proves nothing
 * about whether the app ever hands it to the signing screen. A call site that
 * forgot `confirm:` entirely, or passed a stale variable, or wired the wrong
 * descriptor to the wrong button, would leave all of those tests green.
 *
 * These render the real components and assert what actually reaches tx.run —
 * the object Circle's screen is built from. They also pin the guards that stop
 * a submission happening at all: the zero-address checks (which the contract
 * rejects on-chain) and the loading gates (where an unresolved read is
 * indistinguishable from a real empty answer).
 */

const runMock = vi.hoisted(() => vi.fn())
const txState = vi.hoisted(() => ({ current: { run: null, isBusy: false, status: 'idle', hash: null, error: null } }))
const authMock = vi.hoisted(() => ({ current: { address: '0x1111111111111111111111111111111111111111' } }))
const refundBalanceMock = vi.hoisted(() => ({ current: { balance: 250000000n, isLoading: false, refetch: vi.fn() } }))
// `pendingRefundRecoveryAt` (feeds expiryOf). `pendingRefundRecovery`
// (proposedOwner) is split into its own mock below — Round 15 #1 made claim's
// gate depend on proposedOwner actually being a real address (hasProposal),
// so the two reads can no longer share one mock value the way they used to
// when proposedOwner only ever fed display text.
const readContractMock = vi.hoisted(() => ({ current: { data: undefined, isLoading: false, refetch: vi.fn() } }))
const proposedOwnerMock = vi.hoisted(() => ({ current: { data: undefined, isLoading: false, refetch: vi.fn() } }))
const rolesMock = vi.hoisted(() => ({ current: { roles: {}, isLoading: false } }))
const protocolConfigMock = vi.hoisted(() => ({ current: { config: { protocolFeeBps: 199n, protocolTreasury: '0x2222222222222222222222222222222222222222', cctpForwardFee: 200000n, paused: false }, refetch: vi.fn() } }))

vi.mock('../hooks/useTx.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useTx: () => ({ ...txState.current, run: runMock })
}))
vi.mock('../hooks/useAuth.jsx', () => ({ useAuth: () => authMock.current }))
vi.mock('../hooks/useEscrows.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useRefundBalance: () => refundBalanceMock.current
}))
vi.mock('../hooks/useRoles.jsx', () => ({ useRoles: () => rolesMock.current }))
vi.mock('../hooks/useArbiter.js', () => ({ useProtocolConfig: () => protocolConfigMock.current }))
vi.mock('../hooks/useSupportedDomains.js', () => ({ useSupportedDomains: () => ({ supported: [], refetch: vi.fn() }) }))
vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal()),
  useReadContract: (opts) => opts?.functionName === 'pendingRefundRecovery' ? proposedOwnerMock.current : readContractMock.current,
  // WalletButton renders inside both pages and reaches for the wagmi provider,
  // which these tests deliberately do not stand up.
  useAccount: () => ({ address: authMock.current?.address, isConnected: true, chainId: 5042002 }),
  useConnect: () => ({ connect: vi.fn(), connectors: [] })
}))

// Both pages sit behind the connect gate, which otherwise renders a sign-in
// form instead of the controls under test. The gate is not what these tests
// are about; the mocked useAuth above already represents a connected wallet.
vi.mock('../components/ConnectGate.jsx', () => ({
  default: ({ children }) => children
}))

// Settings renders an appearance section that requires ThemeProvider; the
// theme is irrelevant to what these tests assert.
vi.mock('../hooks/useTheme.jsx', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn(), resolved: 'light' })
}))

const Settings = (await import('./Settings.jsx')).default
const ProtocolSettings = (await import('./ProtocolSettings.jsx')).default
const { withdrawRefundConfirm } = await import('./Settings.jsx')
const { claimRecoveryConfirm, protocolTreasuryConfirm } = await import('./ProtocolSettings.jsx')

const ZERO = '0x0000000000000000000000000000000000000000'
const GOOD = '0x4bdbe608ea998b4822476353df9dd83228ffd503'

// The options object tx.run received, i.e. what actually feeds the signing screen.
const lastConfirm = () => runMock.mock.calls.at(-1)?.[1]?.confirm

const type = (el, value) => fireEvent.change(el, { target: { value } })

/* Phase E: the recovery panels debounce their lookups by 400ms, and the submit
   gate deliberately counts "typed, not yet looked up" as a read still pending
   — otherwise the button would go live during the pause, which is the exact
   mid-read submit the gate exists to prevent.
 *
 * So a test that types an address and immediately expects the button live is
 * now asserting the wrong instant, not a broken gate. Advance past the window
 * first. Uses real timers deliberately: this file renders components and
 * fires events, and swapping the whole file to fake timers to serve two
 * assertions would be a much larger change than waiting 400ms twice. */
const RECOVERY_DEBOUNCE_MS = 400
const settleLookup = () => new Promise((r) => setTimeout(r, RECOVERY_DEBOUNCE_MS + 50))

// Real "now", not fake timers (this file uses real timers for the debounce).
// A fixed calendar date goes stale the moment real time passes it — Round 15
// #2 added an expiry check to the claim gate, so a hardcoded past date would
// now read as an expired proposal and wrongly disable the button under test.
const RECENT_PROPOSED_AT = BigInt(Math.floor(Date.now() / 1000) - 24 * 60 * 60)

// The treasury field is labelled rather than uniquely placeheld (several
// inputs share the bare "0x…" placeholder), so select it by its label.
const treasuryInput = () => screen.getByLabelText(/treasury address/i)

// vitest.config.js does not set `globals`, so RTL's automatic cleanup is never
// registered and renders accumulate across tests.
afterEach(() => { cleanup() })

beforeEach(() => {
  runMock.mockReset()
  txState.current = { run: null, isBusy: false, status: 'idle', hash: null, error: null }
  authMock.current = { address: '0x1111111111111111111111111111111111111111' }
  refundBalanceMock.current = { balance: 250000000n, isLoading: false, refetch: vi.fn() }
  readContractMock.current = { data: undefined, isLoading: false, refetch: vi.fn() }
  proposedOwnerMock.current = { data: undefined, isLoading: false, refetch: vi.fn() }
  rolesMock.current = { roles: {}, isLoading: false }
})

describe('withdrawRefund is wired to its descriptor', () => {
  const openWithdraw = () => {
    render(<Settings />)
    return screen.getByRole('button', { name: /withdraw funds/i })
  }

  it('passes the real withdrawRefundConfirm output to tx.run', () => {
    const btn = openWithdraw()
    fireEvent.click(btn)

    expect(runMock).toHaveBeenCalledTimes(1)
    const confirm = lastConfirm()
    expect(confirm).toBeTruthy()
    expect(confirm.functionName).toBe('withdrawRefund')
    // Independently rebuilt from the same inputs the component had, so a call
    // site that passed a stale balance or the wrong recipient fails here.
    expect(confirm).toEqual(withdrawRefundConfirm({
      balance: 250000000n,
      recipient: authMock.current.address,
      signer: authMock.current.address
    }))
  })

  it('carries the live balance, not a placeholder', () => {
    refundBalanceMock.current = { balance: 987654321n, isLoading: false, refetch: vi.fn() }
    fireEvent.click(openWithdraw())
    expect(lastConfirm().amount).toBe(987654321n)
  })

  /* withdrawRefund reverts ZeroAddress on-chain, so submitting is a guaranteed
     paid failure. isValidAddress passes the zero address on hex shape alone. */
  it('refuses to submit to the zero address', () => {
    render(<Settings />)
    const input = screen.getAllByPlaceholderText('0x…')[0]
    type(input, ZERO)
    const btn = screen.getByRole('button', { name: /withdraw funds/i })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('still allows an ordinary address', () => {
    render(<Settings />)
    type(screen.getAllByPlaceholderText('0x…')[0], GOOD)
    const btn = screen.getByRole('button', { name: /withdraw funds/i })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(lastConfirm().parameters.join('\n')).toContain(GOOD)
  })
})

describe('the treasury setter is wired to its descriptor', () => {
  beforeEach(() => { rolesMock.current = { roles: { isFeeManager: true }, isLoading: false } })

  it('passes the real protocolTreasuryConfirm output to tx.run', () => {
    render(<ProtocolSettings />)
    type(treasuryInput(), GOOD)
    fireEvent.click(screen.getByRole('button', { name: /update treasury/i }))

    const confirm = lastConfirm()
    expect(confirm.functionName).toBe('setProtocolTreasury')
    expect(confirm).toEqual(protocolTreasuryConfirm({
      currentTreasury: protocolConfigMock.current.config.protocolTreasury,
      newTreasury: GOOD
    }))
  })

  /* setProtocolTreasury reverts ZeroAddress (sol:197). */
  it('refuses to submit the zero address as treasury', () => {
    render(<ProtocolSettings />)
    type(treasuryInput(), ZERO)
    const btn = screen.getByRole('button', { name: /update treasury/i })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(runMock).not.toHaveBeenCalled()
  })
})

describe('the recovery claim is wired to its descriptor', () => {
  // No admin role: this is the nominee path, which the page must still expose.
  // Default proposedOwner to the connected wallet — a real, non-expired,
  // matching proposal — so tests that don't care about the gate itself
  // (Round 15 #1/#2 now require hasProposal and !expired) aren't all forced
  // to set it individually; tests below override where the gate IS the point.
  beforeEach(() => {
    rolesMock.current = { roles: {}, isLoading: false }
    proposedOwnerMock.current = { data: authMock.current.address, isLoading: false, refetch: vi.fn() }
    readContractMock.current = { data: RECENT_PROPOSED_AT, isLoading: false, refetch: vi.fn() }
  })

  const openClaim = async () => {
    render(<ProtocolSettings />)
    const input = screen.getByPlaceholderText(/the restricted wallet from step 1/i)
    type(input, GOOD)
    await act(settleLookup)
    fireEvent.click(screen.getByRole('button', { name: /^claim credit$/i }))
    return screen.getByRole('button', { name: /confirm claim/i })
  }

  it('reaches a wallet holding no admin role at all', () => {
    render(<ProtocolSettings />)
    expect(screen.getByPlaceholderText(/the restricted wallet from step 1/i)).toBeTruthy()
  })

  it('passes the real claimRecoveryConfirm output to tx.run', async () => {
    fireEvent.click(await openClaim())

    const confirm = lastConfirm()
    expect(confirm.functionName).toBe('claimRefundCreditTransfer')
    expect(confirm).toEqual(claimRecoveryConfirm({
      blacklisted: GOOD,
      balance: 250000000n,
      expiry: Number(RECENT_PROPOSED_AT) + 14 * 24 * 60 * 60
    }))
  })

  /* The claim sweeps the execution-time balance (sol:945). A mid-read submit
     would put a 0.00 Total on that, and drop the expiry line entirely. */
  it('blocks submission while the balance read is still in flight', () => {
    refundBalanceMock.current = { balance: 0n, isLoading: true, refetch: vi.fn() }
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), GOOD)
    expect(screen.getByRole('button', { name: /^claim credit$/i })).toBeDisabled()
  })

  it('blocks submission while the pending-proposal read is still in flight', () => {
    readContractMock.current = { data: undefined, isLoading: true, refetch: vi.fn() }
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), GOOD)
    expect(screen.getByRole('button', { name: /^claim credit$/i })).toBeDisabled()
  })

  /* Round 15 #1/#2: the gate now also requires a real, non-expired proposal —
     not just settled reads. Pin both new conditions at the wiring level too,
     not only in round14PhaseA.test.jsx's pure-hook tests. */
  it('blocks submission when the resolved proposal is empty (nothing pending)', async () => {
    proposedOwnerMock.current = { data: undefined, isLoading: false, refetch: vi.fn() }
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), GOOD)
    await act(settleLookup)
    expect(screen.getByRole('button', { name: /^claim credit$/i })).toBeDisabled()
  })

  it('blocks submission when the resolved proposal has expired', async () => {
    readContractMock.current = { data: BigInt(Math.floor(Date.now() / 1000) - 15 * 24 * 60 * 60), isLoading: false, refetch: vi.fn() }
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), GOOD)
    await act(settleLookup)
    expect(screen.getByRole('button', { name: /^claim credit$/i })).toBeDisabled()
  })

  /* Phase E: "resolved" now includes the debounce settling. Before the window
     elapses the reads have not been issued at all, so the button must still be
     disabled — asserted first, since that is the state the privacy change
     introduced and the gate has to cover. */
  it('allows submission once both reads have resolved', async () => {
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), GOOD)
    expect(screen.getByRole('button', { name: /^claim credit$/i })).toBeDisabled()
    await act(settleLookup)
    expect(screen.getByRole('button', { name: /^claim credit$/i })).not.toBeDisabled()
  })
})
