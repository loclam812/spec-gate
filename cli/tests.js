import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { screenNames } from './lib/profile.js'
import { riskSignals } from './lib/risk.js'
import { createRun, latestRunId, loadState, runsDir } from './lib/run-store.js'
import { nextInstruction, submitStep } from './lib/tests-steps.js'
import { repoSlug } from './lib/store.js'

const OPTIONS = {
  repo: { type: 'string', default: '.' },
  run: { type: 'string' },
  request: { type: 'string' },
  'request-file': { type: 'string' },
  answers: { type: 'string' },
  approve: { type: 'boolean', default: false },
  reject: { type: 'string' },
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
