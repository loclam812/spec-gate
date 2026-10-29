import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { readState } from './run-store.js'

const GROUPED = ['caught', 'caught-below-layer', 'missed', 'inverted', 'empty', 'broken']
const SHORTEST_SENTENCE = 20

const list = (value) => (Array.isArray(value) ? value : [])
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const readYaml = (path) => {
  try {
    return parse(readText(path)) ?? {}
  } catch {
    return {}
  }
}

// A split run keeps its parts in part-N/; the top directory then only records the split.
export function driverDirs(runDir) {
  const top = join(runDir, 'spec-to-tests')
  if (!existsSync(join(top, 'state.json'))) return []
  const parts = readdirSync(top)
    .filter((name) => /^part-\d+$/.test(name))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
  return parts.length > 0 ? parts.map((name) => join(top, name)) : [top]
}

export function driverStep(runDir) {
  const dirs = driverDirs(runDir)
  if (dirs.length === 0) return null
  const steps = dirs.map((dir) => readState(dir)?.step ?? 'unknown')
  // drive.js creates part-N/ only for the parts it started.
  const planned = list(readYaml(join(runDir, 'spec-to-tests', 'cases.yaml')).split).length
  return steps.find((step) => step !== 'done') ?? (dirs.length < planned ? 'split' : 'done')
}

const normalize = (text) => String(text).toLowerCase().replace(/\s+/g, ' ').trim().replace(/^[#*>\- ]+/, '')

function quoteCovered(dirs, quote) {
  const wanted = normalize(quote)
  const sentences = dirs.flatMap((dir) => list(readYaml(join(dir, 'cases.yaml')).sentences))
  const textOf = (sentence) => normalize(sentence?.text ?? '')
  const hasCases = (sentence) => list(sentence.cases).length > 0
  const containing = sentences.filter((sentence) => textOf(sentence) !== '' && textOf(sentence).includes(wanted))
  // A quote spanning sentences does not say which one states the bug, so each must have a case.
  const inside = sentences.filter((sentence) => !containing.includes(sentence) && textOf(sentence).length >= SHORTEST_SENTENCE && wanted.includes(textOf(sentence)))
  return containing.some(hasCases) || (inside.length > 0 && inside.every(hasCases))
}

function gapTouched(dirs, keywords) {
  const questions = dirs.flatMap((dir) => [...readText(join(dir, 'decisions.md')).matchAll(/^- Q\w+ (.+)$/gm)].map((match) => match[1]))
  const assumed = dirs
    .flatMap((dir) => list(readYaml(join(dir, 'cases.yaml')).cases))
    .filter((c) => c?.basis === 'assumed')
    .map((c) => `${c.when ?? ''} ${c.then ?? ''}`)
  const texts = [...questions, ...assumed].map((text) => text.toLowerCase())
  return keywords.some((keyword) => texts.some((text) => text.includes(keyword.toLowerCase())))
}

function groupOf(verdict, step) {
  if (verdict === 'caught' || verdict === 'broken') return verdict
  if (step !== 'done') return `incomplete@${step}`
  if (verdict === 'empty') return verdict
  return 'missed@done'
}

function layerOf(dirs, truth, touched) {
  if (truth === null) return 'unattributed'
  if (truth.bucket === 'specified') return quoteCovered(dirs, truth.quote) ? 'writer-missed' : 'qc-no-case'
  if (touched) return 'gap-touched'
  return truth.kind === 'knowledge' ? 'qc-gap-unasked' : 'qc-gap-unprobed'
}

// A run with no spec-to-tests/ directory is a prompt candidate: it gets a group, never a layer.
export function attribute({ verdict, dir }, truth) {
  if (!GROUPED.includes(verdict)) return { group: null, layer: null, touched: null }
  const dirs = driverDirs(dir)
  const driver = dirs.length > 0
  const group = groupOf(verdict, driver ? driverStep(dir) : 'done')
  const touched = driver && truth?.bucket === 'spec_gap' ? gapTouched(dirs, truth.keywords) : null
  return { group, layer: driver && group === 'missed@done' ? layerOf(dirs, truth, touched) : null, touched }
}
