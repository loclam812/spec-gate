import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

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

// Git for Windows keeps git under <root>/mingw64/libexec/git-core and bash under <root>/bin.
function bashBesideGit(env) {
  try {
    const execPath = execFileSync('git', ['--exec-path'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return join(execPath, '..', '..', '..', 'bin', 'bash.exe')
  } catch {
    return null
  }
}

export function gitBash(env = process.env) {
  const found = [env.CLAUDE_CODE_GIT_BASH_PATH, bashBesideGit(env)].find((path) => path && existsSync(path))
  if (!found) throw new Error('Git Bash not found: install Git for Windows or set CLAUDE_CODE_GIT_BASH_PATH')
  return found
}

const PROCESS_LIST =
  "Get-CimInstance Win32_Process | Where-Object CreationDate | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToFileTimeUtc() }"
const FILETIME_AT_EPOCH = 116444736000000000n

// Windows has no process groups and never reparents an orphan, so whatever a run started still
// names the run's shell as its parent after the shell exits; the creation time rules out reused pids.
export function killTree(rootPid, sinceMs) {
  const listed = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', PROCESS_LIST], { encoding: 'utf8', windowsHide: true })
  const since = BigInt(sinceMs - 1000) * 10000n + FILETIME_AT_EPOCH
  const children = new Map()
  for (const line of (listed.stdout ?? '').split(/\r?\n/)) {
    const [pid, parent, created] = line.trim().split(' ')
    if (!created || BigInt(created) < since) continue
    children.set(parent, [...(children.get(parent) ?? []), pid])
  }
  const tree = [String(rootPid)]
  for (let i = 0; i < tree.length; i++) tree.push(...(children.get(tree[i]) ?? []))
  for (const pid of tree) {
    try {
      process.kill(Number(pid))
    } catch {}
  }
}

const SPAWN_OPTIONS = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }

// The command runs as the leader of its own process group (perl's setpgrp; spawnSync cannot
// detach), and the whole group is killed after every run: a server or a sleep a test leaves
// behind must not hold a port or a lock into the next file's run.
function runPosix(command, cwd, timeoutS) {
  const result = spawnSync('perl', ['-e', 'setpgrp(0, 0); exec @ARGV', '/bin/sh', '-c', command], { cwd, env: childEnv(), timeout: timeoutS * 1000, ...SPAWN_OPTIONS })
  if (result.error?.code === 'ENOENT') throw new Error('perl is required on PATH to run test commands')
  if (result.pid) killGroup(result.pid)
  return result
}

function runWindows(command, cwd, timeoutS, started) {
  const result = spawnSync(gitBash(), ['-c', command], { cwd, env: childEnv(), timeout: timeoutS * 1000, windowsHide: true, ...SPAWN_OPTIONS })
  if (result.pid) killTree(result.pid, started)
  return result
}

export function runShell(command, cwd, timeoutS) {
  const started = Date.now()
  const result = process.platform === 'win32' ? runWindows(command, cwd, timeoutS, started) : runPosix(command, cwd, timeoutS)
  return {
    code: result.status ?? -1,
    timedOut: result.error?.code === 'ETIMEDOUT',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    ms: Date.now() - started,
  }
}

// On Windows a program is started through Git Bash, which finds npm's extensionless shims and
// shell scripts that spawnSync cannot run; the arguments pass as argv, never through a shell string.
export function spawnTool(name, args, options) {
  if (process.platform !== 'win32') return spawnSync(name, args, options)
  const started = Date.now()
  const result = spawnSync(gitBash(options.env), ['-c', 'exec "$0" "$@"', name, ...args], { windowsHide: true, ...options })
  if (result.pid) killTree(result.pid, started)
  return result
}

export function isGreen(run) {
  return run.code === 0 && !run.timedOut
}

export function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
