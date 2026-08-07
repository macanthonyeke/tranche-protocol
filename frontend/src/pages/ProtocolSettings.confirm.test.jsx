import { describe, it, expect } from 'vitest'

/* First CONFIG-CHANGE descriptor in the app, so these tests are as much about
   the template's shape as about pause itself: no amount, and an old → new line
   standing in for the figure a value-moving screen would carry.

   The hazard specific to this pair is direction. PauseControl renders its two
   buttons from a ternary on the same `isPaused` flag, so a descriptor wired to
   the wrong branch would say "Pause new deposits" on a call to unpause. */
import { pauseConfirm } from './ProtocolSettings.jsx'
import { buildContractInteraction } from '../utils/circleTheme.js'

const paramText = (d) => (d.parameters || []).join('\n')

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
