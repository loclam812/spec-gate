import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { writeJson } from './lib/files.js'
import { discoverProfile, screenNames } from './lib/profile.js'
import { createRun, latestRunId, loadState, runsDir } from './lib/run-store.js'
import { firstStep, nextInstruction, submitStep } from './lib/run-steps.js'
import { projectDir, repoSlug } from './lib/store.js'
import { triage } from './lib/triage.js'

const OPTIONS = {
  repo: { type: 'string', default: '.' },
  run: { type: 'string' },
  request: { type: 'string' },
  'request-file': { type: 'string' },
  tier: { type: 'string' },
  answers: { type: 'string' },
  approve: { type: 'boolean', default: false },
  reject: { type: 'string' },
  'stop-after': { type: 'string' },
}

const USAGE = 'usage: spec-gate run <start|next|submit|status> [--repo <path>] [--run <id>] [--request "<text>" | --request-file <path>] [--tier t0|t1|t2] [--answers <file>] [--approve | --reject "<why>"] [--stop-after write-tests]'

const print = (out, value) => out.write(`${JSON.stringify(value, null, 2)}\n`)

function openRun(values, env) {
  const repo = resolve(values.repo)
  const slug = repoSlug(repo)
  const dir = join(runsDir(slug, env), values.run ?? latestRunId(slug, env, repo))
  return { dir, repo, state: loadState(dir) }
}

function start(values, rest, env, out) {
  const repo = resolve(values.repo)
  const request = values['request-file'] ? readFileSync(values['request-file'], 'utf8') : (values.request ?? rest.join(' '))
  if (!request.trim()) throw new Error('start: give the request with --request "<text>" or --request-file <path>')
  const stopAfter = values['stop-after'] ?? null
  if (stopAfter !== null && stopAfter !== 'write-tests') throw new Error('start: --stop-after accepts only write-tests')
  const triaged = triage(request, { override: values.tier ?? null, screens: screenNames(repo) })
  const created = createRun(repoSlug(repo), env, { request, triaged, repo, firstStep: firstStep(triaged.tier), stopAfter })
  print(out, { run: created.id, tier: triaged.tier, reasons: triaged.reasons })
  return 0
}

export function runRun(argv, { env = process.env, out = process.stdout } = {}) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true })
  const [command, ...rest] = positionals
  if (command === 'start') return start(values, rest, env, out)
  if (command === 'next') {
    print(out, nextInstruction(openRun(values, env)))
    return 0
  }
  if (command === 'submit') {
    const { state, errors } = submitStep(openRun(values, env), {
      answers: values.answers,
      approve: values.approve,
      reject: values.reject,
    })
    print(out, { step: state.step, errors })
    return errors.length > 0 ? 1 : 0
  }
  if (command === 'status') {
    print(out, openRun(values, env).state)
    return 0
  }
  throw new Error(USAGE)
}

export function runProfile(argv, { env = process.env, out = process.stdout } = {}) {
  const { values } = parseArgs({ args: argv, options: { repo: { type: 'string', default: '.' } } })
  const repo = resolve(values.repo)
  const profile = discoverProfile(repo)
  writeJson(join(projectDir(repoSlug(repo), env), 'profile.json'), profile)
  print(out, profile)
  return 0
}
