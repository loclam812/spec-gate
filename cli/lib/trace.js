import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { didNotLoad } from './run-tests.js'
import { mentionsId } from './text.js'

const list = (value) => (Array.isArray(value) ? value : [])
function fileCaseStatus(id, result) {
  if (!result) return 'not run'
  if (result.status === 'unrunnable') return 'untested'
  if (result.tests.length === 0) return result.status
  const named = result.tests.filter((test) => mentionsId(test.name, id))
  if (named.length === 0) return didNotLoad(result) ? 'red' : 'no test'
  if (named.some((test) => test.status === 'fail')) return 'red'
  return named.every((test) => test.status === 'pass') ? 'green' : 'skipped'
}

// With a per-test report, only a test whose name carries the id counts; a mention in a comment
// does not, and a skipped test checks nothing. Without one (jest), the file's status stands in.
function caseStatus(id, { repo, files, results }) {
  const holders = files.filter((file) => existsSync(join(repo, file)) && mentionsId(readFileSync(join(repo, file), 'utf8'), id))
  if (holders.length === 0) return 'no test'
  const statuses = holders.map((file) => fileCaseStatus(id, results.find((entry) => entry.file === file)))
  if (statuses.every((status) => status === 'green')) return 'green'
  return statuses.includes('red') ? 'red' : statuses.find((status) => status !== 'green')
}

function combined(statuses) {
  if (statuses.length === 0) return 'no case'
  if (statuses.every((status) => status === 'green')) return 'green'
  return statuses.find((status) => status !== 'green')
}

function table(header, rows) {
  return [header, header.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n')
}

export function buildTrace({ casesDoc, repo, files, results }) {
  const context = { repo, files, results }
  const rows = list(casesDoc?.sentences).map((sentence) => {
    const label = `${sentence.id}: ${sentence.text}`
    const ids = list(sentence.cases)
    if (ids.length === 0) return { cells: [label, '', `not testable: ${sentence.non_testable ?? 'no reason given'}`], gap: false, key: sentence.id }
    const result = combined(ids.map((id) => caseStatus(id, context)))
    return { cells: [label, ids.join(', '), result], gap: result !== 'green', key: sentence.id, result }
  })
  return {
    section: `## Requirement → test\n\n${table(['Sentence', 'Cases', 'Result'], rows.map((row) => row.cells))}`,
    gaps: rows.filter((row) => row.gap).map((row) => `- ${row.key}: ${row.result}`),
  }
}
