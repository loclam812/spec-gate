import { it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { gitBash, listProcesses, processTree, runShell, spawnTool } from '../cli/lib/exec.js'
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

it('the process tree holds every descendant started since the run began, and nothing older', () => {
  const listing = [
    { pid: 10, parent: 1, created: 100 },
    { pid: 11, parent: 10, created: 101 },
    { pid: 12, parent: 11, created: 102 },
    { pid: 13, parent: 10, created: 50 },
    { pid: 14, parent: 2, created: 103 },
  ]
  assert.deepEqual(processTree(listing, 10, 100).sort(), [10, 11, 12])
})

it('the Windows process listing names this process and its parent', { skip: process.platform !== 'win32' }, () => {
  const me = listProcesses().find((entry) => entry.pid === process.pid)
  assert.equal(me?.parent, process.ppid)
})
