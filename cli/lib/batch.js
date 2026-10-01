import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { appliesTo, listCandidates, loadCandidate } from './candidate.js'
import { contextFor, generateRun } from './eval-steps.js'
import { readJson } from './files.js'
import { scoreRun } from './replay.js'
import { sampleErrors } from './sample.js'
import { runDir, storeRoot } from './store.js'
import { prepareWorkspace } from './workspace.js'

const listDir = (path) => (existsSync(path) ? readdirSync(path).sort() : [])
const repoFileOf = (root, slug) => join(root, 'projects', slug, 'repo.json')

function jobsForCandidate(slug, repo, id, candidate, runs, env) {
  return Array.from({ length: runs }, (_, index) => index + 1)
    .map((n) => ({ slug, repo, id, candidate, n, outDir: runDir(slug, id, candidate.name, n, env) }))
    .filter((job) => !existsSync(join(job.outDir, 'verdict.json')))
}

export function planJobs({ env, runs, candidates, samples }) {
  const root = storeRoot(env)
  const loaded = candidates.map((name) => loadCandidate(name, root))
  return listDir(join(root, 'projects'))
    .filter((slug) => existsSync(repoFileOf(root, slug)))
    .flatMap((slug) => {
      const repo = readJson(repoFileOf(root, slug)).path
      const applicable = loaded.filter((candidate) => appliesTo(candidate, slug))
      const ids = listDir(join(root, 'projects', slug, 'eval')).filter((id) => samples === null || samples.includes(id))
      return ids.flatMap((id) => applicable.flatMap((candidate) => jobsForCandidate(slug, repo, id, candidate, runs, env)))
    })
}

function runJob(job, prepared, env, out) {
  const label = `${job.id} ${job.candidate.name} ${job.n}`
  try {
    const ctx = contextFor(job.repo, job.id, env)
    const key = `${job.slug}/${job.id}`
    if (!prepared.has(key)) {
      const errors = sampleErrors(ctx.sample, job.repo)
      if (errors.length > 0) throw new Error(`invalid sample: ${errors.join('; ')}`)
      prepareWorkspace(ctx.sample, job.repo, ctx.work)
      prepared.add(key)
    }
    generateRun(ctx, job.candidate, job.outDir, env)
    const record = scoreRun(ctx.sample, ctx.sides, job.outDir)
    out.write(`${label}: ${record.verdict}\n`)
    return record.verdict
  } catch (error) {
    out.write(`${label}: failed — ${error.message.split('\n')[0]}\n`)
    return 'failed'
  }
}

export function runBatch({ env, out, runs, candidates, samples }) {
  const root = storeRoot(env)
  const names = candidates ?? listCandidates(root)
  for (const slug of listDir(join(root, 'projects')).filter((slug) => !existsSync(repoFileOf(root, slug)))) {
    out.write(`skip ${slug}: no repo.json; run any eval command for it with --repo once\n`)
  }
  const jobs = planJobs({ env, runs, candidates: names, samples })
  out.write(`${jobs.length} run(s) to do\n`)
  const prepared = new Set()
  let leaked = 0
  for (const job of jobs) {
    leaked += runJob(job, prepared, env, out) === 'leaked' ? 1 : 0
    if (leaked >= 2) {
      out.write('stop: two leaked runs\n')
      return 3
    }
  }
  return 0
}
