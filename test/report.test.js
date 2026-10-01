import { it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeJson } from '../cli/lib/files.js'
import { loadVerdicts, parseRunName, renderReport, summarize } from '../cli/lib/report.js'
import { tempDir } from './helpers.js'

const records = [
  { project: 'p1', sample: 's1', candidate: 'single-prompt', run: 1, verdict: 'caught' },
  { project: 'p1', sample: 's1', candidate: 'single-prompt', run: 2, verdict: 'missed' },
  { project: 'p2', sample: 's2', candidate: 'single-prompt', run: 1, verdict: 'empty' },
  { project: 'p2', sample: 's2', candidate: 'single-prompt', run: 2, verdict: 'inconclusive' },
]

it('summarize counts empty as a miss and leaves inconclusive out of the rate', () => {
  const [summary] = summarize(records)
  assert.deepEqual(summary.overall, { caught: 1, conclusive: 3, inconclusive: 1, rate: 1 / 3 })
  assert.deepEqual(summary.runs, [
    { run: 1, caught: 1, conclusive: 2, inconclusive: 0, rate: 0.5 },
    { run: 2, caught: 0, conclusive: 1, inconclusive: 1, rate: 0 },
  ])
  assert.deepEqual(summary.spread, { min: 0, max: 0.5 })
})

it('renderReport prints the rate, the spread and one row per sample', () => {
  const text = renderReport(summarize(records))
  assert.match(text, /## single-prompt/)
  assert.match(text, /Catch rate: 1\/3 \(33%\) · inconclusive 1 · spread across runs 0%–50%/)
  assert.match(text, /\| p1\/s1 \| caught \| missed \|/)
  assert.match(text, /\| p2\/s2 \| empty \| inconclusive \|/)
})

it('renderReport marks a missing run instead of shifting columns', () => {
  const text = renderReport(summarize([records[0], { ...records[2], run: 2 }]))
  assert.match(text, /\| p1\/s1 \| caught \| — \|/)
  assert.match(text, /\| p2\/s2 \| — \| empty \|/)
})

it('an empty store renders a placeholder', () => {
  assert.equal(renderReport(summarize(loadVerdicts(tempDir()))), 'No verdicts yet.\n')
})

it('loadVerdicts walks projects, samples and runs', () => {
  const root = tempDir()
  writeJson(join(root, 'projects/p1/eval/s1/runs/single-prompt-2/verdict.json'), { verdict: 'caught' })
  writeJson(join(root, 'projects/p1/eval/s1/runs/my-skill-1/verdict.json'), { verdict: 'missed' })
  assert.deepEqual(loadVerdicts(root), [
    { project: 'p1', sample: 's1', candidate: 'my-skill', run: 1, verdict: 'missed' },
    { project: 'p1', sample: 's1', candidate: 'single-prompt', run: 2, verdict: 'caught' },
  ])
})

it('parseRunName rejects a directory without a run number', () => {
  assert.deepEqual(parseRunName('my-skill-12'), { candidate: 'my-skill', run: 12 })
  assert.throws(() => parseRunName('single-prompt'), /not <candidate>-<n>/)
})
