import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { runRun } from '../cli/run.js'
import { git } from '../cli/lib/exec.js'
import { BUGGY_TOTAL, commitAll, makeFixtureRepo, tempDir, writeFile } from './helpers.js'

const MODEL = {
  ui: false,
  sentences: [{ id: 'S1', text: 'Refunds need approval.', covered_by: ['R1'] }],
  rules: [{ id: 'R1', when: 'a refund is requested', then: 'it waits for approval' }],
  flows: [],
  questions: [],
}
const CASES = { cases: [{ id: 'C1', covers: ['R1'], layer: 'unit', steps: 'request', expected: 'waits' }] }
const C1_TEST =
  "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { total } from '../src/total.js'\n\ntest('C1: total multiplies price by quantity', () => {\n  assert.equal(total([{ price: 2, qty: 3 }]), 6)\n})\n"

function setup({ testScript = true, home = tempDir('sg-home-'), repo = makeFixtureRepo().repo } = {}) {
  if (testScript) writeFile(repo, 'package.json', JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }))
  writeFile(repo, 'src/total.js', BUGGY_TOTAL)
  commitAll(repo, 'baseline')
  const env = { ...process.env, SPEC_GATE_HOME: home }
  const cli = (...argv) => {
    const chunks = []
    const code = runRun([...argv, '--repo', repo], { env, out: { write: (text) => chunks.push(text) } })
    return { code, json: JSON.parse(chunks.join('')) }
  }
  return { repo, home, cli }
}

function toReady(cli) {
  cli('start', '--request', 'Refunds need approval.', '--tier', 't2')
  cli('submit')
  writeFileSync(cli('next').json.output, stringify(MODEL))
  cli('submit')
  writeFileSync(cli('next').json.output, stringify(CASES))
  cli('submit')
}

function toDev(cli, repo, testText = C1_TEST) {
  cli('start', '--request', 'The total multiplies price by quantity.', '--tier', 't1')
  cli('submit')
  const writer = cli('next').json
  writeFile(repo, 'test/total.test.js', testText)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  return cli('submit')
}

it('a step whose output keeps failing its checks ends stuck after three attempts', () => {
  const { cli } = setup()
  cli('start', '--request', 'Refunds need approval.', '--tier', 't2')
  cli('submit')
  const broken = stringify({ ...MODEL, rules: [] })
  for (const expected of ['ba', 'ba', 'stuck']) {
    writeFileSync(cli('next').json.output ?? '/dev/null', broken)
    assert.equal(cli('submit').json.step, expected)
  }
  assert.match(cli('next').json.reason, /^ba: output failed its checks 3 times — sentence S1 refers to unknown R1/)
})

it('a rejection at Ready needs a new model: the rejected one does not count', () => {
  const { cli } = setup()
  toReady(cli)
  assert.equal(cli('submit', '--reject', 'approval needs two people').json.step, 'ba')
  const result = cli('submit')
  assert.equal(result.json.step, 'ba')
  assert.match(result.json.errors[0], /model\.yaml was not written/)
  assert.match(readFileSync(cli('next').json.prompt_file, 'utf8'), /Your previous model[\s\S]*it waits for approval/)
})

it('output that is not valid YAML goes back to the agent with the parse error', () => {
  const { cli } = setup()
  cli('start', '--request', 'Refunds need approval.', '--tier', 't2')
  cli('submit')
  writeFileSync(cli('next').json.output, 'rules:\n  - id: R1\n    then: rejected: window expired\n')
  const result = cli('submit')
  assert.equal(result.code, 1)
  assert.match(result.json.errors[0], /^model\.yaml is not valid YAML: /)
})

it('a request that names a dialog needs ui: true or a question, and every sentence must be in the model', () => {
  const { cli } = setup()
  cli('start', '--request', 'Add a refund dialog. Admins approve it.', '--tier', 't2')
  cli('submit')
  const ba = cli('next').json
  assert.match(readFileSync(ba.prompt_file, 'utf8'), /S1: Add a refund dialog\.\nS2: Admins approve it\./)
  writeFileSync(ba.output, stringify({ ...MODEL, sentences: [{ id: 'S1', text: 'Add a refund dialog.', covered_by: ['R1'] }] }))
  assert.deepEqual(cli('submit').json.errors, [
    'sentence S2 of the request is not in the model',
    'ui: the request names a screen, page, dialog or form; set ui: true, or ask (about: ux-source)',
  ])
})

it('a case id named only in a comment does not count as a test for that case', () => {
  const { repo, cli } = setup()
  toReady(cli)
  cli('submit', '--approve')
  const writer = cli('next').json
  writeFile(repo, 'test/total.test.js', C1_TEST.replace("test('C1: ", '// C1 is covered below\ntest(\''))
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  assert.deepEqual(cli('submit').json.errors, ['write-tests: no test names C1'])
})

it('an edited test file is restored by the CLI and the dev step is told', () => {
  const { repo, cli } = setup()
  toDev(cli, repo)
  writeFile(repo, 'test/total.test.js', C1_TEST.replace('6)', '2)'))
  assert.deepEqual(cli('submit').json.errors, [
    'dev: your edit to test/total.test.js was reverted — tests are read-only after the test-writer step',
  ])
  assert.equal(readFileSync(join(repo, 'test/total.test.js'), 'utf8'), C1_TEST)
})

it('a test file no stack can run is refused, and a repository with no stack stops at discover', () => {
  const { repo, cli } = setup()
  cli('start', '--request', 'The total multiplies price by quantity.', '--tier', 't1')
  cli('submit')
  const writer = cli('next').json
  writeFile(repo, 'e2e/total.spec.py', 'def test_total(): pass\n')
  writeFileSync(writer.output, stringify({ files: ['e2e/total.spec.py'] }))
  assert.match(cli('submit').json.errors[0], /^write-tests: no test stack runs e2e\/total\.spec\.py/)
  const bare = setup({ testScript: false })
  bare.cli('start', '--request', 'The total multiplies price by quantity.', '--tier', 't1')
  assert.equal(bare.cli('submit').json.step, 'stuck')
  assert.match(bare.cli('next').json.reason, /no test stack found/)
})

it('a dev that says a test is wrong stops the run with its reason', () => {
  const { repo, cli } = setup()
  toDev(cli, repo)
  writeFileSync(cli('next').json.output, 'TEST-WRONG: C1 expects 6 but the request says 7\n')
  assert.equal(cli('submit').json.step, 'stuck')
  assert.match(cli('next').json.reason, /TEST-WRONG: C1 expects 6 but the request says 7/)
})

it('two clones of one repository each follow their own run', () => {
  const home = tempDir('sg-home-')
  const a = makeFixtureRepo().repo
  const b = makeFixtureRepo().repo
  for (const repo of [a, b]) git(repo, ['remote', 'add', 'origin', 'git@github.com:acme/shop.git'])
  const first = setup({ home, repo: a })
  const second = setup({ home, repo: b })
  first.cli('start', '--request', 'Refunds need approval.', '--tier', 't2')
  second.cli('start', '--request', 'fix typo in README')
  assert.equal(first.cli('next').json.kind, 'cli')
  assert.equal(second.cli('next').json.kind, 'direct')
})

it('a T1 run uses the discovered skills: the test-writing skill in its prompt, the review in its report', () => {
  const { repo, cli } = setup()
  writeFile(repo, '.claude/skills/write-tests/SKILL.md', '---\nname: write-tests\n---\n')
  writeFile(repo, '.claude/skills/code-review/SKILL.md', '---\nname: code-review\n---\n')
  cli('start', '--request', 'The total multiplies price by quantity.', '--tier', 't1')
  cli('submit')
  const writer = cli('next').json
  assert.match(readFileSync(writer.prompt_file, 'utf8'), /Test-writing skill in this repository: write-tests\./)
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  cli('submit')
  writeFile(repo, 'src/total.js', readFileSync(join(repo, 'src/total.js'), 'utf8').replace('item.price', 'item.price * item.qty'))
  writeFileSync(cli('next').json.output, 'Multiplied by quantity.\n')
  assert.equal(cli('submit').json.step, 'qa')
  assert.equal(cli('submit').json.step, 'review')
  const review = cli('next').json
  assert.match(readFileSync(review.prompt_file, 'utf8'), /`code-review` skill/)
  writeFileSync(review.output, 'Minor: name the quantity field explicitly.\n')
  assert.equal(cli('submit').json.step, 'verify')
  assert.equal(cli('submit').json.step, 'done')
  assert.match(readFileSync(cli('next').json.report, 'utf8'), /## Review findings\n\nMinor: name the quantity field explicitly\./)
})

it('a test path outside the repository is refused before anything reads or restores it', () => {
  const { repo, cli } = setup()
  cli('start', '--request', 'The total multiplies price by quantity.', '--tier', 't1')
  cli('submit')
  const writer = cli('next').json
  writeFile(join(repo, '..'), 'outside.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['../outside.test.js', '/etc/hosts'] }))
  assert.deepEqual(cli('submit').json.errors, [
    'write-tests: ../outside.test.js is outside the repository',
    'write-tests: /etc/hosts is outside the repository',
  ])
})

it('a test file its runner finds no tests in is refused at write-tests', () => {
  const { repo, cli } = setup()
  cli('start', '--request', 'The total multiplies price by quantity.', '--tier', 't1')
  cli('submit')
  const writer = cli('next').json
  const quiet = { name: 'fake', test_globs: ['e2e/**/*.spec.ts'], test_command: "echo 'No tests found, exiting with code 1'; exit 1", report: null, report_file: null }
  const profilePath = join(writer.output, '..', 'profile.json')
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
  writeFileSync(profilePath, JSON.stringify({ ...profile, stacks: [quiet, ...profile.stacks] }))
  writeFile(repo, 'e2e/total.spec.ts', "test('C1: total', () => {})\n")
  writeFileSync(writer.output, stringify({ files: ['e2e/total.spec.ts'] }))
  assert.match(cli('submit').json.errors[0], /^write-tests: the fake runner found no tests in e2e\/total\.spec\.ts/)
})
