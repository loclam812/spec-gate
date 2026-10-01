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
