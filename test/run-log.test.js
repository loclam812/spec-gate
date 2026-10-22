import { it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runLog, runNote } from '../cli/log.js'
import { repoSlug } from '../cli/lib/store.js'
import { VERSION } from '../cli/lib/version.js'
import { FIXED_TOTAL, writeFile } from './helpers.js'
import { stringify } from 'yaml'
import { C1_TEST, CASES, REQUEST, setup, toDone } from './tests-helpers.js'

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
  assert.ok(events.every((event) => event.version === VERSION))
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

it('the log reports minutes to done and minutes to the last verify separately', () => {
  const { repo, env, cli, verify } = setup()
  toDone(cli, repo)
  verify()
  const [entry] = capture(runLog, ['--since', '1d'], env).json.runs
  assert.equal(typeof entry.minutes_to_done, 'number')
  assert.equal(typeof entry.minutes_to_last_verify, 'number')
  assert.equal('minutes' in entry, false)
})

it('the log lists the distinct versions that wrote a run, and none for older runs', () => {
  const { repo, env, cli, verify } = setup()
  toDone(cli, repo)
  verify()
  const dir = dirname(cli('next').json.report)
  const events = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n')
  writeFileSync(join(dir, 'events.jsonl'), [events[0].replace(VERSION, '0.5.0'), ...events].join('\n') + '\n')
  const [entry] = capture(runLog, ['--since', '1d'], env).json.runs
  assert.deepEqual(entry.versions, ['0.5.0', VERSION])
  const old = join(env.SPEC_GATE_HOME, 'projects', repoSlug(repo), 'runs', '20200101-000000-000-bbbb')
  mkdirSync(old, { recursive: true })
  writeFileSync(join(old, 'state.json'), JSON.stringify({ id: 'x', repo, step: 'done' }))
  writeFileSync(join(old, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), step: 'done' }) + '\n')
  const runs = capture(runLog, ['--since', '3650d'], env).json.runs
  assert.deepEqual(runs.find((run) => run.run.endsWith('bbbb')).versions, [])
})

it('the log counts QC rounds and Ready rejections, leaving runs that never reached QC out of the round counts', () => {
  const { repo, env, cli } = setup()
  cli('start', '--request', REQUEST)
  cli('submit')
  writeFileSync(cli('next').json.output, stringify(CASES))
  cli('submit')
  cli('submit', '--reject', 'C1 misses the empty cart')
  writeFileSync(cli('next').json.output, stringify(CASES))
  cli('submit')
  cli('submit', '--approve')
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFileSync(cli('next').json.output, stringify({ files: ['test/total.test.js'] }))
  assert.equal(cli('submit').json.step, 'done')
  cli('start', '--request', 'Totals are rounded.')
  const { runs, summary } = capture(runLog, ['--since', '1d'], env).json
  const done = runs.find((run) => run.step === 'done')
  const fresh = runs.find((run) => run.step !== 'done')
  assert.deepEqual({ qc_rounds: done.qc_rounds, ready_rejections: done.ready_rejections }, { qc_rounds: 1, ready_rejections: 1 })
  assert.deepEqual({ qc_rounds: fresh.qc_rounds, ready_rejections: fresh.ready_rejections }, { qc_rounds: null, ready_rejections: 0 })
  assert.deepEqual({ by_qc_rounds: summary.by_qc_rounds, ready_rejections: summary.ready_rejections }, { by_qc_rounds: { 1: 1 }, ready_rejections: 1 })
})

it('a run from before events were logged takes its QC rounds from its state, unless it was adopted or never left discover', () => {
  const { env } = setup()
  const runs = join(env.SPEC_GATE_HOME, 'projects', 'p', 'runs')
  const legacy = (id, state) => {
    mkdirSync(join(runs, id), { recursive: true })
    writeFileSync(join(runs, id, 'state.json'), JSON.stringify({ id, qc_rounds: 0, ...state }))
  }
  legacy('20200101-000000-000-done', { step: 'done', qc_rounds: 2 })
  legacy('20200101-000000-000-adop', { step: 'done', adopted: true })
  legacy('20200101-000000-000-disc', { step: 'discover' })
  const rounds = Object.fromEntries(capture(runLog, ['--since', '3650d'], env).json.runs.map((run) => [run.run.slice(-4), run.qc_rounds]))
  assert.deepEqual(rounds, { done: 2, adop: null, disc: null })
})
