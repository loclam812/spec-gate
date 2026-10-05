import { it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { writeFile } from './helpers.js'
import { C1_TEST, CASES, REQUEST, setup } from './tests-helpers.js'

it('spec-to-tests runs discover → blind QC → Ready → write-tests and ends with a suite snapshot', () => {
  const { repo, cli } = setup()
  assert.equal(cli('start', '--request', REQUEST).json.risk.level, 'low')
  assert.equal(cli('submit').json.step, 'qc')
  const qc = cli('next').json
  assert.deepEqual([qc.kind, qc.step, qc.model], ['agent', 'qc', 'opus'])
  const prompt = readFileSync(qc.prompt_file, 'utf8')
  assert.match(prompt, /qc-packet\.md/)
  assert.match(prompt, /Do not open implementation code/)
  writeFileSync(qc.output, stringify(CASES))
  assert.equal(cli('submit').json.step, 'ready')
  assert.equal(cli('next').json.kind, 'approve')
  assert.equal(cli('submit', '--approve').json.step, 'write-tests')
  const writer = cli('next').json
  assert.deepEqual([writer.step, writer.model], ['write-tests', 'sonnet'])
  assert.match(readFileSync(writer.prompt_file, 'utf8'), /No knowledge file was found/)
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  assert.equal(cli('submit').json.step, 'done')
  const done = cli('next').json
  assert.match(readFileSync(done.report, 'utf8'), /C1 .*red \(assertion\)/)
  assert.ok(existsSync(join(done.report, '..', 'suite-baseline.json')))
})

function toWriter(cli) {
  cli('start', '--request', REQUEST)
  cli('submit')
  writeFileSync(cli('next').json.output, stringify(CASES))
  cli('submit')
  cli('submit', '--approve')
  return cli('next').json
}

it('a test file with a syntax error is sent back to the writer with the reason', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  writeFile(repo, 'test/total.test.js', "import { test } from 'node:test'\ntest('C1: total', () => {\n")
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  const result = cli('submit').json
  assert.equal(result.step, 'write-tests')
  assert.match(result.errors[0], /\(syntax\)|did not load/)
})

it('a test for code that does not exist yet is accepted and reported as red (missing)', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  writeFile(repo, 'test/refund.test.js', C1_TEST.replace('../src/total.js', '../src/refund.js'))
  writeFileSync(writer.output, stringify({ files: ['test/refund.test.js'] }))
  assert.equal(cli('submit').json.step, 'done')
  assert.match(readFileSync(cli('next').json.report, 'utf8'), /C1 .*red \(missing\)/)
})

it('a high-risk question goes to the user, and an unagreed UX source is asked by the CLI', () => {
  const { cli } = setup()
  cli('start', '--request', 'Let viewers open the refund dialog.')
  cli('submit')
  const ui = {
    ...CASES,
    ui: true,
    ux: { source: 'none-agreed', screens: ['refund dialog'], states: ['error'] },
    sentences: [{ id: 'S1', text: 'Let viewers open the refund dialog.', cases: ['C1'] }],
  }
  writeFileSync(cli('next').json.output, stringify(ui))
  assert.equal(cli('submit').json.step, 'ask')
  const ask = cli('next').json
  assert.deepEqual(ask.questions.map((q) => q.about), ['ux-source'])
  writeFileSync(ask.answers_file, stringify([{ id: ask.questions[0].id, answer: 'Match the screen as it is now.' }]))
  assert.equal(cli('submit', '--answers', ask.answers_file).json.step, 'qc')
})
