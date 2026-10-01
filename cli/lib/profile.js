import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, matchesGlob } from 'node:path'
import { tryGit } from './exec.js'

const JS_TEST_GLOBS = ['**/*.test.ts', '**/*.test.tsx', '**/*.test.js', '**/*.test.jsx']
const REPORT_FILE = '.spec-gate-report.xml'

const STACKS = [
  { name: 'go', test_globs: ['**/*_test.go'], test_command: 'go test -json {dir}', report: 'go-json', report_file: null },
  {
    name: 'vitest',
    test_globs: JS_TEST_GLOBS,
    test_command: `npx vitest run {file} --reporter=junit --outputFile=${REPORT_FILE}`,
    report: 'junit',
    report_file: REPORT_FILE,
  },
  { name: 'jest', test_globs: JS_TEST_GLOBS, test_command: 'npx jest {file}', report: null, report_file: null },
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

const SKILL_ROLES = { test_writing: /spec-to-tests|test-gen|tdd/, review: /review/, bug_fix: /bug/ }

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

function detectStacks(repo, packages, deps) {
  const present = {
    go: existsSync(join(repo, 'go.work')) || existsSync(join(repo, 'go.mod')),
    vitest: deps.has('vitest'),
    jest: deps.has('jest'),
    'node-test': packages.some((pkg) => /node --test/.test(pkg.scripts?.test ?? '')),
  }
  return STACKS.filter((stack) => present[stack.name])
}

function detectSetup(repo) {
  const found = LOCKFILES.find(([file]) => existsSync(join(repo, file)))
  return found ? found[1] : null
}

function detectUiLayer(repo, deps) {
  if (deps.has('@playwright/test') || deps.has('playwright')) return 'playwright'
  const configs = tryGit(repo, ['ls-files', '--', 'playwright.config.*', '*/playwright.config.*']) ?? ''
  return configs.trim() ? 'playwright' : null
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
