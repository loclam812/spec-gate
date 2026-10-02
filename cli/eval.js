import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { runBatch } from './lib/batch.js'
import { loadCandidate } from './lib/candidate.js'
import { contextFor, generateRun, rememberRepo, requirePrepared } from './lib/eval-steps.js'
import { collectTests, scoreRun } from './lib/replay.js'
import { loadVerdicts, renderReport, summarize } from './lib/report.js'
import { sampleErrors } from './lib/sample.js'
import { repoSlug, runDir, sampleDir, storeRoot } from './lib/store.js'
import { prepareWorkspace } from './lib/workspace.js'

const OPTIONS = {
  repo: { type: 'string', default: '.' },
  candidate: { type: 'string', multiple: true },
  run: { type: 'string' },
  runs: { type: 'string', default: '3' },
  sample: { type: 'string', multiple: true },
  fresh: { type: 'boolean', default: false },
}

const USAGE = [
  'usage: spec-gate eval <where|validate|prepare|generate|collect|score> <sample-id> [--repo <path>]',
  '                      [--candidate <name> --run <n>] [--fresh]',
  '       spec-gate eval batch [--runs <n>] [--candidate <name>]... [--sample <id>]...',
  '       spec-gate eval report',
].join('\n')

function outDirFor(ctx, values, env) {
  const candidate = values.candidate?.[0]
  if (!candidate || !/^\d+$/.test(values.run ?? '')) {
    throw new Error('--candidate <name> and --run <n> are required')
  }
  return runDir(ctx.slug, ctx.sample.id, candidate, values.run, env)
}

const collectedLine = ({ tests, ignored }) =>
  `collected ${tests.length} test file(s), ignored ${ignored.length} other change(s)\n`

const COMMANDS = {
  validate(ctx, values, out) {
    const errors = sampleErrors(ctx.sample, ctx.repo)
    out.write(errors.length === 0 ? 'ok\n' : `${errors.join('\n')}\n`)
    return errors.length === 0 ? 0 : 1
  },
  prepare(ctx, values, out) {
    const errors = sampleErrors(ctx.sample, ctx.repo, { docs: false })
    if (errors.length > 0) throw new Error(errors.join('\n'))
    const sides = prepareWorkspace(ctx.sample, ctx.repo, ctx.work, { fresh: values.fresh })
    out.write(`pre:  ${sides.pre}\npost: ${sides.post}\n`)
    return 0
  },
  generate(ctx, values, out, env) {
    requirePrepared(ctx)
    const candidate = loadCandidate(values.candidate[0], storeRoot(env))
    out.write(collectedLine(generateRun(ctx, candidate, outDirFor(ctx, values, env), env)))
    return 0
  },
  collect(ctx, values, out, env) {
    requirePrepared(ctx)
    const outDir = outDirFor(ctx, values, env)
    if (existsSync(join(outDir, 'collected.json')) && !values.fresh) {
      throw new Error(`run already collected in ${outDir}; pass --fresh to replace it`)
    }
    out.write(collectedLine(collectTests(ctx.sample, ctx.sides.pre, outDir)))
    return 0
  },
  score(ctx, values, out, env) {
    requirePrepared(ctx)
    const outDir = outDirFor(ctx, values, env)
    if (!existsSync(join(outDir, 'collected.json'))) {
      throw new Error(`nothing collected in ${outDir}; run generate or collect first`)
    }
    const record = scoreRun(ctx.sample, ctx.sides, outDir)
    const lines = record.files.map((file) => `  ${file.verdict.padEnd(12)} ${file.path}`)
    out.write(`${[`${record.sample}: ${record.verdict}`, ...lines].join('\n')}\n`)
    return 0
  },
}

export function runEval(argv, { env = process.env, out = process.stdout } = {}) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true })
  const [command, id] = positionals
  if (command === 'report') {
    out.write(renderReport(summarize(loadVerdicts(storeRoot(env)))))
    return 0
  }
  if (command === 'batch') {
    if (!/^\d+$/.test(values.runs)) throw new Error('--runs must be a whole number')
    return runBatch({ env, out, runs: Number(values.runs), candidates: values.candidate ?? null, samples: values.sample ?? null })
  }
  const repo = resolve(values.repo)
  if (command === 'where' && id) {
    rememberRepo(repoSlug(repo), repo, env)
    out.write(`${sampleDir(repoSlug(repo), id, env)}\n`)
    return 0
  }
  const handler = COMMANDS[command]
  if (!handler || !id) throw new Error(USAGE)
  return handler(contextFor(repo, id, env), values, out, env)
}
