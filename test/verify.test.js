import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { FIXED_TOTAL, writeFile } from './helpers.js'
import { C1_TEST, LEGACY_RED, OLD_TEST, setup, toDone } from './tests-helpers.js'

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
