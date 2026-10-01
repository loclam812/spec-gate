import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadCandidate, runCandidate } from './lib/candidate.js'
import { collectTests, scoreRun } from './lib/replay.js'
import { loadVerdicts, renderReport, summarize } from './lib/report.js'
import { loadSample, sampleErrors } from './lib/sample.js'
import { repoSlug, runDir, sampleDir, storeRoot, workDir } from './lib/store.js'
import { prepareWorkspace, workspaceSides } from './lib/workspace.js'

const OPTIONS = {
  repo: { type: 'string', default: '.' },
  candidate: { type: 'string' },
  run: { type: 'string' },
  fresh: { type: 'boolean', default: false },
}

const USAGE = [
  'usage: spec-gate eval <where|validate|prepare|generate|collect|score> <sample-id> [--repo <path>]',
  '                      [--candidate <name> --run <n>] [--fresh]',
  '       spec-gate eval report',
].join('\n')

function context(values, id, env) {
  const repo = resolve(values.repo)
  const slug = repoSlug(repo)
  const dir = sampleDir(slug, id, env)
  if (!existsSync(join(dir, 'sample.yaml'))) throw new Error(`no sample.yaml in ${dir}`)
  const work = workDir(slug, id)
  return { repo, slug, sample: loadSample(dir), work, sides: workspaceSides(work) }
}

function outDirFor(ctx, values, env) {
  if (!values.candidate || !/^\d+$/.test(values.run ?? '')) {
    throw new Error('--candidate <name> and --run <n> are required')
  }
  return runDir(ctx.slug, ctx.sample.id, values.candidate, values.run, env)
}

function requirePrepared(ctx) {
  const ready = [ctx.sides.pre, ctx.sides.post].every((side) => existsSync(join(side, '.git')))
  if (!ready) throw new Error(`sample ${ctx.sample.id} is not prepared; run: spec-gate eval prepare ${ctx.sample.id}`)
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
    const errors = sampleErrors(ctx.sample, ctx.repo)
    if (errors.length > 0) throw new Error(errors.join('\n'))
    const sides = prepareWorkspace(ctx.sample, ctx.repo, ctx.work, { fresh: values.fresh })
    out.write(`pre:  ${sides.pre}\npost: ${sides.post}\n`)
    return 0
  },
  generate(ctx, values, out, env) {
    requirePrepared(ctx)
    const outDir = outDirFor(ctx, values, env)
    runCandidate(loadCandidate(values.candidate, storeRoot(env)), ctx.sample, ctx.sides.pre, outDir, env)
    out.write(collectedLine(collectTests(ctx.sample, ctx.sides.pre, outDir)))
    return 0
  },
  collect(ctx, values, out, env) {
    requirePrepared(ctx)
    out.write(collectedLine(collectTests(ctx.sample, ctx.sides.pre, outDirFor(ctx, values, env))))
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
  if (command === 'where' && id) {
    out.write(`${sampleDir(repoSlug(resolve(values.repo)), id, env)}\n`)
    return 0
  }
  const handler = COMMANDS[command]
  if (!handler || !id) throw new Error(USAGE)
  return handler(context(values, id, env), values, out, env)
}
