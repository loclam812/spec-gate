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
const FRESH_KEYS = ['pre_fix', 'post_fix', 'test_command']

export function fixTests(sample, repo) {
  return git(repo, ['diff', '--name-only', '--diff-filter=AM', '-z', sample.pre_fix, sample.post_fix])
    .split('\0')
    .filter((path) => path && isTestPath(sample, path))
    .sort()
}

const loads = (result) => !result.timedOut && !['unrunnable', 'no-tests'].includes(result.status) && !didNotLoad(result)

// The driver runs each stack of the profile it discovers in the pre-fix tree; a stack that cannot
// run a test the repository already has will not run the tests a candidate writes either.
export function runnerChecks(sample, preDir) {
  const profile = discoverProfile(preDir)
  const tracked = git(preDir, ['ls-files', '-z']).split('\0').filter(Boolean).sort()
  return profile.stacks.map((stack) => {
    const file = tracked.find((path) => stackFor(profile, path)?.name === stack.name) ?? null
    if (file === null) return { stack: stack.name, file, status: 'unchecked', ok: true, reason: null }
    const result = runTestFile(profile, preDir, file, sample.timeout_s)
    resetTree(preDir)
    const ok = loads(result)
    const reason = ok ? null : (wrongReasons(result, [])[0]?.replace(`${file}: `, '') ?? `status: ${result.status}`)
    return { stack: stack.name, file, status: result.status, ok, reason }
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

export function loadCanary(sample) {
  if (!existsSync(canaryPath(sample))) return null
  const record = readJson(canaryPath(sample))
  return FRESH_KEYS.every((key) => record[key] === sample[key]) ? record : null
}

export function canaryVerdict(sampleDir) {
  if (!existsSync(join(sampleDir, 'sample.yaml'))) return null
  return loadCanary(loadSample(sampleDir))?.verdict ?? null
}
