import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from './files.js'
import { projectDir } from './store.js'

export function runsDir(slug, env) {
  return join(projectDir(slug, env), 'runs')
}

function newRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-')
  return `${stamp}-${randomBytes(2).toString('hex')}`
}

export function createRun(slug, env, { request, triaged, repo, firstStep }) {
  const id = newRunId()
  const dir = join(runsDir(slug, env), id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'request.md'), `${request.trim()}\n`)
  const state = {
    id,
    repo,
    tier: triaged.tier,
    reasons: triaged.reasons,
    step: firstStep,
    round: 0,
    ba_iterations: 0,
    errors: [],
    notes: [],
  }
  writeJson(join(dir, 'state.json'), state)
  return { id, dir, state }
}

export function latestRunId(slug, env) {
  const dir = runsDir(slug, env)
  const ids = existsSync(dir) ? readdirSync(dir).sort() : []
  if (ids.length === 0) throw new Error('no run yet; start one with: spec-gate run start --request "<request>"')
  return ids[ids.length - 1]
}

export const loadState = (dir) => readJson(join(dir, 'state.json'))

export const saveState = (dir, state) => writeJson(join(dir, 'state.json'), state)
