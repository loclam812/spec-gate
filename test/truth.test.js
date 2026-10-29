import { it } from 'node:test'
import assert from 'node:assert/strict'
import { stringify } from 'yaml'
import { loadSample } from '../cli/lib/sample.js'
import { loadTruth, truthErrors } from '../cli/lib/truth.js'
import { tempDir, writeFile, writeSample } from './helpers.js'

const QUOTE = 'the sum of price times quantity'

function sampleWith(truth) {
  const dir = writeSample(tempDir(), { id: 'demo-1' })
  if (typeof truth === 'string') writeFile(dir, 'truth.yaml', truth)
  else if (truth) writeFile(dir, 'truth.yaml', stringify(truth))
  return dir
}

const errorsOf = (dir) => truthErrors(loadSample(dir))

it('a reviewed bug_quote found in spec/*.md loads as specified', () => {
  const dir = sampleWith({ bug_quote: QUOTE, reviewed: true })
  assert.deepEqual(errorsOf(dir), [])
  assert.deepEqual(loadTruth(dir), { bucket: 'specified', quote: QUOTE })
})

it('a bug_quote that is not in any spec file is an error', () => {
  const dir = sampleWith({ bug_quote: 'the total is rounded to cents', reviewed: true })
  assert.ok(errorsOf(dir).includes('truth.yaml: bug_quote is not a substring of spec/*.md'))
  assert.equal(loadTruth(dir), null)
})

it('a reviewed bug_gap loads as spec_gap with its keywords', () => {
  const gap = { kind: 'knowledge', about: 'Which title a group chat toast shows.', keywords: ['group chat', 'title'] }
  const withRef = sampleWith({ bug_gap: { ...gap, answers_ref: 'answers.yaml:36' }, reviewed: true })
  assert.deepEqual(errorsOf(withRef), [])
  assert.deepEqual(loadTruth(withRef), { bucket: 'spec_gap', kind: 'knowledge', about: gap.about, keywords: gap.keywords, answersRef: 'answers.yaml:36' })
  assert.equal(loadTruth(sampleWith({ bug_gap: gap, reviewed: true })).answersRef, null)
})

it('bug_gap needs kind knowledge or reality and at least one keyword', () => {
  const dir = sampleWith({ bug_gap: { kind: 'hunch', about: 'x', keywords: [] }, reviewed: true })
  assert.ok(errorsOf(dir).includes('truth.yaml: bug_gap.kind must be knowledge or reality'))
  assert.ok(errorsOf(dir).includes('truth.yaml: bug_gap.keywords must be a non-empty list of strings'))
  assert.equal(loadTruth(dir), null)
})

it('truth.yaml needs exactly one of bug_quote and bug_gap', () => {
  const both = sampleWith({ bug_quote: QUOTE, bug_gap: { kind: 'knowledge', about: 'x', keywords: ['x'] }, reviewed: true })
  assert.deepEqual(errorsOf(both), ['truth.yaml: give exactly one of bug_quote and bug_gap'])
  assert.deepEqual(errorsOf(sampleWith({ reviewed: true })), ['truth.yaml: give exactly one of bug_quote and bug_gap'])
})

it('reviewed must be a boolean', () => {
  assert.deepEqual(errorsOf(sampleWith({ bug_quote: QUOTE, reviewed: 'yes' })), ['truth.yaml: reviewed must be true or false'])
})

it('an unreviewed label has no errors but does not load', () => {
  const dir = sampleWith({ bug_quote: QUOTE, reviewed: false })
  assert.deepEqual(errorsOf(dir), [])
  assert.equal(loadTruth(dir), null)
})

it('unparseable truth.yaml is an error and does not load', () => {
  const dir = sampleWith('bug_quote: [unclosed\n')
  assert.match(errorsOf(dir)[0], /^truth\.yaml: /)
  assert.equal(loadTruth(dir), null)
})

it('a sample without truth.yaml has no truth errors and no truth', () => {
  const dir = sampleWith(null)
  assert.deepEqual(errorsOf(dir), [])
  assert.equal(loadTruth(dir), null)
})

it('a directory inside spec/ is skipped, not read', () => {
  const dir = sampleWith({ bug_quote: QUOTE, reviewed: true })
  writeFile(dir, 'spec/assets/note.md', 'unrelated\n')
  assert.deepEqual(errorsOf(dir), [])
  assert.deepEqual(loadTruth(dir), { bucket: 'specified', quote: QUOTE })
})
