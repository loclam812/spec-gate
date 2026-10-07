import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { parse } from 'yaml'
import { readEvents } from './lib/run-log.js'
import { projectDir, repoSlug, storeRoot } from './lib/store.js'

const print = (out, value) => out.write(`${JSON.stringify(value, null, 2)}\n`)
const list = (value) => (Array.isArray(value) ? value : [])
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const readYaml = (path) => {
  try {
    return parse(readText(path)) ?? {}
  } catch {
    return {}
  }
}
const readState = (dir) => {
  try {
    return JSON.parse(readText(join(dir, 'state.json')))
  } catch {
    return null
  }
}

const SPAN = /^(\d+)([dh])$/
const sinceMs = (text) => {
  const match = SPAN.exec(text)
  if (!match) throw new Error('log: --since takes a span such as 3d or 12h')
  return Number(match[1]) * (match[2] === 'd' ? 86_400_000 : 3_600_000)
}

// Run ids start with their UTC start time: 20261007-032729-151-…
const startedAt = (id) => {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id)
  return match ? Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]) : NaN
}

function verifySummary(events) {
  const checks = events.filter((event) => event.kind === 'verify')
  const last = checks.at(-1)
  return { runs: checks.length, last: last ? (last.ok ? 'pass' : 'fail') : null, regressions: last?.regressions ?? 0 }
}

function entry(project, id, dir) {
  const state = readState(dir) ?? {}
  const events = readEvents(dir)
  const cases = list(readYaml(join(dir, 'cases.yaml')).cases)
  const written = readYaml(join(dir, 'tests.yaml'))
  const times = events.map((event) => Date.parse(event.at)).filter((time) => !Number.isNaN(time))
  return {
    project,
    run: id,
    request: readText(join(dir, 'request.md')).trim().split('\n')[0] ?? '',
    step: state.step ?? 'unknown',
    ...(state.stuck_reason ? { stuck_reason: state.stuck_reason } : {}),
    adopted: state.adopted === true,
    cases: cases.length,
    assumed: cases.filter((c) => c?.basis === 'assumed').length,
    questions: (readText(join(dir, 'decisions.md')).match(/^- Q\w+ /gm) ?? []).length,
    disputed: list(written.disputed).length,
    dropped: list(written.dropped).length,
    failed_checks: events.filter((event) => list(event.errors).length > 0).length,
    minutes: times.length > 1 ? Math.round((Math.max(...times) - Math.min(...times)) / 60_000) : 0,
    verify: verifySummary(events),
    notes: readText(join(dir, 'notes.md')).split('\n').filter(Boolean),
  }
}

function summary(runs) {
  const count = (key) => runs.reduce((counts, run) => ({ ...counts, [run[key]]: (counts[run[key]] ?? 0) + 1 }), {})
  return {
    runs: runs.length,
    by_step: count('step'),
    stuck_reasons: runs.flatMap((run) => (run.stuck_reason ? [run.stuck_reason] : [])),
    verify_failed: runs.filter((run) => run.verify.last === 'fail').length,
    regressions_caught: runs.reduce((total, run) => total + run.verify.regressions, 0),
  }
}

export function runLog(argv, { env = process.env, out = process.stdout } = {}) {
  const { values } = parseArgs({ args: argv, options: { since: { type: 'string', default: '3d' } } })
  const after = Date.now() - sinceMs(values.since)
  const projects = join(storeRoot(env), 'projects')
  const runs = (existsSync(projects) ? readdirSync(projects) : []).flatMap((project) => {
    const dir = join(projects, project, 'runs')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((id) => startedAt(id) >= after)
      .map((id) => entry(project, id, join(dir, id)))
  })
  print(out, { since: values.since, runs, summary: summary(runs) })
  return 0
}

export function runNote(argv, { env = process.env, out = process.stdout } = {}) {
  const { values, positionals } = parseArgs({ args: argv, options: { run: { type: 'string' }, repo: { type: 'string', default: '.' } }, allowPositionals: true })
  const text = positionals.join(' ').trim()
  if (!values.run || !text) throw new Error('usage: spec-gate note --run <id> "<what you noticed>"')
  const dir = join(projectDir(repoSlug(resolve(values.repo)), env), 'runs', values.run)
  if (!existsSync(join(dir, 'state.json'))) throw new Error(`note: no run ${values.run} for this repository`)
  appendFileSync(join(dir, 'notes.md'), `- ${new Date().toISOString().slice(0, 10)} ${text.replace(/\s+/g, ' ')}\n`)
  print(out, { run: values.run, notes: readText(join(dir, 'notes.md')).split('\n').filter(Boolean).length })
  return 0
}
