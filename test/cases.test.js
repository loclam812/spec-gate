import { it } from 'node:test'
import assert from 'node:assert/strict'
import { casesDocErrors, readySummary } from '../cli/lib/cases.js'

const DOC = {
  ui: false,
  sentences: [{ id: 'S1', text: 'Refunds need approval.', cases: ['C1', 'C2'] }],
  cases: [
    { id: 'C1', when: 'a refund is requested', then: 'it waits for approval', basis: 'request', risk: 'high', layer: 'unit' },
    { id: 'C2', when: 'the refund is for 0', then: 'it is refused', basis: 'assumed', risk: 'low', layer: 'unit' },
  ],
  questions: [],
}
const CONTEXT = { sentenceIds: ['S1'], uiRequest: false, uxSourceAgreed: false }

it('a complete cases document has no errors', () => {
  assert.deepEqual(casesDocErrors(DOC, CONTEXT), [])
})

it('every sentence needs a case or a reason, every case needs when, then, basis, risk and layer', () => {
  const broken = {
    ...DOC,
    sentences: [{ id: 'S1', text: 'x', cases: ['C9'] }],
    cases: [{ id: 'C1', when: '', then: 'y', basis: 'code', risk: 'medium', layer: 'unit' }],
  }
  assert.deepEqual(casesDocErrors(broken, CONTEXT), [
    'sentence S1 refers to unknown case C9',
    'case C1 needs both when and then',
    'case C1: basis must be request, decision or assumed',
    'case C1: risk must be high or low',
  ])
})

it('only non_testable sentences, and more than 30 cases, are refused', () => {
  const none = { ...DOC, sentences: [{ id: 'S1', text: 'x', non_testable: 'thanks' }], cases: [] }
  assert.deepEqual(casesDocErrors(none, CONTEXT), ['cases: the request has nothing to test; write at least one case'])
  const many = { ...DOC, cases: Array.from({ length: 31 }, (_, i) => ({ ...DOC.cases[0], id: `C${i + 1}` })) }
  assert.match(casesDocErrors(many, CONTEXT).join('\n'), /cases: 31 cases; keep the 30 riskiest/)
})

it('Ready lists only assumed and decision cases and counts the rest', () => {
  const text = readySummary(DOC, { casesPath: '/run/cases.yaml' })
  assert.match(text, /## Check these\n\n- C2 \(assumed, low\): when the refund is for 0, then it is refused/)
  assert.match(text, /1 case straight from the request\. All cases: \/run\/cases\.yaml/)
  assert.doesNotMatch(text, /it waits for approval/)
})
