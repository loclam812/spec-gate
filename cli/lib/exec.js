import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnInJob } from './windows-job.js'

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

// Git Bash parses its Windows command line with its own quoting rules, so the command travels in
// the environment, where nothing re-parses it, and is unset before it runs.
const EVAL_FROM_ENV = '-c "__sg=$SPEC_GATE_COMMAND; unset SPEC_GATE_COMMAND; eval \\"$__sg\\""'

function runWindows(command, cwd, timeoutS) {
  const env = { ...childEnv(), SPEC_GATE_COMMAND: command }
  return spawnInJob(gitBash(), EVAL_FROM_ENV, { cwd, env, timeout: timeoutS * 1000, ...SPAWN_OPTIONS })
}

export function runShell(command, cwd, timeoutS) {
  const started = Date.now()
  const result = process.platform === 'win32' ? runWindows(command, cwd, timeoutS) : runPosix(command, cwd, timeoutS)
  return {
    code: result.status ?? -1,
    timedOut: result.error?.code === 'ETIMEDOUT',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    ms: Date.now() - started,
  }
}

const EXEC_FROM_ENV =
  'tool=$SPEC_GATE_TOOL; args=(); i=0; while v=SPEC_GATE_ARG_$i; [ -n "${!v+x}" ]; do args+=("${!v}"); unset "$v"; i=$((i+1)); done; unset SPEC_GATE_TOOL; exec "$tool" "${args[@]}"'

// On Windows a program is started through Git Bash, which finds npm's extensionless shims and shell
// scripts that spawnSync cannot run. The name and arguments travel in the environment (Git Bash
// re-parses its command line with its own quoting rules), and no argument is rewritten as a path.
export function spawnTool(name, args, options) {
  if (process.platform !== 'win32') return spawnSync(name, args, options)
  const passed = Object.fromEntries(args.map((arg, i) => [`SPEC_GATE_ARG_${i}`, arg]))
  const env = { ...(options.env ?? process.env), ...passed, SPEC_GATE_TOOL: name, SPEC_GATE_COMMAND: EXEC_FROM_ENV, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' }
  return spawnInJob(gitBash(options.env), EVAL_FROM_ENV, { ...options, env })
}

export function isGreen(run) {
  return run.code === 0 && !run.timedOut
}

export function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
