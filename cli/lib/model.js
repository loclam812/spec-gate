export const LAYERS = ['unit', 'integration', 'e2e', 'ui']

const list = (value) => (Array.isArray(value) ? value : [])
const nonEmpty = (value) => typeof value === 'string' && value.trim() !== ''
const duplicates = (ids) => [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]

// C1 must not match inside C12 or ABC1, but may follow a lowercase word, as in a Go test name
// (TestC1_LateRefund).
export function mentionsId(text, id) {
  return new RegExp(`(?<![0-9A-Z])${id}(?![0-9])`).test(text)
}

function uxErrors(model, questions) {
  if (model.ui !== true) return []
  const ux = model.ux ?? {}
  const asked = questions.some((question) => question.about === 'ux-source')
  return [
    ...(list(ux.screens).length === 0 ? ['ux.screens: a UI request names at least one screen'] : []),
    ...(list(ux.states).length === 0 ? ['ux.states: a UI request names at least one state'] : []),
    ...(!nonEmpty(ux.source) && !asked ? ['ux.source: give a UX source or ask for one (a question with about: ux-source)'] : []),
  ]
}

export function modelErrors(model) {
  if (model === null || typeof model !== 'object') return ['model.yaml is not a YAML mapping']
  const sentences = list(model.sentences)
  const rules = list(model.rules)
  const flows = list(model.flows)
  const questions = list(model.questions)
  const targetIds = [...rules, ...flows].map((item) => item.id)
  const known = new Set(targetIds)
  return [
    ...(sentences.length === 0 ? ['sentences: map at least one sentence of the request'] : []),
    ...duplicates([...targetIds, ...sentences.map((s) => s.id), ...questions.map((q) => q.id)]).map((id) => `duplicate id ${id}`),
    ...sentences.filter((s) => list(s.covered_by).length === 0).map((s) => `sentence ${s.id} is covered by nothing`),
    ...sentences.flatMap((s) => list(s.covered_by).filter((ref) => !known.has(ref)).map((ref) => `sentence ${s.id} refers to unknown ${ref}`)),
    ...rules.filter((rule) => !nonEmpty(rule.when) || !nonEmpty(rule.then)).map((rule) => `rule ${rule.id} needs both when and then`),
    ...flows.filter((flow) => list(flow.steps).length === 0).map((flow) => `flow ${flow.id} has no steps`),
    ...uxErrors(model, questions),
  ]
}

export function uxCells(model) {
  if (model?.ui !== true) return []
  const ux = model.ux ?? {}
  return list(ux.screens).flatMap((screen) => list(ux.states).map((state) => `ux:${screen}:${state}`))
}

export function casesErrors(model, casesDoc) {
  const cases = list(casesDoc?.cases)
  if (cases.length === 0) return ['cases: write at least one case']
  const targets = [...list(model.rules).map((rule) => rule.id), ...list(model.flows).map((flow) => flow.id), ...uxCells(model)]
  const known = new Set(targets)
  const covered = new Set(cases.flatMap((c) => list(c.covers)))
  return [
    ...duplicates(cases.map((c) => c.id)).map((id) => `duplicate case id ${id}`),
    ...cases.filter((c) => !/^C\d+$/.test(String(c.id))).map((c) => `case id ${c.id} must look like C1, C2, …`),
    ...cases.filter((c) => !LAYERS.includes(c.layer)).map((c) => `case ${c.id}: layer must be one of ${LAYERS.join(', ')}`),
    ...cases.filter((c) => !nonEmpty(c.expected)).map((c) => `case ${c.id} has no expected outcome`),
    ...cases.flatMap((c) => list(c.covers).filter((ref) => !known.has(ref)).map((ref) => `case ${c.id} covers unknown ${ref}`)),
    ...targets.filter((target) => !covered.has(target)).map((target) => `${target} has no case`),
  ]
}

export function readyErrors(model, casesDoc) {
  return [
    ...modelErrors(model),
    ...list(model?.questions).map((question) => `question ${question.id} is still open`),
    ...casesErrors(model, casesDoc),
  ]
}
