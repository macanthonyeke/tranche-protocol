// ArbiterDeliveryStatus — Round 32 (Low finding).
//
// This unconditionally blamed a low forwarding fee for EVERY FAILED
// delivery, regardless of errorCode — misleading for any other failure
// reason Circle's forwardErrorCode might report. EscrowDetail.jsx's
// equivalent UI (errorIsInsufficientFee, see its own CrossChainDelivery /
// SelfRelayCard) already conditions this copy on errorCode ===
// 'INSUFFICIENT_FEE'; this brings ArbiterPanel's copy in line with that
// already-correct pattern.
//
// Same rendering approach as EscrowDetail.crossChainDelivery.test.jsx:
// render ArbiterDeliveryStatus directly against a controlled `deliveries`
// fixture (mocking useCctpDelivery), rather than driving the whole
// ArbiterPanel/DisputeBlock tree.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const cctpDeliveryMock = vi.hoisted(() => ({ current: { phase: 'idle', deliveries: [] } }))
vi.mock('../hooks/useCctpDelivery.js', () => ({
  useCctpDelivery: () => cctpDeliveryMock.current
}))

const { ArbiterDeliveryStatus } = await import('./ArbiterPanel.jsx')

const BASE = 6 // Base Sepolia

const failedMsg = (errorCode) => ({
  message: '0xmsg', attestation: '0xatt',
  destinationDomain: BASE, destinationTxHash: null,
  forwardState: 'FAILED', errorCode
})

const setDeliveries = (phase, deliveries) => { cctpDeliveryMock.current = { phase, deliveries } }

beforeEach(() => {
  cctpDeliveryMock.current = { phase: 'idle', deliveries: [] }
})

afterEach(() => {
  cleanup()
})

const renderStatus = () => render(
  <ArbiterDeliveryStatus txHash="0xtx" isCrossChain expectedOrdinals={[0]} expectedTotalMessages={1} />
)

describe('ArbiterDeliveryStatus — failure copy is conditioned on errorCode, not blanket-attributed to a low fee', () => {
  it('shows the "forwarding fee was too low" copy when errorCode is genuinely INSUFFICIENT_FEE', () => {
    setDeliveries('failed', [failedMsg('INSUFFICIENT_FEE')])
    renderStatus()
    expect(screen.getByText(/forwarding fee was too low/)).toBeInTheDocument()
  })

  it('does NOT show the "forwarding fee was too low" copy for a different errorCode', () => {
    setDeliveries('failed', [failedMsg('SOME_OTHER_REASON')])
    renderStatus()
    expect(screen.queryByText(/forwarding fee was too low/)).not.toBeInTheDocument()
    expect(screen.getByText(/Delivery to Base Sepolia failed/)).toBeInTheDocument()
  })

  it('does NOT show the "forwarding fee was too low" copy when errorCode is null', () => {
    setDeliveries('failed', [failedMsg(null)])
    renderStatus()
    expect(screen.queryByText(/forwarding fee was too low/)).not.toBeInTheDocument()
    expect(screen.getByText(/Delivery to Base Sepolia failed/)).toBeInTheDocument()
  })

  it('still points the recipient to self-relay via the escrow detail page either way', () => {
    setDeliveries('failed', [failedMsg('SOME_OTHER_REASON')])
    renderStatus()
    expect(screen.getByText(/self-relay via the escrow detail page/)).toBeInTheDocument()
  })
})
