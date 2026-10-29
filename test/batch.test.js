import { it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEval } from '../cli/eval.js'
import { repoSlug } from '../cli/lib/store.js'
import { CATCHING_TEST, MISSING_TEST, makeFixtureRepo, tempDir, writeFile, writeSample } from './helpers.js'

function setup(fixTest = CATCHING_TEST) {
  const { repo, preFix, postFix } = makeFixtureRepo({ fixFiles: { 'test/total.test.js': fixTest } })
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
  const calls = join(tempDir(), 'calls.txt')
  const bin = tempDir('sg-bin-')
  writeFile(
    bin,
    'claude',
    `#!/bin/sh\necho call >> '${calls}'\nmkdir -p test && cp '${generated}' test/total.test.js\ncat '${home}/leak-line.txt' 2>/dev/null || echo '{}'\n`,
  )
  chmodSync(join(bin, 'claude'), 0o755)
  const env = { ...process.env, SPEC_GATE_HOME: home, SPEC_GATE_WORK: tempDir('sg-work-'), PATH: `${bin}:${process.env.PATH}` }
  const run = (...argv) => {
    const chunks = []
    const code = runEval([...argv, '--repo', repo], { env, out: { write: (text) => chunks.push(text) } })
    return { code, text: chunks.join('') }
  }
  const callCount = () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').length : 0)
  return { home, repo, run, callCount }
}

it('batch runs the canary once per sample and skips a harness-broken sample', () => {
  const broken = setup(MISSING_TEST)
  broken.run('where', 'demo-1')
  const text = broken.run('batch', '--runs', '2').text
  assert.match(text, /demo-1: harness-broken — fix tests score missed\n/)
  assert.equal(text.match(/harness-broken/g).length, 1)
  assert.equal(broken.callCount(), 0)
  assert.equal(existsSync(join(broken.home, 'projects', repoSlug(broken.repo), 'eval', 'demo-1', 'runs', 'single-prompt-1', 'verdict.json')), false)
  assert.match(broken.run('canary', 'demo-1', '--accept', 'the fix test is known to pass before the fix').text, /demo-1: ok \(accepted: the fix test is known/)
  assert.match(broken.run('batch', '--runs', '2').text, /demo-1 single-prompt 2: caught\n/)
  assert.equal(broken.callCount(), 2)
  const sound = setup()
  sound.run('where', 'demo-1')
  assert.match(sound.run('batch', '--runs', '2').text, /demo-1 single-prompt 2: caught\n/)
  assert.equal(sound.callCount(), 2)
  assert.ok(existsSync(join(sound.home, 'projects', repoSlug(sound.repo), 'eval', 'demo-1', 'canary', 'canary.json')))
})

it('batch runs every missing run and skips the ones already scored', () => {
  const { run, callCount } = setup()
  run('where', 'demo-1')
  const first = run('batch', '--runs', '2')
  assert.equal(first.code, 0)
  assert.match(first.text, /demo-1 single-prompt 1: caught\n/)
  assert.match(first.text, /demo-1 single-prompt 2: caught\n/)
  assert.equal(callCount(), 2)
  assert.match(run('batch', '--runs', '2').text, /^0 run\(s\) to do\n/)
  assert.equal(callCount(), 2)
})

it('a candidate whose applies_to excludes the repository gets no runs', () => {
  const { home, run } = setup()
  run('where', 'demo-1')
  writeFile(home, 'candidates/elsewhere/candidate.yaml', 'applies_to: [github.com-acme-shop]\n')
  writeFile(home, 'candidates/elsewhere/prompt.md', 'Write tests.\n')
  assert.match(run('batch', '--candidate', 'elsewhere').text, /^0 run\(s\) to do\n/)
})

it('batch stops after two leaked runs', () => {
  const { home, repo, run, callCount } = setup()
  const line = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: join(repo, 'src', 'total.js') } }] },
  })
  writeFile(home, 'leak-line.txt', `${line}\n`)
  run('where', 'demo-1')
  const result = run('batch', '--runs', '3')
  assert.equal(result.code, 3)
  assert.match(result.text, /stop: two leaked runs/)
  assert.equal(callCount(), 2)
})

it('the built-in baseline runs next to the store candidates by default', () => {
  const { home, run } = setup()
  run('where', 'demo-1')
  writeFile(home, 'candidates/other/candidate.yaml', 'model: sonnet\n')
  writeFile(home, 'candidates/other/prompt.md', 'Write tests.\n')
  const text = run('batch', '--runs', '1').text
  assert.match(text, /demo-1 other 1: caught\n/)
  assert.match(text, /demo-1 single-prompt 1: caught\n/)
  assert.doesNotMatch(text, /spec-to-tests/)
})
