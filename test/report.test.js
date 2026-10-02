import { it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeJson } from '../cli/lib/files.js'
import { loadVerdicts, parseRunName, renderReport, summarize } from '../cli/lib/report.js'
import { tempDir } from './helpers.js'

const records = [
  { project: 'p1', sample: 's1', candidate: 'single-prompt', run: 1, verdict: 'caught' },
  { project: 'p1', sample: 's1', candidate: 'single-prompt', run: 2, verdict: 'missed' },
  { project: 'p2', sample: 's2', candidate: 'single-prompt', run: 1, verdict: 'empty' },
  { project: 'p2', sample: 's2', candidate: 'single-prompt', run: 2, verdict: 'inconclusive' },
  { project: 'p3', sample: 's3', candidate: 'single-prompt', run: 1, verdict: 'broken' },
  { project: 'p3', sample: 's3', candidate: 'single-prompt', run: 2, verdict: 'leaked' },
]

it('summarize counts empty as a miss, brackets broken, and excludes inconclusive and leaked', () => {
  const [summary] = summarize(records)
  assert.deepEqual(summary.overall, {
    caught: 1,
    conclusive: 3,
    broken: 1,
    excluded: 2,
    rate: 1 / 3,
    rateWithBroken: 1 / 4,
  })
  assert.deepEqual(summary.runs, [
    { run: 1, caught: 1, conclusive: 2, broken: 1, excluded: 0, rate: 0.5, rateWithBroken: 1 / 3 },
    { run: 2, caught: 0, conclusive: 1, broken: 0, excluded: 2, rate: 0, rateWithBroken: 0 },
  ])
  assert.deepEqual(summary.spread, { min: 0, max: 0.5 })
})

it('renderReport prints both rates, the spread and one row per sample', () => {
  const text = renderReport(summarize(records))
  assert.match(text, /## single-prompt/)
  assert.match(
    text,
    /Catch rate: 1\/3 \(33%\) · broken counted as misses: 1\/4 \(25%\) · broken 1 · excluded 2 · spread across runs 0%–50%/,
  )
  assert.match(text, /\| p1\/s1 \| caught \| missed \|/)
  assert.match(text, /\| p3\/s3 \| broken \| leaked \|/)
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

it('each run carries the cost and time of every claude result in its transcript', () => {
  const root = tempDir()
  const runDir = join(root, 'projects', 'p1', 'eval', 's1', 'runs', 'single-prompt-1')
  writeJson(join(runDir, 'verdict.json'), { verdict: 'caught' })
  writeFileSync(
    join(runDir, 'transcript.jsonl'),
    '{"type":"result","total_cost_usd":0.5,"duration_ms":60000}\nnot json\n{"type":"result","total_cost_usd":0.25,"duration_ms":30000}\n',
  )
  assert.deepEqual(loadVerdicts(root), [
    { project: 'p1', sample: 's1', candidate: 'single-prompt', run: 1, verdict: 'caught', usd: 0.75, ms: 90000 },
  ])
})

it('the report prints what a run costs in money and time', () => {
  const priced = [
    { project: 'p1', sample: 's1', candidate: 'c', run: 1, verdict: 'caught', usd: 1, ms: 120000 },
    { project: 'p1', sample: 's1', candidate: 'c', run: 2, verdict: 'missed', usd: 0.5, ms: 240000 },
    { project: 'p1', sample: 's2', candidate: 'c', run: 1, verdict: 'missed' },
  ]
  const [summary] = summarize(priced)
  assert.deepEqual(summary.cost, { measured: 2, totalUsd: 1.5, usdPerRun: 0.75, minutesPerRun: 3 })
  assert.match(renderReport([summary]), /Cost: \$0\.75 per run, \$1\.50 in total over 2 measured runs · 3 min per run/)
})
