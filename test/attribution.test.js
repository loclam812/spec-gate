import { it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { attribute, driverDirs } from '../cli/lib/attribution.js'
import { writeJson } from '../cli/lib/files.js'
import { tempDir, writeFile } from './helpers.js'

const QUOTE = 'The toast hides after 5 seconds.'
const specified = { bucket: 'specified', quote: QUOTE }
const knowledgeGap = { bucket: 'spec_gap', kind: 'knowledge', about: 'Which title a group chat toast shows.', keywords: ['group chat'], answersRef: null }
const realityGap = { ...knowledgeGap, kind: 'reality' }

function writePart(dir, { step = 'done', sentences = [], cases = [], decisions = null } = {}) {
  writeJson(join(dir, 'state.json'), { step, qc_rounds: 1 })
  if (sentences.length > 0 || cases.length > 0) writeFile(dir, 'cases.yaml', stringify({ sentences, cases, questions: [] }))
  if (decisions !== null) writeFile(dir, 'decisions.md', decisions)
}

// parts: one entry writes spec-to-tests/ itself; several write a split top and part-N/ dirs.
function driverRun(parts, { top = 'split' } = {}) {
  const runDir = tempDir('sg-attr-')
  if (parts.length === 1) writePart(join(runDir, 'spec-to-tests'), parts[0])
  else {
    writePart(join(runDir, 'spec-to-tests'), { step: top })
    parts.forEach((part, index) => writePart(join(runDir, 'spec-to-tests', `part-${index + 1}`), part))
  }
  return runDir
}

const sentence = (text, cases) => ({ id: 'S1', text, cases })

it('a prompt candidate run has a group but no layer', () => {
  assert.deepEqual(attribute({ verdict: 'missed', dir: tempDir('sg-attr-') }, specified), { group: 'missed@done', layer: null, touched: null })
})

it('a split run without parts is incomplete@split', () => {
  const dir = driverRun([{ step: 'split' }])
  assert.equal(attribute({ verdict: 'empty', dir }, specified).group, 'incomplete@split')
})

it('a split run whose parts are all done is missed@done', () => {
  const dir = driverRun([{ sentences: [sentence('Other text that is long enough.', ['C1'])] }, { sentences: [sentence(QUOTE, ['C4'])] }])
  assert.deepEqual(driverDirs(dir).map((path) => path.split('/').pop()), ['part-1', 'part-2'])
  assert.deepEqual(attribute({ verdict: 'missed', dir }, specified), { group: 'missed@done', layer: 'writer-missed', touched: null })
})

it('a stuck part makes the run incomplete at that part\'s step', () => {
  const dir = driverRun([{ step: 'done' }, { step: 'stuck' }])
  assert.equal(attribute({ verdict: 'missed', dir }, specified).group, 'incomplete@stuck')
})

it('the quote\'s sentence without cases is qc-no-case', () => {
  const dir = driverRun([{ sentences: [sentence(QUOTE, [])] }])
  assert.equal(attribute({ verdict: 'missed', dir }, specified).layer, 'qc-no-case')
})

it('a quote no sentence covers is qc-no-case', () => {
  const dir = driverRun([{ sentences: [sentence('A different rule about colours.', ['C1'])] }])
  assert.equal(attribute({ verdict: 'missed', dir }, specified).layer, 'qc-no-case')
})

it('a sentence that differs only in case, spacing or a list marker still covers the quote', () => {
  const dir = driverRun([{ sentences: [sentence('-  The Toast  hides after 5 seconds.', ['C2'])] }])
  assert.equal(attribute({ verdict: 'missed', dir }, { bucket: 'specified', quote: 'the toast hides after 5 seconds' }).layer, 'writer-missed')
})

it('a quote spanning several sentences is covered by each long one inside it', () => {
  const quote = 'The toast hides after 5 seconds. It never shows twice for one message.'
  const dir = driverRun([{ sentences: [sentence('The toast hides after 5 seconds.', ['C2']), { id: 'S2', text: '## Edges', cases: [] }] }])
  assert.equal(attribute({ verdict: 'missed', dir }, { bucket: 'specified', quote }).layer, 'writer-missed')
})

it('an untouched knowledge gap is qc-gap-unasked; an untouched reality gap is qc-gap-unprobed', () => {
  const dir = driverRun([{ decisions: '- Q1 Which icon does an unknown type show? (about: rule)\n  Answer: unknown\n' }])
  assert.deepEqual(attribute({ verdict: 'missed', dir }, knowledgeGap), { group: 'missed@done', layer: 'qc-gap-unasked', touched: false })
  assert.equal(attribute({ verdict: 'missed', dir }, realityGap).layer, 'qc-gap-unprobed')
})

it('a question naming a keyword touches the gap', () => {
  const dir = driverRun([{ decisions: '- Q3 For a Group Chat message, what should the pop-up say? (about: rule)\n  Answer: unknown\n' }])
  assert.deepEqual(attribute({ verdict: 'missed', dir }, knowledgeGap), { group: 'missed@done', layer: 'gap-touched', touched: true })
})

it('an assumed case naming a keyword touches the gap, a request case does not', () => {
  const assumed = driverRun([{ cases: [{ id: 'C1', when: 'a group chat message arrives', then: 'the group name is the title', basis: 'assumed' }] }])
  const request = driverRun([{ cases: [{ id: 'C1', when: 'a group chat message arrives', then: 'the group name is the title', basis: 'request' }] }])
  assert.equal(attribute({ verdict: 'missed', dir: assumed }, knowledgeGap).layer, 'gap-touched')
  assert.equal(attribute({ verdict: 'missed', dir: request }, knowledgeGap).layer, 'qc-gap-unasked')
})

it('a caught spec_gap run still records whether the gap was touched', () => {
  const dir = driverRun([{}])
  assert.deepEqual(attribute({ verdict: 'caught', dir }, knowledgeGap), { group: 'caught', layer: null, touched: false })
})

it('inverted and caught-below-layer are missed@done', () => {
  const dir = driverRun([{ sentences: [sentence(QUOTE, ['C1'])] }])
  for (const verdict of ['inverted', 'caught-below-layer']) assert.equal(attribute({ verdict, dir }, specified).group, 'missed@done')
})

it('broken and empty keep their own group once the pipeline is done', () => {
  const dir = driverRun([{}])
  assert.equal(attribute({ verdict: 'broken', dir }, specified).group, 'broken')
  assert.equal(attribute({ verdict: 'empty', dir }, specified).group, 'empty')
})

it('a missed driver run on an unlabelled sample is unattributed', () => {
  const dir = driverRun([{}])
  assert.deepEqual(attribute({ verdict: 'missed', dir }, null), { group: 'missed@done', layer: 'unattributed', touched: null })
})

it('a run with no cases.yaml or decisions.md does not throw', () => {
  const dir = driverRun([{}])
  assert.equal(attribute({ verdict: 'missed', dir }, specified).layer, 'qc-no-case')
})

it('a driver run with an unreadable state is incomplete@unknown', () => {
  const dir = tempDir('sg-attr-')
  writeFile(dir, 'spec-to-tests/state.json', '{not json')
  assert.equal(attribute({ verdict: 'missed', dir }, specified).group, 'incomplete@unknown')
})

it('inconclusive and leaked runs have no group', () => {
  const dir = driverRun([{}])
  for (const verdict of ['inconclusive', 'leaked']) assert.deepEqual(attribute({ verdict, dir }, specified), { group: null, layer: null, touched: null })
})

it('a quote spanning sentences is writer-missed only when every long sentence inside it has a case', () => {
  const quote = 'The message text is the body, shown on one line. A group toast shows the group name as title.'
  const dir = driverRun([{ sentences: [sentence('The message text is the body, shown on one line.', ['C1']), { id: 'S2', text: 'A group toast shows the group name as title.', cases: [] }] }])
  assert.equal(attribute({ verdict: 'missed', dir }, { bucket: 'specified', quote }).layer, 'qc-no-case')
})

it('a broken run is broken even when a part got stuck', () => {
  const dir = driverRun([{ step: 'done' }, { step: 'stuck' }])
  assert.equal(attribute({ verdict: 'broken', dir }, specified).group, 'broken')
})

it('a split run whose later parts never started is incomplete@split', () => {
  const dir = driverRun([{ step: 'done' }, { step: 'done' }])
  writeFile(join(dir, 'spec-to-tests'), 'cases.yaml', stringify({ split: ['first part', 'second part', 'third part'] }))
  assert.equal(attribute({ verdict: 'missed', dir }, specified).group, 'incomplete@split')
})
