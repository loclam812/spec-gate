import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { specFiles } from './sample.js'

const KINDS = ['knowledge', 'reality']

function readTruth(dir) {
  const path = join(dir, 'truth.yaml')
  if (!existsSync(path)) return { doc: null, error: null }
  try {
    return { doc: parse(readFileSync(path, 'utf8')) ?? {}, error: null }
  } catch (error) {
    return { doc: null, error: `truth.yaml: ${error.message.split('\n')[0]}` }
  }
}

const isText = (value) => typeof value === 'string' && value.trim() !== ''

function docErrors(doc, sample) {
  if ((doc.bug_quote === undefined) === (doc.bug_gap === undefined)) return ['truth.yaml: give exactly one of bug_quote and bug_gap']
  if (doc.reviewed !== undefined && typeof doc.reviewed !== 'boolean') return ['truth.yaml: reviewed must be true or false']
  if (doc.bug_quote !== undefined) {
    const paths = specFiles(sample).map((name) => join(sample.dir, 'spec', name)).filter((path) => statSync(path).isFile())
    const spec = paths.map((path) => readFileSync(path, 'utf8'))
    return isText(doc.bug_quote) && spec.some((text) => text.includes(doc.bug_quote)) ? [] : ['truth.yaml: bug_quote is not a substring of spec/*.md']
  }
  const gap = doc.bug_gap ?? {}
  const checks = [
    [KINDS.includes(gap.kind), 'truth.yaml: bug_gap.kind must be knowledge or reality'],
    [isText(gap.about), 'truth.yaml: bug_gap.about must be a sentence'],
    [Array.isArray(gap.keywords) && gap.keywords.length > 0 && gap.keywords.every(isText), 'truth.yaml: bug_gap.keywords must be a non-empty list of strings'],
    [gap.answers_ref === undefined || isText(gap.answers_ref), 'truth.yaml: bug_gap.answers_ref must be a string'],
  ]
  return checks.filter(([ok]) => !ok).map(([, message]) => message)
}

export function truthErrors(sample) {
  const { doc, error } = readTruth(sample.dir)
  if (error) return [error]
  return doc === null ? [] : docErrors(doc, sample)
}

// A drafted label counts only after the owner has read it and set reviewed: true.
export function loadTruth(sampleDir) {
  const { doc } = readTruth(sampleDir)
  if (doc === null || doc.reviewed !== true || docErrors(doc, { dir: sampleDir }).length > 0) return null
  if (doc.bug_quote !== undefined) return { bucket: 'specified', quote: doc.bug_quote }
  const gap = doc.bug_gap
  return { bucket: 'spec_gap', kind: gap.kind, about: gap.about, keywords: gap.keywords, answersRef: gap.answers_ref ?? null }
}
