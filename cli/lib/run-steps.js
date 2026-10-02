import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { renderPrompt } from './candidate.js'
import { tryGit } from './exec.js'
import { readJson, writeJson } from './files.js'
import { casesErrors, mentionsId, modelErrors, readyErrors, splitRequest } from './model.js'
import { discoverProfile, stackFor } from './profile.js'
import { saveState } from './run-store.js'
import { changedSince, hashFiles, runTestFile } from './run-tests.js'
import { buildReport } from './trace.js'
import { mentionsUi } from './triage.js'

const PROMPTS = fileURLToPath(new URL('../../prompts', import.meta.url))
const MAX_ROUNDS = 3

export const FLOWS = {
  t0: ['direct', 'done'],
  t1: ['discover', 'write-tests', 'dev', 'qa', 'review', 'verify', 'done'],
  t2: ['discover', 'ba', 'qc', 'ready', 'write-tests', 'dev', 'qa', 'review', 'verify', 'done'],
}

const AGENTS = {
  ba: { model: 'opus', output: 'model.yaml', template: 'ba.md' },
  qc: { model: 'sonnet', output: 'cases.yaml', template: 'qc.md' },
  'write-tests': { model: 'sonnet', output: 'tests.yaml', template: 'write-tests.md' },
  dev: { model: 'sonnet', output: 'dev.md', template: 'dev.md' },
  review: { model: 'sonnet', output: 'review.md', template: 'review.md' },
}

export const firstStep = (tier) => FLOWS[tier][0]

const list = (value) => (Array.isArray(value) ? value : [])
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const at = (run, name) => join(run.dir, name)
const profileOf = (run) => readJson(at(run, 'profile.json'))
const skillOf = (run, role) => (existsSync(at(run, 'profile.json')) ? profileOf(run).skills[role][0] ?? null : null)
const advance = (run) => ({ step: FLOWS[run.state.tier][FLOWS[run.state.tier].indexOf(run.state.step) + 1] })
const stuck = (reason, patch = {}) => ({ step: 'stuck', patch: { ...patch, stuck_reason: reason } })

function readYaml(path) {
  if (!existsSync(path)) return undefined
  try {
    return parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function readOutput(run, name) {
  const path = at(run, name)
  if (!existsSync(path)) return { errors: [`${run.state.step}: ${path} was not written`] }
  try {
    return { value: parse(readFileSync(path, 'utf8')) }
  } catch (error) {
    return { errors: [`${name} is not valid YAML: ${error.message.split('\n')[0]}`] }
  }
}

function modelContext(run) {
  const request = readText(at(run, 'request.md'))
  return {
    sentenceIds: splitRequest(request).map((sentence) => sentence.id),
    uiRequest: mentionsUi(request),
    uxSourceAgreed: /\(about: ux-source\)/.test(readText(at(run, 'decisions.md'))),
  }
}

function failingSummary(run) {
  const results = existsSync(at(run, 'results.json')) ? readJson(at(run, 'results.json')) : []
  const red = results.filter((result) => result.status !== 'green')
  if (red.length === 0) return 'Nothing yet: run the tests.'
  return red.map((result) => `### ${result.file}\n\n\`\`\`\n${result.output.slice(-1500)}\n\`\`\``).join('\n\n')
}

function promptVars(run, step) {
  const request = readText(at(run, 'request.md')).trim()
  return {
    request,
    sentences: splitRequest(request).map((sentence) => `${sentence.id}: ${sentence.text}`).join('\n'),
    previous_model: readText(at(run, 'model.yaml.prev')).trim() || 'None.',
    decisions: readText(at(run, 'decisions.md')).trim() || 'None yet.',
    profile: readText(at(run, 'profile.json')).trim() || '{}',
    model: readText(at(run, 'model.yaml')).trim() || 'None.',
    cases: readText(at(run, 'cases.yaml')).trim() || 'None.',
    tests: readText(at(run, 'tests.yaml')).trim() || 'None.',
    failing: failingSummary(run),
    errors: run.state.errors.length > 0 ? run.state.errors.map((error) => `- ${error}`).join('\n') : 'None.',
    review_skill: skillOf(run, 'review') ?? '',
    test_skill: skillOf(run, 'test_writing') ?? 'none',
    output: at(run, AGENTS[step].output),
    repo: run.repo,
  }
}

function agentInstruction(run, step) {
  const template = step === 'write-tests' && run.state.tier === 't1' ? 'write-tests-t1.md' : AGENTS[step].template
  const promptFile = at(run, join('prompts', `${step}.md`))
  mkdirSync(dirname(promptFile), { recursive: true })
  writeFileSync(promptFile, renderPrompt(readFileSync(join(PROMPTS, template), 'utf8'), promptVars(run, step)))
  return { kind: 'agent', step, model: AGENTS[step].model, prompt_file: promptFile, output: at(run, AGENTS[step].output) }
}

function readySummary(run) {
  const model = readYaml(at(run, 'model.yaml')) ?? {}
  const cases = list(readYaml(at(run, 'cases.yaml'))?.cases)
  const lines = [
    '# Ready to build',
    '',
    `${list(model.sentences).length} sentences, ${list(model.rules).length} rules, ${list(model.flows).length} flows, ${cases.length} cases.`,
    '',
    ...list(model.rules).map((rule) => `- ${rule.id}: when ${rule.when}, then ${rule.then}`),
    ...list(model.flows).map((flow) => `- ${flow.id}: ${flow.name} — ${list(flow.steps).join(' → ')}`),
    ...(model.ui === true ? [`- UX source: ${model.ux?.source}; screens: ${list(model.ux?.screens).join(', ')}`] : []),
    '',
    ...cases.map((c) => `- ${c.id} [${c.layer}] covers ${list(c.covers).join(', ')}: expect ${c.expected}`),
  ]
  writeFileSync(at(run, 'ready.md'), `${lines.join('\n')}\n`)
  return at(run, 'ready.md')
}

export function nextInstruction(run) {
  const { step } = run.state
  if (step === 'done') return { kind: 'done', report: at(run, 'report.md') }
  if (step === 'stuck') return { kind: 'stuck', reason: run.state.stuck_reason }
  if (step === 'direct') return { kind: 'direct', message: 'T0: make the change directly, run the existing tests, then: spec-gate run submit' }
  if (step === 'ask') return { kind: 'ask', questions: list(readYaml(at(run, 'model.yaml'))?.questions), answers_file: at(run, 'answers.yaml') }
  if (step === 'ready') return { kind: 'approve', summary_file: readySummary(run) }
  if (step === 'review' && skillOf(run, 'review') === null) return { kind: 'cli', step, note: 'no review skill discovered; submit skips it' }
  if (AGENTS[step]) return agentInstruction(run, step)
  return { kind: 'cli', step }
}

function runAll(run, files) {
  const profile = profileOf(run)
  return files.map((file) => runTestFile(profile, run.repo, file))
}

// With a per-test report only a test whose name carries the id counts; a stack without one
// (jest) falls back to the id appearing in the file.
function caseIdsUntested(run, results, caseIds) {
  const tested = (id, result) =>
    result.tests.length > 0
      ? result.tests.some((test) => mentionsId(test.name, id))
      : mentionsId(readText(join(run.repo, result.file)), id)
  return caseIds.filter((id) => !results.some((result) => tested(id, result)))
}

function escalationNotes(run, testFiles) {
  const excluded = testFiles.map((file) => `:(exclude)${file}`)
  const diff = tryGit(run.repo, ['diff', '-U0', '--', '.', ...excluded]) ?? ''
  const branches = diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .filter((line) => /\b(if|else|switch|case|catch)\b|\?\s|&&|\|\|/.test(line)).length
  return branches > 5 ? [`the change added ${branches} branch lines outside its tests; consider rerunning with --tier t2`] : []
}

function devNote(run) {
  const note = readText(at(run, 'dev.md')).trim().split('\n')[0]
  return note ? `; last dev note: ${note}` : ''
}

function writeTests(run) {
  const output = readOutput(run, 'tests.yaml')
  if (output.errors) return output
  const files = list(output.value?.files).filter((file) => typeof file === 'string')
  if (files.length === 0) return { errors: ['write-tests: tests.yaml lists no files'] }
  const outside = files.filter((file) => isAbsolute(file) || relative(run.repo, resolve(run.repo, file)).startsWith('..'))
  if (outside.length > 0) return { errors: outside.map((file) => `write-tests: ${file} is outside the repository`) }
  const absent = files.filter((file) => !existsSync(join(run.repo, file)))
  if (absent.length > 0) return { errors: absent.map((file) => `write-tests: ${file} does not exist`) }
  const profile = profileOf(run)
  const globs = [...new Set(profile.stacks.flatMap((stack) => stack.test_globs))].join(', ')
  const unrunnable = files.filter((file) => stackFor(profile, file) === null)
  if (unrunnable.length > 0) {
    return { errors: unrunnable.map((file) => `write-tests: no test stack runs ${file}; use a name these globs match: ${globs}`) }
  }
  const results = runAll(run, files)
  const empty = results.filter((result) => result.status === 'no-tests')
  if (empty.length > 0) {
    return {
      errors: empty.map(
        (result) =>
          `write-tests: the ${stackFor(profile, result.file).name} runner found no tests in ${result.file}; its config leaves the file out, so move the file where that runner looks`,
      ),
    }
  }
  if (run.state.tier === 't2') {
    const caseIds = list(readYaml(at(run, 'cases.yaml'))?.cases).map((c) => c.id)
    const missing = caseIdsUntested(run, results, caseIds)
    if (missing.length > 0) return { errors: missing.map((id) => `write-tests: no test names ${id}`) }
  }
  for (const file of files) {
    mkdirSync(dirname(at(run, join('guard', file))), { recursive: true })
    cpSync(join(run.repo, file), at(run, join('guard', file)))
  }
  writeJson(at(run, 'guard.json'), hashFiles(run.repo, files))
  writeJson(at(run, 'results.json'), results)
  return advance(run)
}

function dev(run) {
  const note = readText(at(run, 'dev.md')).trim()
  if (note.startsWith('TEST-WRONG:')) return stuck(`dev says a test is wrong — ${note.split('\n').slice(0, 5).join(' ')}`)
  const changed = changedSince(run.repo, readJson(at(run, 'guard.json')))
  if (changed.length === 0) return advance(run)
  for (const file of changed) {
    mkdirSync(dirname(join(run.repo, file)), { recursive: true })
    cpSync(at(run, join('guard', file)), join(run.repo, file))
  }
  const round = run.state.round + 1
  if (round >= MAX_ROUNDS) return stuck(`dev kept changing test files: ${changed.join(', ')}`, { round })
  return {
    errors: changed.map((file) => `dev: your edit to ${file} was reverted — tests are read-only after the test-writer step`),
    patch: { round },
  }
}

function qa(run) {
  const files = Object.keys(readJson(at(run, 'guard.json')))
  const results = runAll(run, files)
  writeJson(at(run, 'results.json'), results)
  const untested = results.filter((result) => result.status === 'unrunnable').map((result) => `untested: ${result.file} (no test stack runs it)`)
  const red = results.filter((result) => ['red', 'no-tests'].includes(result.status))
  if (red.length === 0) {
    const notes = run.state.tier === 't1' ? escalationNotes(run, files) : []
    return { ...advance(run), patch: { notes: [...run.state.notes, ...untested, ...notes] } }
  }
  const round = run.state.round + 1
  if (round >= MAX_ROUNDS) {
    return stuck(`tests still red after ${MAX_ROUNDS} dev rounds: ${red.map((result) => result.file).join(', ')}${devNote(run)}`, { round })
  }
  return { step: 'dev', patch: { round } }
}

function writeReport(run, { files, results, notes }) {
  const t2 = run.state.tier === 't2'
  const { markdown, complete } = buildReport({
    runId: run.state.id,
    tier: run.state.tier,
    reasons: run.state.reasons,
    request: readText(at(run, 'request.md')),
    model: t2 ? readYaml(at(run, 'model.yaml')) : null,
    casesDoc: t2 ? readYaml(at(run, 'cases.yaml')) : null,
    files,
    results,
    notes,
    review: readText(at(run, 'review.md')) || null,
    repo: run.repo,
  })
  writeFileSync(at(run, 'report.md'), markdown)
  return complete
}

function verify(run) {
  const complete = writeReport(run, {
    files: Object.keys(readJson(at(run, 'guard.json'))),
    results: readJson(at(run, 'results.json')),
    notes: run.state.notes,
  })
  return { step: 'done', patch: { complete } }
}

function finishDirect(run) {
  const note = 'T0: changed directly by the session; spec-gate wrote and ran no tests.'
  writeReport(run, { files: [], results: [], notes: [...run.state.notes, note] })
  return { step: 'done' }
}

function recordAnswers(run, answers) {
  if (!answers || !existsSync(answers)) return { errors: ['ask: pass --answers <file> with one { id, answer } per question'] }
  const parsed = (() => {
    try {
      return { value: parse(readFileSync(answers, 'utf8')) }
    } catch (error) {
      return { errors: [`ask: the answers file is not valid YAML: ${error.message.split('\n')[0]}`] }
    }
  })()
  if (parsed.errors) return parsed
  const questions = list(readYaml(at(run, 'model.yaml'))?.questions)
  const answerOf = (question) => list(parsed.value).find((entry) => entry?.id === question.id)?.answer
  const missing = questions.filter((question) => !answerOf(question))
  if (missing.length > 0) return { errors: missing.map((question) => `ask: ${question.id} has no answer`) }
  const recorded = questions.map((question) => `- ${question.id} ${question.text} (about: ${question.about ?? 'rule'})\n  Answer: ${answerOf(question)}`)
  appendFileSync(at(run, 'decisions.md'), `${recorded.join('\n')}\n`)
  return { step: 'ba', patch: { ba_iterations: run.state.ba_iterations + 1 } }
}

const HANDLERS = {
  direct: finishDirect,
  discover(run) {
    const profile = discoverProfile(run.repo)
    writeJson(at(run, 'profile.json'), profile)
    if (profile.stacks.length === 0) {
      return stuck('no test stack found in this repository (looked for Go, vitest, jest and node --test); spec-gate cannot run its tests yet')
    }
    return advance(run)
  },
  ba(run) {
    const output = readOutput(run, 'model.yaml')
    if (output.errors) return output
    const errors = modelErrors(output.value, modelContext(run))
    if (errors.length > 0) return { errors }
    if (list(output.value.questions).length === 0) return advance(run)
    if (run.state.ba_iterations >= MAX_ROUNDS) return stuck(`BA still had questions after ${MAX_ROUNDS} rounds`)
    return { step: 'ask' }
  },
  ask: (run, { answers }) => recordAnswers(run, answers),
  qc(run) {
    const output = readOutput(run, 'cases.yaml')
    if (output.errors) return output
    const errors = casesErrors(readYaml(at(run, 'model.yaml')), output.value)
    return errors.length > 0 ? { errors } : advance(run)
  },
  ready(run, { approve, reject }) {
    if (reject) {
      appendFileSync(at(run, 'decisions.md'), `- Rejected at Ready: ${reject}\n`)
      return { step: 'ba', patch: { ba_iterations: run.state.ba_iterations + 1 } }
    }
    if (!approve) return { errors: ['ready: pass --approve, or --reject "<what is wrong>"'] }
    const errors = readyErrors(readYaml(at(run, 'model.yaml')), readYaml(at(run, 'cases.yaml')), modelContext(run))
    return errors.length > 0 ? { errors } : advance(run)
  },
  'write-tests': writeTests,
  dev,
  qa,
  review(run) {
    if (skillOf(run, 'review') === null) return advance(run)
    return existsSync(at(run, 'review.md')) ? advance(run) : { errors: [`review: ${at(run, 'review.md')} was not written`] }
  },
  verify,
}

// An agent's output from an earlier round must never pass for this round's: entering a step
// sets the old output aside, where the next prompt can still quote it.
function setAside(run, step) {
  const path = at(run, AGENTS[step].output)
  if (existsSync(path)) renameSync(path, `${path}.prev`)
}

export function submitStep(run, options = {}) {
  const handler = HANDLERS[run.state.step]
  if (!handler) throw new Error(`nothing to submit at step ${run.state.step}`)
  const outcome = handler(run, options)
  const errors = outcome.errors ?? []
  const attempts = errors.length > 0 ? (run.state.attempts ?? 0) + 1 : 0
  const exhausted = errors.length > 0 && attempts >= MAX_ROUNDS
  const step = exhausted ? 'stuck' : errors.length > 0 ? run.state.step : (outcome.step ?? run.state.step)
  const state = {
    ...run.state,
    ...(outcome.patch ?? {}),
    ...(exhausted ? { stuck_reason: `${run.state.step}: output failed its checks ${MAX_ROUNDS} times — ${errors.join('; ')}` } : {}),
    errors,
    attempts,
    step,
  }
  if (step !== run.state.step && AGENTS[step]) setAside(run, step)
  saveState(run.dir, state)
  return { state, errors }
}
