#!/usr/bin/env node
import { runEval } from './eval.js'
import { runLog, runNote } from './log.js'
import { runKnowledge, runProfile, runTests, runVerify } from './tests.js'

const GROUPS = { eval: runEval, tests: runTests, verify: runVerify, knowledge: runKnowledge, profile: runProfile, log: runLog, note: runNote }

const [group, ...rest] = process.argv.slice(2)
try {
  const handler = GROUPS[group]
  if (!handler) throw new Error('usage: spec-gate <tests|verify|knowledge|log|note|eval|profile> …')
  process.exitCode = handler(rest)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
