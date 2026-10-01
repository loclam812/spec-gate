import { it } from 'node:test'
import assert from 'node:assert/strict'
import { buildReport } from '../cli/lib/trace.js'
import { tempDir, writeFile } from './helpers.js'

const repo = tempDir()
writeFile(repo, 'test/refund.test.js', "test('C1: late refund is rejected', …)\ntest('C2: refund flow', …)\n")
const model = {
  ui: false,
  sentences: [
    { id: 'S1', text: 'A refund after the window is rejected.', covered_by: ['R1'] },
    { id: 'S2', text: 'The customer requests a refund.', covered_by: ['F1'] },
    { id: 'S3', text: 'Admins are notified.', covered_by: ['R2'] },
  ],
  rules: [
    { id: 'R1', when: 'late', then: 'rejected' },
    { id: 'R2', when: 'refund requested', then: 'admins notified' },
  ],
  flows: [{ id: 'F1', name: 'request a refund', steps: ['open', 'request'] }],
}
const casesDoc = {
  cases: [
    { id: 'C1', covers: ['R1'], layer: 'unit', expected: 'rejected' },
    { id: 'C2', covers: ['F1'], layer: 'e2e', expected: 'confirmation' },
    { id: 'C3', covers: ['R2'], layer: 'unit', expected: 'notified' },
  ],
}
const results = [
  {
    file: 'test/refund.test.js',
    status: 'red',
    tests: [
      { name: 'test > C1: late refund is rejected', status: 'pass' },
      { name: 'test > C2: refund flow', status: 'fail' },
    ],
  },
]

it('the trace follows each sentence to its cases and their test results, and lists the gaps', () => {
  const { markdown, complete } = buildReport({
    runId: 'r1',
    tier: 't2',
    reasons: ['signals: flow'],
    request: 'Refunds after the window are rejected.\nMore text.',
    model,
    casesDoc,
    files: ['test/refund.test.js'],
    results,
    notes: [],
    repo,
  })
  assert.equal(complete, false)
  assert.match(markdown, /\| S1: A refund after the window is rejected\. \| R1 \| C1 \| green \|/)
  assert.match(markdown, /\| S2: The customer requests a refund\. \| F1 \| C2 \| red \|/)
  assert.match(markdown, /\| S3: Admins are notified\. \| R2 \| C3 \| no test \|/)
  assert.match(markdown, /## Gaps\n\n- S2: red\n- S3: no test\n/)
})

it('a T1 report lists the test files and the notes', () => {
  const { markdown, complete } = buildReport({
    runId: 'r2',
    tier: 't1',
    reasons: ['no decisive signal'],
    request: 'Return 404 when the order is missing.',
    model: null,
    casesDoc: null,
    files: ['test/refund.test.js'],
    results: [{ file: 'test/refund.test.js', status: 'green', tests: [] }],
    notes: ['the change added 7 branch lines; consider --tier t2'],
    repo,
  })
  assert.equal(complete, true)
  assert.match(markdown, /\| test\/refund\.test\.js \| green \|/)
  assert.match(markdown, /- the change added 7 branch lines; consider --tier t2/)
})

it('a case named only in a comment, or only by a skipped test, is not green', () => {
  writeFile(repo, 'test/thin.test.js', "test('C1: real check', …)\n// also covers C3\ntest.skip('C2: later', …)\n")
  const thinModel = {
    ...model,
    sentences: [{ id: 'S1', text: 'One.', covered_by: ['R1'] }, { id: 'S2', text: 'Two.', covered_by: ['F1'] }, { id: 'S3', text: 'Three.', covered_by: ['R2'] }],
  }
  const { markdown, complete } = buildReport({
    runId: 'r3',
    tier: 't2',
    reasons: [],
    request: 'One. Two. Three.',
    model: thinModel,
    casesDoc,
    files: ['test/thin.test.js'],
    results: [{ file: 'test/thin.test.js', status: 'green', tests: [{ name: 'C1: real check', status: 'pass' }, { name: 'C2: later', status: 'skip' }] }],
    notes: [],
    repo,
  })
  assert.equal(complete, false)
  assert.match(markdown, /\| S1: One\. \| R1 \| C1 \| green \|/)
  assert.match(markdown, /\| S2: Two\. \| F1 \| C2 \| skipped \|/)
  assert.match(markdown, /\| S3: Three\. \| R2 \| C3 \| no test \|/)
})

it('the report carries the review findings when there are any', () => {
  const { markdown } = buildReport({
    runId: 'r4',
    tier: 't1',
    reasons: [],
    request: 'x',
    model: null,
    casesDoc: null,
    files: [],
    results: [],
    notes: [],
    review: 'Important: the refund window is off by one day.\n',
    repo,
  })
  assert.match(markdown, /## Review findings\n\nImportant: the refund window is off by one day\./)
})
