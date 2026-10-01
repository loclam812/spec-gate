import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mentionsId, uxCells } from './model.js'

const list = (value) => (Array.isArray(value) ? value : [])
const passed = (status) => status === 'pass' || status === 'skip'

function caseStatus(id, { repo, files, results }) {
  const holders = files.filter((file) => existsSync(join(repo, file)) && mentionsId(readFileSync(join(repo, file), 'utf8'), id))
  if (holders.length === 0) return 'no test'
  const statuses = holders.map((file) => {
    const result = results.find((entry) => entry.file === file)
    if (!result) return 'not run'
    const named = result.tests.filter((test) => mentionsId(test.name, id))
    if (named.length > 0) return named.every((test) => passed(test.status)) ? 'green' : 'red'
    return result.status
  })
  if (statuses.every((status) => status === 'green')) return 'green'
  return statuses.includes('red') ? 'red' : statuses[0]
}

function combined(statuses) {
  if (statuses.length === 0) return 'no case'
  if (statuses.every((status) => status === 'green')) return 'green'
  return statuses.find((status) => status !== 'green')
}

function casesFor(casesDoc, targets) {
  return list(casesDoc?.cases).filter((c) => list(c.covers).some((ref) => targets.includes(ref)))
}

function table(header, rows) {
  return [header, header.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n')
}

function traceSection(model, casesDoc, context) {
  const statusOf = (c) => caseStatus(c.id, context)
  const sentenceRows = list(model.sentences).map((sentence) => {
    const cases = casesFor(casesDoc, list(sentence.covered_by))
    const result = combined(cases.map(statusOf))
    return { key: sentence.id, result, cells: [`${sentence.id}: ${sentence.text}`, list(sentence.covered_by).join(', '), cases.map((c) => c.id).join(', '), result] }
  })
  const uxRows = uxCells(model).map((cell) => {
    const cases = casesFor(casesDoc, [cell])
    const result = combined(cases.map(statusOf))
    return { key: cell, result, cells: [cell, cases.map((c) => c.id).join(', '), result] }
  })
  const sections = [
    `## Requirement → test\n\n${table(['Sentence', 'Covered by', 'Cases', 'Result'], sentenceRows.map((row) => row.cells))}`,
    ...(uxRows.length > 0 ? [`## UX\n\n${table(['Cell', 'Cases', 'Result'], uxRows.map((row) => row.cells))}`] : []),
  ]
  const gaps = [...sentenceRows, ...uxRows].filter((row) => row.result !== 'green').map((row) => `- ${row.key}: ${row.result}`)
  return { sections, gaps }
}

export function buildReport({ runId, tier, reasons, request, model, casesDoc, files, results, notes, repo }) {
  const context = { repo, files, results }
  const traced = model ? traceSection(model, casesDoc, context) : { sections: [], gaps: [] }
  const fileRows = files.map((file) => [file, results.find((entry) => entry.file === file)?.status ?? 'not run'])
  const fileGaps = fileRows.filter(([, status]) => status !== 'green').map(([file, status]) => `- ${file}: ${status}`)
  const gaps = [...traced.gaps, ...(model ? [] : fileGaps)]
  const markdown = [
    `# spec-gate run ${runId}`,
    `**Request:** ${request.split('\n')[0]}\n\n**Tier:** ${tier} — ${reasons.join('; ')}`,
    ...traced.sections,
    `## Test files\n\n${table(['File', 'Result'], fileRows)}`,
    `## Gaps\n\n${gaps.length > 0 ? gaps.join('\n') : 'None.'}`,
    `## Notes\n\n${notes.length > 0 ? notes.map((note) => `- ${note}`).join('\n') : 'None.'}`,
  ].join('\n\n')
  return { markdown: `${markdown}\n`, complete: gaps.length === 0 }
}
