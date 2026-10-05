import { UX_SOURCE_UNASKED, uxSourceErrors } from './cases.js'

export { UX_SOURCE_UNASKED }
export const LAYERS = ['unit', 'integration', 'e2e', 'ui']

const list = (value) => (Array.isArray(value) ? value : [])
const nonEmpty = (value) => typeof value === 'string' && value.trim() !== ''
const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const duplicates = (ids) => [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]

export { mentionsId, splitRequest } from './text.js'

function mappings(model, key) {
  const entries = list(model[key])
  return {
    valid: entries.filter(isMapping),
    errors: entries.flatMap((entry, index) => (isMapping(entry) ? [] : [`${key} entry ${index + 1} is not a mapping`])),
  }
}

function uiErrors(model, questions, context) {
  if (typeof model.ui !== 'boolean') return ['ui: set true or false']
  const asked = questions.some((question) => question.about === 'ux-source')
  if (model.ui !== true) {
    return context.uiRequest && !asked
      ? ['ui: the request names a screen, page, dialog or form; set ui: true, or ask (about: ux-source)']
      : []
  }
  const ux = isMapping(model.ux) ? model.ux : {}
  return [
    ...(list(ux.screens).length === 0 ? ['ux.screens: a UI request names at least one screen'] : []),
    ...(list(ux.states).length === 0 ? ['ux.states: a UI request names at least one state'] : []),
    ...uxSourceErrors(nonEmpty(ux.source) ? ux.source.trim() : '', asked, context),
  ]
}

function sentenceSetErrors(sentences, context) {
  if (!Array.isArray(context.sentenceIds)) return []
  const listed = sentences.map((sentence) => sentence.id)
  return [
    ...context.sentenceIds.filter((id) => !listed.includes(id)).map((id) => `sentence ${id} of the request is not in the model`),
    ...listed.filter((id) => !context.sentenceIds.includes(id)).map((id) => `sentence ${id} is not a sentence of the request`),
  ]
}

// Where a rule comes from: the request itself, an answer recorded at Ask, or the BA's own guess.
export const BASES = ['request', 'decision', 'assumed']

export function modelErrors(model, context = {}) {
  if (!isMapping(model)) return ['model.yaml is not a YAML mapping']
  const [sentences, rules, flows, questions] = ['sentences', 'rules', 'flows', 'questions'].map((key) => mappings(model, key))
  const targetIds = [...rules.valid, ...flows.valid].map((item) => item.id)
  const known = new Set(targetIds)
  const uncovered = sentences.valid.filter((s) => list(s.covered_by).length === 0 && !nonEmpty(s.non_testable))
  return [
    ...sentences.errors,
    ...rules.errors,
    ...flows.errors,
    ...questions.errors,
    ...(sentences.valid.length === 0 ? ['sentences: map at least one sentence of the request'] : []),
    ...sentenceSetErrors(sentences.valid, context),
    ...duplicates([...targetIds, ...sentences.valid.map((s) => s.id), ...questions.valid.map((q) => q.id)]).map((id) => `duplicate id ${id}`),
    ...uncovered.map((s) => `sentence ${s.id} is covered by nothing`),
    ...sentences.valid.flatMap((s) => list(s.covered_by).filter((ref) => !known.has(ref)).map((ref) => `sentence ${s.id} refers to unknown ${ref}`)),
    ...rules.valid.filter((rule) => !nonEmpty(rule.when) || !nonEmpty(rule.then)).map((rule) => `rule ${rule.id} needs both when and then`),
    ...rules.valid.filter((rule) => rule.basis !== undefined && !BASES.includes(rule.basis)).map((rule) => `rule ${rule.id} basis must be request, decision or assumed`),
    ...flows.valid.filter((flow) => list(flow.steps).length === 0).map((flow) => `flow ${flow.id} has no steps`),
    ...uiErrors(model, questions.valid, context),
  ]
}

export function uxCells(model) {
  if (model?.ui !== true) return []
  const ux = isMapping(model.ux) ? model.ux : {}
  return list(ux.screens).flatMap((screen) => list(ux.states).map((state) => `ux:${screen}:${state}`))
}

export function casesErrors(model, casesDoc) {
  const entries = list(casesDoc?.cases)
  if (entries.length === 0) return ['cases: write at least one case']
  const cases = entries.filter(isMapping)
  const targets = [
    ...list(model?.rules).filter(isMapping).map((rule) => rule.id),
    ...list(model?.flows).filter(isMapping).map((flow) => flow.id),
    ...uxCells(model),
  ]
  const known = new Set(targets)
  const covered = new Set(cases.flatMap((c) => list(c.covers)))
  return [
    ...entries.flatMap((entry, index) => (isMapping(entry) ? [] : [`cases entry ${index + 1} is not a mapping`])),
    ...duplicates(cases.map((c) => c.id)).map((id) => `duplicate case id ${id}`),
    ...cases.filter((c) => !/^C\d+$/.test(String(c.id))).map((c) => `case id ${c.id} must look like C1, C2, …`),
    ...cases.filter((c) => !LAYERS.includes(c.layer)).map((c) => `case ${c.id}: layer must be one of ${LAYERS.join(', ')}`),
    ...cases.filter((c) => !nonEmpty(c.expected)).map((c) => `case ${c.id} has no expected outcome`),
    ...cases.flatMap((c) => list(c.covers).filter((ref) => !known.has(ref)).map((ref) => `case ${c.id} covers unknown ${ref}`)),
    ...targets.filter((target) => !covered.has(target)).map((target) => `${target} has no case`),
  ]
}

export function readyErrors(model, casesDoc, context = {}) {
  return [
    ...modelErrors(model, context),
    ...list(model?.questions).filter(isMapping).map((question) => `question ${question.id} is still open`),
    ...casesErrors(model, casesDoc),
  ]
}
