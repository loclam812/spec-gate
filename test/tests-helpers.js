import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { stringify } from 'yaml'
import { runTests, runVerify } from '../cli/tests.js'
import { BUGGY_TOTAL, commitAll, makeFixtureRepo, tempDir, writeFile } from './helpers.js'

export const REQUEST = 'The total multiplies price by quantity.'
export const CASES = {
  ui: false,
  sentences: [{ id: 'S1', text: REQUEST, cases: ['C1'] }],
  cases: [{ id: 'C1', when: 'an item has price 2 and quantity 3', then: 'the total is 6', basis: 'request', risk: 'high', layer: 'unit' }],
  questions: [],
}
export const C1_TEST = "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { total } from '../src/total.js'\n\ntest('C1: total multiplies price by quantity', () => {\n  assert.equal(total([{ price: 2, qty: 3 }]), 6)\n})\n"
export const OLD_TEST = "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { total } from '../src/total.js'\n\ntest('one item at quantity one costs its price', () => {\n  assert.equal(total([{ price: 2, qty: 1 }]), 2)\n})\n"

const capture = (run, argv, repo, env) => {
  const chunks = []
  const code = run([...argv, '--repo', repo], { env, out: { write: (text) => chunks.push(text) } })
  return { code, json: JSON.parse(chunks.join('')) }
}

export function setup({ extraTests = {} } = {}) {
  const { repo } = makeFixtureRepo()
  writeFile(repo, 'package.json', JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }))
  writeFile(repo, 'src/total.js', BUGGY_TOTAL)
  for (const [path, text] of Object.entries(extraTests)) writeFile(repo, path, text)
  commitAll(repo, 'test script, total not yet multiplying by quantity')
  const env = { ...process.env, SPEC_GATE_HOME: tempDir('sg-home-') }
  const cli = (...argv) => capture(runTests, argv, repo, env)
  const verify = (...argv) => capture(runVerify, argv, repo, env)
  return { repo, env, cli, verify }
}

export function toDone(cli, repo, { testFile = 'test/total.test.js', source = C1_TEST } = {}) {
  cli('start', '--request', REQUEST)
  cli('submit')
  writeFileSync(cli('next').json.output, stringify(CASES))
  cli('submit')
  cli('submit', '--approve')
  const writer = cli('next').json
  writeFile(repo, testFile, source)
  writeFileSync(writer.output, stringify({ files: [testFile] }))
  assert.equal(cli('submit').json.step, 'done')
}
export const LEGACY_RED = "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n\ntest('legacy check that was red before the change', () => {\n  assert.equal(1, 2)\n})\n"
