import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runShell } from '../cli/lib/exec.js'
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

function goneWithin(pid, ms) {
  const deadline = Date.now() + ms
  while (isAlive(pid) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  return !isAlive(pid)
}

it('runShell kills what a command left running in the background', () => {
  const dir = tempDir()
  const run = runShell('sleep 30 >/dev/null 2>&1 & echo $! > bg.pid', dir, 5)
  assert.equal(run.code, 0)
  assert.equal(goneWithin(Number(readFileSync(join(dir, 'bg.pid'), 'utf8')), 1000), true)
})

it('runShell kills the whole command when it times out', () => {
  const dir = tempDir()
  const run = runShell('sleep 30 >/dev/null 2>&1 & echo $! > bg.pid; sleep 30', dir, 1)
  assert.equal(run.timedOut, true)
  assert.equal(goneWithin(Number(readFileSync(join(dir, 'bg.pid'), 'utf8')), 1000), true)
})
