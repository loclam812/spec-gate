#!/usr/bin/env node
import { runEval } from './eval.js'
import { runProfile, runRun } from './run.js'
import { runTests } from './tests.js'

const GROUPS = { eval: runEval, run: runRun, tests: runTests, profile: runProfile }

const [group, ...rest] = process.argv.slice(2)
try {
  const handler = GROUPS[group]
  if (!handler) throw new Error('usage: spec-gate <run|tests|eval|profile> …')
  process.exitCode = handler(rest)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
