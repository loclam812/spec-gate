import { it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { stringify } from 'yaml'
import { FIXED_TOTAL, writeFile } from './helpers.js'
import { C1_TEST, CASES, REQUEST, setup } from './tests-helpers.js'

const HELPER = 'test/fixtures/items.js'
const HELPER_SOURCE = 'export const items = [{ price: 2, qty: 3 }]\n'
const TEST_WITH_HELPER = C1_TEST.replace("import { total }", "import { items } from './fixtures/items.js'\nimport { total }").replace('[{ price: 2, qty: 3 }]', 'items')

function toWriter(cli) {
  cli('start', '--request', REQUEST)
  cli('submit')
  writeFileSync(cli('next').json.output, stringify(CASES))
  cli('submit')
  cli('submit', '--approve')
  return cli('next').json
}

function toDoneWithHelper(cli, repo) {
  const writer = toWriter(cli)
  writeFile(repo, HELPER, HELPER_SOURCE)
  writeFile(repo, 'test/total.test.js', TEST_WITH_HELPER)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'], helpers: [HELPER] }))
  assert.equal(cli('submit').json.step, 'done')
  return dirname(writer.output)
}

const readJson = (dir, name) => JSON.parse(readFileSync(join(dir, name), 'utf8'))

it('a new helper the tests import is accepted and guarded apart from the tests', () => {
  const { repo, cli } = setup()
  const dir = toDoneWithHelper(cli, repo)
  assert.deepEqual(Object.keys(readJson(dir, 'guard-helpers.json')), [HELPER])
  assert.deepEqual(Object.keys(readJson(dir, 'guard.json')), ['test/total.test.js'])
  assert.ok(existsSync(join(dir, 'guard', HELPER)))
})

it('a helper that a test stack runs is sent back to be listed under files', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFile(repo, 'test/extra.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'], helpers: ['test/extra.test.js'] }))
  const result = cli('submit').json
  assert.equal(result.step, 'write-tests')
  assert.match(result.errors[0], /write-tests: test\/extra\.test\.js is run by a test stack; list it under files/)
})

it('a file git already tracks cannot be a helper', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'], helpers: ['src/total.js'] }))
  const result = cli('submit').json
  assert.equal(result.step, 'write-tests')
  assert.match(result.errors[0], /write-tests: src\/total\.js is already tracked by git; write-tests changes no existing non-test file/)
})

it('a missing helper is rejected, and an unrunnable test file hints at helpers', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'], helpers: ['test/fixtures/none.js'] }))
  assert.match(cli('submit').json.errors[0], /write-tests: test\/fixtures\/none\.js does not exist/)
  writeFile(repo, 'test/support.js', HELPER_SOURCE)
  writeFileSync(writer.output, stringify({ files: ['test/support.js'] }))
  assert.match(cli('submit').json.errors[0], /no test stack runs test\/support\.js; .*A helper the tests import goes under helpers:/)
})

it('verify fails when a guarded helper changes', () => {
  const { repo, cli, verify } = setup()
  toDoneWithHelper(cli, repo)
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  writeFile(repo, HELPER, 'export const items = [{ price: 2, qty: 1 }]\n')
  const result = verify()
  assert.equal(result.code, 1)
  assert.match(readFileSync(result.json.report, 'utf8'), /test\/fixtures\/items\.js changed after the tests were written/)
})

it('amend re-guards a changed helper and verify then accepts it', () => {
  const { repo, cli, verify } = setup()
  const dir = toDoneWithHelper(cli, repo)
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  assert.throws(() => cli('amend', '--file', HELPER, '--reason', 'x'), /amend: test\/fixtures\/items\.js has not changed since it was guarded/)
  const changed = 'export const items = [{ price: 2, qty: 3 }, ]\n'
  writeFile(repo, HELPER, changed)
  assert.deepEqual(cli('amend', '--file', HELPER, '--reason', 'the user approved a formatting change').json, { amended: HELPER })
  assert.equal(readFileSync(join(dir, 'guard', HELPER), 'utf8'), changed)
  assert.equal(verify().code, 0)
  assert.throws(() => cli('amend', '--file', 'test/other.js', '--reason', 'x'), /amend: test\/other\.js is not a guarded test or helper of this run/)
})

const submitHelpers = (cli, repo, helpers) => {
  const writer = toWriter(cli)
  writeFile(repo, 'test/total.test.js', C1_TEST)
  return { writer, submit: (value) => (writeFileSync(writer.output, stringify({ files: ['test/total.test.js'], helpers: value })), cli('submit').json) }
}

it('a directory is refused as a helper without crashing', () => {
  const { repo, cli } = setup()
  const { submit } = submitHelpers(cli, repo)
  writeFile(repo, 'test/fixtures/data/a.json', '{}')
  assert.match(submit(['test/fixtures/data']).errors[0], /write-tests: test\/fixtures\/data is not a regular file/)
})

it('a helper outside the repository is refused', () => {
  const { repo, cli } = setup()
  const { submit } = submitHelpers(cli, repo)
  assert.match(submit(['../elsewhere.js']).errors[0], /write-tests: \.\.\/elsewhere\.js is outside the repository/)
})

it('a file that was already untracked when write-tests began is refused as a helper', () => {
  const { repo, cli } = setup()
  writeFile(repo, 'test/fixtures/scratch.js', HELPER_SOURCE)
  const { submit } = submitHelpers(cli, repo)
  assert.match(submit(['test/fixtures/scratch.js']).errors[0], /write-tests: test\/fixtures\/scratch\.js already existed before the tests were written/)
})

it('helpers that is not a list of strings is sent back', () => {
  const { repo, cli } = setup()
  const { submit } = submitHelpers(cli, repo)
  assert.match(submit('test/fixtures/items.js').errors[0], /write-tests: helpers must be a list of file paths/)
  assert.match(submit([1]).errors[0], /write-tests: helpers must be a list of file paths/)
})

it('a helper path is normalised before it is guarded', () => {
  const { repo, cli } = setup()
  const { writer, submit } = submitHelpers(cli, repo)
  writeFile(repo, HELPER, HELPER_SOURCE)
  assert.equal(submit(['./test/fixtures/../fixtures/items.js']).step, 'done')
  assert.deepEqual(Object.keys(readJson(dirname(writer.output), 'guard-helpers.json')), [HELPER])
})

it('amend releases a guarded helper that was deleted, and a drop leaves the helper guard alone', () => {
  const { repo, cli, verify } = setup()
  const dir = toDoneWithHelper(cli, repo)
  const before = readFileSync(join(dir, 'guard-helpers.json'), 'utf8')
  assert.throws(() => cli('drop', '--case', 'C9', '--reason', 'x'), /no case C9/)
  assert.equal(readFileSync(join(dir, 'guard-helpers.json'), 'utf8'), before)
  rmSync(join(repo, HELPER))
  writeFile(repo, 'test/total.test.js', C1_TEST)
  assert.deepEqual(cli('amend', '--file', HELPER, '--reason', 'the helper was inlined').json, { amended: HELPER })
  assert.deepEqual(readJson(dir, 'guard-helpers.json'), {})
  assert.ok(!existsSync(join(dir, 'guard', HELPER)))
  assert.match(readFileSync(join(dir, 'decisions.md'), 'utf8'), /- Removed helper test\/fixtures\/items\.js after the tests were written: the helper was inlined/)
  assert.deepEqual(cli('amend', '--file', 'test/total.test.js', '--reason', 'inlined the helper').json, { amended: 'test/total.test.js' })
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  assert.equal(verify().code, 0)
})

it('a deleted guarded test cannot be amended', () => {
  const { repo, cli } = setup()
  toDoneWithHelper(cli, repo)
  rmSync(join(repo, 'test/total.test.js'))
  assert.throws(() => cli('amend', '--file', 'test/total.test.js', '--reason', 'x'))
})
