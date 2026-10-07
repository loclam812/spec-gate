import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FIXED_TOTAL, writeFile } from './helpers.js'
import { OLD_TEST, setup } from './tests-helpers.js'

const BUG = 'Two items at price 2 cost 2 instead of 4.'
const REPRO = "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { total } from '../src/total.js'\n\ntest('two items at price 2 cost 4', () => {\n  assert.equal(total([{ price: 2, qty: 2 }]), 4)\n})\n"

it('adopt guards a test another skill wrote, and verify passes once the bug is fixed', () => {
  const { repo, cli, verify } = setup({ extraTests: { 'test/old.test.js': OLD_TEST } })
  writeFile(repo, 'test/repro.test.js', REPRO)
  const adopted = cli('adopt', '--file', 'test/repro.test.js', '--request', BUG)
  assert.equal(adopted.code, 0)
  assert.equal(adopted.json.step, 'done')
  assert.match(readFileSync(adopted.json.report, 'utf8'), /test\/repro\.test\.js: red \(assertion\)/)
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  const result = verify()
  assert.equal(result.code, 0)
  assert.match(readFileSync(result.json.report, 'utf8'), /\| S1: Two items at price 2 cost 2 instead of 4\. \| test\/repro\.test\.js \| green \|/)
})

it('verify still catches an adopted test edited to pass', () => {
  const { repo, cli, verify } = setup()
  writeFile(repo, 'test/repro.test.js', REPRO)
  cli('adopt', '--file', 'test/repro.test.js', '--request', BUG)
  writeFile(repo, 'test/repro.test.js', REPRO.replace('4)', '2)'))
  const result = verify()
  assert.equal(result.code, 1)
  assert.match(readFileSync(result.json.report, 'utf8'), /test\/repro\.test\.js changed after the tests were written/)
})

it('adopt refuses a test that passes on the current code, since it does not reproduce anything', () => {
  const { repo, cli } = setup()
  writeFile(repo, 'test/old.test.js', OLD_TEST)
  const adopted = cli('adopt', '--file', 'test/old.test.js', '--request', BUG)
  assert.equal(adopted.code, 1)
  assert.deepEqual(adopted.json.errors, ['adopt: test/old.test.js passes on the current code, so it does not reproduce the problem'])
})

it('adopt refuses a test that fails for the wrong reason, and a file that does not exist', () => {
  const { repo, cli } = setup()
  writeFile(repo, 'test/broken.test.js', "import { test } from 'node:test'\ntest('x', () => {\n")
  assert.match(cli('adopt', '--file', 'test/broken.test.js', '--request', BUG).json.errors.join('\n'), /did not load|syntax/)
  assert.deepEqual(cli('adopt', '--file', 'test/none.test.js', '--request', BUG).json.errors, ['adopt: test/none.test.js does not exist'])
  assert.throws(() => cli('adopt', '--request', BUG), /adopt: give each test file with --file <path>/)
})
