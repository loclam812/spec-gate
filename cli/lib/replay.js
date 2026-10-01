import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runShell, shellQuote } from './exec.js'
import { readJson, writeJson } from './files.js'
import { parseReport } from './reports.js'
import { isSupportPath, isTestPath } from './sample.js'
import { fileVerdict, reportedFileVerdict, sampleVerdict } from './verdict.js'
import { changedFiles, resetTree } from './workspace.js'

function copyInto(from, to) {
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to)
}

export function collectTests(sample, preDir, outDir) {
  const changed = changedFiles(preDir)
  const tests = changed.filter((path) => isTestPath(sample, path))
  const support = changed.filter((path) => isSupportPath(sample, path))
  const ignored = changed.filter((path) => !tests.includes(path) && !support.includes(path))
  const kept = { tests, support, ignored }
  for (const [folder, paths] of Object.entries(kept)) {
    rmSync(join(outDir, folder), { recursive: true, force: true })
    for (const path of paths) copyInto(join(preDir, path), join(outDir, folder, path))
  }
  const manifest = kept
  writeJson(join(outDir, 'collected.json'), manifest)
  resetTree(preDir)
  return manifest
}

export function renderCommand(template, relPath) {
  const dir = dirname(relPath)
  return template
    .replaceAll('{file}', shellQuote(relPath))
    .replaceAll('{dir}', shellQuote(dir === '.' ? '.' : `./${dir}`))
}

function needsControl(sample, root, path) {
  return sample.test_command.includes('{dir}') && existsSync(join(root, dirname(path)))
}

function runReported(sample, command, root) {
  const run = runShell(command, root, sample.timeout_s)
  if (!sample.report) return run
  const reportPath = sample.report_file ? join(root, sample.report_file) : null
  const xml = reportPath && existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : ''
  return { ...run, tests: parseReport(sample.report, { output: run.output, xml }) }
}

function runSide(sample, root, outDir, path, support) {
  const command = renderCommand(sample.test_command, path)
  resetTree(root)
  for (const file of support) copyInto(join(outDir, 'support', file), join(root, file))
  copyInto(join(outDir, 'tests', path), join(root, path))
  const withRun = runReported(sample, command, root)
  resetTree(root)
  const withoutRun = needsControl(sample, root, path) ? runReported(sample, command, root) : null
  return [withRun, withoutRun]
}

function writeLogs(outDir, path, runs) {
  const base = join(outDir, 'logs', path.replaceAll('/', '__'))
  mkdirSync(dirname(base), { recursive: true })
  for (const [name, run] of Object.entries(runs)) {
    if (run !== null) writeFileSync(`${base}.${name}.log`, run.output)
  }
}

function briefRuns(runs) {
  return Object.fromEntries(
    Object.entries(runs).map(([name, run]) => [
      name,
      run === null ? null : { code: run.code, timedOut: run.timedOut, ms: run.ms },
    ]),
  )
}

function scoreFile(sample, sides, outDir, path, support) {
  const [preWith, preWithout] = runSide(sample, sides.pre, outDir, path, support)
  const [postWith, postWithout] = runSide(sample, sides.post, outDir, path, support)
  const runs = { preWith, preWithout, postWith, postWithout }
  writeLogs(outDir, path, runs)
  if (!sample.report) return { path, verdict: fileVerdict(runs), runs: briefRuns(runs) }
  const { verdict, tests } = reportedFileVerdict(runs)
  return { path, verdict, tests, runs: briefRuns(runs) }
}

export function scoreRun(sample, sides, outDir) {
  const { tests, support = [] } = readJson(join(outDir, 'collected.json'))
  const leaksPath = join(outDir, 'leaks.json')
  const leaks = existsSync(leaksPath) ? readJson(leaksPath).outside : []
  const files = tests.map((path) => scoreFile(sample, sides, outDir, path, support))
  const record = {
    sample: sample.id,
    pre_fix: sample.pre_fix,
    post_fix: sample.post_fix,
    test_command: sample.test_command,
    verdict: leaks.length > 0 ? 'leaked' : sampleVerdict(files.map((file) => file.verdict)),
    leaks,
    files,
  }
  writeJson(join(outDir, 'verdict.json'), record)
  resetTree(sides.pre)
  resetTree(sides.post)
  return record
}
