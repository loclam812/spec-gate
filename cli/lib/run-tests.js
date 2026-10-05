import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { isGreen, runShell } from './exec.js'
import { mentionsId } from './text.js'
import { stackFor } from './profile.js'
import { renderCommand } from './replay.js'
import { junitFailures, parseReport } from './reports.js'

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

function runReported(stack, cwd, command, timeoutS) {
  const reportPath = stack.report_file ? join(cwd, stack.report_file) : null
  if (reportPath) rmSync(reportPath, { force: true })
  const run = runShell(command, cwd, timeoutS)
  const xml = reportPath && existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : ''
  if (reportPath) rmSync(reportPath, { force: true })
  const tests = stack.report
    ? [...parseReport(stack.report, { output: run.output, xml }, { subtests: true })].map(([name, status]) => ({ name, status }))
    : []
  return { run, xml, tests }
}

const GENERIC_FAILURE = 'test failed'

// node --test writes only "test failed" to its JUnit file when a file cannot load; the cause is
// printed by a plain run of the same file.
function withLoadCause(stack, cwd, file, failures) {
  const entries = Object.entries(failures)
  if (stack.name !== 'node-test' || entries.length === 0 || !entries.every(([, failure]) => failure.message === GENERIC_FAILURE)) return failures
  const cause = outputFailure(runShell(`node --test "${file}"`, cwd, 120).output).message
  return Object.fromEntries(entries.map(([name, failure]) => [name, { ...failure, body: cause }]))
}

export function runTestFile(profile, repo, file, timeoutS = 900) {
  const stack = stackFor(profile, file)
  if (stack === null) {
    return { file, status: 'unrunnable', timedOut: false, tests: [], output: 'no test stack in the profile matches this file', failures: {} }
  }
  const cwd = join(repo, runnerRoot(repo, file, stack))
  const { run, xml, tests } = runReported(stack, cwd, renderCommand(stack.test_command, relative(cwd, join(repo, file))), timeoutS)
  const empty = stack.report === 'junit' ? xml !== '' && !/<testcase\b/.test(xml) : NO_TESTS.test(run.output)
  const status = empty ? 'no-tests' : isGreen(run) ? 'green' : 'red'
  const failures = withLoadCause(stack, cwd, relative(cwd, join(repo, file)), stack.report === 'junit' ? Object.fromEntries(junitFailures(xml)) : {})
  return { file, status, timedOut: run.timedOut, tests, failures, output: run.output.slice(-4000) }
}

// The whole suite of each runner the test files use, so QA sees tests the change broke elsewhere.
// A runner without a per-test report cannot tell old failures from new ones and is left out.
export function suiteTargets(profile, repo, files) {
  const targets = files.flatMap((file) => {
    const stack = stackFor(profile, file)
    return stack?.suite_command && stack.report ? [{ key: `${stack.name} in ${runnerRoot(repo, file, stack)}`, stack, root: runnerRoot(repo, file, stack) }] : []
  })
  return [...new Map(targets.map((target) => [target.key, target])).values()]
}

export function runSuite(repo, { stack, root }, timeoutS = 1800) {
  const { run, tests } = runReported(stack, join(repo, root), stack.suite_command, timeoutS)
  const failing = run.timedOut || tests.length === 0 ? null : tests.filter((test) => test.status === 'fail').map((test) => test.name)
  return { failing, output: run.output.slice(-4000) }
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

const firstLine = (text) => text.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
const PLAYWRIGHT_LOCATION = /^\S+:\d+:\d+ /
const MISSING_SYMBOL = /Cannot find module|Failed to resolve import|Failed to load url|is not a function|is not defined|is not a constructor|does not provide an export named|undefined: \w+|cannot find package|no required module provides package|has no field or method/
const TIMEOUT = /Test timeout of \d+ms exceeded|\btimed out after\b/i
const SYNTAX = /\bSyntaxError\b|Unexpected token/
const NETWORK = /ECONNREFUSED|ERR_CONNECTION_REFUSED|ENOTFOUND|getaddrinfo/

export function headline({ message, body }) {
  const line = PLAYWRIGHT_LOCATION.test(message) || message === GENERIC_FAILURE ? firstLine(body) || firstLine(message) : firstLine(message)
  return line.replace(/^Error: /, '')
}

export function failureKind(failure) {
  const text = headline(failure)
  if (/timeout/i.test(failure.type) || TIMEOUT.test(text)) return 'timeout'
  if (/AssertionError|ERR_ASSERTION/.test(failure.type) || /AssertionError|ERR_ASSERTION/.test(text) || /^expected/i.test(text)) return 'assertion'
  if (SYNTAX.test(text)) return 'syntax'
  if (NETWORK.test(text)) return 'network'
  return MISSING_SYMBOL.test(text) ? 'missing' : 'other'
}

function outputFailure(output) {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean)
  const known = [MISSING_SYMBOL, TIMEOUT, SYNTAX, NETWORK]
  const line = lines.find((text) => known.some((pattern) => pattern.test(text))) ?? lines[0] ?? ''
  return { type: '', message: line, body: '' }
}

const REFUSED_KINDS = ['timeout', 'syntax', 'network']

// Red for the right reason is red on the behaviour. A missing symbol of the code under test is the
// expected red before implementation; a timeout, a syntax error or a network error means the
// environment is broken, and any other failure, an assertion included, is accepted.
export const didNotLoad = (result, caseIds) =>
  result.status === 'red' && !result.timedOut && !result.tests.some((test) => caseIds.some((id) => mentionsId(test.name, id)))

export function wrongReasons(result, caseIds, { source = '' } = {}) {
  if (result.timedOut) return [`${result.file}: no test ran (timed out)`]
  const failures = Object.entries(result.failures ?? {})
  if (didNotLoad(result, caseIds)) {
    const first = failures[0]?.[1] ?? (result.output ? outputFailure(result.output) : undefined)
    const accepted = first && failureKind(first) === 'missing' && caseIds.some((id) => mentionsId(source, id))
    const reason = first ? headline(first) : 'no failure reported'
    return accepted ? [] : [`${result.file}: no test ran (the file did not load: ${reason})`]
  }
  return failures
    .filter(([, failure]) => REFUSED_KINDS.includes(failureKind(failure)))
    .map(([name, failure]) => `${name.split(' > ').pop()}: fails on ${headline(failure)} (${failureKind(failure)}), not on the behaviour`)
}
