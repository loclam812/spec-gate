import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { stringify } from 'yaml'
import { runRun } from '../cli/run.js'
import { BUGGY_TOTAL, FIXED_TOTAL, commitAll, makeFixtureRepo, tempDir, writeFile } from './helpers.js'

const C1_TEST =
  "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { total } from '../src/total.js'\n\ntest('C1: total multiplies price by quantity', () => {\n  assert.equal(total([{ price: 2, qty: 3 }]), 6)\n})\n"
const OLD_TEST =
  "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { total } from '../src/total.js'\n\ntest('one item at quantity one costs its price', () => {\n  assert.equal(total([{ price: 2, qty: 1 }]), 2)\n})\n"
const ALREADY_RED =
  "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n\ntest('legacy check that was red before the change', () => {\n  assert.equal(1, 2)\n})\n"
const CONSTANT_TOTAL = 'export function total() {\n  return 6\n}\n'

function toQa(extraTests) {
  const { repo } = makeFixtureRepo()
  writeFile(repo, 'package.json', JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }))
  writeFile(repo, 'src/total.js', BUGGY_TOTAL)
  for (const [path, text] of Object.entries(extraTests)) writeFile(repo, path, text)
  commitAll(repo, 'baseline with existing tests')
  const env = { ...process.env, SPEC_GATE_HOME: tempDir('sg-home-') }
  const cli = (...argv) => {
    const chunks = []
    const code = runRun([...argv, '--repo', repo], { env, out: { write: (text) => chunks.push(text) } })
    return { code, json: JSON.parse(chunks.join('')) }
  }
  cli('start', '--request', 'The total multiplies price by quantity.', '--tier', 't1')
  cli('submit')
  const writer = cli('next').json
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  assert.equal(cli('submit').json.step, 'dev')
  return { repo, cli }
}

it('QA sends dev back when a test that passed before the change now fails', () => {
  const { repo, cli } = toQa({ 'test/old.test.js': OLD_TEST })
  writeFile(repo, 'src/total.js', CONSTANT_TOTAL)
  assert.equal(cli('submit').json.step, 'qa')
  assert.equal(cli('submit').json.step, 'dev')
  const dev = cli('next').json
  assert.match(readFileSync(dev.prompt_file, 'utf8'), /passed before this change and now fail[\s\S]*one item at quantity one costs its price/)
})

it('a test that was already red before the change does not hold QA back', () => {
  const { repo, cli } = toQa({ 'test/old.test.js': OLD_TEST, 'test/legacy.test.js': ALREADY_RED })
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  assert.equal(cli('submit').json.step, 'qa')
  assert.equal(cli('submit').json.step, 'review')
})
