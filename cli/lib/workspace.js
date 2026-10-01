import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { git, isGreen, runShell } from './exec.js'

const SNAPSHOT_CONFIG = [
  '-c', 'user.name=spec-gate',
  '-c', 'user.email=spec-gate@localhost',
  '-c', 'commit.gpgsign=false',
  '-c', 'core.hooksPath=/dev/null',
]

export function exportTree(repoPath, sha, dest) {
  const archive = join(dirname(dest), `${basename(dest)}.tar`)
  mkdirSync(dest, { recursive: true })
  git(repoPath, ['archive', '--format=tar', '-o', archive, sha])
  execFileSync('tar', ['-x', '-f', archive, '-C', dest], { stdio: 'pipe' })
  rmSync(archive)
}

export function snapshot(dest) {
  git(dest, ['init', '-q', '-b', 'snapshot'])
  git(dest, ['add', '-A'])
  git(dest, [...SNAPSHOT_CONFIG, 'commit', '-q', '--allow-empty', '-m', 'snapshot'])
}

export function changedFiles(dest) {
  git(dest, ['add', '-A'])
  const listed = git(dest, ['diff', '--cached', '--name-only', '--diff-filter=AM', '-z'])
  git(dest, ['reset', '-q'])
  return listed.split('\0').filter(Boolean).sort()
}

export function resetTree(dest) {
  git(dest, ['reset', '-q', '--hard'])
  git(dest, ['clean', '-fdq'])
}

export function workspaceSides(workDir) {
  return { pre: join(workDir, 'pre'), post: join(workDir, 'post') }
}

// The snapshot's .git is written last, so it marks a side as ready: a side whose setup
// failed has none and is rebuilt on the next prepare.
export function prepareWorkspace(sample, repoPath, workDir, { fresh = false } = {}) {
  if (fresh) rmSync(workDir, { recursive: true, force: true })
  const sides = workspaceSides(workDir)
  const shas = { pre: sample.pre_fix, post: sample.post_fix }
  for (const [side, dest] of Object.entries(sides)) {
    if (existsSync(join(dest, '.git'))) continue
    rmSync(dest, { recursive: true, force: true })
    exportTree(repoPath, shas[side], dest)
    if (sample.setup) {
      const run = runShell(sample.setup, dest, sample.timeout_s)
      if (!isGreen(run)) {
        const reason = run.timedOut ? 'timed out' : `exit ${run.code}`
        throw new Error(`setup failed in ${side} (${reason}):\n${run.output.slice(-4000)}`)
      }
    }
    snapshot(dest)
  }
  return sides
}
