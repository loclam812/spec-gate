import { it } from 'node:test'
import assert from 'node:assert/strict'
import { isTestPath, loadSample, sampleErrors, specText } from '../cli/lib/sample.js'
import { makeFixtureRepo, tempDir, writeFile, writeSample } from './helpers.js'

const { repo, preFix, postFix } = makeFixtureRepo()
const valid = {
  id: 'demo-1',
  pre_fix: preFix,
  post_fix: postFix,
  test_command: 'node --test {file}',
  test_globs: ['**/*.test.js'],
}

it('a complete sample has no errors and gets defaults', () => {
  const sample = loadSample(writeSample(tempDir(), valid))
  assert.deepEqual(sampleErrors(sample, repo), [])
  assert.equal(sample.timeout_s, 600)
  assert.equal(sample.setup, null)
})

it('reports a missing field', () => {
  const { test_globs, ...rest } = valid
  const sample = loadSample(writeSample(tempDir(), rest))
  assert.deepEqual(sampleErrors(sample, repo), ['missing field: test_globs'])
})

it('rejects an unquoted numeric sha', () => {
  const dir = writeSample(tempDir(), valid)
  writeFile(dir, 'sample.yaml', `id: demo-1\npre_fix: 1234567\npost_fix: "${postFix}"\ntest_command: node --test {file}\ntest_globs: ["**/*.test.js"]\n`)
  assert.ok(sampleErrors(loadSample(dir), repo).includes('pre_fix must be a quoted string'))
})

it('rejects an id that differs from its directory', () => {
  const dir = writeSample(tempDir(), valid)
  writeFile(dir, 'sample.yaml', `id: other\npre_fix: "${preFix}"\npost_fix: "${postFix}"\ntest_command: node --test {file}\ntest_globs: ["**/*.test.js"]\n`)
  assert.deepEqual(sampleErrors(loadSample(dir), repo), ['id "other" does not match directory "demo-1"'])
})

it('rejects a command without a placeholder, no spec and no answers', () => {
  const sample = loadSample(writeSample(tempDir(), { ...valid, test_command: 'npm test' }, { spec: {}, answers: null }))
  assert.deepEqual(sampleErrors(sample, repo), [
    'test_command must contain {file} or {dir}',
    'spec/ must contain at least one file',
    'answers.yaml is missing',
  ])
})

it('rejects a sha the repository does not have', () => {
  const sample = loadSample(writeSample(tempDir(), { ...valid, post_fix: 'deadbeef' }))
  assert.deepEqual(sampleErrors(sample, repo), [`post_fix deadbeef is not a commit in ${repo}`])
})

it('rejects pre_fix that is not an ancestor of post_fix', () => {
  const sample = loadSample(writeSample(tempDir(), { ...valid, pre_fix: postFix, post_fix: preFix }))
  assert.deepEqual(sampleErrors(sample, repo), [`pre_fix ${postFix} is not an ancestor of post_fix ${preFix}`])
})

it('specText joins spec files in name order with headings', () => {
  const sample = loadSample(writeSample(tempDir(), valid, { spec: { 'b.md': 'second', 'a.md': 'first' } }))
  assert.equal(specText(sample), '### a.md\n\nfirst\n\n### b.md\n\nsecond\n')
})

it('isTestPath matches the globs at any depth', () => {
  const sample = loadSample(writeSample(tempDir(), valid))
  assert.equal(isTestPath(sample, 'total.test.js'), true)
  assert.equal(isTestPath(sample, 'test/deep/total.test.js'), true)
  assert.equal(isTestPath(sample, 'src/total.js'), false)
})

it('rejects an unknown report format and a junit report without its file', () => {
  const unknown = loadSample(writeSample(tempDir(), { ...valid, report: 'tap' }))
  assert.deepEqual(sampleErrors(unknown, repo), ['report must be one of go-json, junit'])
  const junit = loadSample(writeSample(tempDir(), { ...valid, report: 'junit' }))
  assert.deepEqual(sampleErrors(junit, repo), ['report junit needs report_file'])
})
