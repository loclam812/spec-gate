import { it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { driveSpecGate } from '../cli/lib/drive.js'
import { loadSample } from '../cli/lib/sample.js'
import { prepareWorkspace } from '../cli/lib/workspace.js'
import { BUGGY_TOTAL, commitAll, makeFixtureRepo, tempDir, writeFile, writeSample } from './helpers.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/drive', import.meta.url))

// The stub plays every agent: it reads the prompt path from its -p argument and writes that
// step's output next to the run, as the real agents would.
function stubEnv(baFirst, baThen = baFirst, { sleep = 0, failOn = '', answerOnce = false } = {}) {
  const bin = tempDir('sg-bin-')
  const log = join(bin, 'calls.log')
  writeFile(bin, 'claude', `#!/bin/sh
printf 'cwd=%s args=%s\\n' "$PWD" "$(printf '%s' "$*" | tr '\\n' ' ')" >> "${log}"
[ "${sleep}" != "0" ] && sleep ${sleep}
case "$2" in
  "You stand in"*)
    out=$(printf '%s\\n' "$2" | sed -n 's/^Write \\(.*\\) as YAML.*/\\1/p')
    if [ "${answerOnce}" = "false" ] || [ ! -f "${bin}/answered" ]; then
      printf -- '- { id: Q1, answer: "unknown — assumed: totals keep full precision" }\\n' > "$out"; touch "${bin}/answered"
    fi
    echo '{"type":"result","total_cost_usd":0.25}'; exit 0 ;;
esac
path=$(echo "$2" | sed -e 's/^Read //' -e 's/ and do exactly.*$//')
run=$(dirname "$(dirname "$path")")
case "$path" in
  *${failOn}) [ -n "${failOn}" ] && { echo 'usage limit reached' >&2; exit 1; } ;;
esac
case "$path" in
  */prompts/ba.md)
    if [ -f "$run/decisions.md" ]; then cp "$FIXTURES/${baThen}" "$run/model.yaml"; else cp "$FIXTURES/${baFirst}" "$run/model.yaml"; fi ;;
  */prompts/qc.md) cp "$FIXTURES/cases.yaml" "$run/cases.yaml" ;;
  */prompts/write-tests.md) mkdir -p test && cp "$FIXTURES/c1.test.js" test/c1.test.js && printf 'files: [test/c1.test.js]\\n' > "$run/tests.yaml" ;;
esac
echo '{"type":"result","total_cost_usd":0.25}'
`)
  chmodSync(join(bin, 'claude'), 0o755)
  return { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURES }, log }
}

function setup() {
  const { repo } = makeFixtureRepo()
  writeFile(repo, 'package.json', JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }))
  writeFile(repo, 'src/total.js', BUGGY_TOTAL)
  const preFix = commitAll(repo, 'test script, total not yet multiplying by quantity')
  const sample = loadSample(
    writeSample(tempDir(), { id: 'demo-1', pre_fix: preFix, post_fix: preFix, test_command: 'node --test {file}', test_globs: ['**/*.test.js'] }),
  )
  const sides = prepareWorkspace(sample, repo, tempDir())
  return { sample, sides, candidate: { name: 'spec-gate', allowed_tools: ['Read', 'Write'], timeout_s: 60 } }
}

it('drives a T2 run to the written tests and stops before dev', () => {
  const { sample, sides, candidate } = setup()
  const outDir = tempDir()
  driveSpecGate(candidate, sample, sides.pre, outDir, { env: stubEnv('model.yaml').env, hide: [sides.post], watch: [sides.post] })
  assert.ok(existsSync(join(sides.pre, 'test/c1.test.js')))
  assert.match(readFileSync(join(outDir, 'spec-gate/report.md'), 'utf8'), /stopped after write-tests/)
  assert.equal(JSON.parse(readFileSync(join(outDir, 'cost.json'), 'utf8')).usd, 0.75)
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'leaks.json'), 'utf8')), { outside: [] })
  assert.equal(existsSync(join(outDir, 'stuck.json')), false)
})

it('a question the answers file does not settle is answered unknown and recorded as assumed', () => {
  const { sample, sides, candidate } = setup()
  const outDir = tempDir()
  driveSpecGate(candidate, sample, sides.pre, outDir, { env: stubEnv('model-question.yaml', 'model.yaml').env, hide: [sides.post], watch: [sides.post] })
  assert.match(readFileSync(join(outDir, 'spec-gate/decisions.md'), 'utf8'), /Answer: unknown — assumed: totals keep full precision/)
  assert.ok(existsSync(join(sides.pre, 'test/c1.test.js')))
})

it('a loop that gets stuck is recorded, not thrown', () => {
  const { sample, sides, candidate } = setup()
  const outDir = tempDir()
  driveSpecGate(candidate, sample, sides.pre, outDir, { env: stubEnv('model-broken.yaml').env, hide: [sides.post], watch: [sides.post] })
  assert.match(JSON.parse(readFileSync(join(outDir, 'stuck.json'), 'utf8')).reason, /^ba: output failed its checks 3 times/)
})

it('a claude that exits non-zero fails the run like a prompted candidate, and keeps what it has', () => {
  const { sample, sides, candidate } = setup()
  const outDir = tempDir()
  const { env } = stubEnv('model.yaml', 'model.yaml', { failOn: 'qc.md' })
  assert.throws(() => driveSpecGate(candidate, sample, sides.pre, outDir, { env, hide: [sides.post], watch: [sides.post] }), /claude exited 1: usage limit reached/)
  assert.equal(JSON.parse(readFileSync(join(outDir, 'cost.json'), 'utf8')).usd, 0.25)
  assert.ok(existsSync(join(outDir, 'transcript.jsonl')))
})

it('the answerer gets its prompt inline, outside the tree, with no Read tool', () => {
  const { sample, sides, candidate } = setup()
  const { env, log } = stubEnv('model-question.yaml', 'model.yaml')
  driveSpecGate(candidate, sample, sides.pre, tempDir(), { env, hide: [sides.post], watch: [sides.post] })
  const calls = readFileSync(log, 'utf8').trim().split('\n')
  const answerer = calls.find((line) => line.includes('You stand in'))
  assert.doesNotMatch(answerer, /cwd=[^ ]*\/pre /)
  assert.match(answerer, /--allowedTools Write( |$)/)
  assert.ok(calls.every((line) => line.includes('--add-dir')))
})

it('an answers file from an earlier round is never reused', () => {
  const { sample, sides, candidate } = setup()
  const outDir = tempDir()
  const { env } = stubEnv('model-question.yaml', 'model-question.yaml', { answerOnce: true })
  driveSpecGate(candidate, sample, sides.pre, outDir, { env, hide: [sides.post], watch: [sides.post] })
  assert.match(JSON.parse(readFileSync(join(outDir, 'stuck.json'), 'utf8')).reason, /^ask: /)
})

it('a driven run has a deadline across all its agents', () => {
  const { sample, sides } = setup()
  const outDir = tempDir()
  const { env } = stubEnv('model.yaml', 'model.yaml', { sleep: 0.9 })
  const started = Date.now()
  const candidate = { name: 'spec-gate', allowed_tools: ['Read', 'Write'], timeout_s: 1 }
  assert.throws(() => driveSpecGate(candidate, sample, sides.pre, outDir, { env, hide: [sides.post], watch: [sides.post] }), /out of time|timed out/)
  assert.ok(Date.now() - started < 2600, `took ${Date.now() - started} ms`)
})
