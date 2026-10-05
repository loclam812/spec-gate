import { it } from 'node:test'
import assert from 'node:assert/strict'
import { buildTrace } from '../cli/lib/trace.js'
import { tempDir, writeFile } from './helpers.js'

const repo = tempDir()
const sentences = [
  { id: 'S1', text: 'A refund after the window is rejected.', cases: ['C1'] },
  { id: 'S2', text: 'The customer requests a refund.', cases: ['C2'] },
  { id: 'S3', text: 'Admins are notified.', cases: ['C3'] },
  { id: 'S4', text: 'Thanks!', non_testable: 'a courtesy' },
]

it('the trace follows each sentence to its cases and their test results, and lists the gaps', () => {
  writeFile(repo, 'test/refund.test.js', "test('C1: late refund is rejected', …)\ntest('C2: refund flow', …)\n")
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
  const { section, gaps } = buildTrace({ casesDoc: { sentences }, repo, files: ['test/refund.test.js'], results })
  assert.match(section, /\| S1: A refund after the window is rejected\. \| C1 \| green \|/)
  assert.match(section, /\| S2: The customer requests a refund\. \| C2 \| red \|/)
  assert.match(section, /\| S3: Admins are notified\. \| C3 \| no test \|/)
  assert.match(section, /\| S4: Thanks! \| {2}\| not testable: a courtesy \|/)
  assert.deepEqual(gaps, ['- S2: red', '- S3: no test'])
})

it('a case named only in a comment, or only by a skipped test, is not green', () => {
  writeFile(repo, 'test/thin.test.js', "test('C1: real check', …)\n// also covers C3\ntest.skip('C2: later', …)\n")
  const results = [{ file: 'test/thin.test.js', status: 'green', tests: [{ name: 'C1: real check', status: 'pass' }, { name: 'C2: later', status: 'skip' }] }]
  const { section } = buildTrace({ casesDoc: { sentences }, repo, files: ['test/thin.test.js'], results })
  assert.match(section, /\| S1: .* \| C1 \| green \|/)
  assert.match(section, /\| S2: .* \| C2 \| skipped \|/)
  assert.match(section, /\| S3: .* \| C3 \| no test \|/)
})
