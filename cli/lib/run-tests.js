import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isGreen, runShell } from './exec.js'
import { mentionsId } from './model.js'
import { stackFor } from './profile.js'
import { renderCommand } from './replay.js'
import { parseReport } from './reports.js'

export function runTestFile(profile, repo, file, timeoutS = 900) {
  const stack = stackFor(profile, file)
  if (stack === null) {
    return { file, status: 'unrunnable', timedOut: false, tests: [], output: 'no test stack in the profile matches this file' }
  }
  const reportPath = stack.report_file ? join(repo, stack.report_file) : null
  if (reportPath) rmSync(reportPath, { force: true })
  const run = runShell(renderCommand(stack.test_command, file), repo, timeoutS)
  const xml = reportPath && existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : ''
  if (reportPath) rmSync(reportPath, { force: true })
  const tests = stack.report
    ? [...parseReport(stack.report, { output: run.output, xml })].map(([name, status]) => ({ name, status }))
    : []
  return { file, status: isGreen(run) ? 'green' : 'red', timedOut: run.timedOut, tests, output: run.output.slice(-4000) }
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

export function hashFiles(repo, files) {
  return Object.fromEntries(files.map((file) => [file, sha256(join(repo, file))]))
}

export function changedSince(repo, hashes) {
  return Object.entries(hashes)
    .filter(([file, hash]) => !existsSync(join(repo, file)) || sha256(join(repo, file)) !== hash)
    .map(([file]) => file)
}

export function caseIdsMissing(repo, files, caseIds) {
  const texts = files.map((file) => readFileSync(join(repo, file), 'utf8'))
  return caseIds.filter((id) => !texts.some((text) => mentionsId(text, id)))
}
