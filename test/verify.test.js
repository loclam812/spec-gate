import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { FIXED_TOTAL, writeFile } from './helpers.js'
import { stringify } from 'yaml'
import { C1_TEST, CASES, LEGACY_RED, OLD_TEST, REQUEST, setup, toDone } from './tests-helpers.js'

const report = (result) => readFileSync(result.json.report, 'utf8')

it('verify passes when the new tests are green and no old test broke', () => {
  const { repo, cli, verify } = setup()
  toDone(cli, repo)
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  const result = verify()
  assert.equal(result.code, 0)
  assert.match(report(result), /S1: The total multiplies price by quantity\. \| C1 \| green/)
})

it('verify fails on a test that passed before the change and fails after it', () => {
  const { repo, cli, verify } = setup({ extraTests: { 'test/old.test.js': OLD_TEST, 'test/legacy.test.js': LEGACY_RED } })
  toDone(cli, repo)
  writeFile(repo, 'src/total.js', 'export function total() {\n  return 6\n}\n')
  const result = verify()
  assert.equal(result.code, 1)
  assert.match(report(result), /## Regressions\n\n- test > one item at quantity one costs its price\n/)
  assert.doesNotMatch(report(result).split('## Regressions')[1].split('## Gaps')[0], /legacy check/)
})

it('verify reports an edited guarded test file and leaves it as it is', () => {
  const { repo, cli, verify } = setup()
  toDone(cli, repo)
  writeFile(repo, 'test/total.test.js', C1_TEST.replace('6)', '2)'))
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  const result = verify()
  assert.equal(result.code, 1)
  assert.match(report(result), /test\/total\.test\.js changed after the tests were written/)
  assert.match(readFileSync(join(repo, 'test/total.test.js'), 'utf8'), /2\)/)
})

it('verify fails while a new test is still red, including one accepted as red (missing)', () => {
  const { repo, cli, verify } = setup()
  toDone(cli, repo, { testFile: 'test/refund.test.js', source: C1_TEST.replace('../src/total.js', '../src/refund.js') })
  const result = verify()
  assert.equal(result.code, 1)
  assert.match(report(result), /## Red tests\n\n- test\/refund\.test\.js/)
  assert.match(report(result), /\| S1: The total multiplies price by quantity\. \| C1 \| red \|/)
})

it('verify notes a suite it could not compare instead of passing it silently', () => {
  const { repo, cli, verify } = setup()
  toDone(cli, repo)
  const profilePath = join(dirname(cli('next').json.report), 'profile.json')
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
  writeFileSync(profilePath, JSON.stringify({ ...profile, stacks: profile.stacks.map((stack) => ({ ...stack, suite_command: null })) }))
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  const result = verify()
  assert.equal(result.code, 0)
  assert.match(report(result), /## Notes\n\n- suite not checked: node-test has no per-test suite report\n/)
})

it('an approved change to a guarded test is amended with a reason, and verify then accepts it', () => {
  const { repo, cli, verify } = setup()
  toDone(cli, repo)
  assert.throws(() => cli('amend', '--file', 'test/total.test.js', '--reason', 'x'), /amend: test\/total\.test\.js has not changed since it was guarded/)
  writeFile(repo, 'test/total.test.js', C1_TEST.replace("'C1: total multiplies price by quantity'", "'C1: total multiplies the unit price by the quantity'"))
  assert.throws(() => cli('amend', '--file', 'test/total.test.js'), /amend: give the reason with --reason/)
  assert.throws(() => cli('amend', '--file', 'test/other.test.js', '--reason', 'x'), /amend: test\/other\.test\.js is not a guarded test or helper of this run/)
  assert.deepEqual(cli('amend', '--file', 'test/total.test.js', '--reason', 'the user approved a clearer name').json, { amended: 'test/total.test.js' })
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  const result = verify()
  assert.equal(result.code, 0)
  assert.match(report(result), /- Amended test\/total\.test\.js after the tests were written: the user approved a clearer name/)
})

it('a test that fails once and passes on a rerun is reported as flaky, not as a regression', () => {
  const FLAKY = "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { existsSync, writeFileSync } from 'node:fs'\n\ntest('passes after its first run', () => {\n  const mark = new URL('./.ran', import.meta.url)\n  const first = !existsSync(mark)\n  writeFileSync(mark, 'x')\n  assert.equal(first, false)\n})\n"
  const { repo, cli, verify } = setup({ extraTests: { 'test/flaky.test.js': "import { test } from 'node:test'\n\ntest('passes after its first run', () => {})\n" } })
  toDone(cli, repo)
  writeFile(repo, 'test/flaky.test.js', FLAKY)
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  const result = verify()
  assert.equal(result.code, 0)
  assert.match(report(result), /## Regressions\n\nNone\./)
  assert.match(report(result), /flaky: test > passes after its first run failed once and passed on a rerun/)
})

const LATER_RED = "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n\ntest('a later feature not built yet', () => {\n  assert.fail('not built')\n})\n"

it('a failing test added after the tests were written is noted, not counted as a regression', () => {
  const { repo, cli, verify } = setup()
  toDone(cli, repo)
  writeFile(repo, 'test/later.test.js', LATER_RED)
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  const result = verify()
  assert.equal(result.code, 0)
  assert.match(report(result), /## Regressions\n\nNone\./)
  assert.match(report(result), /- not compared: test > a later feature not built yet fails now but did not pass when the suite was recorded/)
})

it('a run recorded before passing tests were kept counts every new failure as a regression', () => {
  const { repo, cli, verify } = setup()
  toDone(cli, repo)
  const baselinePath = join(dirname(cli('next').json.report), 'suite-baseline.json')
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  writeFileSync(baselinePath, JSON.stringify(Object.fromEntries(Object.entries(baseline).map(([key, suite]) => [key, suite.failing]))))
  writeFile(repo, 'test/later.test.js', LATER_RED)
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  const result = verify()
  assert.equal(result.code, 1)
  assert.match(report(result), /## Regressions\n\n- test > a later feature not built yet\n/)
})

it('verify lists an existing test the change edited, without failing on it', () => {
  const { repo, cli, verify } = setup({ extraTests: { 'test/old.test.js': OLD_TEST } })
  toDone(cli, repo)
  writeFile(repo, 'test/old.test.js', OLD_TEST.replace('assert.equal(total([{ price: 2, qty: 1 }]), 2)', 'assert.ok(true)'))
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  const result = verify()
  assert.equal(result.code, 0)
  assert.match(report(result), /## Existing tests changed\n\n- test\/old\.test\.js changed since spec-gate recorded it; check it was not weakened\n/)
})

it('verify says none when no existing test was edited', () => {
  const { repo, cli, verify } = setup({ extraTests: { 'test/old.test.js': OLD_TEST } })
  toDone(cli, repo)
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  assert.match(report(verify()), /## Existing tests changed\n\nNone\.\n/)
})

it('verify lists an existing test the writer edited before the tests were guarded', () => {
  const { repo, cli, verify } = setup({ extraTests: { 'test/old.test.js': OLD_TEST } })
  cli('start', '--request', REQUEST)
  cli('submit')
  writeFileSync(cli('next').json.output, stringify(CASES))
  cli('submit')
  cli('submit', '--approve')
  const writer = cli('next').json
  writeFile(repo, 'test/old.test.js', OLD_TEST.replace('assert.equal(total([{ price: 2, qty: 1 }]), 2)', 'assert.ok(true)'))
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  assert.equal(cli('submit').json.step, 'done')
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  assert.match(report(verify()), /## Existing tests changed\n\n- test\/old\.test\.js changed since spec-gate recorded it/)
})
