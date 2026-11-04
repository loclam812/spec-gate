import { it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { gitBash, runShell, spawnTool } from '../cli/lib/exec.js'
import { tempDir } from './helpers.js'

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

// Git Bash's $! is its own pid; the pid Windows knows is in /proc/<pid>/winpid.
const BG_PID = process.platform === 'win32' ? 'cat /proc/$!/winpid > bg.pid' : 'echo $! > bg.pid'

function goneWithin(pid, ms) {
  const deadline = Date.now() + ms
  while (isAlive(pid) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  return !isAlive(pid)
}

it('runShell kills what a command left running in the background', () => {
  const dir = tempDir()
  const run = runShell(`sleep 30 >/dev/null 2>&1 & ${BG_PID}`, dir, 5)
  assert.equal(run.code, 0)
  assert.equal(goneWithin(Number(readFileSync(join(dir, 'bg.pid'), 'utf8')), 1000), true)
})

it('runShell kills the whole command when it times out', () => {
  const dir = tempDir()
  const run = runShell(`sleep 30 >/dev/null 2>&1 & ${BG_PID}; sleep 30`, dir, 1)
  assert.equal(run.timedOut, true)
  assert.equal(goneWithin(Number(readFileSync(join(dir, 'bg.pid'), 'utf8')), 1000), true)
})

it('runShell runs in a directory with spaces and Vietnamese letters', () => {
  const dir = join(tempDir(), 'Nguyễn Văn A')
  mkdirSync(dir)
  const run = runShell("printf 'Tiếng Việt' && pwd", dir, 10)
  assert.equal(run.code, 0)
  assert.match(run.output, /^Tiếng Việt/)
  assert.match(run.output, /Nguyễn Văn A/)
})

it('gitBash honours CLAUDE_CODE_GIT_BASH_PATH', () => {
  assert.equal(gitBash({ CLAUDE_CODE_GIT_BASH_PATH: process.execPath }), process.execPath)
})

it('gitBash names the env var when bash is missing', () => {
  const env = { CLAUDE_CODE_GIT_BASH_PATH: join(tempDir(), 'bash.exe'), PATH: '' }
  assert.throws(() => gitBash(env), /CLAUDE_CODE_GIT_BASH_PATH/)
})

it('spawnTool runs an extensionless shell script found on PATH', () => {
  const bin = tempDir('sg-bin-')
  writeFileSync(join(bin, 'fake-tool'), `#!/bin/sh\nprintf '%s|' "$@"\n`)
  chmodSync(join(bin, 'fake-tool'), 0o755)
  const result = spawnTool('fake-tool', ['a b', "it's", 'x"y'], { env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` }, encoding: 'utf8' })
  assert.equal(result.stdout, `a b|it's|x"y|`)
})

it('runShell passes quotes inside the command intact', () => {
  const run = runShell(`printf '%s|' "x\\"y" 'it'"'"'s' a\\ b`, tempDir(), 10)
  assert.equal(run.output, `x"y|it's|a b|`)
})

it('runShell kills a native process whose parent already exited', () => {
  const dir = tempDir()
  const orphan = "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore', detached: false }); c.unref(); require('fs').writeFileSync('bg.pid', String(c.pid))"
  const run = runShell(`node -e "${orphan}"`, dir, 10)
  assert.equal(run.code, 0, run.output)
  assert.equal(goneWithin(Number(readFileSync(join(dir, 'bg.pid'), 'utf8')), 1000), true)
})

it('the test command does not see how it was passed in', () => {
  assert.equal(runShell('printf %s "${SPEC_GATE_COMMAND-unset}"', tempDir(), 10).output, 'unset')
})
