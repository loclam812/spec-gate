import { it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitBash, runShell } from '../cli/lib/exec.js'
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
