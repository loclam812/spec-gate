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

it('access words decide high risk even next to a copy-change word, in English and Vietnamese', () => {
  assert.deepEqual(riskSignals('Change the config so guests can see prices', { screens: [] }).access, ['guests'])
  assert.equal(riskSignals('Only admins may export reports', { screens: [] }).level, 'high')
  const vietnamese = riskSignals('cho phép người xem xoá hoá đơn', { screens: [] })
  assert.deepEqual([vietnamese.access, vietnamese.level], [['cho phép', 'người xem'], 'high'])
})

it('words that merely contain a signal stay low risk', () => {
  for (const request of ['statement totals are off by one cent', 'Return 404 instead of 500 when the order is missing', 'dịch vụ thanh toán trả về lỗi 500', 'Rename the variable total to sum']) {
    assert.equal(riskSignals(request, { screens: [] }).level, 'low', request)
  }
})

it('a screen of the repository is found in lower case inside the request', () => {
  const signals = riskSignals('sort the order summary by date', { screens: ['Checkout', 'Order Summary'] })
  assert.deepEqual(signals.screens, ['order summary'])
})
