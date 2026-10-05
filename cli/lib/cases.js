const UX_SOURCE = /^(figma:|screenshot:|existing-screen:)\S+( .*)?$|^none-agreed$/

export const UX_SOURCE_UNASKED = [
  'ux.source: give a UX source or ask for one (a question with about: ux-source)',
  "ux.source: none-agreed needs the user's answer to a question with about: ux-source",
]

export function uxSourceErrors(source, asked, context) {
  if (source === '') return asked ? [] : [UX_SOURCE_UNASKED[0]]
  if (!UX_SOURCE.test(source)) return ['ux.source: use figma:<url>, screenshot:<path>, existing-screen:<route> or none-agreed']
  if (source === 'none-agreed' && !context.uxSourceAgreed) {
    return [UX_SOURCE_UNASKED[1]]
  }
  return []
}

export const BASES = ['request', 'decision', 'assumed']
export const RISKS = ['high', 'low']
export const LAYERS = ['unit', 'integration', 'e2e', 'ui']
export const MAX_CASES = 30

const list = (value) => (Array.isArray(value) ? value : [])
const nonEmpty = (value) => typeof value === 'string' && value.trim() !== ''
const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const duplicates = (ids) => [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]

function sentenceErrors(sentences, ids, context) {
  const listed = sentences.map((s) => s.id)
  return [
    ...context.sentenceIds.filter((id) => !listed.includes(id)).map((id) => `sentence ${id} of the request is not in cases.yaml`),
    ...sentences.filter((s) => list(s.cases).length === 0 && !nonEmpty(s.non_testable)).map((s) => `sentence ${s.id} is covered by no case`),
    ...sentences.flatMap((s) => list(s.cases).filter((id) => !ids.has(id)).map((id) => `sentence ${s.id} refers to unknown case ${id}`)),
  ]
}

function caseErrors(cases) {
  return [
    ...duplicates(cases.map((c) => c.id)).map((id) => `duplicate case id ${id}`),
    ...cases.filter((c) => !/^C\d+$/.test(String(c.id))).map((c) => `case id ${c.id} must look like C1, C2, ...`),
    ...cases.flatMap((c) => [
      ...(nonEmpty(c.when) && nonEmpty(c.then) ? [] : [`case ${c.id} needs both when and then`]),
      ...(BASES.includes(c.basis) ? [] : [`case ${c.id}: basis must be request, decision or assumed`]),
      ...(RISKS.includes(c.risk) ? [] : [`case ${c.id}: risk must be high or low`]),
      ...(LAYERS.includes(c.layer) ? [] : [`case ${c.id}: layer must be one of ${LAYERS.join(', ')}`]),
    ]),
  ]
}

function uiErrors(doc, questions, context) {
  if (typeof doc.ui !== 'boolean') return ['ui: set true or false']
  const asked = questions.some((q) => q.about === 'ux-source')
  if (doc.ui !== true) {
    return context.uiRequest && !asked ? ['ui: the request names a screen, page, dialog or form; set ui: true, or ask (about: ux-source)'] : []
  }
  return uxSourceErrors(isMapping(doc.ux) ? String(doc.ux.source ?? '').trim() : '', asked, context)
}

const MAX_QUESTIONS = 4

export function casesDocErrors(doc, context) {
  if (!isMapping(doc)) return ['cases.yaml is not a YAML mapping']
  const cases = list(doc.cases).filter(isMapping)
  const sentences = list(doc.sentences).filter(isMapping)
  const questions = list(doc.questions).filter(isMapping)
  return [
    ...(cases.length === 0 ? ['cases: the request has nothing to test; write at least one case'] : []),
    ...(cases.length > MAX_CASES ? [`cases: ${cases.length} cases; keep the ${MAX_CASES} riskiest`] : []),
    ...sentenceErrors(sentences, new Set(cases.map((c) => c.id)), context),
    ...caseErrors(cases),
    ...(questions.length > MAX_QUESTIONS ? [`questions: ${questions.length} questions; ask at most ${MAX_QUESTIONS} per round, the riskiest first`] : []),
    ...duplicates(questions.map((q) => q.id)).map((id) => `duplicate question id ${id}`),
    ...uiErrors(doc, questions, context),
  ]
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

export function readySummary(doc, { casesPath }) {
  const cases = list(doc?.cases).filter(isMapping)
  const toCheck = [...cases.filter((c) => c.basis === 'assumed'), ...cases.filter((c) => c.basis === 'decision')]
  const settled = cases.filter((c) => c.basis === 'request')
  const checkLines = toCheck.map((c) => `- ${c.id} (${c.basis}, ${c.risk}): when ${c.when}, then ${c.then}`)
  return [
    '# Ready to write tests',
    '',
    `${plural(cases.length, 'case')}${doc?.ui === true ? `; UX source: ${doc.ux?.source}` : ''}.`,
    '',
    '## Check these',
    '',
    ...(checkLines.length > 0 ? checkLines : ['Nothing: every case comes straight from the request.']),
    '',
    `${plural(settled.length, 'case')} straight from the request. All cases: ${casesPath}`,
    '',
  ].join('\n')
}
