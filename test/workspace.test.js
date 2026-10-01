import { it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { git } from '../cli/lib/exec.js'
import { loadSample } from '../cli/lib/sample.js'
import { changedFiles, exportTree, isReady, preparedFor, prepareWorkspace, resetTree, snapshot } from '../cli/lib/workspace.js'
import { BUGGY_TOTAL, CATCHING_TEST, FIXED_TOTAL, makeFixtureRepo, tempDir, writeFile, writeSample } from './helpers.js'

const { repo, preFix, postFix } = makeFixtureRepo()
const fields = {
  id: 'demo-1',
  pre_fix: preFix,
  post_fix: postFix,
  test_command: 'node --test {file}',
  test_globs: ['**/*.test.js'],
}

function exported(sha) {
  const dest = join(tempDir(), 'tree')
  exportTree(repo, sha, dest)
  snapshot(dest)
  return dest
}

it('an export holds the commit content and exactly one commit of history', () => {
  const dest = exported(preFix)
  assert.equal(readFileSync(join(dest, 'src/total.js'), 'utf8'), BUGGY_TOTAL)
  assert.equal(git(dest, ['rev-list', '--all', '--count']), '1')
})

it('changedFiles lists added and modified paths and leaves nothing staged', () => {
  const dest = exported(preFix)
  writeFile(dest, 'test/total.test.js', CATCHING_TEST)
  writeFile(dest, 'src/total.js', FIXED_TOTAL)
  assert.deepEqual(changedFiles(dest), ['src/total.js', 'test/total.test.js'])
  assert.equal(git(dest, ['diff', '--cached', '--name-only']), '')
})

it('resetTree restores tracked files, removes new ones and keeps ignored ones', () => {
  const dest = exported(preFix)
  writeFile(dest, 'node_modules/kept.js', 'x')
  writeFile(dest, 'test/total.test.js', CATCHING_TEST)
  writeFile(dest, 'src/total.js', FIXED_TOTAL)
  resetTree(dest)
  assert.deepEqual(changedFiles(dest), [])
  assert.equal(readFileSync(join(dest, 'src/total.js'), 'utf8'), BUGGY_TOTAL)
  assert.ok(existsSync(join(dest, 'node_modules/kept.js')))
})

it('prepareWorkspace exports both sides, runs setup before the snapshot, and is idempotent', () => {
  const setup = 'mkdir -p node_modules && echo ok > node_modules/marker'
  const sample = loadSample(writeSample(tempDir(), { ...fields, setup }))
  const work = tempDir()
  const sides = prepareWorkspace(sample, repo, work)
  assert.equal(readFileSync(join(sides.pre, 'src/total.js'), 'utf8'), BUGGY_TOTAL)
  assert.equal(readFileSync(join(sides.post, 'src/total.js'), 'utf8'), FIXED_TOTAL)
  assert.ok(existsSync(join(sides.pre, 'node_modules/marker')))
  writeFile(sides.pre, 'src/total.js', 'changed\n')
  prepareWorkspace(sample, repo, work)
  assert.equal(readFileSync(join(sides.pre, 'src/total.js'), 'utf8'), 'changed\n')
  prepareWorkspace(sample, repo, work, { fresh: true })
  assert.equal(readFileSync(join(sides.pre, 'src/total.js'), 'utf8'), BUGGY_TOTAL)
})

it('a failing setup stops prepare, names the side and leaves no ready marker', () => {
  const setup = 'echo registry unreachable >&2; exit 3'
  const sample = loadSample(writeSample(tempDir(), { ...fields, setup }))
  const work = tempDir()
  assert.throws(() => prepareWorkspace(sample, repo, work), /setup failed in pre \(exit 3\)[\s\S]*registry unreachable/)
  assert.equal(existsSync(join(work, 'pre', '.git')), false)
})

it('a side with a .git but no snapshot commit is not ready and gets rebuilt', () => {
  const sample = loadSample(writeSample(tempDir(), fields))
  const work = tempDir()
  const sides = prepareWorkspace(sample, repo, work)
  rmSync(join(sides.pre, '.git'), { recursive: true })
  git(sides.pre, ['init', '-q'])
  assert.equal(isReady(sides.pre), false)
  prepareWorkspace(sample, repo, work)
  assert.equal(isReady(sides.pre), true)
  assert.equal(readFileSync(join(sides.pre, 'src/total.js'), 'utf8'), BUGGY_TOTAL)
})

it('a workspace prepared for other shas is rebuilt for the sample', () => {
  const work = tempDir()
  prepareWorkspace(loadSample(writeSample(tempDir(), { ...fields, post_fix: preFix })), repo, work)
  const sample = loadSample(writeSample(tempDir(), fields))
  assert.equal(preparedFor(work, sample), false)
  const sides = prepareWorkspace(sample, repo, work)
  assert.equal(preparedFor(work, sample), true)
  assert.equal(readFileSync(join(sides.post, 'src/total.js'), 'utf8'), FIXED_TOTAL)
})

it('prepare restores access to a side a crashed run left hidden', () => {
  const sample = loadSample(writeSample(tempDir(), fields))
  const work = tempDir()
  const sides = prepareWorkspace(sample, repo, work)
  chmodSync(sides.post, 0o000)
  prepareWorkspace(sample, repo, work)
  assert.equal(preparedFor(work, sample), true)
  assert.equal(readFileSync(join(sides.post, 'src/total.js'), 'utf8'), FIXED_TOTAL)
})
