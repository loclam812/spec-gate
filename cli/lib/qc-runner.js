import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resultTotals, sessionInfo } from './candidate.js'
import { logEvent } from './run-log.js'

// Tools the QC must not have even by asking: anything that could reach the application's code.
const DENIED = ['Bash', 'Grep', 'Glob', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task']
const MEMORY_FILES = ['CLAUDE.md', 'CLAUDE.local.md', join('.claude', 'CLAUDE.md'), join('.claude', 'rules')]

function memoryAbove(dir) {
  for (let parent = dirname(dir); ; parent = dirname(parent)) {
    const found = MEMORY_FILES.map((file) => join(parent, file)).find((path) => existsSync(path))
    if (found) return found
    if (dirname(parent) === parent) return null
  }
}

// The QC has read access to its run folder only (the prompt and the packet) and write access to
// cases.yaml only, so it cannot open the code it would otherwise copy. It gets none of the user's
// settings, hooks, plugins, memory or CLAUDE.md, so every machine runs the same QC.
export function runBlindQc(run, instruction, { env = process.env, timeoutS = 900 } = {}) {
  // Permission rules match resolved paths (/var is /private/var on macOS).
  const dir = realpathSync(run.dir)
  // CLAUDE.md discovery walks up from the cwd and finds ~/.claude/CLAUDE.md even with
  // --setting-sources project, so the QC starts in an empty folder with no memory above it.
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'sg-qc-')))
  const memory = memoryAbove(cwd)
  let result = {}
  try {
    if (!memory) {
      const { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: _, ...clean } = env
      const args = [
        '-p', `Read ${instruction.prompt_file} and do exactly what it says.`,
        '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
        '--setting-sources', 'project', '--strict-mcp-config', '--model', instruction.model,
        '--add-dir', dir,
        // File writes are governed by Edit(path) rules; a Write(path) rule is not matched.
        '--allowedTools', `Read(/${dir}/**),Edit(/${join(dir, 'cases.yaml')})`,
        '--disallowedTools', DENIED.join(','),
      ]
      result = spawnSync('claude', args, { cwd, env: { ...clean, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: timeoutS * 1000, maxBuffer: 64 * 1024 * 1024 })
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
  const usd = resultTotals(result.stdout ?? '').usd
  const failure = memory
    ? `the QC would load ${memory} above the temporary folder ${cwd}; point the temporary folder (TMPDIR, or TEMP on Windows) at a folder with no CLAUDE.md or .claude above it`
    : result.error?.code === 'ETIMEDOUT'
      ? `the QC timed out after ${timeoutS} s`
      : result.status !== 0
        ? `claude exited ${result.status ?? result.error?.code}: ${(result.stderr ?? '').trim().slice(-300)}`
        : null
  logEvent(run.dir, { kind: 'qc', model: instruction.model, ...sessionInfo(result.stdout ?? ''), usd, ...(failure ? { failure } : {}) })
  return { usd, failure }
}
