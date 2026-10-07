import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { readJson } from './files.js'
import { stackFor } from './profile.js'
import { changedSince, runSuite, runTestFile, suiteTargets } from './run-tests.js'
import { buildTrace } from './trace.js'

const at = (run, name) => join(run.dir, name)
const bullets = (items) => (items.length > 0 ? items.join('\n') : 'None.')

function suiteRegressions(run, profile, files) {
  const baseline = existsSync(at(run, 'suite-baseline.json')) ? readJson(at(run, 'suite-baseline.json')) : {}
  const checked = suiteTargets(profile, run.repo, files).map((target) => {
    const before = baseline[target.key]
    const now = runSuite(run.repo, target)
    if (!Array.isArray(before) || now.failing === null) return { note: `suite not checked: ${target.key}` }
    return { broken: now.failing.filter((name) => !before.includes(name)) }
  })
  const comparable = new Set(suiteTargets(profile, run.repo, files).map((target) => target.stack.name))
  const unreported = [...new Set(files.map((file) => stackFor(profile, file)?.name).filter((name) => name && !comparable.has(name)))]
  return {
    regressions: checked.flatMap((entry) => entry.broken ?? []),
    notes: [...checked.flatMap((entry) => (entry.note ? [entry.note] : [])), ...unreported.map((name) => `suite not checked: ${name} has no per-test suite report`)],
  }
}

function renderVerify({ run, edited, red, regressions, traced, notes, ok }) {
  return `${[
    `# spec-gate verify ${run.state.id}`,
    `**Result:** ${ok ? 'pass' : 'fail'}`,
    traced.section,
    `## Changed test files\n\n${bullets(edited.map((file) => `- ${file} changed after the tests were written`))}`,
    `## Red tests\n\n${bullets(red.map((result) => `- ${result.file}: ${result.status}`))}`,
    `## Regressions\n\n${bullets(regressions.map((name) => `- ${name}`))}`,
    `## Gaps\n\n${bullets(traced.gaps)}`,
    `## Notes\n\n${bullets(notes.map((note) => `- ${note}`))}`,
  ].join('\n\n')}\n`
}

// An adopted run has no cases: its request is traced to the adopted files as a whole.
function adoptedTrace(run, files, results) {
  const request = readFileSync(at(run, 'request.md'), 'utf8').trim().replace(/\s+/g, ' ')
  const result = results.every((entry) => entry.status === 'green') ? 'green' : 'red'
  const row = `| S1: ${request} | ${files.join(', ')} | ${result} |`
  return {
    section: `## Requirement → test\n\n| Sentence | Tests | Result |\n| --- | --- | --- |\n${row}`,
    gaps: result === 'green' ? [] : [`- S1: ${result}`],
  }
}

export function verifyRun(run) {
  const guard = readJson(at(run, 'guard.json'))
  const files = Object.keys(guard)
  const profile = readJson(at(run, 'profile.json'))
  const edited = changedSince(run.repo, guard)
  const results = files.map((file) => runTestFile(profile, run.repo, file))
  const red = results.filter((result) => result.status !== 'green')
  const { regressions, notes } = suiteRegressions(run, profile, files)
  const traced = run.state.adopted ? adoptedTrace(run, files, results) : buildTrace({ casesDoc: parse(readFileSync(at(run, 'cases.yaml'), 'utf8')), repo: run.repo, files, results })
  const ok = edited.length === 0 && red.length === 0 && regressions.length === 0 && traced.gaps.length === 0
  const dropped = existsSync(at(run, 'decisions.md')) ? readFileSync(at(run, 'decisions.md'), 'utf8').split('\n').filter((line) => line.startsWith('- Dropped ')) : []
  const markdown = renderVerify({ run, edited, red, regressions, traced, notes: [...notes, ...dropped.map((line) => line.slice(2))], ok })
  writeFileSync(at(run, 'verify.md'), markdown)
  return { ok, markdown }
}
