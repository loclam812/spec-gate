import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { runCandidate } from './candidate.js'
import { driveSpecToTests } from './drive.js'
import { writeJson } from './files.js'
import { collectTests } from './replay.js'
import { loadSample } from './sample.js'
import { projectDir, repoSlug, sampleDir, storeRoot, workDir } from './store.js'
import { preparedFor, workspaceSides } from './workspace.js'

export function rememberRepo(slug, repo, env) {
  writeJson(join(projectDir(slug, env), 'repo.json'), { path: repo })
}

export function contextFor(repo, id, env) {
  const slug = repoSlug(repo)
  rememberRepo(slug, repo, env)
  const dir = sampleDir(slug, id, env)
  if (!existsSync(join(dir, 'sample.yaml'))) throw new Error(`no sample.yaml in ${dir}`)
  const work = workDir(slug, id, env)
  return { repo, slug, sample: loadSample(dir), work, sides: workspaceSides(work) }
}

export function requirePrepared(ctx) {
  if (!preparedFor(ctx.work, ctx.sample)) {
    throw new Error(`sample ${ctx.sample.id} is not prepared; run: spec-gate eval prepare ${ctx.sample.id}`)
  }
}

export function generateRun(ctx, candidate, outDir, env) {
  rmSync(outDir, { recursive: true, force: true })
  const watch = [ctx.sides.post, storeRoot(env), ctx.repo]
  const run = candidate.driver === 'spec-to-tests' ? driveSpecToTests : runCandidate
  run(candidate, ctx.sample, ctx.sides.pre, outDir, { env, hide: [ctx.sides.post], watch })
  return collectTests(ctx.sample, ctx.sides.pre, outDir)
}
