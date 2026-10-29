import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { parse } from 'yaml'
import { readEvents } from './lib/run-log.js'
import { readState } from './lib/run-store.js'
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

// Minutes from the run's first event to the first (or last) event that matches; null when none does.
function minutesUntil(events, matches, { last = false } = {}) {
  const start = Date.parse(events[0]?.at)
  const found = last ? events.findLast(matches) : events.find(matches)
  const end = Date.parse(found?.at)
  return Number.isNaN(start) || Number.isNaN(end) ? null : Math.round((end - start) / 60_000)
}

const centsOf = (amounts) => Math.round(amounts.reduce((sum, usd) => sum + usd, 0) * 100) / 100

const versionsOf = (events) => [...new Set(events.map((event) => event.version).filter(Boolean))]

// Runs from before events.jsonl existed only have their state to go by.
const reachedQc = (state, events) =>
  events.length > 0 ? events.some((event) => event.step === 'qc') : state.adopted !== true && state.step !== 'discover'

function entry(project, id, dir) {
  const state = readState(dir) ?? {}
  const events = readEvents(dir)
  const cases = list(readYaml(join(dir, 'cases.yaml')).cases)
  const written = readYaml(join(dir, 'tests.yaml'))
  const decisions = readText(join(dir, 'decisions.md'))
  return {
    project,
    run: id,
    versions: versionsOf(events),
    request: readText(join(dir, 'request.md')).trim().split('\n')[0] ?? '',
    step: state.step ?? 'unknown',
    ...(state.stuck_reason ? { stuck_reason: state.stuck_reason } : {}),
    adopted: state.adopted === true,
    cases: cases.length,
    assumed: cases.filter((c) => c?.basis === 'assumed').length,
    questions: (decisions.match(/^- Q\w+ /gm) ?? []).length,
    qc_rounds: reachedQc(state, events) ? (state.qc_rounds ?? 0) : null,
    ready_rejections: (decisions.match(/^- Rejected at Ready: /gm) ?? []).length,
    disputed: list(written.disputed).length,
    dropped: list(written.dropped).length,
    failed_checks: events.filter((event) => list(event.errors).length > 0).length,
    minutes_to_done: minutesUntil(events, (event) => event.step === 'done'),
    minutes_to_last_verify: minutesUntil(events, (event) => event.kind === 'verify', { last: true }),
    verify: verifySummary(events),
    usd: centsOf(events.map((event) => event.usd).filter((usd) => typeof usd === 'number')),
    notes: readText(join(dir, 'notes.md')).split('\n').filter(Boolean),
  }
}

function summary(runs) {
  const count = (key, from = runs) => from.reduce((counts, run) => ({ ...counts, [run[key]]: (counts[run[key]] ?? 0) + 1 }), {})
  return {
    runs: runs.length,
    by_step: count('step'),
    by_qc_rounds: count('qc_rounds', runs.filter((run) => run.qc_rounds !== null)),
    ready_rejections: runs.reduce((total, run) => total + run.ready_rejections, 0),
    stuck_reasons: runs.flatMap((run) => (run.stuck_reason ? [run.stuck_reason] : [])),
    verify_failed: runs.filter((run) => run.verify.last === 'fail').length,
    regressions_caught: runs.reduce((total, run) => total + run.verify.regressions, 0),
    usd: centsOf(runs.map((run) => run.usd)),
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
