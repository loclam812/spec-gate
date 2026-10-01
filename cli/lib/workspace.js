import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { readJson, writeJson } from './files.js'
import { git, isGreen, runShell, tryGit } from './exec.js'

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

const IGNORED_BASELINE = 'spec-gate-ignored'

function ignoredEntries(dest) {
  return git(dest, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'])
    .split('\0')
    .filter(Boolean)
}

export function snapshot(dest) {
  git(dest, ['init', '-q', '-b', 'snapshot'])
  git(dest, ['add', '-A'])
  git(dest, [...SNAPSHOT_CONFIG, 'commit', '-q', '--allow-empty', '-m', 'snapshot'])
  writeFileSync(join(dest, '.git', IGNORED_BASELINE), ignoredEntries(dest).join('\0'))
}

export function changedFiles(dest) {
  git(dest, ['add', '-A'])
  const listed = git(dest, ['diff', '--cached', '--name-only', '--diff-filter=AM', '-z'])
  git(dest, ['reset', '-q'])
  return listed.split('\0').filter(Boolean).sort()
}

// Ignored files a run writes (CLAUDE.local.md, caches) would otherwise carry over into the next
// run; ignored files present at the snapshot (installed dependencies) are kept.
export function resetTree(dest) {
  git(dest, ['reset', '-q', '--hard'])
  git(dest, ['clean', '-fdq'])
  const baselinePath = join(dest, '.git', IGNORED_BASELINE)
  if (!existsSync(baselinePath)) return
  const baseline = new Set(readFileSync(baselinePath, 'utf8').split('\0'))
  for (const entry of ignoredEntries(dest).filter((path) => !baseline.has(path))) {
    rmSync(join(dest, entry), { recursive: true, force: true })
  }
}

export function workspaceSides(workDir) {
  return { pre: join(workDir, 'pre'), post: join(workDir, 'post') }
}

export function isReady(side) {
  return tryGit(side, ['rev-parse', '--verify', '--quiet', 'HEAD']) !== null
}

const manifestPath = (workDir) => join(workDir, 'prepared.json')
const manifestOf = (sample) => ({ pre_fix: sample.pre_fix, post_fix: sample.post_fix, setup: sample.setup })

export function preparedFor(workDir, sample) {
  if (!existsSync(manifestPath(workDir))) return false
  const recorded = readJson(manifestPath(workDir))
  const expected = manifestOf(sample)
  const sameShas = Object.keys(expected).every((key) => recorded[key] === expected[key])
  return sameShas && Object.values(workspaceSides(workDir)).every(isReady)
}

// A side is ready only once its snapshot commit exists: `git init` alone leaves an unborn
// branch, on which resetTree would wipe the whole tree.
export function prepareWorkspace(sample, repoPath, workDir, { fresh = false } = {}) {
  for (const side of Object.values(workspaceSides(workDir)).filter(existsSync)) chmodSync(side, 0o755)
  const stale = existsSync(manifestPath(workDir)) && !preparedFor(workDir, sample)
  if (fresh || stale) rmSync(workDir, { recursive: true, force: true })
  const sides = workspaceSides(workDir)
  const shas = { pre: sample.pre_fix, post: sample.post_fix }
  for (const [side, dest] of Object.entries(sides)) {
    if (isReady(dest)) continue
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
  writeJson(manifestPath(workDir), manifestOf(sample))
  return sides
}
