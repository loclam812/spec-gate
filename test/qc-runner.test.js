import { it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sessionInfo } from '../cli/lib/candidate.js'
import { rulePath, runBlindQc } from '../cli/lib/qc-runner.js'
import { tempDir, withPath, writeFile } from './helpers.js'

function stubClaude() {
  const bin = tempDir('sg-bin-')
  const called = join(bin, 'called')
  writeFile(bin, 'claude', `#!/bin/sh\ntouch '${called}'\necho '{"type":"result","total_cost_usd":0.5}'\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  return { env: withPath(process.env, bin), called }
}

// os.tmpdir() reads TMPDIR on POSIX and TEMP or TMP on Windows.
const TMP_VARS = ['TMPDIR', 'TEMP', 'TMP']

function withTmpdir(dir, fn) {
  const saved = TMP_VARS.map((name) => process.env[name])
  for (const name of TMP_VARS) process.env[name] = dir
  try {
    return fn()
  } finally {
    TMP_VARS.forEach((name, i) => {
      if (saved[i] === undefined) delete process.env[name]
      else process.env[name] = saved[i]
    })
  }
}

it('refuses to start the QC when a folder above the temporary folder holds a CLAUDE.md it would load', () => {
  const root = tempDir('sg-home-')
  writeFile(root, '.claude/CLAUDE.md', '# Global instructions\n')
  writeFile(root, 'tmp/.keep', '')
  const run = { dir: tempDir('sg-run-') }
  const { env, called } = stubClaude()
  const { failure } = withTmpdir(join(root, 'tmp'), () => runBlindQc(run, { prompt_file: join(run.dir, 'qc.md'), model: 'opus' }, { env }))
  assert.match(failure, /\.claude[/\\]CLAUDE\.md/)
  assert.match(failure, /TMPDIR/)
  assert.equal(existsSync(called), false)
  assert.deepEqual(readdirSync(join(root, 'tmp')).filter((name) => name.startsWith('sg-qc-')), [])
  assert.match(readFileSync(join(run.dir, 'events.jsonl'), 'utf8'), /"kind":"qc".*"failure"/)
})

it('a transcript without a start event records the model and Claude Code version as unknown', () => {
  assert.deepEqual(sessionInfo('{"type":"result","total_cost_usd":0.5}\n'), { model_id: 'unknown', claude_code: 'unknown' })
})

it('a permission rule names a Windows path the way Claude Code matches it', () => {
  assert.equal(rulePath('C:\\Users\\a b\\run', 'win32'), '/c/Users/a b/run')
  assert.equal(rulePath('/tmp/run', 'darwin'), '/tmp/run')
})
