import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

/* Round 14 Phase A — a second Codex pass on Round 13's own recovery-panel
   fixes found two regressions and one still-incomplete finding in the code
   Round 13 itself touched:

   1/2. TWO-STAGE CONFIRM BYPASS. Round 13 (#1/#2) made the submit gate check
        `valid`/`readsPending`, but only on the button that OPENS the confirm
        panel. The field stays editable underneath the open panel, and the
        actual signing button only ever checked `tx.isBusy` — so editing the
        address (to an unread wallet, or to the zero address) after opening
        confirm slipped straight past every check Round 13 added. Fixed here
        by re-evaluating the same `valid` on the signing button too, since
        `valid` is derived fresh every render from current state rather than
        anything captured at panel-open time.

   3. Round 13 exempted wallets holding NO admin role from the role gate so
      they could still reach ClaimRecovery (claimRefundCreditTransfer has no
      onlyRole — the contract's gate is msg.sender == proposed). It missed
      the mirror case: a wallet that DOES hold some unrelated role (fee
      manager, domain manager, pauser, default admin) but is not a recovery
      manager was routed to Body, and Body only rendered RecoveryControls —
      and therefore Claim — behind isRecoveryManager. Fixed by making Claim
      unconditional inside RecoveryControls regardless of role.

   4. The claim form read `proposedOwner` off-chain but never compared it to
      the connected wallet before offering a signature — a guaranteed
      msg.sender revert if they differ, the same "pays for a revert" shape as
      the zero-address guard on the propose side (#16, Round 13). */

const runMock = vi.hoisted(() => vi.fn())
const txState = vi.hoisted(() => ({ current: { run: null, isBusy: false, status: 'idle', hash: null, error: null } }))
const authMock = vi.hoisted(() => ({ current: { address: '0x1111111111111111111111111111111111111111' } }))
const rolesMock = vi.hoisted(() => ({ current: { roles: { isRecoveryManager: true }, isLoading: false } }))
const protocolConfigMock = vi.hoisted(() => ({ current: { config: { protocolFeeBps: 199n, protocolTreasury: '0x2222222222222222222222222222222222222222', cctpForwardFee: 200000n, paused: false }, refetch: vi.fn() } }))

// Per-address fixtures, keyed lowercase, read by the wagmi/useEscrows mocks
// below. This is what lets the tests distinguish "data for A" from "data for
// B" instead of one shared mock object standing in for both.
const balances = vi.hoisted(() => ({ current: {} }))
const balanceErrors = vi.hoisted(() => ({ current: {} }))
const proposedOwners = vi.hoisted(() => ({ current: {} }))
const proposedAts = vi.hoisted(() => ({ current: {} }))
const recoveryErrors = vi.hoisted(() => ({ current: {} }))

vi.mock('../hooks/useTx.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useTx: () => ({ ...txState.current, run: runMock })
}))
vi.mock('../hooks/useAuth.jsx', () => ({ useAuth: () => authMock.current }))
vi.mock('../hooks/useEscrows.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useRefundBalance: (address) => {
    const key = address?.toLowerCase()
    if (!key) return { balance: 0n, isLoading: false, error: null, refetch: vi.fn() }
    return {
      balance: balances.current[key] ?? 0n,
      isLoading: false,
      error: balanceErrors.current[key] ?? null,
      refetch: vi.fn()
    }
  }
}))
vi.mock('../hooks/useRoles.jsx', () => ({ useRoles: () => rolesMock.current }))
vi.mock('../hooks/useArbiter.js', () => ({ useProtocolConfig: () => protocolConfigMock.current }))
vi.mock('../hooks/useSupportedDomains.js', () => ({ useSupportedDomains: () => ({ supported: [], refetch: vi.fn() }) }))
vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal()),
  // Keyed by functionName + the address argument, so the two recovery
  // getters (pendingRefundRecovery / pendingRefundRecoveryAt) can be given
  // independent, per-address values — a single shared mock object can't tell
  // "B's real reads have settled" from "A's reads are still what's cached".
  useReadContract: (opts) => {
    const enabled = !!opts?.query?.enabled
    const key = opts?.args?.[0]?.toLowerCase()
    if (!enabled || !key) return { data: undefined, isLoading: false, error: null, refetch: vi.fn() }
    if (opts.functionName === 'pendingRefundRecovery') {
      return { data: recoveryErrors.current[key] ? undefined : (proposedOwners.current[key] ?? ZERO), isLoading: false, error: recoveryErrors.current[key] ?? null, refetch: vi.fn() }
    }
    if (opts.functionName === 'pendingRefundRecoveryAt') {
      return { data: recoveryErrors.current[key] ? undefined : (proposedAts.current[key] ?? 0n), isLoading: false, error: recoveryErrors.current[key] ?? null, refetch: vi.fn() }
    }
    return { data: undefined, isLoading: false, error: null, refetch: vi.fn() }
  },
  useAccount: () => ({ address: authMock.current?.address, isConnected: true, chainId: 5042002 }),
  useConnect: () => ({ connect: vi.fn(), connectors: [] })
}))
vi.mock('../components/ConnectGate.jsx', () => ({ default: ({ children }) => children }))

const ProtocolSettings = (await import('./ProtocolSettings.jsx')).default

const ZERO = '0x0000000000000000000000000000000000000000'
const ADDR_A = '0x179cc4c8f23d257b7f4acb785464025570e3af86'
const ADDR_B = '0x4bdbe608ea998b4822476353df9dd83228ffd503'
const REPLACEMENT = '0x2Fcbb92566C51E92c1353d0a6a9AC86f10bb1a03'

const type = (el, value) => fireEvent.change(el, { target: { value } })
const lastConfirm = () => runMock.mock.calls.at(-1)?.[1]?.confirm

const RECOVERY_DEBOUNCE_MS = 400
const settleLookup = () => new Promise((r) => setTimeout(r, RECOVERY_DEBOUNCE_MS + 50))

afterEach(() => { cleanup() })

beforeEach(() => {
  runMock.mockReset()
  txState.current = { run: null, isBusy: false, status: 'idle', hash: null, error: null }
  authMock.current = { address: '0x1111111111111111111111111111111111111111' }
  rolesMock.current = { roles: { isRecoveryManager: true }, isLoading: false }
  balances.current = { [ADDR_A.toLowerCase()]: 100000000n, [ADDR_B.toLowerCase()]: 500000000n }
  balanceErrors.current = {}
  proposedOwners.current = { [ADDR_A.toLowerCase()]: ZERO, [ADDR_B.toLowerCase()]: ZERO }
  proposedAts.current = { [ADDR_A.toLowerCase()]: 0n, [ADDR_B.toLowerCase()]: 0n }
  recoveryErrors.current = {}
})

describe('#1/#2 — the propose panel re-validates at the moment of signing', () => {
  const openConfirm = async () => {
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/current credit holder/i), ADDR_A)
    type(screen.getByPlaceholderText(/\(replacement\)/i), REPLACEMENT)
    await act(settleLookup)
    fireEvent.click(screen.getByRole('button', { name: /^propose transfer$/i }))
    return screen.getByRole('button', { name: /^confirm proposal$/i })
  }

  it('blocks signing if the address is edited to one whose reads have not settled', async () => {
    const confirmBtn = await openConfirm()
    expect(confirmBtn).not.toBeDisabled()

    // Edit the field to B underneath the open confirm panel, then try to
    // sign before B's debounce/reads have caught up.
    type(screen.getByPlaceholderText(/current credit holder/i), ADDR_B)
    expect(screen.getByRole('button', { name: /^confirm proposal$/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^confirm proposal$/i }))
    expect(runMock).not.toHaveBeenCalled()
  })

  it('submits the CURRENT input once its reads settle, not what was cached when the panel opened', async () => {
    await openConfirm()
    type(screen.getByPlaceholderText(/current credit holder/i), ADDR_B)
    await act(settleLookup)

    const confirmBtn = screen.getByRole('button', { name: /^confirm proposal$/i })
    expect(confirmBtn).not.toBeDisabled()
    fireEvent.click(confirmBtn)

    expect(runMock).toHaveBeenCalledTimes(1)
    const [call] = runMock.mock.calls.at(-1)
    expect(call.args[0]).toBe(ADDR_B)
    // B's own balance (500.00), not A's stale cached balance (100.00).
    expect(lastConfirm().parameters.join('\n')).toContain('Balance today: 500.00 USDC')
  })

  it('blocks signing if the destination is edited to the zero address after confirm opens', async () => {
    await openConfirm()
    type(screen.getByPlaceholderText(/\(replacement\)/i), ZERO)
    expect(screen.getByRole('button', { name: /^confirm proposal$/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^confirm proposal$/i }))
    expect(runMock).not.toHaveBeenCalled()
  })
})

describe('#1/#2 — the claim panel re-validates at the moment of signing', () => {
  const openConfirm = async () => {
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), ADDR_A)
    await act(settleLookup)
    fireEvent.click(screen.getByRole('button', { name: /^claim credit$/i }))
    return screen.getByRole('button', { name: /^confirm claim$/i })
  }

  it('blocks signing if the address is edited to one whose reads have not settled', async () => {
    const confirmBtn = await openConfirm()
    expect(confirmBtn).not.toBeDisabled()

    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), ADDR_B)
    expect(screen.getByRole('button', { name: /^confirm claim$/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^confirm claim$/i }))
    expect(runMock).not.toHaveBeenCalled()
  })

  it('submits the CURRENT input once its reads settle, not what was cached when the panel opened', async () => {
    await openConfirm()
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), ADDR_B)
    await act(settleLookup)

    const confirmBtn = screen.getByRole('button', { name: /^confirm claim$/i })
    expect(confirmBtn).not.toBeDisabled()
    fireEvent.click(confirmBtn)

    expect(runMock).toHaveBeenCalledTimes(1)
    const [call] = runMock.mock.calls.at(-1)
    expect(call.args[0]).toBe(ADDR_B)
    expect(lastConfirm().amount).toBe(500000000n)
  })
})

describe('#2 — a failed read is not treated as a resolved-empty one', () => {
  it('propose: disables submission and surfaces a failure message rather than a false empty state', async () => {
    balanceErrors.current[ADDR_A.toLowerCase()] = new Error('RPC unavailable')
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/current credit holder/i), ADDR_A)
    type(screen.getByPlaceholderText(/\(replacement\)/i), REPLACEMENT)
    await act(settleLookup)

    expect(screen.getByRole('button', { name: /^propose transfer$/i })).toBeDisabled()
    expect(screen.getByText(/could not read this wallet's balance or pending proposal/i)).toBeTruthy()
  })

  it('claim: disables submission and surfaces a failure message rather than a false empty state', async () => {
    recoveryErrors.current[ADDR_A.toLowerCase()] = new Error('RPC unavailable')
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), ADDR_A)
    await act(settleLookup)

    expect(screen.getByRole('button', { name: /^claim credit$/i })).toBeDisabled()
    expect(screen.getByText(/could not read this wallet's balance or pending proposal/i)).toBeTruthy()
  })
})

describe('#3 — claim is reachable by any connected wallet, independent of role', () => {
  it('a wallet holding an unrelated role (fee manager, not recovery manager) still sees Claim', () => {
    rolesMock.current = { roles: { isFeeManager: true }, isLoading: false }
    render(<ProtocolSettings />)
    expect(screen.getByPlaceholderText(/the restricted wallet from step 1/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^claim credit$/i })).toBeTruthy()
  })

  it('the same wallet does NOT see Propose, which stays admin-gated', () => {
    rolesMock.current = { roles: { isFeeManager: true }, isLoading: false }
    render(<ProtocolSettings />)
    expect(screen.queryByPlaceholderText(/current credit holder/i)).toBeNull()
  })

  it('a wallet holding no admin role at all still sees Claim (unchanged fallback path)', () => {
    rolesMock.current = { roles: {}, isLoading: false }
    render(<ProtocolSettings />)
    expect(screen.getByPlaceholderText(/the restricted wallet from step 1/i)).toBeTruthy()
  })
})

describe('#4 — claim warns before signing as the wrong wallet', () => {
  it('blocks and warns when the proposal names a different wallet than the connected one', async () => {
    proposedOwners.current[ADDR_A.toLowerCase()] = ADDR_B // NOT authMock's connected address
    proposedAts.current[ADDR_A.toLowerCase()] = 1767225600n
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), ADDR_A)
    await act(settleLookup)

    expect(screen.getByRole('button', { name: /^claim credit$/i })).toBeDisabled()
    expect(screen.getByText(/not the one you're connected with/i)).toBeTruthy()
  })

  it('does not warn when the connected wallet IS the proposed nominee', async () => {
    proposedOwners.current[ADDR_A.toLowerCase()] = authMock.current.address
    proposedAts.current[ADDR_A.toLowerCase()] = 1767225600n
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), ADDR_A)
    await act(settleLookup)

    expect(screen.getByRole('button', { name: /^claim credit$/i })).not.toBeDisabled()
    expect(screen.queryByText(/not the one you're connected with/i)).toBeNull()
  })

  it('does not warn when nothing is pending (zero address reads as no proposal, not a mismatch)', async () => {
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), ADDR_A)
    await act(settleLookup)

    expect(screen.getByRole('button', { name: /^claim credit$/i })).not.toBeDisabled()
    expect(screen.queryByText(/not the one you're connected with/i)).toBeNull()
  })
})
