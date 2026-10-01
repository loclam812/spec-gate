import { it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { runRun } from '../cli/run.js'
import { BUGGY_TOTAL, FIXED_TOTAL, commitAll, makeFixtureRepo, tempDir, writeFile } from './helpers.js'

const MODEL = {
  ui: false,
  sentences: [{ id: 'S1', text: 'The total multiplies price by quantity.', covered_by: ['R1'] }],
  rules: [{ id: 'R1', when: 'an item has price 2 and quantity 3', then: 'the total is 6' }],
  flows: [],
  questions: [],
}
const CASES = { cases: [{ id: 'C1', covers: ['R1'], layer: 'unit', steps: 'total one line', expected: '6' }] }
const C1_TEST =
  "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { total } from '../src/total.js'\n\ntest('C1: total multiplies price by quantity', () => {\n  assert.equal(total([{ price: 2, qty: 3 }]), 6)\n})\n"

function setup() {
  const { repo } = makeFixtureRepo()
  writeFile(repo, 'package.json', JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }))
  writeFile(repo, 'src/total.js', BUGGY_TOTAL)
  commitAll(repo, 'test script, total not yet multiplying by quantity')
  const env = { ...process.env, SPEC_GATE_HOME: tempDir('sg-home-') }
  const cli = (...argv) => {
    const chunks = []
    const code = runRun([...argv, '--repo', repo], { env, out: { write: (text) => chunks.push(text) } })
    return { code, json: JSON.parse(chunks.join('')) }
  }
  return { repo, cli }
}

it('a T0 request is handed back to the session and finishes on submit', () => {
  const { cli } = setup()
  assert.equal(cli('start', '--request', 'fix typo in README').json.tier, 't0')
  assert.equal(cli('next').json.kind, 'direct')
  assert.equal(cli('submit').json.step, 'done')
})

it('a T2 request runs discover → BA → QC → Ready → tests → dev → QA → verify to a green trace', () => {
  const { repo, cli } = setup()
  cli('start', '--request', 'The total multiplies price by quantity.', '--tier', 't2')
  assert.equal(cli('next').json.kind, 'cli')
  assert.equal(cli('submit').json.step, 'ba')

  const ba = cli('next').json
  assert.deepEqual([ba.kind, ba.step, ba.model], ['agent', 'ba', 'opus'])
  assert.match(readFileSync(ba.prompt_file, 'utf8'), /The total multiplies price by quantity\./)
  writeFileSync(ba.output, stringify(MODEL))
  assert.equal(cli('submit').json.step, 'qc')

  writeFileSync(cli('next').json.output, stringify(CASES))
  assert.equal(cli('submit').json.step, 'ready')
  assert.equal(cli('next').json.kind, 'approve')
  assert.equal(cli('submit', '--approve').json.step, 'write-tests')

  const writer = cli('next').json
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  assert.equal(cli('submit').json.step, 'dev')

  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  writeFileSync(cli('next').json.output, 'Multiplied by quantity.\n')
  assert.equal(cli('submit').json.step, 'qa')
  assert.equal(cli('submit').json.step, 'review')
  assert.equal(cli('submit').json.step, 'verify')
  assert.equal(cli('submit').json.step, 'done')

  const done = cli('next').json
  assert.equal(done.kind, 'done')
  assert.match(readFileSync(done.report, 'utf8'), /\| S1: The total multiplies price by quantity\. \| R1 \| C1 \| green \|/)
  assert.equal(cli('status').json.complete, true)
})

it('BA questions go to the user, and the answers come back into the next BA prompt', () => {
  const { cli } = setup()
  cli('start', '--request', 'Refunds need approval.', '--tier', 't2')
  cli('submit')
  const asking = { ...MODEL, questions: [{ id: 'Q1', text: 'Who may approve a refund?', about: 'rule' }] }
  writeFileSync(cli('next').json.output, stringify(asking))
  assert.equal(cli('submit').json.step, 'ask')
  const ask = cli('next').json
  assert.deepEqual(ask.questions.map((question) => question.id), ['Q1'])
  writeFileSync(ask.answers_file, stringify([{ id: 'Q1', answer: 'Only admins.' }]))
  assert.equal(cli('submit', '--answers', ask.answers_file).json.step, 'ba')
  assert.match(readFileSync(cli('next').json.prompt_file, 'utf8'), /Q1 Who may approve a refund\? \(about: rule\)\n {2}Answer: Only admins\./)
})

it('a broken model keeps the BA step and puts the problems into the next BA prompt', () => {
  const { cli } = setup()
  cli('start', '--request', 'Refunds need approval.', '--tier', 't2')
  cli('submit')
  const broken = { ...MODEL, sentences: [{ id: 'S1', text: 'x', covered_by: ['R9'] }] }
  writeFileSync(cli('next').json.output, stringify(broken))
  const result = cli('submit')
  assert.equal(result.code, 1)
  assert.deepEqual(result.json, { step: 'ba', errors: ['sentence S1 refers to unknown R9'] })
  assert.match(readFileSync(cli('next').json.prompt_file, 'utf8'), /- sentence S1 refers to unknown R9/)
})

it('an agent that wrote nothing does not advance the run', () => {
  const { cli } = setup()
  cli('start', '--request', 'Refunds need approval.', '--tier', 't2')
  cli('submit')
  const result = cli('submit')
  assert.equal(result.json.step, 'ba')
  assert.match(result.json.errors[0], /model\.yaml was not written/)
})

it('dev may not edit a test file: each edit is reverted, and the third ends the run as stuck', () => {
  const { repo, cli } = setup()
  cli('start', '--request', 'The total multiplies price by quantity.', '--tier', 't1')
  cli('submit')
  const writer = cli('next').json
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  assert.equal(cli('submit').json.step, 'dev')
  const edit = () => writeFile(repo, 'test/total.test.js', C1_TEST.replace('6)', '2)'))
  edit()
  assert.deepEqual(cli('submit').json.errors, [
    'dev: your edit to test/total.test.js was reverted — tests are read-only after the test-writer step',
  ])
  edit()
  cli('submit')
  edit()
  assert.equal(cli('submit').json.step, 'stuck')
  assert.match(cli('next').json.reason, /dev kept changing test files: test\/total\.test\.js/)
  assert.equal(readFileSync(join(repo, 'test/total.test.js'), 'utf8'), C1_TEST)
})

it('red tests send QA back to dev, and three red rounds end the run as stuck', () => {
  const { repo, cli } = setup()
  cli('start', '--request', 'The total multiplies price by quantity.', '--tier', 't1')
  cli('submit')
  const writer = cli('next').json
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  cli('submit')
  for (const expected of ['qa', 'dev', 'qa', 'dev', 'qa']) assert.equal(cli('submit').json.step, expected)
  assert.equal(cli('submit').json.step, 'stuck')
  assert.match(cli('next').json.reason, /tests still red after 3 dev rounds: test\/total\.test\.js/)
  assert.equal(readFileSync(join(repo, 'src/total.js'), 'utf8'), BUGGY_TOTAL)
})
