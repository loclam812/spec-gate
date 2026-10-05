import { it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { driveSpecToTests } from '../cli/lib/drive.js'
import { loadSample } from '../cli/lib/sample.js'
import { prepareWorkspace } from '../cli/lib/workspace.js'
import { BUGGY_TOTAL, KNOWLEDGE_FULL, commitAll, makeFixtureRepo, tempDir, writeFile, writeSample } from './helpers.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/drive', import.meta.url))

// The stub plays every agent: it reads the prompt path from its -p argument and writes that
// step's output next to the run, as the real agents would.
function stubEnv({ first = 'cases.yaml', then = 'cases.yaml', sleep = 0, failOn = '', answerOnce = false, qcReads = '', qcGlob = '', qcGrep = '' }) {
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
  */prompts/qc.md)
    if [ -f "$run/decisions.md" ]; then cp "$FIXTURES/${then}" "$run/cases.yaml"; else cp "$FIXTURES/${first}" "$run/cases.yaml"; fi
    [ -n "${qcReads}" ] && printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"%s/${qcReads}"}}]}}\\n' "$PWD"
    [ "${qcGrep}" = "dir" ] && printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"refund","path":"%s/src"}}]}}\\n' "$PWD"
    [ "${qcGrep}" = "bare" ] && printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"refund"}}]}}\\n'
    [ -n "${qcGlob}" ] && printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Glob","input":{"pattern":"${qcGlob}"}}]}}\\n' ;;
  */prompts/write-tests.md) cat .claude/testing.md >> "${log}" 2>/dev/null; mkdir -p test && cp "$FIXTURES/c1.test.js" test/c1.test.js && printf 'files: [test/c1.test.js]\\n' > "$run/tests.yaml" ;;
esac
echo '{"type":"result","total_cost_usd":0.25}'
`)
  chmodSync(join(bin, 'claude'), 0o755)
  return { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURES }, log }
}

function setup({ knowledge = null, tracked = null } = {}) {
  const { repo } = makeFixtureRepo()
  writeFile(repo, 'package.json', JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }))
  writeFile(repo, 'src/total.js', BUGGY_TOTAL)
  if (tracked) writeFile(repo, '.claude/testing.md', tracked)
  const preFix = commitAll(repo, 'test script, total not yet multiplying by quantity')
  const sample = loadSample(
    writeSample(tempDir(), { id: 'demo-1', pre_fix: preFix, post_fix: preFix, test_command: 'node --test {file}', test_globs: ['**/*.test.js'] }),
  )
  if (knowledge) writeFile(sample.dir, 'knowledge.md', knowledge)
  const sides = prepareWorkspace(sample, repo, tempDir())
  return { sample, sides, candidate: { name: 'spec-to-tests', allowed_tools: ['Read', 'Write'], timeout_s: 60 } }
}

it('drives the tests flow to the written tests', () => {
  const { sample, sides, candidate } = setup()
  const outDir = tempDir()
  driveSpecToTests(candidate, sample, sides.pre, outDir, { env: stubEnv({}).env, hide: [sides.post], watch: [sides.post] })
  assert.ok(existsSync(join(sides.pre, 'test/c1.test.js')))
  assert.match(readFileSync(join(outDir, 'spec-to-tests/report.md'), 'utf8'), /Tests written/)
  assert.equal(JSON.parse(readFileSync(join(outDir, 'cost.json'), 'utf8')).usd, 0.5)
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'leaks.json'), 'utf8')), { outside: [] })
  assert.equal(existsSync(join(outDir, 'stuck.json')), false)
})

it('a question the answers file does not settle is answered unknown and recorded as assumed', () => {
  const { sample, sides, candidate } = setup()
  const outDir = tempDir()
  driveSpecToTests(candidate, sample, sides.pre, outDir, { env: stubEnv({ first: 'cases-question.yaml' }).env, hide: [sides.post], watch: [sides.post] })
  assert.match(readFileSync(join(outDir, 'spec-to-tests/decisions.md'), 'utf8'), /Answer: unknown — assumed: totals keep full precision/)
  assert.ok(existsSync(join(sides.pre, 'test/c1.test.js')))
})

it('a loop that gets stuck is recorded, not thrown', () => {
  const { sample, sides, candidate } = setup()
  const outDir = tempDir()
  driveSpecToTests(candidate, sample, sides.pre, outDir, { env: stubEnv({ first: 'cases-broken.yaml' }).env, hide: [sides.post], watch: [sides.post] })
  assert.match(JSON.parse(readFileSync(join(outDir, 'stuck.json'), 'utf8')).reason, /^qc: output failed its checks 3 times .*the request has nothing to test/)
})

it('a claude that exits non-zero fails the run like a prompted candidate, and keeps what it has', () => {
  const { sample, sides, candidate } = setup()
  const outDir = tempDir()
  const { env } = stubEnv({ failOn: 'write-tests.md' })
  assert.throws(() => driveSpecToTests(candidate, sample, sides.pre, outDir, { env, hide: [sides.post], watch: [sides.post] }), /claude exited 1: usage limit reached/)
  assert.equal(JSON.parse(readFileSync(join(outDir, 'cost.json'), 'utf8')).usd, 0.25)
  assert.ok(existsSync(join(outDir, 'transcript.jsonl')))
})

it('the answerer gets its prompt inline, outside the tree, with no Read tool', () => {
  const { sample, sides, candidate } = setup()
  const { env, log } = stubEnv({ first: 'cases-question.yaml' })
  driveSpecToTests(candidate, sample, sides.pre, tempDir(), { env, hide: [sides.post], watch: [sides.post] })
  const calls = readFileSync(log, 'utf8').trim().split('\n')
  const answerer = calls.find((line) => line.includes('You stand in'))
  assert.doesNotMatch(answerer, /cwd=[^ ]*\/pre /)
  assert.match(answerer, /--allowedTools Write( |$)/)
  assert.ok(calls.every((line) => line.includes('--add-dir')))
})

it('an answers file from an earlier round is never reused', () => {
  const { sample, sides, candidate } = setup()
  const outDir = tempDir()
  const { env } = stubEnv({ first: 'cases-question.yaml', then: 'cases-question.yaml', answerOnce: true })
  driveSpecToTests(candidate, sample, sides.pre, outDir, { env, hide: [sides.post], watch: [sides.post] })
  assert.match(JSON.parse(readFileSync(join(outDir, 'stuck.json'), 'utf8')).reason, /^ask: /)
})

it('a driven run has a deadline across all its agents', () => {
  const { sample, sides } = setup()
  const outDir = tempDir()
  const { env } = stubEnv({ sleep: 0.9 })
  const started = Date.now()
  const candidate = { name: 'spec-to-tests', allowed_tools: ['Read', 'Write'], timeout_s: 1 }
  assert.throws(() => driveSpecToTests(candidate, sample, sides.pre, outDir, { env, hide: [sides.post], watch: [sides.post] }), /out of time|timed out/)
  assert.ok(Date.now() - started < 2600, `took ${Date.now() - started} ms`)
})

it('the QC reading an application source file is recorded in qc-reads.json', () => {
  const { sample, sides, candidate } = setup()
  const outDir = tempDir()
  const { env } = stubEnv({ qcReads: 'src/total.js' })
  driveSpecToTests(candidate, sample, sides.pre, outDir, { env, hide: [sides.post], watch: [sides.post] })
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'qc-reads.json'), 'utf8')), { reads: ['src/total.js'] })
})

it('a QC read of a test file is not counted as a source read', () => {
  const { sample, sides, candidate } = setup()
  const outDir = tempDir()
  const { env } = stubEnv({ qcReads: 'test/old.test.js' })
  driveSpecToTests(candidate, sample, sides.pre, outDir, { env, hide: [sides.post], watch: [sides.post] })
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'qc-reads.json'), 'utf8')), { reads: [] })
})

it('a QC Grep of a directory, or with no path, is recorded as a read of that directory', () => {
  const run = (qcGrep) => {
    const { sample, sides, candidate } = setup()
    const outDir = tempDir()
    driveSpecToTests(candidate, sample, sides.pre, outDir, { env: stubEnv({ qcGrep }).env, hide: [sides.post], watch: [sides.post] })
    return JSON.parse(readFileSync(join(outDir, 'qc-reads.json'), 'utf8'))
  }
  assert.deepEqual(run('dir'), { reads: ['src'] })
  assert.deepEqual(run('bare'), { reads: ['.'] })
})

it('a QC Glob pattern is not a read of a file', () => {
  const { sample, sides, candidate } = setup()
  const outDir = tempDir()
  const { env } = stubEnv({ qcGlob: 'src/**/*.js' })
  driveSpecToTests(candidate, sample, sides.pre, outDir, { env, hide: [sides.post], watch: [sides.post] })
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'qc-reads.json'), 'utf8')), { reads: [] })
})

it('a QC read of a locale file is not counted, the packet hands those over', () => {
  const { sample, sides, candidate } = setup()
  const outDir = tempDir()
  const { env } = stubEnv({ qcReads: 'src/locales/en.js' })
  driveSpecToTests(candidate, sample, sides.pre, outDir, { env, hide: [sides.post], watch: [sides.post] })
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'qc-reads.json'), 'utf8')), { reads: [] })
})

it('a knowledge file the pre-fix tree tracks is restored after the run', () => {
  const { sample, sides, candidate } = setup({ knowledge: KNOWLEDGE_FULL, tracked: '# repo own notes\n' })
  const { env } = stubEnv({})
  driveSpecToTests(candidate, sample, sides.pre, tempDir(), { env, hide: [sides.post], watch: [sides.post] })
  assert.equal(readFileSync(join(sides.pre, '.claude/testing.md'), 'utf8'), '# repo own notes\n')
  assert.equal(spawnSync('git', ['status', '--porcelain', '--', '.claude'], { cwd: sides.pre, encoding: 'utf8' }).stdout, '')
})

it('a sample knowledge file reaches the writer as the repository knowledge file', () => {
  const { sample, sides, candidate } = setup({ knowledge: KNOWLEDGE_FULL })
  const { env, log } = stubEnv({})
  driveSpecToTests(candidate, sample, sides.pre, tempDir(), { env, hide: [sides.post], watch: [sides.post] })
  assert.match(readFileSync(log, 'utf8'), /write-tests/)
  assert.match(readFileSync(log, 'utf8'), /## Domain terms/)
  assert.equal(existsSync(join(sides.pre, '.claude/testing.md')), false)
})
