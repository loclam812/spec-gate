import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { git } from './exec.js'
import { readJson, writeJson } from './files.js'
import { discoverProfile, stackFor } from './profile.js'
import { scoreRun } from './replay.js'
import { didNotLoad, runTestFile, wrongReasons } from './run-tests.js'
import { isTestPath, loadSample } from './sample.js'
import { VERSION } from './version.js'
import { resetTree } from './workspace.js'

const canaryDir = (sample) => join(sample.dir, 'canary')
const canaryPath = (sample) => join(canaryDir(sample), 'canary.json')
// Every sample field that changes how the trees are built or the tests judged.
const FRESH_KEYS = ['pre_fix', 'post_fix', 'test_command', 'setup', 'report', 'report_file', 'timeout_s', 'test_globs']
const MAX_STACK_FILES = 3

export function fixTests(sample, repo) {
  return git(repo, ['diff', '--name-only', '--diff-filter=AM', '-z', sample.pre_fix, sample.post_fix])
    .split('\0')
    .filter((path) => path && isTestPath(sample, path))
    .sort()
}

const loads = (result) => !result.timedOut && !['unrunnable', 'no-tests'].includes(result.status) && !didNotLoad(result)

function checkFile(profile, preDir, file, timeoutS) {
  const result = runTestFile(profile, preDir, file, timeoutS)
  resetTree(preDir)
  const ok = loads(result)
  const reason = ok ? null : (wrongReasons(result, [])[0]?.replace(`${file}: `, '') ?? `status: ${result.status}`)
  return { file, status: result.status, ok, reason }
}

// The driver runs each stack of the profile it discovers in the pre-fix tree; a stack that cannot
// run a test the repository already has will not run the tests a candidate writes either. One
// existing file can be broken at pre_fix on its own, so a stack passes when any of a few loads.
export function runnerChecks(sample, preDir) {
  const profile = discoverProfile(preDir)
  const tracked = git(preDir, ['ls-files', '-z']).split('\0').filter(Boolean).sort()
  return profile.stacks.map((stack) => {
    const files = tracked.filter((path) => stackFor(profile, path)?.name === stack.name).slice(0, MAX_STACK_FILES)
    if (files.length === 0) return { stack: stack.name, file: null, status: 'unchecked', ok: true, reason: null }
    const checks = []
    for (const file of files) {
      checks.push(checkFile(profile, preDir, file, sample.timeout_s))
      if (checks.at(-1).ok) break
    }
    return { stack: stack.name, ...(checks.find((check) => check.ok) ?? checks[0]) }
  })
}

// Only the fix's test files are copied: a non-test file of the fix would plant the fix in the
// pre-fix tree.
function scoreFixTests(ctx, tests) {
  const dir = canaryDir(ctx.sample)
  rmSync(dir, { recursive: true, force: true })
  for (const path of tests) {
    mkdirSync(dirname(join(dir, 'tests', path)), { recursive: true })
    cpSync(join(ctx.sides.post, path), join(dir, 'tests', path))
  }
  writeJson(join(dir, 'collected.json'), { tests, support: [], helpers: [], ignored: [], version: VERSION })
  return scoreRun(ctx.sample, ctx.sides, dir)
}

export function runCanary(ctx) {
  const tests = fixTests(ctx.sample, ctx.repo)
  if (tests.length === 0) throw new Error(`sample ${ctx.sample.id} has no test file in its fix; the canary needs one`)
  const scored = scoreFixTests(ctx, tests)
  const stacks = runnerChecks(ctx.sample, ctx.sides.pre)
  const reasons = [
    ...(scored.verdict === 'caught' ? [] : [`fix tests score ${scored.verdict}`]),
    ...stacks.filter((stack) => !stack.ok).map((stack) => `${stack.stack} cannot run ${stack.file}: ${stack.reason}`),
  ]
  const record = {
    ...Object.fromEntries(FRESH_KEYS.map((key) => [key, ctx.sample[key]])),
    version: VERSION,
    tests,
    scorer: { verdict: scored.verdict, files: scored.files.map(({ path, verdict }) => ({ path, verdict })) },
    stacks,
    verdict: reasons.length === 0 ? 'ok' : 'harness-broken',
    reasons,
  }
  writeJson(canaryPath(ctx.sample), record)
  return record
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function loadCanary(sample) {
  if (!existsSync(canaryPath(sample))) return null
  const record = readJson(canaryPath(sample))
  return FRESH_KEYS.every((key) => same(record[key], sample[key])) ? record : null
}

// The owner's ruling that a harness-broken result is the canary's mistake, not the harness's. It
// lasts until the canary is run again.
export function acceptCanary(sample, reason) {
  const record = loadCanary(sample)
  if (record === null) throw new Error(`no canary for ${sample.id}; run: spec-gate eval canary ${sample.id}`)
  const accepted = { ...record, accepted: reason }
  writeJson(canaryPath(sample), accepted)
  return accepted
}

export const canaryOutcome = (record) => (record.accepted ? 'ok' : record.verdict)

export function canaryVerdict(sampleDir) {
  if (!existsSync(join(sampleDir, 'sample.yaml'))) return null
  const record = loadCanary(loadSample(sampleDir))
  return record === null ? null : canaryOutcome(record)
}

export function canaryRuling(sampleDir) {
  if (!existsSync(join(sampleDir, 'sample.yaml'))) return null
  return loadCanary(loadSample(sampleDir))?.accepted ?? null
}
