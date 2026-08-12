// CrossChainDelivery — Round 20 Phase D.
//
// The most severe finding this round: a mixed split settlement can burn
// multiple CCTP messages to DIFFERENT chains in one transaction, and the old
// design collapsed all of that down to one aggregate `phase` string and one
// outer `destinationDomain` value. Two concrete failures followed:
//   1. If one leg failed while a DIFFERENT leg had already delivered, the
//      whole block rendered as "failed" and the delivered leg's confirmation
//      never appeared at all.
//   2. The recovery card for a failed leg read the OUTER (wrong) domain for
//      which chain to switch to and which MessageTransmitterV2 to call —
//      a broken recovery action, not just inaccurate copy.
// These tests render CrossChainDelivery directly against a controlled
// `deliveries` fixture (mocking useCctpDelivery) to prove both are fixed,
// plus the tracker-cleanup interaction: a relay never flips Iris's own
// forwardState, so the shared tracker key must survive one leg being
// self-relayed while another is still failed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const cctpDeliveryMock = vi.hoisted(() => ({ current: { phase: 'idle', deliveries: [] } }))
vi.mock('../hooks/useCctpDelivery.js', () => ({
  useCctpDelivery: () => cctpDeliveryMock.current
}))
vi.mock('../hooks/useAuth.jsx', () => ({
  useAuth: () => ({ address: '0x179cc4c8f23d257b7f4acb785464025570e3af86' })
}))

const { CrossChainDelivery } = await import('./EscrowDetail.jsx')

const BASE = 6   // Base Sepolia
const ETH = 0    // Ethereum Sepolia

const completeMsg = (domain, txHash) => ({
  message: '0xmsg', attestation: '0xatt',
  destinationDomain: domain, destinationTxHash: txHash,
  forwardState: 'COMPLETE', errorCode: null
})
const failedMsg = (domain) => ({
  message: '0xmsg', attestation: '0xatt',
  destinationDomain: domain, destinationTxHash: null,
  forwardState: 'FAILED', errorCode: 'INSUFFICIENT_FEE'
})

const setDeliveries = (phase, deliveries) => { cctpDeliveryMock.current = { phase, deliveries } }

let removeItemSpy

beforeEach(() => {
  removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem')
  cctpDeliveryMock.current = { phase: 'idle', deliveries: [] }
})

afterEach(() => {
  cleanup()
  removeItemSpy.mockRestore()
})

const renderTracker = () => render(
  <CrossChainDelivery txHash="0xtx" isCrossChain escrowId={7} milestoneIndex={1} />
)

describe('a delivered leg stays visible even when a DIFFERENT leg in the same settlement failed', () => {
  it('renders both the delivered confirmation and the failed leg\'s recovery card at once', () => {
    setDeliveries('failed', [completeMsg(BASE, '0xdesttx'), failedMsg(ETH)])
    renderTracker()

    expect(screen.getByText(/Delivered to Base Sepolia/)).toBeInTheDocument()
    expect(screen.getByText(/Delivery failed/)).toBeInTheDocument()
  })
})

describe('the recovery card reads the FAILED message\'s own domain, not a different leg\'s domain', () => {
  it('names the failed leg\'s chain (Ethereum Sepolia), not the delivered leg\'s chain (Base Sepolia)', () => {
    setDeliveries('failed', [completeMsg(BASE, '0xdesttx'), failedMsg(ETH)])
    renderTracker()

    expect(screen.getByText(/Switch your wallet to/)).toBeInTheDocument()
    expect(screen.getByText('Ethereum Sepolia', { selector: 'span' })).toBeInTheDocument()
    // The delivered leg's own chain name appears too (in its own line), but
    // the recovery instructions must not also claim Base Sepolia.
    const switchLine = screen.getByText(/Switch your wallet to/).closest('p')
    expect(switchLine.textContent).toContain('Ethereum Sepolia')
    expect(switchLine.textContent).not.toContain('Base Sepolia')
  })

  it('reverses correctly when the FAILED leg is on Base and the delivered leg is on Ethereum — proving this is not a lucky fixed ordering', () => {
    setDeliveries('failed', [completeMsg(ETH, '0xdesttx'), failedMsg(BASE)])
    renderTracker()

    const switchLine = screen.getByText(/Switch your wallet to/).closest('p')
    expect(switchLine.textContent).toContain('Base Sepolia')
    expect(switchLine.textContent).not.toContain('Ethereum Sepolia')
  })
})

describe('two simultaneously-failed legs on different chains both get their own recovery card', () => {
  it('renders two independent "Delivery failed" cards, each naming its own chain', () => {
    setDeliveries('failed', [failedMsg(BASE), failedMsg(ETH)])
    renderTracker()

    const cards = screen.getAllByText(/Delivery failed/)
    expect(cards).toHaveLength(2)
    expect(screen.getAllByText(/Switch your wallet to/)).toHaveLength(2)
    expect(screen.getByText('Base Sepolia', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('Ethereum Sepolia', { selector: 'span' })).toBeInTheDocument()
  })
})

describe('tracker cleanup: only clears the shared key once every message is genuinely COMPLETE', () => {
  it('does NOT clear the tracker when two legs are FAILED, even though one may have already been self-relayed by hand', () => {
    // A manual self-relay never flips Iris's own forwardState — so "one
    // relayed" is indistinguishable from "neither relayed" at this layer,
    // by design. The tracker (and the still-failed leg's card) must survive.
    setDeliveries('failed', [failedMsg(BASE), failedMsg(ETH)])
    renderTracker()

    expect(removeItemSpy).not.toHaveBeenCalled()
    // The still-failed leg's card is still reachable — proving the tracker
    // surviving actually keeps something alive, not just an unused key.
    expect(screen.getAllByText(/Delivery failed/)).toHaveLength(2)
  })

  it('does NOT clear the tracker while one leg is still FAILED and another is COMPLETE', () => {
    setDeliveries('failed', [completeMsg(BASE, '0xdesttx'), failedMsg(ETH)])
    renderTracker()
    expect(removeItemSpy).not.toHaveBeenCalled()
  })

  it('clears the tracker once every leg has genuinely reached COMPLETE', () => {
    setDeliveries('delivered', [completeMsg(BASE, '0xdesttx1'), completeMsg(ETH, '0xdesttx2')])
    renderTracker()
    expect(removeItemSpy).toHaveBeenCalledWith('cctp-track-7-1')
  })
})

describe('an Iris-omitted domain renders honestly instead of guessing a wrong chain', () => {
  it('shows "an unknown chain" rather than defaulting to some other message\'s domain', () => {
    setDeliveries('failed', [failedMsg(null)])
    renderTracker()
    expect(screen.getByText(/Switch your wallet to/).closest('p').textContent).toContain('an unknown chain')
  })
})
