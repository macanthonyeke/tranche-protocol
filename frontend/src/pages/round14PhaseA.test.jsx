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

// Real "now" in seconds, not fake timers — this file uses real timers for the
// debounce (see settleLookup). A fixed calendar date goes stale the moment
// real time passes it, which is exactly the trap the expiry fix below exists
// to catch — Round 15 #2 found this file's own fixtures had already fallen
// into it. DAY/RECOVERY_WINDOW_DAYS mirror ProtocolSettings.jsx's own
// ARBITER_WINDOW mirror (14 days, no on-chain getter).
const DAY = 24 * 60 * 60
const RECOVERY_WINDOW_DAYS = 14
const NOW = Math.floor(Date.now() / 1000)
const RECENT_PROPOSED_AT = BigInt(NOW - DAY) // well inside the 14-day window
const EXPIRED_PROPOSED_AT = BigInt(NOW - (RECOVERY_WINDOW_DAYS + 1) * DAY) // past it

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
  // Round 15 #1/#2 require a real, non-expired, matching proposal to even
  // reach the confirm panel — the outer beforeEach defaults both addresses to
  // "nothing pending" (ZERO), which is correct for #4's tests but would block
  // this bypass scenario before it gets started. Both A and B get one here
  // since the whole point of these tests is editing between the two.
  beforeEach(() => {
    proposedOwners.current = {
      [ADDR_A.toLowerCase()]: authMock.current.address,
      [ADDR_B.toLowerCase()]: authMock.current.address
    }
    proposedAts.current = {
      [ADDR_A.toLowerCase()]: RECENT_PROPOSED_AT,
      [ADDR_B.toLowerCase()]: RECENT_PROPOSED_AT
    }
  })

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
    proposedAts.current[ADDR_A.toLowerCase()] = RECENT_PROPOSED_AT
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), ADDR_A)
    await act(settleLookup)

    expect(screen.getByRole('button', { name: /^claim credit$/i })).toBeDisabled()
    expect(screen.getByText(/not the one you're connected with/i)).toBeTruthy()
  })

  it('does not warn when the connected wallet IS the proposed nominee', async () => {
    proposedOwners.current[ADDR_A.toLowerCase()] = authMock.current.address
    proposedAts.current[ADDR_A.toLowerCase()] = RECENT_PROPOSED_AT
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), ADDR_A)
    await act(settleLookup)

    expect(screen.getByRole('button', { name: /^claim credit$/i })).not.toBeDisabled()
    expect(screen.queryByText(/not the one you're connected with/i)).toBeNull()
  })

  /* Round 15 #1: this assertion had it backwards — "nothing pending" (zero
     address reads as no proposal, not a mismatch) is its own guaranteed
     revert (NoPendingRecovery, TrancheProtocol.sol:937), so the button must
     stay disabled here too. The mismatch-warning-absence half was already
     correct: a genuinely empty proposal is not "the wrong wallet", so no
     mismatch text should appear — only the disabled-state expectation was
     wrong, not the reason for it. */
  it('blocks claiming when nothing is pending, without a mismatch warning (zero address reads as no proposal)', async () => {
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), ADDR_A)
    await act(settleLookup)

    expect(screen.getByRole('button', { name: /^claim credit$/i })).toBeDisabled()
    expect(screen.queryByText(/not the one you're connected with/i)).toBeNull()
  })
})

/* Round 15 #2: claimRefundCreditTransfer also reverts RecoveryProposalExpired
   once block.timestamp passes proposedAt + ARBITER_WINDOW
   (TrancheProtocol.sol:940-942). expiryOf(proposedAt) was read only for
   display before this fix — never checked against "now" in the gate — so a
   genuinely expired proposal for the correct nominee still reached a
   guaranteed-revert signature. */
describe('#2 — claim blocks an expired proposal', () => {
  it('blocks claiming once the proposal has passed its 14-day window, even for the correct nominee', async () => {
    proposedOwners.current[ADDR_A.toLowerCase()] = authMock.current.address
    proposedAts.current[ADDR_A.toLowerCase()] = EXPIRED_PROPOSED_AT
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), ADDR_A)
    await act(settleLookup)

    expect(screen.getByRole('button', { name: /^claim credit$/i })).toBeDisabled()
    // Expired is a different reason than a mismatched nominee — the
    // mismatch-specific warning must not fire for it.
    expect(screen.queryByText(/not the one you're connected with/i)).toBeNull()
  })

  it('allows claiming a proposal that is still inside its window', async () => {
    proposedOwners.current[ADDR_A.toLowerCase()] = authMock.current.address
    proposedAts.current[ADDR_A.toLowerCase()] = RECENT_PROPOSED_AT
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), ADDR_A)
    await act(settleLookup)

    expect(screen.getByRole('button', { name: /^claim credit$/i })).not.toBeDisabled()
  })
})

/* Round 15 #3: proposeRefundCreditTransfer reverts NothingToWithdraw when
   refundBalances[blacklistedWallet] == 0 (TrancheProtocol.sol:924). A
   successfully-resolved zero balance is not a pending read — readsPending
   alone never caught it — so Propose's gate needed its own balance check,
   the same shape as the existing zero-address guard on the replacement
   field. */
describe('#3 — propose blocks a successfully-read zero balance', () => {
  it('blocks proposing when the resolved balance is genuinely zero', async () => {
    balances.current[ADDR_A.toLowerCase()] = 0n
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/current credit holder/i), ADDR_A)
    type(screen.getByPlaceholderText(/\(replacement\)/i), REPLACEMENT)
    await act(settleLookup)

    expect(screen.getByRole('button', { name: /^propose transfer$/i })).toBeDisabled()
  })

  it('allows proposing once the resolved balance is nonzero', async () => {
    balances.current[ADDR_A.toLowerCase()] = 1n
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/current credit holder/i), ADDR_A)
    type(screen.getByPlaceholderText(/\(replacement\)/i), REPLACEMENT)
    await act(settleLookup)

    expect(screen.getByRole('button', { name: /^propose transfer$/i })).not.toBeDisabled()
  })
})

/* Round 16 Phase A: a fourth Codex pass on Round 15's own expiry fix (#2
   above) found the check only covers "already expired before this render" —
   `expired` is a plain const, recomputed on every render, but nothing forces
   a render purely from time passing. A valid proposal that expires while the
   confirm panel is already open would leave the signing button looking live
   on whatever `valid` was computed to before expiry, same shape as the
   #1/#2 two-stage bypass above, just triggered by a clock instead of an
   input. Needs fake timers (unlike every other describe in this file, which
   uses real ones for the debounce) because the fix under test is itself a
   timer, and the 5-minute safety margin (RECOVERY_EXPIRY_SAFETY_MARGIN_SECONDS
   in ProtocolSettings.jsx) is too long to wait out for real. */
describe('Round 16 Phase A — expiry advances while the confirm panel is already open', () => {
  const MARGIN_S = 5 * 60
  const BASE_MS = 1_800_000_000_000 // arbitrary fixed epoch, deterministic across runs

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(BASE_MS)
    const nowSec = Math.floor(BASE_MS / 1000)
    proposedOwners.current = { [ADDR_A.toLowerCase()]: authMock.current.address }
    // Boundary (proposedAt + 14 days - margin) lands 20s after mount — long
    // enough to settle the lookup and open confirm first, short enough to
    // cross with one timer advance.
    proposedAts.current = { [ADDR_A.toLowerCase()]: BigInt(nowSec - RECOVERY_WINDOW_DAYS * DAY + MARGIN_S + 20) }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const openConfirm = async () => {
    render(<ProtocolSettings />)
    type(screen.getByPlaceholderText(/the restricted wallet from step 1/i), ADDR_A)
    await act(async () => { await vi.advanceTimersByTimeAsync(RECOVERY_DEBOUNCE_MS + 50) })
    fireEvent.click(screen.getByRole('button', { name: /^claim credit$/i }))
    return screen.getByRole('button', { name: /^confirm claim$/i })
  }

  it('disables the confirm button at the exact instant expiry crosses, not just eventually afterward', async () => {
    const confirmBtn = await openConfirm()
    expect(confirmBtn).not.toBeDisabled()

    // openConfirm() already advanced the clock by RECOVERY_DEBOUNCE_MS + 50
    // (450ms) settling the lookup, and the boundary sits at BASE_MS + 20s —
    // so advancing by exactly 19,550ms more lands the mocked clock AT the
    // margin-adjusted boundary, not generously past it. That distinction
    // matters: Round 17 Phase B found the proactive timer's setTimeout
    // fires at precisely this instant (remaining reaches 0 the moment
    // Date.now() reaches the boundary), but isRecoveryExpired used to be a
    // strict `>` — so the timer fired here while `expired` still read
    // false, and the button stayed enabled until a LATER render caught up.
    // Overshooting the boundary (the old 25,000ms advance) can't catch that
    // gap: it never exercises the exact-equality instant at all.
    await act(async () => { await vi.advanceTimersByTimeAsync(19_550) })

    expect(screen.getByRole('button', { name: /^confirm claim$/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^confirm claim$/i }))
    expect(runMock).not.toHaveBeenCalled()
  })

  it('blocks the click-time recheck even when the proactive timer has not fired yet', async () => {
    const confirmBtn = await openConfirm()
    expect(confirmBtn).not.toBeDisabled()

    // Jump the clock past the boundary WITHOUT running any timers, so the
    // component's own setTimeout has not fired and `valid`/`disabled` are
    // still whatever they were computed to before the jump — isolates the
    // click-handler's fresh-Date.now() recheck from the proactive-disable
    // timer, which is a UI nicety, not the safety mechanism.
    vi.setSystemTime(BASE_MS + 25_000)

    fireEvent.click(screen.getByRole('button', { name: /^confirm claim$/i }))
    expect(runMock).not.toHaveBeenCalled()
  })

  it('still allows claiming comfortably inside the window', async () => {
    const confirmBtn = await openConfirm()
    fireEvent.click(confirmBtn)
    expect(runMock).toHaveBeenCalledTimes(1)
  })
})
