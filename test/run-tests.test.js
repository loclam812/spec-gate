import { it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { discoverProfile } from '../cli/lib/profile.js'
import { caseIdsMissing, changedSince, hashFiles, runnerRoot, runTestFile } from '../cli/lib/run-tests.js'
import { BUGGY_TOTAL, CATCHING_TEST, commitAll, makeFixtureRepo, writeFile } from './helpers.js'

const { repo } = makeFixtureRepo()
writeFile(repo, 'package.json', JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }))
writeFile(repo, 'src/total.js', BUGGY_TOTAL)
commitAll(repo, 'test script, total not yet multiplying by quantity')
const profile = discoverProfile(repo)
writeFile(repo, 'test/c1.test.js', CATCHING_TEST.replace('total multiplies price by quantity', 'C1: total multiplies price by quantity'))

it('runTestFile runs one file through its stack, reads per-test results and cleans up the report', () => {
  const result = runTestFile(profile, repo, 'test/c1.test.js')
  assert.equal(result.status, 'red')
  assert.equal(result.tests.length, 1)
  assert.match(result.tests[0].name, /C1: total multiplies price by quantity/)
  assert.equal(result.tests[0].status, 'fail')
  assert.equal(existsSync(join(repo, '.spec-gate-report.xml')), false)
})

it('a file no stack matches is unrunnable', () => {
  assert.equal(runTestFile(profile, repo, 'README.md').status, 'unrunnable')
})

it('the guard names a test file that was edited or deleted', () => {
  writeFile(repo, 'test/c2.test.js', "// C2\n")
  const hashes = hashFiles(repo, ['test/c1.test.js', 'test/c2.test.js'])
  assert.deepEqual(changedSince(repo, hashes), [])
  writeFile(repo, 'test/c1.test.js', "// edited\n")
  rmSync(join(repo, 'test/c2.test.js'))
  assert.deepEqual(changedSince(repo, hashes), ['test/c1.test.js', 'test/c2.test.js'])
})

it('caseIdsMissing names the cases no test file mentions', () => {
  writeFile(repo, 'test/c3.test.js', "test('C3: something', () => {})\n")
  assert.deepEqual(caseIdsMissing(repo, ['test/c3.test.js'], ['C3', 'C4']), ['C4'])
})

it('a test runs from the nearest package or module root that holds its runner', () => {
  writeFile(repo, 'web/package.json', '{}\n')
  writeFile(repo, 'svc/go.mod', 'module example.com/svc\n')
  const js = { name: 'vitest' }
  const go = { name: 'go' }
  assert.equal(runnerRoot(repo, 'web/src/deep/a.test.ts', js), 'web')
  assert.equal(runnerRoot(repo, 'test/c1.test.js', js), '.')
  assert.equal(runnerRoot(repo, 'svc/pkg/x/a_test.go', go), 'svc')
  assert.equal(runnerRoot(repo, 'pkg/a_test.go', go), '.')
  writeFile(repo, 'web/playwright.config.ts', 'export default {}\n')
  assert.equal(runnerRoot(repo, 'web/tests/e2e/a.spec.ts', { name: 'playwright' }), 'web')
})

it('a JUnit report without a test case means the runner found no tests in the file', () => {
  const excluded = {
    stacks: [{ name: 'fake', test_globs: ['**/*.fake'], test_command: "printf '<testsuites tests=\"0\"></testsuites>' > report.xml; exit 1", report: 'junit', report_file: 'report.xml' }],
  }
  writeFile(repo, 'e2e/b.fake', '')
  assert.equal(runTestFile(excluded, repo, 'e2e/b.fake').status, 'no-tests')
  assert.equal(existsSync(join(repo, 'report.xml')), false)
})

it('a file the runner finds no tests in is no-tests, not red', () => {
  const quiet = {
    stacks: [{ name: 'fake', test_globs: ['**/*.fake'], test_command: "echo 'No tests found, exiting with code 1'; exit 1", report: null, report_file: null }],
  }
  writeFile(repo, 'e2e/a.fake', '')
  const result = runTestFile(quiet, repo, 'e2e/a.fake')
  assert.equal(result.status, 'no-tests')
  assert.deepEqual(result.tests, [])
})
