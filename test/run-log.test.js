import { it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runLog, runNote } from '../cli/log.js'
import { repoSlug } from '../cli/lib/store.js'
import { FIXED_TOTAL, writeFile } from './helpers.js'
import { setup, toDone } from './tests-helpers.js'

const capture = (run, argv, env, repo) => {
  const chunks = []
  const code = run([...argv, ...(repo ? ['--repo', repo] : [])], { env, out: { write: (text) => chunks.push(text) } })
  return { code, json: JSON.parse(chunks.join('')) }
}

it('every state change and verify is logged with a time, and the log summarises the run', () => {
  const { repo, env, cli, verify } = setup()
  toDone(cli, repo)
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  verify()
  const dir = dirname(cli('next').json.report)
  const events = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(events.map((event) => event.step ?? event.kind), ['discover', 'qc', 'ready', 'write-tests', 'done', 'verify'])
  assert.ok(events.every((event) => !Number.isNaN(Date.parse(event.at))))
  const { runs, summary } = capture(runLog, ['--since', '1d'], env).json
  assert.equal(runs.length, 1)
  assert.deepEqual(
    { step: runs[0].step, cases: runs[0].cases, verify: runs[0].verify },
    { step: 'done', cases: 1, verify: { runs: 1, last: 'pass', regressions: 0 } },
  )
  assert.deepEqual(summary.by_step, { done: 1 })
})

it('a note is kept with its run and shown in the log', () => {
  const { repo, env, cli } = setup()
  toDone(cli, repo)
  const run = dirname(cli('next').json.report).split('/').pop()
  assert.equal(capture(runNote, ['--run', run, 'the test missed the empty cart'], env, repo).code, 0)
  const [entry] = capture(runLog, ['--since', '1d'], env).json.runs
  assert.equal(entry.notes.length, 1)
  assert.match(entry.notes[0], /the test missed the empty cart/)
})

it('the log leaves out runs older than --since and lists stuck reasons', () => {
  const { repo, env, cli } = setup()
  cli('start', '--request', 'Totals are rounded.')
  const old = join(env.SPEC_GATE_HOME, 'projects', repoSlug(repo), 'runs', '20200101-000000-000-aaaa')
  mkdirSync(old, { recursive: true })
  writeFileSync(join(old, 'state.json'), JSON.stringify({ id: '20200101-000000-000-aaaa', repo, step: 'stuck', stuck_reason: 'old' }))
  writeFileSync(join(old, 'request.md'), 'Old.\n')
  const { runs } = capture(runLog, ['--since', '3d'], env).json
  assert.equal(runs.length, 1)
  assert.equal(runs[0].request, 'Totals are rounded.')
})
