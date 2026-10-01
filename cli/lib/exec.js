import { execFileSync, spawnSync } from 'node:child_process'

export function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  }).trim()
}

export function tryGit(cwd, args) {
  try {
    return git(cwd, args)
  } catch {
    return null
  }
}

// A measured repository's tests must not inherit the caller's Node test-runner context:
// with NODE_TEST_CONTEXT set, a nested `node --test` reports to a parent and exits 0 on failure.
function childEnv() {
  const { NODE_TEST_CONTEXT, ...env } = process.env
  return env
}

function killGroup(pid) {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

// The command runs as the leader of its own process group (perl's setpgrp; spawnSync cannot
// detach), and the whole group is killed after every run: a server or a sleep a test leaves
// behind must not hold a port or a lock into the next file's run.
export function runShell(command, cwd, timeoutS) {
  const started = Date.now()
  const result = spawnSync('perl', ['-e', 'setpgrp(0, 0); exec @ARGV', '/bin/sh', '-c', command], {
    cwd,
    env: childEnv(),
    encoding: 'utf8',
    timeout: timeoutS * 1000,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error?.code === 'ENOENT') throw new Error('perl is required on PATH to run test commands')
  if (result.pid) killGroup(result.pid)
  return {
    code: result.status ?? -1,
    timedOut: result.error?.code === 'ETIMEDOUT',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    ms: Date.now() - started,
  }
}

export function isGreen(run) {
  return run.code === 0 && !run.timedOut
}

export function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
