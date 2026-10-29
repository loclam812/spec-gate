import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { readJson } from './files.js'
import { stackFor } from './profile.js'
import { changedSince, runSuite, runTestFile, suiteTargets } from './run-tests.js'
import { logEvent } from './run-log.js'
import { buildTrace } from './trace.js'

const at = (run, name) => join(run.dir, name)
const NEW_FAILURES_TO_STOP = 5
const bullets = (items) => (items.length > 0 ? items.join('\n') : 'None.')

function suiteRegressions(run, profile, files) {
  const baseline = existsSync(at(run, 'suite-baseline.json')) ? readJson(at(run, 'suite-baseline.json')) : {}
  const checked = suiteTargets(profile, run.repo, files).map((target) => {
    // Runs recorded before 0.7.7 kept only the failing names, so any new failure there is a suspect.
    const before = Array.isArray(baseline[target.key]) ? { failing: baseline[target.key], passing: null } : baseline[target.key]
    // A handful of new failures proves a regression; running every broken browser test to its
    // timeout only makes the user wait.
    const now = runSuite(run.repo, target, undefined, { maxFailures: Array.isArray(before?.failing) ? before.failing.length + NEW_FAILURES_TO_STOP : null })
    if (!Array.isArray(before?.failing) || now.failing === null) return { note: `suite not checked: ${target.key}` }
    const newFailures = now.failing.filter((name) => !before.failing.includes(name))
    // A test that did not pass when the suite was recorded, such as one another run added since,
    // cannot have been broken by this change.
    const unrecorded = before.passing ? newFailures.filter((name) => !before.passing.includes(name)) : []
    const suspects = newFailures.filter((name) => !unrecorded.includes(name))
    // A new failure counts only if it fails again: a test that passes on a rerun is flaky.
    const again = suspects.length > 0 ? runSuite(run.repo, target).failing : []
    const broken = again === null ? suspects : suspects.filter((name) => again.includes(name))
    const flaky = suspects.filter((name) => !broken.includes(name)).map((name) => `flaky: ${name} failed once and passed on a rerun`)
    const stopped = now.stopped ? [`${target.key} stopped after ${now.failing.length} failures; more tests may be broken`] : []
    const notCompared = unrecorded.map((name) => `not compared: ${name} fails now but did not pass when the suite was recorded`)
    return { broken, notes: [...notCompared, ...flaky, ...stopped] }
  })
  const comparable = new Set(suiteTargets(profile, run.repo, files).map((target) => target.stack.name))
  const unreported = [...new Set(files.map((file) => stackFor(profile, file)?.name).filter((name) => name && !comparable.has(name)))]
  return {
    regressions: checked.flatMap((entry) => entry.broken ?? []),
    notes: [...checked.flatMap((entry) => [...(entry.note ? [entry.note] : []), ...(entry.notes ?? [])]), ...unreported.map((name) => `suite not checked: ${name} has no per-test suite report`)],
  }
}

// Editing an old test can be right (a changed interface), so it is listed for review, not failed.
function existingTestsChanged(run) {
  if (!existsSync(at(run, 'existing-tests.json'))) return null
  return changedSince(run.repo, readJson(at(run, 'existing-tests.json'))).map((file) =>
    existsSync(join(run.repo, file)) ? `- ${file} changed since spec-gate recorded it; check it was not weakened` : `- ${file} was deleted since spec-gate recorded it`,
  )
}

const existingSection = (lines) =>
  `## Existing tests changed\n\n${lines === null ? 'Not checked: this run was written before spec-gate recorded the existing tests.' : bullets(lines)}`

function renderVerify({ run, edited, existing, red, regressions, traced, notes, ok }) {
  return `${[
    `# spec-gate verify ${run.state.id}`,
    `**Result:** ${ok ? 'pass' : 'fail'}`,
    traced.section,
    `## Changed test and helper files\n\n${bullets(edited.map((file) => `- ${file} changed after the tests were written`))}`,
    existingSection(existing),
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
  const helpers = existsSync(at(run, 'guard-helpers.json')) ? readJson(at(run, 'guard-helpers.json')) : {}
  const edited = [...changedSince(run.repo, guard), ...changedSince(run.repo, helpers)]
  const existing = existingTestsChanged(run)
  const results = files.map((file) => runTestFile(profile, run.repo, file))
  const red = results.filter((result) => result.status !== 'green')
  const { regressions, notes } = suiteRegressions(run, profile, files)
  const traced = run.state.adopted ? adoptedTrace(run, files, results) : buildTrace({ casesDoc: parse(readFileSync(at(run, 'cases.yaml'), 'utf8')), repo: run.repo, files, results })
  const ok = edited.length === 0 && red.length === 0 && regressions.length === 0 && traced.gaps.length === 0
  const dropped = existsSync(at(run, 'decisions.md')) ? readFileSync(at(run, 'decisions.md'), 'utf8').split('\n').filter((line) => line.startsWith('- Dropped ') || line.startsWith('- Amended ')) : []
  const markdown = renderVerify({ run, edited, existing, red, regressions, traced, notes: [...notes, ...dropped.map((line) => line.slice(2))], ok })
  writeFileSync(at(run, 'verify.md'), markdown)
  logEvent(run.dir, { kind: 'verify', ok, red: red.length, regressions: regressions.length, edited: edited.length, existing_edited: existing?.length ?? null })
  return { ok, markdown }
}
