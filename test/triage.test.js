import { it } from 'node:test'
import assert from 'node:assert/strict'
import { mentionsUi, triage } from '../cli/lib/triage.js'

const cases = [
  ['Update the German translation for the checkout button', 't0'],
  ['sửa bản dịch tiếng Đức cho nút thanh toán', 't0'],
  ['fix typo in README', 't0'],
  ['Add a refund dialog with an approval flow for admins', 't2'],
  ['thêm màn hình hoàn tiền có phân quyền', 't2'],
  ['Translate the labels of the new refund dialog', 't1'],
  ['Return 404 instead of 500 when the order is missing', 't1'],
  ['dịch vụ thanh toán trả về lỗi 500', 't1'],
  ['statement totals are off by one cent', 't1'],
  // Boundary cases: a small diff that changes who may do what is never a T0 or a T1.
  ['Let viewers delete invoices (one-line change)', 't2'],
  ['Only admins may export reports', 't2'],
  ['Change the config so guests can see prices', 't2'],
  ['cho phép người xem xoá hoá đơn', 't2'],
  ['Rename the variable total to sum', 't0'],
  ['Update the wording of the delete button', 't0'],
]

for (const [request, tier] of cases) {
  it(`${request} -> ${tier}`, () => assert.equal(triage(request).tier, tier))
}

it('every decision carries its reason', () => {
  assert.deepEqual(triage('fix typo in README').reasons, ['signals: typo, readme'])
  assert.deepEqual(triage('Return 404 when the order is missing').reasons, ['no decisive signal'])
})

it('an override wins, and an unknown tier is rejected', () => {
  assert.deepEqual(triage('fix typo in README', { override: 't2' }), { tier: 't2', reasons: ['user override'] })
  assert.throws(() => triage('x', { override: 't9' }), /--tier must be one of t0, t1, t2/)
})

it('a screen the repository has counts as a T2 and UI signal', () => {
  const screens = ['Shop', 'Opponent Select']
  const request = 'Shop: after opening a chest, show the set it came from'
  assert.deepEqual(triage(request, { screens }), { tier: 't2', reasons: ['signals: shop'] })
  assert.equal(triage('pick an opponent select by tier', { screens }).tier, 't2')
  assert.equal(triage(request).tier, 't1')
  assert.equal(mentionsUi(request, screens), true)
  assert.equal(mentionsUi(request), false)
})

it('an access signal wins over a T0 signal instead of meeting it halfway', () => {
  assert.deepEqual(triage('Change the config so guests can see prices'), { tier: 't2', reasons: ['access: guests'] })
})
