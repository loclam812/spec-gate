import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import { FIXED_TOTAL, writeFile } from './helpers.js'
import { C1_TEST, CASES, REQUEST, setup } from './tests-helpers.js'

const TWO_CASES = {
  ...CASES,
  sentences: [{ id: 'S1', text: REQUEST, cases: ['C1', 'C2'] }],
  cases: [...CASES.cases, { id: 'C2', when: 'the cart is empty', then: 'the total shows "n/a"', basis: 'assumed', risk: 'low', layer: 'unit' }],
}
const C2_TEST = "\ntest('C2: an empty cart shows n/a', () => {\n  assert.equal(total([]), 'n/a')\n})\n"

function toDoneWithTwoCases(cli, repo) {
  cli('start', '--request', REQUEST)
  cli('submit')
  writeFileSync(cli('next').json.output, stringify(TWO_CASES))
  cli('submit')
  cli('submit', '--approve')
  const writer = cli('next').json
  writeFile(repo, 'test/total.test.js', C1_TEST + C2_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  assert.equal(cli('submit').json.step, 'done')
  return dirname(writer.output)
}

it('a case is dropped only after its test is gone, with a reason, once the tests are written', () => {
  const { repo, cli } = setup()
  cli('start', '--request', REQUEST)
  assert.throws(() => cli('drop', '--case', 'C1', '--reason', 'x'), /drop: run .* is at step discover/)
  const fresh = setup()
  toDoneWithTwoCases(fresh.cli, fresh.repo)
  assert.throws(() => fresh.cli('drop', '--case', 'C2'), /drop: give the reason with --reason/)
  assert.throws(() => fresh.cli('drop', '--case', 'C9', '--reason', 'x'), /drop: no case C9/)
  assert.throws(() => fresh.cli('drop', '--case', 'C2', '--reason', 'x'), /drop: remove the test for C2 from test\/total\.test\.js first/)
})

it('dropping a case removes it from the cases, records why, and verify passes without it', () => {
  const { repo, cli, verify } = setup()
  const dir = toDoneWithTwoCases(cli, repo)
  writeFile(repo, 'test/total.test.js', C1_TEST)
  const dropped = cli('drop', '--case', 'C2', '--reason', 'the cart page never shows an empty total')
  assert.deepEqual(dropped.json, { dropped: 'C2', reguarded: ['test/total.test.js'] })
  const doc = parse(readFileSync(join(dir, 'cases.yaml'), 'utf8'))
  assert.deepEqual(doc.cases.map((c) => c.id), ['C1'])
  assert.deepEqual(doc.sentences[0].cases, ['C1'])
  assert.match(readFileSync(join(dir, 'decisions.md'), 'utf8'), /- Dropped C2 after the tests were written: the cart page never shows an empty total\n/)
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  const result = verify()
  assert.equal(result.code, 0)
  assert.match(readFileSync(result.json.report, 'utf8'), /## Notes\n\n(.*\n)*- Dropped C2 after the tests were written/)
})

it('dropping a case does not bless other edits to guarded files that never held it', () => {
  const { repo, cli, verify } = setup()
  cli('start', '--request', REQUEST)
  cli('submit')
  writeFileSync(cli('next').json.output, stringify(TWO_CASES))
  cli('submit')
  cli('submit', '--approve')
  const writer = cli('next').json
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFile(repo, 'test/empty.test.js', C1_TEST.replace(/test\('C1[^]*$/, '') + C2_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js', 'test/empty.test.js'] }))
  assert.equal(cli('submit').json.step, 'done')
  writeFile(repo, 'test/total.test.js', C1_TEST.replace('6)', '2)'))
  writeFile(repo, 'test/empty.test.js', C1_TEST.replace(/test\('C1[^]*$/, ''))
  assert.deepEqual(cli('drop', '--case', 'C2', '--reason', 'not a real state').json.reguarded, ['test/empty.test.js'])
  const report = readFileSync(verify().json.report, 'utf8')
  assert.match(report, /test\/total\.test\.js changed after the tests were written/)
  assert.doesNotMatch(report, /test\/empty\.test\.js changed/)
})
