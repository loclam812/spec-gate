import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { git, tryGit } from './exec.js'

export function storeRoot(env = process.env) {
  return env.SPEC_GATE_HOME || join(homedir(), '.claude', 'spec-gate')
}

export function slugFromRemote(url) {
  const bare = url.trim().replace(/\/+$/, '').replace(/\.git$/, '')
  const scp = bare.match(/^[^@/]+@([^:/]+):(?!\/)(.+)$/)
  const hostAndPath = scp
    ? `${scp[1]}/${scp[2]}`
    : bare
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
        .replace(/^[^@/]+@/, '')
        .replace(/:\d+(?=\/)/, '')
  return hostAndPath.split('/').filter(Boolean).join('-').toLowerCase()
}

export function slugFromPath(gitCommonDir) {
  const path = gitCommonDir.replace(/\/\.git\/?$/, '').replace(/^\/+/, '')
  return `local-${path.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`
}

export function repoSlug(repoPath) {
  const remote = tryGit(repoPath, ['remote', 'get-url', 'origin'])
  if (remote) return slugFromRemote(remote)
  return slugFromPath(git(repoPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
}

export function projectDir(slug, env = process.env) {
  return join(storeRoot(env), 'projects', slug)
}

export function sampleDir(slug, id, env = process.env) {
  return join(projectDir(slug, env), 'eval', id)
}

export function runDir(slug, id, candidate, run, env = process.env) {
  return join(sampleDir(slug, id, env), 'runs', `${candidate}-${run}`)
}

// Workspaces live outside the system temp directory, which macOS purges of files unused for three
// days (taking node_modules with them), and outside the store, whose reads count as leaks.
export function workRoot(env = process.env) {
  return env.SPEC_GATE_WORK || join(homedir(), '.cache', 'spec-gate', 'work')
}

export function workDir(slug, id, env = process.env) {
  const digest = createHash('sha256').update(`${slug}/${id}`).digest('hex').slice(0, 10)
  return join(workRoot(env), `sg-${digest}`)
}
