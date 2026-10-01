import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectTests, renderCommand, scoreRun } from '../cli/lib/replay.js'
import { loadSample } from '../cli/lib/sample.js'
import { changedFiles, prepareWorkspace } from '../cli/lib/workspace.js'
import {
  BROKEN_TEST,
  CATCHING_TEST,
  FIXED_TOTAL,
  HANGING_TEST,
  MISSING_TEST,
  makeFixtureRepo,
  tempDir,
  writeFile,
  writeSample,
} from './helpers.js'

const { repo, preFix, postFix } = makeFixtureRepo()
const sample = loadSample(
  writeSample(tempDir(), {
    id: 'demo-1',
    pre_fix: preFix,
    post_fix: postFix,
    test_command: 'node --test {file}',
    test_globs: ['**/*.test.js'],
  }),
)
const sides = prepareWorkspace(sample, repo, tempDir())

function candidateRun(files, runSample = sample) {
  for (const [path, text] of Object.entries(files)) writeFile(sides.pre, path, text)
  const outDir = tempDir()
  collectTests(runSample, sides.pre, outDir)
  return { outDir, record: scoreRun(runSample, sides, outDir) }
}

it('renderCommand quotes the file and turns a directory into ./dir', () => {
  assert.equal(renderCommand('node --test {file}', 'test/a b.test.js'), "node --test 'test/a b.test.js'")
  assert.equal(renderCommand('go test {dir}', 'pkg/x/a_test.go'), "go test './pkg/x'")
  assert.equal(renderCommand('go test {dir}', 'a_test.go'), "go test '.'")
})

it('a test red before the fix and green after it is caught', () => {
  assert.equal(candidateRun({ 'test/total.test.js': CATCHING_TEST }).record.verdict, 'caught')
})

it('a test green on both sides is missed', () => {
  assert.equal(candidateRun({ 'test/total.test.js': MISSING_TEST }).record.verdict, 'missed')
})

it('a test red after the fix is inconclusive', () => {
  assert.equal(candidateRun({ 'test/total.test.js': BROKEN_TEST }).record.verdict, 'inconclusive')
})

it('one caught file makes the run caught, and every file keeps its own verdict', () => {
  const { record } = candidateRun({ 'test/a.test.js': MISSING_TEST, 'test/b.test.js': CATCHING_TEST })
  assert.equal(record.verdict, 'caught')
  assert.deepEqual(
    record.files.map((file) => [file.path, file.verdict]),
    [['test/a.test.js', 'missed'], ['test/b.test.js', 'caught']],
  )
})

it('product-code edits are listed as ignored and never scored', () => {
  const { outDir, record } = candidateRun({ 'src/total.js': FIXED_TOTAL, 'test/total.test.js': MISSING_TEST })
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'collected.json'), 'utf8')), {
    tests: ['test/total.test.js'],
    ignored: ['src/total.js'],
  })
  assert.equal(record.verdict, 'missed')
})

it('a run that writes no test file is empty', () => {
  assert.equal(candidateRun({ 'src/total.js': FIXED_TOTAL }).record.verdict, 'empty')
})

it('collect and score leave both workspaces clean', () => {
  candidateRun({ 'test/total.test.js': CATCHING_TEST })
  assert.deepEqual(changedFiles(sides.pre), [])
  assert.deepEqual(changedFiles(sides.post), [])
})

it('a hanging test is recorded as timed out and is inconclusive', () => {
  const { record } = candidateRun({ 'test/hang.test.js': HANGING_TEST }, { ...sample, timeout_s: 1 })
  assert.equal(record.verdict, 'inconclusive')
  assert.equal(record.files[0].runs.postWith.timedOut, true)
})
