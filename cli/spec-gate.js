#!/usr/bin/env node
import { runEval } from './eval.js'

const [group, ...rest] = process.argv.slice(2)
try {
  if (group !== 'eval') throw new Error('usage: spec-gate eval <command> ...')
  process.exitCode = runEval(rest)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
