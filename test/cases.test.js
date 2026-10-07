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

it('more than four questions are refused', () => {
  const questions = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'].map((id) => ({ id, text: 'x', about: 'rule' }))
  assert.deepEqual(casesDocErrors({ ...DOC, questions }, CONTEXT), ['questions: 5 questions; ask at most 4 per round, the riskiest first'])
})

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

it('Ready lists only assumed cases and counts the rest by where they came from', () => {
  const decided = { id: 'C3', when: 'a refund is asked twice', then: 'the second is refused', basis: 'decision', risk: 'high', layer: 'unit' }
  const text = readySummary({ ...DOC, cases: [...DOC.cases, decided] }, { casesPath: '/run/cases.yaml' })
  assert.match(text, /## Check these\n\n- C2 \(assumed, low\): when the refund is for 0, then it is refused\n\n/)
  assert.doesNotMatch(text, /C3 \(decision/)
  assert.match(text, /1 case straight from the request, 1 from your answers\. All cases: \/run\/cases\.yaml/)
  assert.doesNotMatch(text, /it waits for approval/)
})

const withSource = (source, context = CONTEXT) =>
  casesDocErrors({ ...DOC, ui: true, ux: { source, screens: ['refund dialog'], states: ['error'] } }, { ...context, uiRequest: true })

it('a UX source has a known form, and none-agreed needs the user to have said so', () => {
  for (const source of ['figma:https://example.test/file/1', 'screenshot:docs/refund.png', 'existing-screen:/orders/:id']) {
    assert.deepEqual(withSource(source), [], source)
  }
  assert.deepEqual(withSource('TBD'), ['ux.source: use figma:<url>, screenshot:<path>, existing-screen:<route> or none-agreed'])
  assert.deepEqual(withSource('none-agreed'), ["ux.source: none-agreed needs the user's answer to a question with about: ux-source"])
  assert.deepEqual(withSource('none-agreed', { ...CONTEXT, uxSourceAgreed: true }), [])
})

it('a UX source may carry a note after its locator, but not stand without one', () => {
  assert.deepEqual(withSource('existing-screen:orders/refund-dialog (RefundForm → AmountField)'), [])
  assert.equal(withSource('existing-screen: (somewhere)').length, 1)
})

it('none-agreed needs no extra CLI question while the QC itself asks about the UX source', () => {
  const asking = { ...DOC, ui: true, ux: { source: 'none-agreed', screens: [], states: [] }, questions: [{ id: 'Q1', text: 'Is there a design?', about: 'ux-source' }] }
  assert.deepEqual(casesDocErrors(asking, { ...CONTEXT, uiRequest: true }), [])
})

it('a high-risk case may be assumed only once the round has used its four questions', () => {
  const risky = { ...DOC, cases: [DOC.cases[0], { ...DOC.cases[1], risk: 'high' }] }
  assert.deepEqual(casesDocErrors(risky, CONTEXT), ['case C2 is high risk and assumed: ask about it (a question), or settle it from the request'])
  const full = ['Q1', 'Q2', 'Q3', 'Q4'].map((id) => ({ id, text: 'x', about: 'rule' }))
  assert.deepEqual(casesDocErrors({ ...risky, questions: full }, CONTEXT), [])
})

it('a request too large for one run may be split instead of covered', () => {
  const split = { split: ['Show the duel board.', 'Feed duel results into rewards.'] }
  assert.deepEqual(casesDocErrors(split, CONTEXT), [])
  assert.deepEqual(casesDocErrors({ split: ['Only one part.'] }, CONTEXT), ['split: list at least two smaller requests, each one sentence or more'])
})

it('a high-risk case may stay assumed once a question about it came back unknown', () => {
  const risky = { ...DOC, cases: [DOC.cases[0], { ...DOC.cases[1], risk: 'high' }] }
  assert.deepEqual(casesDocErrors(risky, { ...CONTEXT, unknownAnswers: true }), [])
})
