import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, matchesGlob, normalize } from 'node:path'
import { tryGit } from './exec.js'

const JS_TEST_GLOBS = ['**/*.test.ts', '**/*.test.tsx', '**/*.test.js', '**/*.test.jsx', '**/*.spec.ts', '**/*.spec.tsx', '**/*.spec.js', '**/*.spec.jsx']
const REPORT_FILE = '.spec-gate-report.xml'

const PLAYWRIGHT_COMMAND = `PLAYWRIGHT_JUNIT_OUTPUT_FILE=${REPORT_FILE} npx --no-install playwright test {file} --reporter=junit`

const STACKS = [
  { name: 'go', test_globs: ['**/*_test.go'], test_command: 'go test -json {dir}', report: 'go-json', report_file: null },
  {
    name: 'vitest',
    test_globs: JS_TEST_GLOBS,
    test_command: `npx --no-install vitest run {file} --reporter=junit --outputFile=${REPORT_FILE}`,
    report: 'junit',
    report_file: REPORT_FILE,
  },
  { name: 'jest', test_globs: JS_TEST_GLOBS, test_command: 'npx --no-install jest {file}', report: null, report_file: null },
  {
    name: 'node-test',
    test_globs: ['**/*.test.js', '**/*.test.mjs'],
    test_command: `node --test --test-reporter=junit --test-reporter-destination=${REPORT_FILE} {file}`,
    report: 'junit',
    report_file: REPORT_FILE,
  },
]

const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm install --frozen-lockfile --prefer-offline'],
  ['yarn.lock', 'yarn install --immutable'],
  ['package-lock.json', 'npm ci'],
]

const SKILL_ROLES = { test_writing: /write-tests|spec-to-tests|test-gen|tdd/, review: /review/, bug_fix: /bug/ }

function readPackage(repo, path) {
  try {
    return JSON.parse(readFileSync(join(repo, path), 'utf8'))
  } catch {
    return {}
  }
}

function trackedPackages(repo) {
  const listed = tryGit(repo, ['ls-files', '--', 'package.json', '*/package.json']) ?? ''
  return listed
    .split('\n')
    .filter(Boolean)
    .map((path) => readPackage(repo, path))
}

function dependencyNames(packages) {
  return new Set(packages.flatMap((pkg) => Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })))
}

function playwrightConfigs(repo) {
  const listed = tryGit(repo, ['ls-files', '--', 'playwright.config.*', '*/playwright.config.*']) ?? ''
  return listed.split('\n').filter(Boolean)
}

// Without an explicit testDir Playwright claims every spec file under its config, the unit
// runner's included, so only a config that names its directory gets a stack. It comes first
// because the JS unit runners' globs also match its files.
function playwrightStack(repo, deps) {
  if (!deps.has('@playwright/test')) return null
  const dirs = playwrightConfigs(repo).flatMap((config) => {
    const testDir = readFileSync(join(repo, config), 'utf8').match(/\btestDir\s*:\s*['"`]([^'"`]+)['"`]/)?.[1]
    const dir = testDir ? normalize(join(dirname(config), testDir)) : '.'
    return dir === '.' || dir.startsWith('..') ? [] : [dir]
  })
  if (dirs.length === 0) return null
  return {
    name: 'playwright',
    test_globs: dirs.flatMap((dir) => JS_TEST_GLOBS.map((glob) => `${dir}/${glob}`)),
    test_command: PLAYWRIGHT_COMMAND,
    report: 'junit',
    report_file: REPORT_FILE,
  }
}

function detectStacks(repo, packages, deps) {
  const present = {
    go: existsSync(join(repo, 'go.work')) || (tryGit(repo, ['ls-files', '--', 'go.mod', '*/go.mod']) ?? '').trim() !== '',
    vitest: deps.has('vitest'),
    jest: deps.has('jest'),
    'node-test': packages.some((pkg) => /node --test/.test(pkg.scripts?.test ?? '')),
  }
  const playwright = playwrightStack(repo, deps)
  return [...(playwright ? [playwright] : []), ...STACKS.filter((stack) => present[stack.name])]
}

function detectSetup(repo) {
  const found = LOCKFILES.find(([file]) => existsSync(join(repo, file)))
  return found ? found[1] : null
}

function detectUiLayer(repo, deps) {
  if (deps.has('@playwright/test') || deps.has('playwright')) return 'playwright'
  return playwrightConfigs(repo).length > 0 ? 'playwright' : null
}

function detectSkills(repo) {
  const dir = join(repo, '.claude', 'skills')
  const names = existsSync(dir)
    ? readdirSync(dir).filter((name) => existsSync(join(dir, name, 'SKILL.md'))).sort()
    : []
  return Object.fromEntries(
    Object.entries(SKILL_ROLES).map(([role, pattern]) => [role, names.filter((name) => pattern.test(name))]),
  )
}

export function discoverProfile(repo) {
  const packages = trackedPackages(repo)
  const deps = dependencyNames(packages)
  return {
    stacks: detectStacks(repo, packages, deps),
    setup: detectSetup(repo),
    ui_layer: detectUiLayer(repo, deps),
    skills: detectSkills(repo),
  }
}

export function stackFor(profile, relPath) {
  return profile.stacks.find((stack) => stack.test_globs.some((pattern) => matchesGlob(relPath, pattern))) ?? null
}
