import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { renderPrompt } from './candidate.js'
import { casesDocErrors, isSplit, readySummary, UX_SOURCE_UNASKED } from './cases.js'
import { withoutCase } from './drop-case.js'
import { readJson, writeJson } from './files.js'
import { findKnowledge } from './knowledge.js'
import { discoverProfile, stackFor } from './profile.js'
import { buildQcPacket } from './qc-packet.js'
import { saveState } from './run-store.js'
import { didNotLoad, failureKind, hashFiles, runSuite, runTestFile, suiteTargets, wrongReasons } from './run-tests.js'
import { repoSlug } from './store.js'
import { mentionsId, splitRequest } from './text.js'

const PROMPTS = fileURLToPath(new URL('../../prompts', import.meta.url))
const NO_KNOWLEDGE = 'No knowledge file was found; follow the conventions of the tests next to the code.'

export const FLOW = ['discover', 'qc', 'ready', 'write-tests', 'done']
const MAX_ATTEMPTS = 3
const MAX_QC_ROUNDS = 3
const AGENTS = {
  qc: { model: 'opus', output: 'cases.yaml', template: 'qc-blind.md' },
  'write-tests': { model: 'sonnet', output: 'tests.yaml', template: 'write-tests.md' },
}

const list = (value) => (Array.isArray(value) ? value : [])
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const at = (run, name) => join(run.dir, name)
const profileOf = (run) => readJson(at(run, 'profile.json'))
const advance = (run) => ({ step: FLOW[FLOW.indexOf(run.state.step) + 1] })
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

function qcContext(run) {
  return {
    sentenceIds: splitRequest(readText(at(run, 'request.md'))).map((sentence) => sentence.id),
    uiRequest: run.state.signals.ui,
    uxSourceAgreed: /\(about: ux-source\)/.test(readText(at(run, 'decisions.md'))),
    unknownAnswers: /^\s*Answer: unknown\b/im.test(readText(at(run, 'decisions.md'))),
  }
}

function runAll(run, files) {
  const profile = profileOf(run)
  return files.map((file) => runTestFile(profile, run.repo, file))
}

function caseIdsUntested(run, results, caseIds) {
  const tested = (id, result) =>
    didNotLoad(result)
      ? mentionsId(readText(join(run.repo, result.file)), id)
      : result.tests.some((test) => mentionsId(test.name, id))
  return caseIds.filter((id) => !results.some((result) => tested(id, result)))
}

function suiteFailures(run, files) {
  const targets = suiteTargets(profileOf(run), run.repo, files)
  return Object.fromEntries(targets.map((target) => [target.key, runSuite(run.repo, target).failing]))
}

function guardFiles(run, files) {
  for (const file of files) {
    mkdirSync(dirname(at(run, join('guard', file))), { recursive: true })
    cpSync(join(run.repo, file), at(run, join('guard', file)))
  }
  writeJson(at(run, 'guard.json'), hashFiles(run.repo, files))
}

function caseStatus(run, result, id) {
  if (!result) return 'not run'
  const test = result.tests.find((entry) => mentionsId(entry.name, id))
  if (!test) return result.status === 'red' && mentionsId(readText(join(run.repo, result.file)), id) ? 'red (missing)' : 'not run'
  if (test.status === 'pass') return 'green (already holds)'
  const failure = Object.entries(result.failures ?? {}).find(([name]) => name === test.name || name.endsWith(` > ${test.name}`))?.[1]
  const kind = failure ? failureKind(failure) : 'other'
  return kind === 'missing' ? 'red (missing)' : kind === 'assertion' || kind === 'other' ? 'red (assertion)' : 'not run'
}

function testsReport(run, results) {
  const cases = list(readYaml(at(run, 'cases.yaml'))?.cases)
  const written = readYaml(at(run, 'tests.yaml'))
  const disputed = list(written?.disputed)
  const assumes = list(written?.assumes).filter((line) => typeof line === 'string')
  const dropped = list(written?.dropped)
  const lines = cases.map((c) => {
    const result = results.find((entry) => entry.tests.some((test) => mentionsId(test.name, c.id)) || mentionsId(readText(join(run.repo, entry.file)), c.id))
    const name = result?.tests.find((test) => mentionsId(test.name, c.id))?.name ?? result?.file ?? 'no test'
    return `- ${c.id} ${c.then} — ${name}: ${caseStatus(run, result, c.id)}`
  })
  const assumed = cases.filter((c) => c.basis === 'assumed').map((c) => `- ${c.id}: ${c.then}`)
  return [
    '# Tests written',
    '',
    '## Cases',
    '',
    ...lines,
    '',
    '## Disputed',
    '',
    ...(disputed.length > 0 ? disputed.map((d) => `- ${d?.case}: ${d?.reason}`) : ['None.']),
    '',
    '## Assumed cases',
    '',
    ...(assumed.length > 0 ? assumed : ['None.']),
    '',
    '## Interfaces the tests assume',
    '',
    ...(assumes.length > 0 ? assumes.map((line) => `- ${line}`) : ['None.']),
    '',
    '## Dropped',
    '',
    ...(dropped.length > 0 ? dropped.map((entry) => `- ${entry?.case}: ${entry?.reason}`) : ['None.']),
    '',
  ].join('\n')
}

function checkFiles(run, output) {
  const files = list(output.value?.files).filter((file) => typeof file === 'string')
  if (files.length === 0) return { errors: ['write-tests: tests.yaml lists no files'] }
  const outside = files.filter((file) => isAbsolute(file) || relative(run.repo, resolve(run.repo, file)).startsWith('..'))
  if (outside.length > 0) return { errors: outside.map((file) => `write-tests: ${file} is outside the repository`) }
  const absent = files.filter((file) => !existsSync(join(run.repo, file)))
  if (absent.length > 0) return { errors: absent.map((file) => `write-tests: ${file} does not exist`) }
  const profile = profileOf(run)
  const globs = [...new Set(profile.stacks.flatMap((stack) => stack.test_globs))].join(', ')
  const unrunnable = files.filter((file) => stackFor(profile, file) === null)
  if (unrunnable.length > 0) return { errors: unrunnable.map((file) => `write-tests: no test stack runs ${file}; use a name these globs match: ${globs}`) }
  return { files }
}

function droppedCaseErrors(dropped, caseIds) {
  return [
    ...dropped.filter((entry) => !caseIds.includes(entry.case)).map((entry) => `write-tests: dropped ${entry.case} is not a case`),
    ...dropped.filter((entry) => typeof entry.reason !== 'string' || entry.reason.trim() === '').map((entry) => `write-tests: dropped ${entry.case} needs a reason`),
    ...(dropped.length * 3 > caseIds.length ? [`write-tests: ${dropped.length} of ${caseIds.length} cases dropped; drop at most a third`] : []),
  ]
}

// A case the writer cannot test here leaves cases.yaml like a user drop, so verify's trace agrees.
function recordDropped(run, dropped) {
  if (dropped.length === 0) return
  const doc = dropped.reduce((current, entry) => withoutCase(current, entry.case, entry.reason.trim()), readYaml(at(run, 'cases.yaml')))
  writeFileSync(at(run, 'cases.yaml'), stringify(doc))
  appendFileSync(at(run, 'decisions.md'), dropped.map((entry) => `- Dropped ${entry.case} at write-tests: ${entry.reason.trim()}\n`).join(''))
}

function writeTests(run) {
  const output = readOutput(run, 'tests.yaml')
  if (output.errors) return output
  const checked = checkFiles(run, output)
  if (checked.errors) return checked
  const { files } = checked
  const results = runAll(run, files)
  const empty = results.filter((result) => result.status === 'no-tests')
  if (empty.length > 0) {
    return {
      errors: empty.map(
        (result) =>
          `write-tests: the ${stackFor(profileOf(run), result.file).name} runner found no tests in ${result.file}; its config leaves the file out, so move the file where that runner looks`,
      ),
    }
  }
  const allIds = list(readYaml(at(run, 'cases.yaml'))?.cases).map((c) => c.id)
  const dropped = list(output.value?.dropped).filter((entry) => entry && typeof entry === 'object')
  const droppedErrors = droppedCaseErrors(dropped, allIds)
  if (droppedErrors.length > 0) return { errors: droppedErrors }
  const caseIds = allIds.filter((id) => !dropped.some((entry) => entry.case === id))
  const wrong = results.flatMap((result) => wrongReasons(result, caseIds, { source: readText(join(run.repo, result.file)) }))
  if (wrong.length > 0) return { errors: wrong.map((line) => `write-tests: ${line}`) }
  const missing = caseIdsUntested(run, results, caseIds)
  if (missing.length > 0) return { errors: missing.map((id) => `write-tests: no test names ${id}`) }
  recordDropped(run, dropped)
  guardFiles(run, files)
  writeJson(at(run, 'results.json'), results)
  writeJson(at(run, 'suite-baseline.json'), suiteFailures(run, files))
  writeFileSync(at(run, 'report.md'), testsReport(run, results))
  return advance(run)
}

function askUxSource(run, doc) {
  const question = {
    id: 'QUX',
    text: 'There is no Figma link, screenshot or agreed screen for this UI. What should it match: the existing screens as they are now, a design you can share, or nothing agreed yet?',
    about: 'ux-source',
  }
  writeFileSync(at(run, 'cases.yaml'), stringify({ ...doc, questions: [...list(doc.questions).filter((q) => q?.id !== 'QUX'), question] }))
  if (run.state.qc_rounds >= MAX_QC_ROUNDS) return stuck(`QC still had questions after ${MAX_QC_ROUNDS} rounds`)
  return { step: 'ask' }
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
  const questions = list(readYaml(at(run, 'cases.yaml'))?.questions)
  const answerOf = (question) => list(parsed.value).find((entry) => entry?.id === question.id)?.answer
  const missing = questions.filter((question) => !answerOf(question))
  if (missing.length > 0) return { errors: missing.map((question) => `ask: ${question.id} has no answer`) }
  const recorded = questions.map((question) => `- ${question.id} ${question.text} (about: ${question.about ?? 'rule'})\n  Answer: ${answerOf(question)}`)
  appendFileSync(at(run, 'decisions.md'), `${recorded.join('\n')}\n`)
  return { step: 'qc', patch: { qc_rounds: run.state.qc_rounds + 1 } }
}

const HANDLERS = {
  discover(run) {
    const profile = discoverProfile(run.repo)
    writeJson(at(run, 'profile.json'), profile)
    if (profile.stacks.length === 0) return stuck('no test stack found in this repository (looked for Go, vitest, jest, node --test and Playwright)')
    const knowledge = findKnowledge(run.repo, repoSlug(run.repo), run.env)
    if (knowledge) writeFileSync(at(run, 'knowledge.md'), knowledge.text)
    writeFileSync(at(run, 'qc-packet.md'), buildQcPacket({ repo: run.repo, request: readText(at(run, 'request.md')), knowledgeText: knowledge?.text, profile }))
    return advance(run)
  },
  qc(run) {
    const output = readOutput(run, 'cases.yaml')
    if (output.errors) return output
    const errors = casesDocErrors(output.value, qcContext(run))
    if (errors.length > 0 && errors.every((error) => UX_SOURCE_UNASKED.includes(error))) return askUxSource(run, output.value)
    if (errors.length > 0) return { errors }
    if (isSplit(output.value)) return { step: 'split', patch: { split: list(output.value.split) } }
    if (list(output.value.questions).length === 0) return advance(run)
    if (run.state.qc_rounds >= MAX_QC_ROUNDS) return stuck(`QC still had questions after ${MAX_QC_ROUNDS} rounds`)
    return { step: 'ask' }
  },
  ask: (run, { answers }) => recordAnswers(run, answers),
  ready(run, { approve, reject }) {
    if (reject) {
      appendFileSync(at(run, 'decisions.md'), `- Rejected at Ready: ${reject}\n`)
      return { step: 'qc', patch: { qc_rounds: run.state.qc_rounds + 1 } }
    }
    return approve ? advance(run) : { errors: ['ready: pass --approve, or --reject "<what is wrong>"'] }
  },
  'write-tests': writeTests,
}

function promptVars(run, step) {
  const { signals } = run.state
  const request = readText(at(run, 'request.md')).trim()
  const sentences = splitRequest(request).map((sentence) => `- { id: ${sentence.id}, text: ${JSON.stringify(sentence.text)}, cases: [] }`)
  return {
    packet: at(run, 'qc-packet.md'),
    risk: `level ${signals.level}; access: ${list(signals.access).join(', ') || 'none'}; features: ${list(signals.feature).join(', ') || 'none'}; screens: ${list(signals.screens).join(', ') || 'none'}`,
    sentences: sentences.join('\n    '),
    decisions: readText(at(run, 'decisions.md')).trim() || 'None yet.',
    cases: readText(at(run, 'cases.yaml')).trim().replace(/\n/g, '\n    ') || 'None.',
    previous: readText(at(run, 'cases.yaml.prev')).trim() || 'None.',
    knowledge: readText(at(run, 'knowledge.md')).trim() || NO_KNOWLEDGE,
    profile: readText(at(run, 'profile.json')).trim() || '{}',
    errors: run.state.errors.length > 0 ? run.state.errors.map((error) => `- ${error}`).join('\n') : 'None.',
    output: at(run, AGENTS[step].output),
    repo: run.repo,
  }
}

function agentInstruction(run, step) {
  const promptFile = at(run, join('prompts', `${step}.md`))
  mkdirSync(dirname(promptFile), { recursive: true })
  writeFileSync(promptFile, renderPrompt(readFileSync(join(PROMPTS, AGENTS[step].template), 'utf8'), promptVars(run, step)))
  // Revising cases after answers or a rejection is lighter work than the first pass.
  const model = step === 'qc' && run.state.qc_rounds > 0 ? 'sonnet' : AGENTS[step].model
  return { kind: 'agent', step, model, prompt_file: promptFile, output: at(run, AGENTS[step].output) }
}

export function nextInstruction(run) {
  const { step } = run.state
  if (step === 'done') return { kind: 'done', report: at(run, 'report.md') }
  if (step === 'stuck') return { kind: 'stuck', reason: run.state.stuck_reason }
  if (step === 'split') return { kind: 'split', requests: run.state.split }
  if (step === 'ask') return { kind: 'ask', questions: list(readYaml(at(run, 'cases.yaml'))?.questions), answers_file: at(run, 'answers.yaml') }
  if (step === 'ready') {
    writeFileSync(at(run, 'ready.md'), readySummary(readYaml(at(run, 'cases.yaml')), { casesPath: at(run, 'cases.yaml') }))
    return { kind: 'approve', summary_file: at(run, 'ready.md') }
  }
  if (AGENTS[step]) return agentInstruction(run, step)
  return { kind: 'cli', step }
}

// An agent's output from an earlier round must never pass for this round's: entering a step
// sets the old output aside as <name>.prev, which the qc prompt quotes as the previous cases.
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
  const exhausted = errors.length > 0 && attempts >= MAX_ATTEMPTS
  const step = exhausted ? 'stuck' : errors.length > 0 ? run.state.step : (outcome.step ?? run.state.step)
  const state = {
    ...run.state,
    ...(outcome.patch ?? {}),
    ...(exhausted ? { stuck_reason: `${run.state.step}: output failed its checks ${MAX_ATTEMPTS} times — ${errors.join('; ')}` } : {}),
    errors,
    attempts,
    step,
  }
  if (step !== run.state.step && AGENTS[step]) setAside(run, step)
  saveState(run.dir, state)
  return { state, errors }
}
