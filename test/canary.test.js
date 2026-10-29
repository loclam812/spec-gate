import { it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acceptCanary, canaryVerdict, loadCanary, runCanary } from '../cli/lib/canary.js'
import { git } from '../cli/lib/exec.js'
import { loadSample } from '../cli/lib/sample.js'
import { prepareWorkspace } from '../cli/lib/workspace.js'
import { CATCHING_TEST, MISSING_TEST, makeFixtureRepo, tempDir, writeSample } from './helpers.js'

const NODE_TEST_PACKAGE = '{ "type": "module", "scripts": { "test": "node --test" } }\n'

function canaryContext(options) {
  const { repo, preFix, postFix } = makeFixtureRepo(options)
  const sample = loadSample(
    writeSample(tempDir(), { id: 'demo-1', pre_fix: preFix, post_fix: postFix, test_command: 'node --test {file}', test_globs: ['**/*.test.js'] }),
  )
  return { repo, sample, sides: prepareWorkspace(sample, repo, tempDir()) }
}

it('a sample whose fix test fails before the fix and passes after is ok', () => {
  const ctx = canaryContext({ fixFiles: { 'test/total.test.js': CATCHING_TEST } })
  const record = runCanary(ctx)
  assert.equal(record.verdict, 'ok')
  assert.equal(record.scorer.verdict, 'caught')
  assert.deepEqual(record.tests, ['test/total.test.js'])
  assert.ok(existsSync(join(ctx.sample.dir, 'canary', 'canary.json')))
})

it('a fix test that passes before the fix makes the sample harness-broken', () => {
  const record = runCanary(canaryContext({ fixFiles: { 'test/total.test.js': MISSING_TEST } }))
  assert.equal(record.verdict, 'harness-broken')
  assert.match(record.reasons[0], /fix tests score missed/)
})

it('the canary never copies a non-test file of the fix', () => {
  const rateTest = CATCHING_TEST.replace("import { total } from '../src/total.js'", "import { total } from '../src/total.js'\nimport { rate } from '../src/rate.js'")
  const ctx = canaryContext({ fixFiles: { 'src/rate.js': 'export const rate = 1\n', 'test/total.test.js': rateTest } })
  const record = runCanary(ctx)
  assert.equal(record.verdict, 'ok')
  assert.deepEqual(JSON.parse(readFileSync(join(ctx.sample.dir, 'canary', 'collected.json'), 'utf8')).helpers, [])
  assert.equal(existsSync(join(ctx.sides.pre, 'src/rate.js')), false)
})

it('a stack that cannot load its existing test makes the sample harness-broken', () => {
  const record = runCanary(
    canaryContext({
      preFiles: { 'package.json': NODE_TEST_PACKAGE, 'test/old.test.js': "import { gone } from './missing.js'\n" },
      fixFiles: { 'test/total.test.js': CATCHING_TEST },
    }),
  )
  const stack = record.stacks.find((entry) => entry.stack === 'node-test')
  assert.equal(stack.ok, false)
  assert.match(record.reasons.join('\n'), /node-test cannot run test\/old\.test\.js: .*did not load/)
  assert.equal(record.verdict, 'harness-broken')
})

it('a stack with no test file is unchecked, not broken', () => {
  const record = runCanary(canaryContext({ preFiles: { 'package.json': NODE_TEST_PACKAGE }, fixFiles: { 'test/total.test.js': CATCHING_TEST } }))
  assert.deepEqual(record.stacks, [{ stack: 'node-test', file: null, status: 'unchecked', ok: true, reason: null }])
  assert.equal(record.verdict, 'ok')
})

it('the canary leaves the pre tree clean', () => {
  const ctx = canaryContext({
    preFiles: { 'package.json': NODE_TEST_PACKAGE, 'test/old.test.js': "import { test } from 'node:test'\ntest('old', () => {})\n" },
    fixFiles: { 'test/total.test.js': CATCHING_TEST },
  })
  const record = runCanary(ctx)
  assert.equal(record.stacks[0].ok, true)
  assert.equal(git(ctx.sides.pre, ['status', '--porcelain']), '')
})

it('a canary for other shas or another test command reads as not run', () => {
  const ctx = canaryContext({ fixFiles: { 'test/total.test.js': CATCHING_TEST } })
  runCanary(ctx)
  assert.equal(loadCanary(ctx.sample).verdict, 'ok')
  assert.equal(loadCanary({ ...ctx.sample, test_command: 'node --test --test-only {file}' }), null)
  assert.equal(loadCanary({ ...ctx.sample, post_fix: ctx.sample.pre_fix }), null)
  for (const [key, value] of Object.entries({ setup: 'npm ci', report: 'junit', report_file: 'r.xml', timeout_s: 30, test_globs: ['**/*.spec.js'] })) {
    assert.equal(loadCanary({ ...ctx.sample, [key]: value }), null, key)
  }
})

it('a stack passes when another of its existing test files loads, though the first does not', () => {
  const record = runCanary(
    canaryContext({
      preFiles: {
        'package.json': NODE_TEST_PACKAGE,
        'test/a-old.test.js': "import { gone } from './missing.js'\n",
        'test/b-old.test.js': "import { test } from 'node:test'\ntest('old', () => {})\n",
      },
      fixFiles: { 'test/total.test.js': CATCHING_TEST },
    }),
  )
  assert.deepEqual(record.stacks.map(({ stack, file, ok }) => ({ stack, file, ok })), [{ stack: 'node-test', file: 'test/b-old.test.js', ok: true }])
  assert.equal(record.verdict, 'ok')
})

it('an owner ruling keeps a harness-broken sample, until the canary goes stale', () => {
  const ctx = canaryContext({ fixFiles: { 'test/total.test.js': MISSING_TEST } })
  assert.throws(() => acceptCanary(ctx.sample, 'reason'), /no canary for demo-1/)
  runCanary(ctx)
  assert.equal(canaryVerdict(ctx.sample.dir), 'harness-broken')
  acceptCanary(ctx.sample, 'the fix test passes before the fix by design')
  assert.equal(canaryVerdict(ctx.sample.dir), 'ok')
  assert.equal(loadCanary(ctx.sample).accepted, 'the fix test passes before the fix by design')
  assert.equal(runCanary(ctx).accepted, undefined)
  assert.equal(canaryVerdict(ctx.sample.dir), 'harness-broken')
})

it('a sample with no test file in its fix is refused', () => {
  assert.throws(() => runCanary(canaryContext()), /has no test file in its fix/)
})
