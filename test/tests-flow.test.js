import { it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { runTests } from '../cli/tests.js'
import { git } from '../cli/lib/exec.js'
import { tempDir, writeFile } from './helpers.js'
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

it('three failed submissions of one step end the run stuck with the reason', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  writeFile(repo, 'test/total.test.js', "import { test } from 'node:test'\ntest('C1: total', () => {\n")
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  assert.deepEqual([cli('submit').json.step, cli('submit').json.step, cli('submit').json.step], ['write-tests', 'write-tests', 'stuck'])
  assert.match(cli('next').json.reason, /^write-tests: output failed its checks 3 times/)
})

it('a test file no stack runs is refused', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  writeFile(repo, 'e2e/total.spec.py', 'def test_total(): pass\n')
  writeFileSync(writer.output, stringify({ files: ['e2e/total.spec.py'] }))
  assert.match(cli('submit').json.errors[0], /^write-tests: no test stack runs e2e\/total\.spec\.py/)
})

it('a repository with no test stack stops at discover', () => {
  const { repo, cli } = setup()
  rmSync(join(repo, 'package.json'))
  cli('start', '--request', REQUEST)
  assert.equal(cli('submit').json.step, 'stuck')
  assert.match(cli('next').json.reason, /no test stack found/)
})

it('a test path outside the repository is refused before anything reads it', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  writeFile(join(repo, '..'), 'outside.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['../outside.test.js', '/etc/hosts'] }))
  assert.deepEqual(cli('submit').json.errors, [
    'write-tests: ../outside.test.js is outside the repository',
    'write-tests: /etc/hosts is outside the repository',
  ])
})

it('a test file its runner finds no tests in is refused at write-tests', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  const quiet = { name: 'fake', test_globs: ['e2e/**/*.spec.ts'], test_command: "echo 'No tests found, exiting with code 1'; exit 1", report: null, report_file: null }
  const profilePath = join(writer.output, '..', 'profile.json')
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
  writeFileSync(profilePath, JSON.stringify({ ...profile, stacks: [quiet, ...profile.stacks] }))
  writeFile(repo, 'e2e/total.spec.ts', "test('C1: total', () => {})\n")
  writeFileSync(writer.output, stringify({ files: ['e2e/total.spec.ts'] }))
  assert.match(cli('submit').json.errors[0], /^write-tests: the fake runner found no tests in e2e\/total\.spec\.ts/)
})

it('a rejection at Ready goes back to qc, records the reason and counts a round', () => {
  const { cli } = setup()
  cli('start', '--request', REQUEST)
  cli('submit')
  writeFileSync(cli('next').json.output, stringify(CASES))
  cli('submit')
  assert.equal(cli('submit', '--reject', 'refunds need two approvers').json.step, 'qc')
  assert.equal(cli('status').json.qc_rounds, 1)
  assert.match(readFileSync(join(cli('next').json.output, '..', 'decisions.md'), 'utf8'), /- Rejected at Ready: refunds need two approvers\n/)
})

it('two working trees of one repository each follow their own latest run', () => {
  const { repo, env } = setup()
  const tree = join(tempDir('sg-tree-'), 'tree')
  git(repo, ['worktree', 'add', tree])
  const run = (path, ...argv) => {
    const chunks = []
    runTests([...argv, '--repo', path], { env, out: { write: (text) => chunks.push(text) } })
    return JSON.parse(chunks.join(''))
  }
  const first = run(repo, 'start', '--request', REQUEST).run
  const second = run(tree, 'start', '--request', 'Refunds need approval.').run
  assert.notEqual(first, second)
  assert.equal(run(repo, 'status').id, first)
  assert.equal(run(tree, 'status').id, second)
})

it('agent output that is not valid YAML comes back with the parse error', () => {
  const { cli } = setup()
  cli('start', '--request', REQUEST)
  cli('submit')
  writeFileSync(cli('next').json.output, 'cases:\n  - id: C1\n    then: rejected: window expired\n')
  const result = cli('submit')
  assert.equal(result.code, 1)
  assert.match(result.json.errors[0], /^cases\.yaml is not valid YAML: /)
})

it('disputed cases from tests.yaml appear in the report', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'], disputed: [{ case: 'C1', reason: 'the request says 7 elsewhere' }] }))
  assert.equal(cli('submit').json.step, 'done')
  assert.match(readFileSync(cli('next').json.report, 'utf8'), /## Disputed\n\n- C1: the request says 7 elsewhere\n/)
})

it('a test whose hook throws on the environment is refused as a setup failure', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  const source = "import { test, beforeEach } from 'node:test'\nbeforeEach(() => { throw new Error('DATABASE_URL is not set') })\ntest('C1: total', () => {})\n"
  writeFile(repo, 'test/total.test.js', source)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  const result = cli('submit').json
  assert.equal(result.step, 'write-tests')
  assert.match(result.errors[0], /DATABASE_URL is not set \(setup\)/)
})

it('a loaded test whose name carries no case id is refused with no test names C1', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  const source = "import { test } from 'node:test'\nimport * as refunds from '../src/refunds.js'\n// C1\ntest('refund within window', () => { refunds.approve() })\n"
  writeFile(repo, 'src/refunds.js', 'export const other = 1\n')
  writeFile(repo, 'test/refunds.test.js', source)
  writeFileSync(writer.output, stringify({ files: ['test/refunds.test.js'] }))
  assert.deepEqual(cli('submit').json.errors, ['write-tests: no test names C1'])
})

it('after a Ready reject the next QC prompt quotes the previous cases and the reason', () => {
  const { cli } = setup()
  cli('start', '--request', REQUEST)
  cli('submit')
  writeFileSync(cli('next').json.output, stringify(CASES))
  cli('submit')
  cli('submit', '--reject', 'C1 is wrong: refunds after 30 days are refused')
  const prompt = readFileSync(cli('next').json.prompt_file, 'utf8')
  assert.match(prompt, /Your previous cases \(revise them; keep their ids\)/)
  assert.match(prompt, /id: C1/)
  assert.match(prompt, /C1 is wrong: refunds after 30 days are refused/)
})

it('the first QC prompt says there are no previous cases', () => {
  const { cli } = setup()
  cli('start', '--request', REQUEST)
  cli('submit')
  assert.match(readFileSync(cli('next').json.prompt_file, 'utf8'), /Your previous cases \(revise them; keep their ids\)\n\nNone\./)
})
