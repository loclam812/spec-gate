#!/usr/bin/env node
import { runEval } from './eval.js'
import { runProfile, runRun } from './run.js'

const GROUPS = { eval: runEval, run: runRun, profile: runProfile }

const [group, ...rest] = process.argv.slice(2)
try {
  const handler = GROUPS[group]
  if (!handler) throw new Error('usage: spec-gate <run|eval|profile> …')
  process.exitCode = handler(rest)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
