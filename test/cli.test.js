import { it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEval } from '../cli/eval.js'
import { repoSlug } from '../cli/lib/store.js'
import { CATCHING_TEST, makeFixtureRepo, tempDir, writeFile, writeSample } from './helpers.js'

function setup() {
  const { repo, preFix, postFix } = makeFixtureRepo()
  const home = tempDir('sg-home-')
  writeSample(join(home, 'projects', repoSlug(repo), 'eval'), {
    id: 'demo-1',
    pre_fix: preFix,
    post_fix: postFix,
    test_command: 'node --test {file}',
    test_globs: ['**/*.test.js'],
  })
  const generated = join(tempDir(), 'generated.test.js')
  writeFileSync(generated, CATCHING_TEST)
  const bin = tempDir('sg-bin-')
  writeFile(bin, 'claude', `#!/bin/sh\nmkdir -p test && cp '${generated}' test/total.test.js && echo '{}'\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  const env = { ...process.env, SPEC_GATE_HOME: home, PATH: `${bin}:${process.env.PATH}` }
  const run = (...argv) => {
    const chunks = []
    const code = runEval([...argv, '--repo', repo], { env, out: { write: (text) => chunks.push(text) } })
    return { code, text: chunks.join('') }
  }
  return { home, repo, preFix, run }
}

it('where, validate, prepare, generate, score and report run end to end with a stub claude', () => {
  const { home, repo, run } = setup()
  assert.equal(run('where', 'demo-1').text, `${join(home, 'projects', repoSlug(repo), 'eval', 'demo-1')}\n`)
  assert.deepEqual(run('validate', 'demo-1'), { code: 0, text: 'ok\n' })
  assert.equal(run('prepare', 'demo-1').code, 0)
  const generated = run('generate', 'demo-1', '--candidate', 'single-prompt', '--run', '1')
  assert.match(generated.text, /collected 1 test file\(s\), ignored 1 other change\(s\)/)
  const scored = run('score', 'demo-1', '--candidate', 'single-prompt', '--run', '1')
  assert.match(scored.text, /^demo-1: caught\n {2}caught +test\/total\.test\.js\n$/)
  assert.match(run('report').text, /Catch rate: 1\/1 \(100%\)/)
})

it('score before prepare says which command to run', () => {
  const { run } = setup()
  assert.throws(
    () => run('score', 'demo-1', '--candidate', 'single-prompt', '--run', '1'),
    /not prepared; run: spec-gate eval prepare demo-1/,
  )
})

it('generate without a run number is rejected', () => {
  const { run } = setup()
  run('prepare', 'demo-1')
  assert.throws(() => run('generate', 'demo-1', '--candidate', 'single-prompt'), /--candidate <name> and --run <n> are required/)
})

it('an unknown sample points at where it was expected', () => {
  const { run } = setup()
  assert.throws(() => run('validate', 'missing-1'), /no sample\.yaml in .*eval\/missing-1/)
})

it('score refuses a workspace prepared for other shas', () => {
  const { home, repo, preFix, run } = setup()
  run('prepare', 'demo-1')
  const yamlPath = join(home, 'projects', repoSlug(repo), 'eval', 'demo-1', 'sample.yaml')
  const edited = readFileSync(yamlPath, 'utf8').replace(/post_fix: .*/, `post_fix: "${preFix}"`)
  writeFileSync(yamlPath, edited)
  assert.throws(
    () => run('score', 'demo-1', '--candidate', 'single-prompt', '--run', '1'),
    /not prepared; run: spec-gate eval prepare demo-1/,
  )
})

it('collect after generate is refused instead of erasing the collected tests', () => {
  const { run } = setup()
  run('prepare', 'demo-1')
  run('generate', 'demo-1', '--candidate', 'single-prompt', '--run', '1')
  assert.throws(
    () => run('collect', 'demo-1', '--candidate', 'single-prompt', '--run', '1'),
    /already collected .*--fresh/,
  )
  assert.match(run('score', 'demo-1', '--candidate', 'single-prompt', '--run', '1').text, /: caught/)
})

function stubTouching(path) {
  const generated = join(tempDir(), 'generated.test.js')
  writeFileSync(generated, CATCHING_TEST)
  const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: path } }] } })
  const bin = tempDir('sg-bin-')
  writeFile(bin, 'claude', `#!/bin/sh\nmkdir -p test && cp '${generated}' test/total.test.js && echo '${line}'\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  return bin
}

it('a candidate reading the source checkout is leaked; one writing scratch files to /tmp is not', () => {
  const { home, repo, run } = setup()
  run('prepare', 'demo-1')
  const runWith = (bin, n) => {
    const env = { ...process.env, SPEC_GATE_HOME: home, PATH: `${bin}:${process.env.PATH}` }
    const out = { write: () => {} }
    runEval(['generate', 'demo-1', '--candidate', 'single-prompt', '--run', n, '--repo', repo], { env, out })
    const chunks = []
    runEval(['score', 'demo-1', '--candidate', 'single-prompt', '--run', n, '--repo', repo], { env, out: { write: (text) => chunks.push(text) } })
    return chunks.join('')
  }
  assert.match(runWith(stubTouching(join(repo, 'src', 'total.js')), '1'), /^demo-1: leaked/)
  assert.match(runWith(stubTouching('/tmp/sg-scratch-mutation.sh'), '2'), /^demo-1: caught/)
})
