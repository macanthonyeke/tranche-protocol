import { describe, it, expect } from 'vitest'

/* First CONFIG-CHANGE descriptor in the app, so these tests are as much about
   the template's shape as about pause itself: no amount, and an old → new line
   standing in for the figure a value-moving screen would carry.

   The hazard specific to this pair is direction. PauseControl renders its two
   buttons from a ternary on the same `isPaused` flag, so a descriptor wired to
   the wrong branch would say "Pause new deposits" on a call to unpause. */
import {
  pauseConfirm, protocolFeeConfirm, protocolTreasuryConfirm,
  cctpForwardFeeConfirm, domainConfirm
} from './ProtocolSettings.jsx'
import { buildContractInteraction } from '../utils/circleTheme.js'

const paramText = (d) => (d.parameters || []).join('\n')

const SNAPSHOT_LINE = 'Applies to escrows created after this transaction. Escrows that already exist keep the value they snapshotted at deposit.'
const OLD_TREASURY = '0x2fcbb92566c51e92c1353d0a6a9ac86f10bb1a03'
const NEW_TREASURY = '0x179cc4c8f23d257b7f4acb785464025570e3af86'

describe.each([
  ['pausing', false, 'pause', 'Deposits: Active → Paused'],
  ['unpausing', true, 'unpause', 'Deposits: Paused → Active']
])('pauseConfirm — %s', (_label, paused, fn, transition) => {
  const d = () => pauseConfirm({ paused })

  /* CONFIG-CHANGE moves nothing. buildContractInteraction only omits the
     currency row when amount is absent, so this is the property that keeps a
     "0.00 USDC" Total off an admin screen. */
  it('carries no amount and renders no currency row', () => {
    expect(d()).not.toHaveProperty('amount')
    const built = buildContractInteraction(d())
    expect(built).not.toHaveProperty('mainCurrency')
    expect(built).not.toHaveProperty('total')
    expect(built).not.toHaveProperty('totalLabel')
  })

  it('states the change as old → new', () => {
    expect(d().parameters).toContain(transition)
  })

  /* The direction check: title and function name have to agree, or the screen
     describes the opposite of the call being signed. */
  it('calls the function its title describes', () => {
    expect(d().functionName).toBe(fn)
    expect(d().title.toLowerCase()).toContain(paused ? 'resume' : 'pause')
  })

  it('says the change is protocol-wide, not escrow-scoped', () => {
    expect(paramText(d()).toLowerCase()).toMatch(/protocol|whole protocol/)
  })
})

describe('pauseConfirm — what pausing actually blocks', () => {
  /* Verified against the contract: deposit() is the only function carrying
     whenNotPaused, so this claim is true today. It is stated on the signing
     screen, which makes it a claim worth pinning — if the modifier is ever
     added elsewhere, this test is where the copy stops matching the code. */
  it('promises that only deposits are blocked', () => {
    const d = pauseConfirm({ paused: false })
    expect(d.parameters).toContain('Only new deposits are blocked — release, refund and dispute paths stay open.')
    expect(paramText(d)).toContain('Existing escrows carry on as normal.')
  })

  it('does not repeat the settlement-paths promise when resuming', () => {
    expect(paramText(pauseConfirm({ paused: true }))).not.toMatch(/dispute paths stay open/)
  })

  it('reassures that escrowed money is untouched', () => {
    expect(pauseConfirm({ paused: false }).subtitle).toMatch(/not affected/i)
  })
})

describe('pauseConfirm — the two directions are not interchangeable', () => {
  const off = pauseConfirm({ paused: false })
  const on = pauseConfirm({ paused: true })

  it('differ in title, subtitle, function and transition line', () => {
    expect(off.title).not.toBe(on.title)
    expect(off.subtitle).not.toBe(on.subtitle)
    expect(off.functionName).not.toBe(on.functionName)
    expect(paramText(off)).not.toBe(paramText(on))
  })

  it('never shows a transition into the state it is already in', () => {
    expect(paramText(off)).not.toContain('Deposits: Paused → Active')
    expect(paramText(on)).not.toContain('Deposits: Active → Paused')
  })
})

/* ---------- The five config setters ----------
   All five are CONFIG-CHANGE, but they are not five copies of the same
   old → new line. Two carry a consequence the template does not express on
   its own, and those are the ones these tests concentrate on. */

const ALL_SETTERS = [
  ['protocol fee', () => protocolFeeConfirm({ currentBps: 199n, newBps: 300n }), 'setProtocolFee'],
  ['treasury', () => protocolTreasuryConfirm({ currentTreasury: OLD_TREASURY, newTreasury: NEW_TREASURY }), 'setProtocolTreasury'],
  ['CCTP fee', () => cctpForwardFeeConfirm({ currentFee: 200000n, newFee: 350000n }), 'setCctpForwardFee'],
  ['remove domain', () => domainConfirm({ domain: 6, domainName: 'Base Sepolia', enabled: true }), 'removeSupportedDomain'],
  ['add domain', () => domainConfirm({ domain: 6, domainName: 'Base Sepolia', enabled: false }), 'addSupportedDomain']
]

describe.each(ALL_SETTERS)('CONFIG-CHANGE shape — %s', (_label, build, fn) => {
  it('carries no amount and renders no currency row', () => {
    expect(build()).not.toHaveProperty('amount')
    const built = buildContractInteraction(build())
    expect(built).not.toHaveProperty('mainCurrency')
    expect(built).not.toHaveProperty('total')
    expect(built).not.toHaveProperty('totalLabel')
  })

  it('states the change as old → new', () => {
    expect(paramText(build())).toMatch(/ → /)
  })

  it('names the function it actually calls', () => {
    expect(build().functionName).toBe(fn)
  })
})

describe('protocolFeeConfirm', () => {
  const d = () => protocolFeeConfirm({ currentBps: 199n, newBps: 300n })

  it('shows both the percentage and the raw bps', () => {
    expect(paramText(d())).toContain('Protocol fee: 1.99% (199 bps) → 3.00% (300 bps)')
  })

  /* escrowFeeBps is snapshotted at deposit (TrancheProtocol.sol:348), so this
     cannot reach an existing escrow. Worth stating — an admin has no other way
     to know from the signing screen. */
  it('says in-flight escrows keep their snapshot', () => {
    expect(paramText(d())).toContain(SNAPSHOT_LINE)
  })

  it('survives an unloaded current value', () => {
    expect(paramText(protocolFeeConfirm({ currentBps: undefined, newBps: 300n })))
      .toContain('Protocol fee: unknown → 3.00% (300 bps)')
  })
})

describe('protocolTreasuryConfirm', () => {
  const d = () => protocolTreasuryConfirm({ currentTreasury: OLD_TREASURY, newTreasury: NEW_TREASURY })

  it('shows both addresses in full', () => {
    expect(paramText(d())).toContain(`Treasury: ${OLD_TREASURY} → ${NEW_TREASURY}`)
  })

  /* The consequence that runs opposite to the obvious reading. Fees are paid
     to escrowTreasury[escrowId], the per-escrow snapshot (:621, :1269), so
     changing the global does NOT stop money reaching the old address —
     in-flight escrows keep paying it on release. Anyone rotating a compromised
     treasury needs to know that before they sign, not after. */
  /* Phase B #8 corrected this: "the current address" was itself wrong.
     escrowTreasury is per-escrow (:345, paid :1269), so after two rotations the
     oldest escrows still pay the OLDEST address — not whatever is current. */
  it('attributes in-flight fees to each escrow own snapshot, not to the current address', () => {
    expect(paramText(d())).toContain(
      'This does not stop fees already owed. Each in-flight escrow pays whichever treasury address was set at its own deposit — which may be an older address than the one shown above.'
    )
  })

  it('does not imply the redirect is total', () => {
    expect(d().subtitle).toMatch(/keeps paying the address it snapshotted when it was funded/i)
  })

  /* The fee and CCTP-fee screens are plain value swaps; only treasury carries
     the still-being-paid warning, so it must not leak into the others. */
  it('is the only setter carrying that warning', () => {
    for (const [label, build] of ALL_SETTERS) {
      if (label === 'treasury') continue
      expect(paramText(build())).not.toMatch(/does not stop fees/)
    }
  })
})

describe('cctpForwardFeeConfirm', () => {
  const d = () => cctpForwardFeeConfirm({ currentFee: 200000n, newFee: 350000n })

  it('shows both values as USDC rather than base units', () => {
    expect(paramText(d())).toContain('CCTP forwarding fee: 0.20 USDC → 0.35 USDC')
  })

  /* Not cosmetic: permissionless release() burns at the escrow's snapshotted
     fee and ignores the caller's live quote, so a floor below Circle's real
     fee leaves those burns attested but never minted (INSUFFICIENT_FEE). */
  it('warns that a floor below Circle’s live fee breaks auto-delivery', () => {
    expect(paramText(d())).toMatch(/permissionless releases will not auto-deliver/)
  })

  it('says in-flight escrows keep their snapshot', () => {
    expect(paramText(d())).toContain(SNAPSHOT_LINE)
  })
})

describe('domainConfirm — removing', () => {
  const d = () => domainConfirm({ domain: 6, domainName: 'Base Sepolia', enabled: true })

  it('names the chain and the domain number, in the removing direction', () => {
    expect(d().title).toBe('Stop accepting Base Sepolia')
    expect(paramText(d())).toContain('Base Sepolia (domain 6): Accepted → Not accepted')
  })

  /* The release paths never consult supportedDomains, so escrows already bound
     for this chain still deliver. Saying otherwise would scare an admin off a
     safe action. */
  it('reassures that in-flight escrows to this chain still deliver', () => {
    expect(paramText(d())).toContain('Escrows already heading to this chain still release and deliver normally.')
  })

  /* But three paths DO consult it (:255/:264 deposit, :866 cross-chain refund
     withdrawal, :975/:1027 payout redirect). The refund-withdrawal one is the
     quiet casualty — someone holding a credit loses that route with no warning
     anywhere else in the UI. */
  it('lists what removal actually blocks, including refund withdrawals', () => {
    expect(paramText(d())).toMatch(/Blocks new escrows to this chain/)
    expect(paramText(d())).toMatch(/cross-chain refund withdrawals to it/)
    expect(paramText(d())).toMatch(/redirecting a payout to it/)
  })
})

describe('domainConfirm — adding', () => {
  const d = () => domainConfirm({ domain: 6, domainName: 'Base Sepolia', enabled: false })

  it('names the chain and the domain number, in the adding direction', () => {
    expect(d().title).toBe('Start accepting Base Sepolia')
    expect(paramText(d())).toContain('Base Sepolia (domain 6): Not accepted → Accepted')
  })

  /* Adding is not removal with the arrow reversed: none of removal's
     consequences apply, and repeating them would be noise at best and
     misleading at worst. */
  it('does not carry removal’s blocking language', () => {
    expect(paramText(d())).not.toMatch(/Blocks new escrows/)
    expect(paramText(d())).not.toMatch(/still release and deliver normally/)
  })
})

describe('the two domain directions are not interchangeable', () => {
  const off = domainConfirm({ domain: 6, domainName: 'Base Sepolia', enabled: false })
  const on = domainConfirm({ domain: 6, domainName: 'Base Sepolia', enabled: true })

  it('differ in title, function and transition line', () => {
    expect(off.title).not.toBe(on.title)
    expect(off.functionName).not.toBe(on.functionName)
    expect(paramText(off)).not.toBe(paramText(on))
  })

  it('never shows a transition into the state it is already in', () => {
    expect(paramText(off)).not.toContain('Accepted → Not accepted')
    expect(paramText(on)).not.toContain('Not accepted → Accepted')
  })
})
