import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { resultTotals } from './candidate.js'
import { logEvent } from './run-log.js'

// Tools the QC must not have even by asking: anything that could reach the application's code.
const DENIED = ['Bash', 'Grep', 'Glob', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task']

// The QC runs in its run folder with read access to that folder only (the prompt and the packet)
// and write access to cases.yaml only, so it cannot open the code it would otherwise copy.
export function runBlindQc(run, instruction, { env = process.env, timeoutS = 900 } = {}) {
  // Permission rules match resolved paths (/var is /private/var on macOS).
  const dir = realpathSync(run.dir)
  const args = [
    '-p', `Read ${instruction.prompt_file} and do exactly what it says.`,
    '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--strict-mcp-config', '--model', instruction.model,
    // File writes are governed by Edit(path) rules; a Write(path) rule is not matched.
    '--allowedTools', `Read(/${dir}/**),Edit(/${join(dir, 'cases.yaml')})`,
    '--disallowedTools', DENIED.join(','),
  ]
  const result = spawnSync('claude', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: timeoutS * 1000, maxBuffer: 64 * 1024 * 1024 })
  const usd = resultTotals(result.stdout ?? '').usd
  const failure =
    result.error?.code === 'ETIMEDOUT'
      ? `the QC timed out after ${timeoutS} s`
      : result.status !== 0
        ? `claude exited ${result.status ?? result.error?.code}: ${(result.stderr ?? '').trim().slice(-300)}`
        : null
  logEvent(run.dir, { kind: 'qc', model: instruction.model, usd, ...(failure ? { failure } : {}) })
  return { usd, failure }
}
