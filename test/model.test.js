import { it } from 'node:test'
import assert from 'node:assert/strict'
import { casesErrors, mentionsId, modelErrors, readyErrors, splitRequest, uxCells } from '../cli/lib/model.js'

const model = {
  ui: true,
  sentences: [
    { id: 'S1', text: 'A refund after the window is rejected.', covered_by: ['R1'] },
    { id: 'S2', text: 'The customer requests a refund from the order page.', covered_by: ['F1'] },
  ],
  rules: [{ id: 'R1', when: 'refund requested after the window', then: 'rejected: refund window expired' }],
  flows: [{ id: 'F1', name: 'request a refund', steps: ['open order', 'request refund', 'see confirmation'] }],
  ux: { source: 'existing-screen:/orders/:id', screens: ['refund dialog'], states: ['error', 'success'] },
  questions: [],
}

const casesDoc = {
  cases: [
    { id: 'C1', covers: ['R1'], layer: 'unit', expected: 'rejected' },
    { id: 'C2', covers: ['F1', 'ux:refund dialog:success'], layer: 'e2e', expected: 'confirmation shown' },
    { id: 'C3', covers: ['ux:refund dialog:error'], layer: 'ui', expected: 'error message shown' },
  ],
}

it('a complete model and complete cases pass every check', () => {
  assert.deepEqual(modelErrors(model), [])
  assert.deepEqual(casesErrors(model, casesDoc), [])
  assert.deepEqual(readyErrors(model, casesDoc), [])
  assert.deepEqual(uxCells(model), ['ux:refund dialog:error', 'ux:refund dialog:success'])
})

it('a sentence mapped to nothing, or to an unknown id, is named', () => {
  const broken = {
    ...model,
    sentences: [
      { id: 'S1', text: 'x', covered_by: [] },
      { id: 'S2', text: 'y', covered_by: ['R9'] },
    ],
  }
  assert.deepEqual(modelErrors(broken), ['sentence S1 is covered by nothing', 'sentence S2 refers to unknown R9'])
})

it('a rule needs both when and then, and ids must be unique', () => {
  const broken = { ...model, rules: [{ id: 'R1', when: 'x', then: '' }, { id: 'F1', when: 'y', then: 'z' }] }
  assert.deepEqual(modelErrors(broken), ['duplicate id F1', 'rule R1 needs both when and then'])
})

it('a UI request needs a UX source, or a question asking for one', () => {
  const noSource = { ...model, ux: { ...model.ux, source: '' } }
  assert.deepEqual(modelErrors(noSource), ['ux.source: give a UX source or ask for one (a question with about: ux-source)'])
  const asking = { ...noSource, questions: [{ id: 'Q1', text: 'Is there a design for the dialog?', about: 'ux-source' }] }
  assert.deepEqual(modelErrors(asking), [])
})

it('cases must cover every rule, flow and UX cell, with known targets and valid layers', () => {
  const partial = {
    cases: [
      { id: 'C1', covers: ['R1', 'R7'], layer: 'unit', expected: 'rejected' },
      { id: 'X2', covers: ['F1'], layer: 'manual', expected: '' },
    ],
  }
  assert.deepEqual(casesErrors(model, partial), [
    'case id X2 must look like C1, C2, …',
    'case X2: layer must be one of unit, integration, e2e, ui',
    'case X2 has no expected outcome',
    'case C1 covers unknown R7',
    'ux:refund dialog:error has no case',
    'ux:refund dialog:success has no case',
  ])
})

it('Ready refuses while a question is open', () => {
  const asking = { ...model, questions: [{ id: 'Q1', text: 'Which roles approve?', about: 'rule' }] }
  assert.deepEqual(readyErrors(asking, casesDoc), ['question Q1 is still open'])
})

it('mentionsId finds a case id as a whole token only', () => {
  assert.equal(mentionsId("it('C1: rejects a late refund')", 'C1'), true)
  assert.equal(mentionsId("it('C12: rejects a late refund')", 'C1'), false)
  assert.equal(mentionsId('func TestC1_LateRefund(t *testing.T)', 'C1'), true)
  assert.equal(mentionsId('ABC1 is a product code', 'C1'), false)
})

it('entries that are not mappings are named instead of crashing the check', () => {
  const broken = { ...model, rules: [null, ...model.rules], sentences: ['S9', ...model.sentences] }
  assert.deepEqual(modelErrors(broken), ['sentences entry 1 is not a mapping', 'rules entry 1 is not a mapping'])
})

it('ui must be a boolean, and a request that names a screen must set it or ask', () => {
  assert.deepEqual(modelErrors({ ...model, ui: 'yes' }), ['ui: set true or false'])
  const notUi = { ...model, ui: false }
  assert.deepEqual(modelErrors(notUi, { uiRequest: true }), [
    'ui: the request names a screen, page, dialog or form; set ui: true, or ask (about: ux-source)',
  ])
})

it('a UX source has a known form, and none-agreed needs the user to have said so', () => {
  assert.deepEqual(modelErrors({ ...model, ux: { ...model.ux, source: 'TBD' } }), [
    'ux.source: use figma:<url>, screenshot:<path>, existing-screen:<route> or none-agreed',
  ])
  const noneAgreed = { ...model, ux: { ...model.ux, source: 'none-agreed' } }
  assert.deepEqual(modelErrors(noneAgreed), ["ux.source: none-agreed needs the user's answer to a question with about: ux-source"])
  assert.deepEqual(modelErrors(noneAgreed, { uxSourceAgreed: true }), [])
})

it('the model lists exactly the sentences the request was split into', () => {
  const sentenceIds = ['S1', 'S2', 'S3']
  assert.deepEqual(modelErrors(model, { sentenceIds }), ['sentence S3 of the request is not in the model'])
  const marked = { ...model, sentences: [...model.sentences, { id: 'S3', text: 'Thanks!', non_testable: 'a courtesy' }] }
  assert.deepEqual(modelErrors(marked, { sentenceIds }), [])
  assert.deepEqual(splitRequest('Refunds are rejected after 30 days. Admins approve!\nThanks'), [
    { id: 'S1', text: 'Refunds are rejected after 30 days.' },
    { id: 'S2', text: 'Admins approve!' },
    { id: 'S3', text: 'Thanks' },
  ])
})

it('a case id followed by a letter is a different token', () => {
  assert.equal(mentionsId('color: #C1C1C1', 'C1'), false)
  assert.equal(mentionsId("test.skip('C2b placeholder')", 'C2'), false)
})
