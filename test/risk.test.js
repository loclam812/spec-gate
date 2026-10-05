import { it } from 'node:test'
import assert from 'node:assert/strict'
import { mentionsUi, riskSignals } from '../cli/lib/risk.js'

it('an access word makes a request high risk', () => {
  assert.deepEqual(riskSignals('Let viewers delete invoices', { screens: [] }), {
    access: ['viewers'], feature: [], screens: [], ui: false, level: 'high',
  })
})

it('a screen name is a signal for risk, never for UI', () => {
  const signals = riskSignals('Checkout: show which coupon was applied', { screens: ['Checkout'] })
  assert.deepEqual([signals.screens, signals.ui, signals.level], [['checkout'], false, 'low'])
  assert.equal(mentionsUi('Add a refund dialog'), true)
  assert.equal(mentionsUi('Import orders from the CSV header'), false)
})
