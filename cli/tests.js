import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { screenNames } from './lib/profile.js'
import { riskSignals } from './lib/risk.js'
import { createRun, latestRunId, loadState, runsDir } from './lib/run-store.js'
import { verifyRun } from './lib/verify.js'
import { nextInstruction, submitStep } from './lib/tests-steps.js'
import { projectDir, repoSlug } from './lib/store.js'
import { findKnowledge, knowledgeErrors, knowledgePaths } from './lib/knowledge.js'
import { renderPrompt } from './lib/candidate.js'

const OPTIONS = {
  repo: { type: 'string', default: '.' },
  run: { type: 'string' },
  request: { type: 'string' },
  'request-file': { type: 'string' },
  answers: { type: 'string' },
  approve: { type: 'boolean', default: false },
  reject: { type: 'string' },
  file: { type: 'string' },
  'old-skill': { type: 'string' },
}

const USAGE = 'usage: spec-gate tests <start|next|submit|status> [--repo <path>] [--run <id>] [--request "<text>" | --request-file <path>] [--answers <file>] [--approve | --reject "<why>"]'

const print = (out, value) => out.write(`${JSON.stringify(value, null, 2)}\n`)

function openRun(values, env) {
  const repo = resolve(values.repo)
  const slug = repoSlug(repo)
  const dir = join(runsDir(slug, env), values.run ?? latestRunId(slug, env, repo))
  return { dir, repo, env, state: loadState(dir) }
}

function start(values, rest, env, out) {
  const repo = resolve(values.repo)
  const request = values['request-file'] ? readFileSync(values['request-file'], 'utf8') : (values.request ?? rest.join(' '))
  if (!request.trim()) throw new Error('start: give the request with --request "<text>" or --request-file <path>')
  const signals = riskSignals(request, { screens: screenNames(repo) })
  const created = createRun(repoSlug(repo), env, { request, repo, signals })
  print(out, { run: created.id, risk: signals })
  return 0
}

export function runTests(argv, { env = process.env, out = process.stdout } = {}) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true })
  const [command, ...rest] = positionals
  if (command === 'start') return start(values, rest, env, out)
  if (command === 'next') {
    print(out, nextInstruction(openRun(values, env)))
    return 0
  }
  if (command === 'submit') {
    const { state, errors } = submitStep(openRun(values, env), { answers: values.answers, approve: values.approve, reject: values.reject })
    print(out, { step: state.step, errors })
    return errors.length > 0 ? 1 : 0
  }
  if (command === 'status') {
    print(out, openRun(values, env).state)
    return 0
  }
  throw new Error(USAGE)
}

export function runVerify(argv, { env = process.env, out = process.stdout } = {}) {
  const { values } = parseArgs({ args: argv, options: OPTIONS })
  const run = openRun(values, env)
  if (run.state.step !== 'done') throw new Error(`verify: run ${run.state.id} is at step ${run.state.step}; finish spec-gate tests first`)
  const { ok } = verifyRun(run)
  print(out, { ok, report: join(run.dir, 'verify.md') })
  return ok ? 0 : 1
}

const LEARN_PROMPT = fileURLToPath(new URL('../prompts/learn-project.md', import.meta.url))
const KNOWLEDGE_USAGE = 'usage: spec-gate knowledge <path|check|draft> [--repo <path>] [--file <path>] [--old-skill <dir>]'

const skillFiles = (path) =>
  path.endsWith('SKILL.md') ? [path] : readdirSync(path, { recursive: true }).filter((entry) => entry.endsWith('SKILL.md')).map((entry) => join(path, entry))

function draftKnowledge(values, repo, slug, env) {
  const dir = projectDir(slug, env)
  mkdirSync(dir, { recursive: true })
  const output = join(dir, 'knowledge.draft.md')
  const found = values['old-skill'] ? skillFiles(resolve(values['old-skill'])) : []
  const prompt = renderPrompt(readFileSync(LEARN_PROMPT, 'utf8'), { repo, output, old_skills: found.length > 0 ? found.join(', ') : 'None.' })
  const promptFile = join(dir, 'learn-project.prompt.md')
  writeFileSync(promptFile, prompt)
  return { prompt_file: promptFile, output, model: 'sonnet' }
}

export function runKnowledge(argv, { env = process.env, out = process.stdout } = {}) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true })
  const repo = resolve(values.repo)
  const slug = repoSlug(repo)
  const [command] = positionals
  if (command === 'path') {
    const paths = knowledgePaths(repo, slug, env)
    const found = findKnowledge(repo, slug, env)
    print(out, { found: found !== null, path: found?.path ?? null, repo_path: paths.repo, store_path: paths.store })
    return 0
  }
  if (command === 'check') {
    if (!values.file) throw new Error('check: give the file with --file <path>')
    const errors = knowledgeErrors(readFileSync(resolve(values.file), 'utf8'))
    print(out, { errors })
    return errors.length > 0 ? 1 : 0
  }
  if (command === 'draft') {
    print(out, draftKnowledge(values, repo, slug, env))
    return 0
  }
  throw new Error(KNOWLEDGE_USAGE)
}
