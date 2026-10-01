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

// ponytail: a timeout kills the shell only; grandchildren of a compound command survive.
// Kill the process group if a sample's command forks long-lived children.
export function runShell(command, cwd, timeoutS) {
  const started = Date.now()
  const result = spawnSync('/bin/sh', ['-c', command], {
    cwd,
    env: childEnv(),
    encoding: 'utf8',
    timeout: timeoutS * 1000,
    maxBuffer: 64 * 1024 * 1024,
  })
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
