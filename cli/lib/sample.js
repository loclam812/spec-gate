import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, matchesGlob } from 'node:path'
import { parse } from 'yaml'
import { tryGit } from './exec.js'
import { REPORT_FORMATS } from './reports.js'

const REQUIRED = ['id', 'pre_fix', 'post_fix', 'test_command', 'test_globs']
const DEFAULTS = { setup: null, timeout_s: 600, report: null, report_file: null }

export function loadSample(dir) {
  const parsed = parse(readFileSync(join(dir, 'sample.yaml'), 'utf8')) ?? {}
  return { ...DEFAULTS, ...parsed, dir }
}

function specFiles(sample) {
  const specDir = join(sample.dir, 'spec')
  if (!existsSync(specDir)) return []
  return readdirSync(specDir).filter((name) => !name.startsWith('.')).sort()
}

function isCommit(repoPath, sha) {
  return tryGit(repoPath, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]) !== null
}

export function sampleErrors(sample, repoPath) {
  const missing = REQUIRED.filter((key) => sample[key] === undefined || sample[key] === null || sample[key] === '')
  if (missing.length > 0) return missing.map((key) => `missing field: ${key}`)
  const checks = [
    [sample.id === basename(sample.dir), `id "${sample.id}" does not match directory "${basename(sample.dir)}"`],
    [typeof sample.pre_fix === 'string', 'pre_fix must be a quoted string'],
    [typeof sample.post_fix === 'string', 'post_fix must be a quoted string'],
    [/\{(file|dir)\}/.test(sample.test_command), 'test_command must contain {file} or {dir}'],
    [Array.isArray(sample.test_globs) && sample.test_globs.length > 0, 'test_globs must be a non-empty list'],
    [specFiles(sample).length > 0, 'spec/ must contain at least one file'],
    [existsSync(join(sample.dir, 'answers.yaml')), 'answers.yaml is missing'],
    [sample.report === null || REPORT_FORMATS.includes(sample.report), `report must be one of ${REPORT_FORMATS.join(', ')}`],
    [sample.report !== 'junit' || typeof sample.report_file === 'string', 'report junit needs report_file'],
  ]
  const failed = checks.filter(([ok]) => !ok).map(([, message]) => message)
  if (failed.length > 0) return failed
  const unknown = ['pre_fix', 'post_fix']
    .filter((key) => !isCommit(repoPath, sample[key]))
    .map((key) => `${key} ${sample[key]} is not a commit in ${repoPath}`)
  if (unknown.length > 0) return unknown
  const ordered = tryGit(repoPath, ['merge-base', '--is-ancestor', sample.pre_fix, sample.post_fix]) !== null
  return ordered ? [] : [`pre_fix ${sample.pre_fix} is not an ancestor of post_fix ${sample.post_fix}`]
}

export function specText(sample) {
  return specFiles(sample)
    .map((name) => `### ${name}\n\n${readFileSync(join(sample.dir, 'spec', name), 'utf8').trim()}\n`)
    .join('\n')
}

export function answersText(sample) {
  return readFileSync(join(sample.dir, 'answers.yaml'), 'utf8').trim()
}

export function isTestPath(sample, relPath) {
  return sample.test_globs.some((pattern) => matchesGlob(relPath, pattern))
}
