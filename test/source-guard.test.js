import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { git } from '../cli/lib/exec.js'
import { commitAll, writeFile } from './helpers.js'
import { C1_TEST, CASES, REQUEST, setup } from './tests-helpers.js'

function toWriter(cli) {
  cli('start', '--request', REQUEST)
  cli('submit')
  writeFileSync(cli('next').json.output, stringify(CASES))
  cli('submit')
  cli('submit', '--approve')
  return cli('next').json
}

const touch = (repo, file) => writeFile(repo, file, `${readFileSync(join(repo, file), 'utf8')}// touched\n`)

function submitTests(cli, repo, writer) {
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  return cli('submit').json
}

it('write-tests refuses a tracked non-test file the writer changed after Ready', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  touch(repo, 'src/total.js')
  const result = submitTests(cli, repo, writer)
  assert.equal(result.step, 'write-tests')
  assert.match(result.errors.join('\n'), /write-tests: src\/total\.js changed after Ready; write-tests changes no existing non-test file/)
})

it('write-tests refuses a new file it was not told about', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  writeFile(repo, 'src/refund.js', 'export const refund = () => 0\n')
  const result = submitTests(cli, repo, writer)
  assert.equal(result.step, 'write-tests')
  assert.match(result.errors.join('\n'), /write-tests: src\/refund\.js is new and not listed; list it under helpers if the tests import it, or delete it/)
})

it('an edit the user made before Ready is the baseline, not the writer’s change', () => {
  const { repo, cli } = setup()
  touch(repo, 'src/total.js')
  const writer = toWriter(cli)
  assert.equal(submitTests(cli, repo, writer).step, 'done')
})

it('a file that was already untracked at Ready may not be edited by the writer either', () => {
  const { repo, cli } = setup()
  writeFile(repo, 'src/draft.js', 'export const draft = 1\n')
  const writer = toWriter(cli)
  touch(repo, 'src/draft.js')
  assert.match(submitTests(cli, repo, writer).errors.join('\n'), /write-tests: src\/draft\.js changed after Ready/)
})

it('a commit made during write-tests is refused, so a change cannot hide in history', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  touch(repo, 'src/total.js')
  commitAll(repo, 'sneak')
  assert.match(submitTests(cli, repo, writer).errors.join('\n'), /write-tests: HEAD moved since Ready/)
})

it('a file hidden with assume-unchanged or an exclude rule is still seen', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  touch(repo, 'src/total.js')
  git(repo, ['update-index', '--assume-unchanged', 'src/total.js'])
  assert.match(submitTests(cli, repo, writer).errors.join('\n'), /write-tests: src\/total\.js is hidden from git/)

  const second = setup()
  const writer2 = toWriter(second.cli)
  writeFile(second.repo, '.git/info/exclude', 'src/refund.js\n')
  writeFile(second.repo, 'src/refund.js', 'export const refund = () => 0\n')
  assert.match(submitTests(second.cli, second.repo, writer2).errors.join('\n'), /write-tests: \.git\/info\/exclude changed after Ready/)
})

it('files the test runner itself leaves behind are not the writer’s and do not use up attempts', () => {
  const { repo, cli } = setup()
  const writer = toWriter(cli)
  writeFile(repo, 'test/total.test.js', C1_TEST.replace("import { total }", "import { writeFileSync } from 'node:fs'\nwriteFileSync(new URL('../run-artifact.log', import.meta.url), 'x')\nimport { total }"))
  writeFile(repo, 'test/other.test.js', 'oops')
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js', 'test/other.test.js'] }))
  cli('submit')
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  rmSync(join(repo, 'test/other.test.js'))
  const errors = (cli('submit').json.errors ?? []).join('\n')
  assert.doesNotMatch(errors, /run-artifact\.log/)
})
