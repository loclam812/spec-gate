import { it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { discoverProfile } from '../cli/lib/profile.js'
import { caseIdsMissing, changedSince, hashFiles, failureKind, runnerRoot, runTestFile, withBail, wrongReasons } from '../cli/lib/run-tests.js'
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

const failure = (message, extra = {}) => ({ type: '', message, body: '', ...extra })
const red = (failures, extra = {}) => ({
  file: 'a.test.js',
  status: 'red',
  timedOut: false,
  tests: Object.keys(failures).map((name) => ({ name, status: 'fail' })),
  failures,
  ...extra,
})

it('wrongReasons accepts a node --test assertion failure whose values mention a timeout', () => {
  const message = "Expected values to be strictly deep-equal:\n+   status: 'pending'\n-   status: 'timeout'"
  assert.deepEqual(wrongReasons(red({ 'C1: x': failure(message, { type: 'testCodeFailure' }) }), ['C1']), [])
})

it('wrongReasons accepts an assertion that only mentions an error code', () => {
  const found = failure("expected 'ECONNREFUSED' to be 'ETIMEDOUT'", { type: 'AssertionError' })
  assert.deepEqual(wrongReasons(red({ 'C1: x': found }), ['C1']), [])
})

it('wrongReasons reads a Playwright failure from its body, not from the location and title', () => {
  const message = 'refund.spec.ts:3:5 C5: shows the timeout notice'
  const asserted = failure(message, { body: 'Error: expect(locator).toBeVisible() failed' })
  assert.deepEqual(wrongReasons(red({ 'C5: shows the timeout notice': asserted }), ['C5']), [])
  const timedOut = failure(message, { body: 'Test timeout of 30000ms exceeded.' })
  const lines = wrongReasons(red({ 'C5: shows the timeout notice': timedOut }), ['C5'])
  assert.equal(lines.length, 1)
  assert.match(lines[0], /\(timeout\)/)
})

it('wrongReasons refuses a syntax error and a network error', () => {
  const syntax = wrongReasons(red({ 'C1: x': failure("SyntaxError: Unexpected token '}'") }), ['C1'])
  assert.equal(syntax.length, 1)
  assert.match(syntax[0], /\(syntax\)/)
  const network = wrongReasons(red({ 'C1: x': failure('connect ECONNREFUSED 127.0.0.1:5432') }), ['C1'])
  assert.equal(network.length, 1)
  assert.match(network[0], /\(network\)/)
})

it('wrongReasons refuses a failure typed as a timeout', () => {
  const lines = wrongReasons(red({ 'C1: x': failure('test did not finish', { type: 'testTimeoutFailure' }) }), ['C1'])
  assert.equal(lines.length, 1)
  assert.match(lines[0], /\(timeout\)/)
})

it('wrongReasons accepts a file that did not load on a missing symbol only when the source names a case', () => {
  const unloaded = { file: 'b.test.js', status: 'red', timedOut: false, tests: [{ name: 'b.test.js', status: 'fail' }], failures: { 'b.test.js': failure("Cannot find module '../src/refund.js'") } }
  assert.deepEqual(wrongReasons(unloaded, ['C1', 'C2'], { source: 'it("C1: a") it("C2: b")' }), [])
  assert.deepEqual(wrongReasons(unloaded, ['C1', 'C2'], { source: 'it("C1: a")' }), [])
  assert.deepEqual(wrongReasons(unloaded, ['C1', 'C2'], { source: '' }), [
    "b.test.js: no test ran (the file did not load: Cannot find module '../src/refund.js')",
  ])
})

it('wrongReasons refuses a broken install: a missing runner or dependency is setup, not missing code', () => {
  const output = "Error: Cannot find module '/tmp/ws/post/node_modules/vitest/vitest.mjs'\n    at Module._resolveFilename"
  const crashed = { file: 'b.test.js', status: 'red', timedOut: false, tests: [], failures: {}, output }
  assert.deepEqual(wrongReasons(crashed, ['C1'], { source: 'C1' }), [
    "b.test.js: no test ran (the file did not load: Cannot find module '/tmp/ws/post/node_modules/vitest/vitest.mjs')",
  ])
  assert.equal(failureKind(failure("Cannot find package 'react' imported from /repo/src/card.tsx")), 'setup')
  assert.equal(failureKind(failure("Cannot find module '../src/refund.js'")), 'missing')
})

it('wrongReasons refuses a file that did not load for any other reason, and a timeout', () => {
  const unloaded = { file: 'b.test.js', status: 'red', timedOut: false, tests: [], failures: { 'b.test.js': failure("SyntaxError: Unexpected token '}'") } }
  assert.deepEqual(wrongReasons(unloaded, ['C3'], { source: 'C3' }), ["b.test.js: no test ran (the file did not load: SyntaxError: Unexpected token '}')"])
  assert.deepEqual(wrongReasons({ ...unloaded, timedOut: true }, ['C3']), ['b.test.js: no test ran (timed out)'])
})

it('wrongReasons reads a compile error from the output when the runner reports no failures', () => {
  const output = './refund_test.go:12:9: undefined: Refund\nFAIL\texample.com/shop [build failed]'
  const built = { file: 'refund_test.go', status: 'red', timedOut: false, tests: [], failures: {}, output }
  assert.deepEqual(wrongReasons(built, ['C1'], { source: 'func TestRefund(t *testing.T) { t.Run("C1: a", nil) }' }), [])
  const lines = wrongReasons(built, ['C1'], { source: '' })
  assert.equal(lines.length, 1)
  assert.match(lines[0], /no test ran \(the file did not load: .*undefined: Refund\)/)
  const hung = wrongReasons({ ...built, output: 'panic: test timed out after 10m0s' }, ['C1'], { source: 'C1' })
  assert.equal(hung.length, 1)
  assert.match(hung[0], /timed out/)
})

it('a node --test file that cannot load is read as a missing symbol, with the real cause', () => {
  const { repo: fixture } = makeFixtureRepo()
  writeFile(fixture, 'package.json', JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }))
  writeFile(fixture, 'src/total.js', BUGGY_TOTAL)
  commitAll(fixture, 'node test stack')
  writeFile(fixture, 'test/a.test.js', "import { test } from 'node:test'\nimport { x } from '../src/missing.js'\ntest('C1: a', () => {})\n")
  const result = runTestFile(discoverProfile(fixture), fixture, 'test/a.test.js')
  assert.equal(result.status, 'red')
  assert.deepEqual(wrongReasons(result, ['C1'], { source: 'C1' }), [])
  assert.equal(failureKind(Object.values(result.failures)[0]), 'missing')
})

it('headline reads the body when node --test reports only "test failed"', () => {
  const generic = { type: 'testCodeFailure', message: 'test failed', body: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/x/src/refund.js'" }
  assert.equal(failureKind(generic), 'missing')
})

it('wrongReasons accepts a did-not-load file when its source names some case id', () => {
  const missing = red({ 'test > a.test.js': failure('Cannot find module ../src/refund.js') })
  assert.deepEqual(wrongReasons(missing, ['C1', 'C2'], { source: 'test("C1: x")' }), [])
  assert.equal(wrongReasons(missing, ['C1', 'C2'], { source: '' }).length, 1)
})

const hookFailure = (cause) => failure('failed running beforeEach hook', { type: 'hookFailed', body: `[Error [ERR_TEST_FAILURE]: failed running beforeEach hook] {\n  failureType: 'hookFailed',\n  cause: ${cause}\n      at TestContext.<anonymous> (file:///x/a.test.js:2:26)\n}` })

it('wrongReasons refuses a failed hook unless its cause is a missing symbol', () => {
  const refused = wrongReasons(red({ 'C1: x': hookFailure('Error: DATABASE_URL is not set') }), ['C1'])
  assert.equal(refused.length, 1)
  assert.match(refused[0], /DATABASE_URL is not set \(setup\)/)
  assert.deepEqual(wrongReasons(red({ 'C1: x': hookFailure('ReferenceError: seedRefunds is not defined') }), ['C1']), [])
})

it('failureKind reads a jest suite that failed to run by its cause', () => {
  const suite = (text) => failure('Test suite failed to run', { body: `Test suite failed to run\n\n  ${text}\n\n    at foo (a.js:1:1)` })
  assert.equal(failureKind(suite('Cannot find module ../src/refund from test/a.test.js')), 'missing')
  assert.equal(failureKind(suite('Error: DATABASE_URL is not set')), 'setup')
})

it('a vitest hook that throws is a setup failure, not a red test', () => {
  const hooked = {
    file: 'src/cart.test.ts',
    status: 'red',
    timedOut: false,
    tests: [{ name: 'src/cart.test.ts > C1: works', status: 'skip' }, { name: 'src/cart.test.ts > src/cart.test.ts', status: 'fail' }],
    failures: { 'src/cart.test.ts > src/cart.test.ts': failure('db is down', { type: 'Error', body: 'Error: db is down' }) },
  }
  const lines = wrongReasons(hooked, ['C1'], { source: "it('C1: works')" })
  assert.equal(lines.length, 1)
  assert.match(lines[0], /\(setup\)/)
})

it('a suite run can stop after a number of failures where its runner allows it', () => {
  assert.equal(withBail({ name: 'playwright' }, 'npx playwright test --reporter=junit', 7), 'npx playwright test --reporter=junit --max-failures=7')
  assert.equal(withBail({ name: 'vitest' }, 'npx vitest run --reporter=junit', 7), 'npx vitest run --reporter=junit --bail=7')
  assert.equal(withBail({ name: 'node-test' }, 'node --test', 7), 'node --test')
  assert.equal(withBail({ name: 'vitest' }, 'npx vitest run', null), 'npx vitest run')
})
