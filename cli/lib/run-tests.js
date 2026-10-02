import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { isGreen, runShell } from './exec.js'
import { mentionsId } from './model.js'
import { stackFor } from './profile.js'
import { renderCommand } from './replay.js'
import { parseReport } from './reports.js'

const PLAYWRIGHT_CONFIGS = ['ts', 'js', 'mts', 'mjs', 'cts', 'cjs'].map((ext) => `playwright.config.${ext}`)
const ROOT_MARKERS = { go: ['go.mod'], vitest: ['package.json'], jest: ['package.json'], 'node-test': ['package.json'], playwright: PLAYWRIGHT_CONFIGS }

// What jest prints when its config leaves the file out; a JUnit runner writes no test case instead.
const NO_TESTS = /No tests found/

function ancestors(dir) {
  const parts = dir === '.' ? [] : dir.split('/')
  return [...parts.map((_, index) => parts.slice(0, parts.length - index).join('/')), '.']
}

// A monorepo keeps its runner and its config in a package or module below the root; running
// there is what makes the runner find its config and not fetch a different version.
export function runnerRoot(repo, file, stack) {
  const markers = ROOT_MARKERS[stack.name] ?? []
  return ancestors(dirname(file)).find((dir) => markers.some((marker) => existsSync(join(repo, dir, marker)))) ?? '.'
}

export function runTestFile(profile, repo, file, timeoutS = 900) {
  const stack = stackFor(profile, file)
  if (stack === null) {
    return { file, status: 'unrunnable', timedOut: false, tests: [], output: 'no test stack in the profile matches this file' }
  }
  const cwd = join(repo, runnerRoot(repo, file, stack))
  const reportPath = stack.report_file ? join(cwd, stack.report_file) : null
  if (reportPath) rmSync(reportPath, { force: true })
  const run = runShell(renderCommand(stack.test_command, relative(cwd, join(repo, file))), cwd, timeoutS)
  const xml = reportPath && existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : ''
  if (reportPath) rmSync(reportPath, { force: true })
  const tests = stack.report
    ? [...parseReport(stack.report, { output: run.output, xml })].map(([name, status]) => ({ name, status }))
    : []
  const empty = stack.report === 'junit' ? xml !== '' && !/<testcase\b/.test(xml) : NO_TESTS.test(run.output)
  const status = empty ? 'no-tests' : isGreen(run) ? 'green' : 'red'
  return { file, status, timedOut: run.timedOut, tests, output: run.output.slice(-4000) }
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
