import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from './files.js'
import { projectDir } from './store.js'

export function runsDir(slug, env) {
  return join(projectDir(slug, env), 'runs')
}

function newRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace('Z', '')
  return `${stamp}-${randomBytes(2).toString('hex')}`
}

export function createRun(slug, env, { request, repo, signals }) {
  const id = newRunId()
  const dir = join(runsDir(slug, env), id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'request.md'), `${request.trim()}\n`)
  const state = { id, repo, step: 'discover', signals, attempts: 0, qc_rounds: 0, errors: [], notes: [] }
  writeJson(join(dir, 'state.json'), state)
  return { id, dir, state }
}

// Every clone and worktree of a repository shares one store, so "latest" means the latest run
// started from this working tree.
export function latestRunId(slug, env, repo) {
  const dir = runsDir(slug, env)
  const ids = existsSync(dir) ? readdirSync(dir).sort() : []
  const mine = ids.filter((id) => readJson(join(dir, id, 'state.json')).repo === repo)
  if (mine.length === 0) throw new Error('no run yet in this working tree; start one with: spec-gate tests start --request "<request>"')
  return mine[mine.length - 1]
}

export const loadState = (dir) => readJson(join(dir, 'state.json'))

export const saveState = (dir, state) => writeJson(join(dir, 'state.json'), state)
