import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { renderPrompt } from './candidate.js'
import { tryGit } from './exec.js'
import { readJson, writeJson } from './files.js'
import { casesErrors, modelErrors, readyErrors } from './model.js'
import { discoverProfile } from './profile.js'
import { saveState } from './run-store.js'
import { caseIdsMissing, changedSince, hashFiles, runTestFile } from './run-tests.js'
import { buildReport } from './trace.js'

const PROMPTS = fileURLToPath(new URL('../../prompts', import.meta.url))
const MAX_ROUNDS = 3

export const FLOWS = {
  t0: ['direct', 'done'],
  t1: ['discover', 'write-tests', 'dev', 'qa', 'verify', 'done'],
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
const readYaml = (path) => (existsSync(path) ? parse(readFileSync(path, 'utf8')) : undefined)
const at = (run, name) => join(run.dir, name)
const profileOf = (run) => readJson(at(run, 'profile.json'))
const reviewSkill = (run) => (existsSync(at(run, 'profile.json')) ? profileOf(run).skills.review[0] ?? null : null)
const advance = (run) => ({ step: FLOWS[run.state.tier][FLOWS[run.state.tier].indexOf(run.state.step) + 1] })
const stuck = (reason, patch = {}) => ({ step: 'stuck', patch: { ...patch, stuck_reason: reason } })
const missingOutput = (run, name) => ({ errors: [`${run.state.step}: ${at(run, name)} was not written`] })

function failingSummary(run) {
  const results = existsSync(at(run, 'results.json')) ? readJson(at(run, 'results.json')) : []
  const red = results.filter((result) => result.status !== 'green')
  if (red.length === 0) return 'Nothing yet: run the tests.'
  return red.map((result) => `### ${result.file}\n\n\`\`\`\n${result.output.slice(-1500)}\n\`\`\``).join('\n\n')
}

function promptVars(run, step) {
  return {
    request: readText(at(run, 'request.md')).trim(),
    decisions: readText(at(run, 'decisions.md')).trim() || 'None yet.',
    profile: readText(at(run, 'profile.json')).trim() || '{}',
    model: readText(at(run, 'model.yaml')).trim() || 'None.',
    cases: readText(at(run, 'cases.yaml')).trim() || 'None.',
    tests: readText(at(run, 'tests.yaml')).trim() || 'None.',
    failing: failingSummary(run),
    errors: run.state.errors.length > 0 ? run.state.errors.map((error) => `- ${error}`).join('\n') : 'None.',
    review_skill: reviewSkill(run) ?? '',
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
  const model = readYaml(at(run, 'model.yaml'))
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
  if (step === 'review' && reviewSkill(run) === null) return { kind: 'cli', step, note: 'no review skill discovered; submit skips it' }
  if (AGENTS[step]) return agentInstruction(run, step)
  return { kind: 'cli', step }
}

function runAll(run, files) {
  const profile = profileOf(run)
  return files.map((file) => runTestFile(profile, run.repo, file))
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

const HANDLERS = {
  direct: () => ({ step: 'done' }),
  discover(run) {
    writeJson(at(run, 'profile.json'), discoverProfile(run.repo))
    return advance(run)
  },
  ba(run) {
    const model = readYaml(at(run, 'model.yaml'))
    if (model === undefined) return missingOutput(run, 'model.yaml')
    const errors = modelErrors(model)
    if (errors.length > 0) return { errors }
    if (list(model.questions).length === 0) return advance(run)
    if (run.state.ba_iterations >= MAX_ROUNDS) return stuck(`BA still had questions after ${MAX_ROUNDS} rounds`)
    return { step: 'ask' }
  },
  ask(run, { answers }) {
    if (!answers) return { errors: ['ask: pass --answers <file> with one { id, answer } per question'] }
    const questions = list(readYaml(at(run, 'model.yaml'))?.questions)
    const given = list(parse(readFileSync(answers, 'utf8')))
    const answerOf = (question) => given.find((entry) => entry.id === question.id)?.answer
    const missing = questions.filter((question) => !answerOf(question))
    if (missing.length > 0) return { errors: missing.map((question) => `ask: ${question.id} has no answer`) }
    const recorded = questions.map((question) => `- ${question.id} ${question.text}\n  Answer: ${answerOf(question)}`)
    appendFileSync(at(run, 'decisions.md'), `${recorded.join('\n')}\n`)
    return { step: 'ba', patch: { ba_iterations: run.state.ba_iterations + 1 } }
  },
  qc(run) {
    const casesDoc = readYaml(at(run, 'cases.yaml'))
    if (casesDoc === undefined) return missingOutput(run, 'cases.yaml')
    const errors = casesErrors(readYaml(at(run, 'model.yaml')), casesDoc)
    return errors.length > 0 ? { errors } : advance(run)
  },
  ready(run, { approve, reject }) {
    if (reject) {
      appendFileSync(at(run, 'decisions.md'), `- Rejected at Ready: ${reject}\n`)
      return { step: 'ba', patch: { ba_iterations: run.state.ba_iterations + 1 } }
    }
    if (!approve) return { errors: ['ready: pass --approve, or --reject "<what is wrong>"'] }
    const errors = readyErrors(readYaml(at(run, 'model.yaml')), readYaml(at(run, 'cases.yaml')))
    return errors.length > 0 ? { errors } : advance(run)
  },
  'write-tests'(run) {
    const doc = readYaml(at(run, 'tests.yaml'))
    if (doc === undefined) return missingOutput(run, 'tests.yaml')
    const files = list(doc.files)
    if (files.length === 0) return { errors: ['write-tests: tests.yaml lists no files'] }
    const absent = files.filter((file) => !existsSync(join(run.repo, file)))
    if (absent.length > 0) return { errors: absent.map((file) => `write-tests: ${file} does not exist`) }
    if (run.state.tier === 't2') {
      const caseIds = list(readYaml(at(run, 'cases.yaml'))?.cases).map((c) => c.id)
      const missing = caseIdsMissing(run.repo, files, caseIds)
      if (missing.length > 0) return { errors: missing.map((id) => `write-tests: no test names ${id}`) }
    }
    writeJson(at(run, 'guard.json'), hashFiles(run.repo, files))
    writeJson(at(run, 'results.json'), runAll(run, files))
    return advance(run)
  },
  dev(run) {
    const changed = changedSince(run.repo, readJson(at(run, 'guard.json')))
    if (changed.length === 0) return advance(run)
    const round = run.state.round + 1
    if (round >= MAX_ROUNDS) return stuck(`dev kept changing test files: ${changed.join(', ')}`, { round })
    return {
      errors: changed.map((file) => `dev: ${file} changed; restore it — tests are read-only after the test-writer step`),
      patch: { round },
    }
  },
  qa(run) {
    const files = Object.keys(readJson(at(run, 'guard.json')))
    const results = runAll(run, files)
    writeJson(at(run, 'results.json'), results)
    const red = results.filter((result) => result.status !== 'green')
    if (red.length === 0) {
      const notes = run.state.tier === 't1' ? escalationNotes(run, files) : []
      return { ...advance(run), patch: { notes: [...run.state.notes, ...notes] } }
    }
    const round = run.state.round + 1
    if (round >= MAX_ROUNDS) return stuck(`tests still red after ${MAX_ROUNDS} dev rounds: ${red.map((r) => r.file).join(', ')}`, { round })
    return { step: 'dev', patch: { round } }
  },
  review(run) {
    if (reviewSkill(run) === null) return advance(run)
    return existsSync(at(run, 'review.md')) ? advance(run) : missingOutput(run, 'review.md')
  },
  verify(run) {
    const t2 = run.state.tier === 't2'
    const { markdown, complete } = buildReport({
      runId: run.state.id,
      tier: run.state.tier,
      reasons: run.state.reasons,
      request: readText(at(run, 'request.md')),
      model: t2 ? readYaml(at(run, 'model.yaml')) : null,
      casesDoc: t2 ? readYaml(at(run, 'cases.yaml')) : null,
      files: Object.keys(readJson(at(run, 'guard.json'))),
      results: readJson(at(run, 'results.json')),
      notes: run.state.notes,
      repo: run.repo,
    })
    writeFileSync(at(run, 'report.md'), markdown)
    return { step: 'done', patch: { complete } }
  },
}

export function submitStep(run, options = {}) {
  const handler = HANDLERS[run.state.step]
  if (!handler) throw new Error(`nothing to submit at step ${run.state.step}`)
  const outcome = handler(run, options)
  const errors = outcome.errors ?? []
  const state = {
    ...run.state,
    ...(outcome.patch ?? {}),
    errors,
    step: errors.length > 0 ? run.state.step : outcome.step ?? run.state.step,
  }
  saveState(run.dir, state)
  return { state, errors }
}
