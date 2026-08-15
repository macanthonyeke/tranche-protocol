import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const authMock = vi.hoisted(() => ({ current: null }))
const executeContractCall = vi.hoisted(() => vi.fn())
const writeContractAsync = vi.hoisted(() => vi.fn())
const switchChainAsync = vi.hoisted(() => vi.fn())
const accountMock = vi.hoisted(() => ({ current: { chainId: 5042002 } }))
const txToast = vi.hoisted(() => vi.fn(() => ({ update: vi.fn(), success: vi.fn(), error: vi.fn() })))

vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal()),
  useWriteContract: () => ({ writeContractAsync }),
  useSwitchChain: () => ({ switchChainAsync }),
  useAccount: () => accountMock.current,
  useWaitForTransactionReceipt: () => ({ data: undefined, isError: false, error: null })
}))

vi.mock('../hooks/useAuth.jsx', () => ({
  useAuth: () => authMock.current
}))

vi.mock('../hooks/useToast.jsx', () => ({ txToast }))

const { ReviewSection } = await import('./CreateEscrow.jsx')
const { useTx } = await import('../hooks/useTx.js')
const {
  TransactionConfirmHost,
  __resetConfirmationForTests
} = await import('../hooks/useTransactionConfirm.js')
const { CONTRACT_ADDRESS } = await import('../config/contract.js')
const { ARC_DOMAIN } = await import('../config/chains.js')

const PAYER = '0x1111111111111111111111111111111111111111'
const FREELANCER = '0x2222222222222222222222222222222222222222'
const REQUEST = {
  address: CONTRACT_ADDRESS,
  abi: [{ type: 'function', name: 'pause', stateMutability: 'nonpayable', inputs: [], outputs: [] }],
  functionName: 'pause',
  args: []
}
const ACTION_INPUT = {
  request: REQUEST,
  descriptor: {
    title: 'Lock funds into escrow',
    subtitle: 'Moves USDC into the escrow contract.',
    contractName: 'Tranche Protocol Escrow',
    contractAddress: CONTRACT_ADDRESS,
    functionName: 'pause',
    parameters: ['CreateEscrow regression action']
  }
}

function CompareCreateEscrowHarness() {
  const depositTx = useTx()
  const onDeposit = () => { depositTx.run(ACTION_INPUT).catch(() => {}) }

  return (
    <>
      <ReviewSection
        state={{
          freelancer: FREELANCER,
          destinationDomain: ARC_DOMAIN,
          invoice: { status: 'idle' },
          milestones: [{ title: 'Upfront payment', customTitle: '', amount: '1' }]
        }}
        totalBaseUnits={1000000n}
        errors={{}}
        approved
        approveTx={{ isBusy: false }}
        depositTx={depositTx}
        onApprove={vi.fn()}
        onDeposit={onDeposit}
        address={PAYER}
        allowanceLoading={false}
        allowanceIsError={false}
        refetchAllowance={vi.fn()}
        usdcBalance={5000000n}
        balanceLoading={false}
        envelopePinning={false}
        envelopeError=""
        onJump={vi.fn()}
      />
      <TransactionConfirmHost />
    </>
  )
}

let root

beforeEach(() => {
  vi.stubEnv('VITE_UCW_CONFIRM_MODE', 'compare')
  authMock.current = {
    isSca: true,
    address: PAYER,
    walletId: 'wallet-1',
    executeContractCall
  }
  executeContractCall.mockReset()
  executeContractCall.mockResolvedValue({ challengeId: 'challenge-1', userToken: 'test-token' })
  writeContractAsync.mockReset()
  switchChainAsync.mockReset()
  accountMock.current = { chainId: 5042002 }
  txToast.mockClear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ txHash: `0x${'ab'.repeat(32)}` })
  }))
  root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  __resetConfirmationForTests()
})

afterEach(() => {
  cleanup()
  root?.remove()
  __resetConfirmationForTests()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('CreateEscrow compare-mode modal handoff', () => {
  it('makes the global review the only active modal and waits for continuation before Circle', async () => {
    render(<CompareCreateEscrowHarness />, { container: root })

    fireEvent.click(screen.getByRole('button', { name: 'Lock funds' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign and lock' }))

    const continueButton = screen.getByRole('button', { name: 'Continue to Circle confirmation' })
    expect(continueButton).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign and lock' })).not.toBeInTheDocument()
    expect(screen.queryByText('Check your wallet')).not.toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(executeContractCall).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()

    fireEvent.click(continueButton)
    await waitFor(() => expect(executeContractCall).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/wallet/tx-status', expect.anything())
  })
})
