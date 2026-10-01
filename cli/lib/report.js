import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readJson } from './files.js'

const CONCLUSIVE = ['caught', 'missed', 'empty', 'inverted']

const listDir = (path) => (existsSync(path) ? readdirSync(path).sort() : [])

export function parseRunName(name) {
  const match = name.match(/^(.+)-(\d+)$/)
  if (!match) throw new Error(`run directory "${name}" is not <candidate>-<n>`)
  return { candidate: match[1], run: Number(match[2]) }
}

export function loadVerdicts(root) {
  const projectsDir = join(root, 'projects')
  return listDir(projectsDir).flatMap((project) =>
    listDir(join(projectsDir, project, 'eval')).flatMap((sample) => {
      const runsDir = join(projectsDir, project, 'eval', sample, 'runs')
      return listDir(runsDir)
        .filter((name) => existsSync(join(runsDir, name, 'verdict.json')))
        .map((name) => ({
          project,
          sample,
          ...parseRunName(name),
          verdict: readJson(join(runsDir, name, 'verdict.json')).verdict,
        }))
    }),
  )
}

function groupBy(items, keyOf) {
  return items.reduce((groups, item) => {
    const key = keyOf(item)
    return { ...groups, [key]: [...(groups[key] ?? []), item] }
  }, {})
}

function rate(rows) {
  const conclusive = rows.filter((row) => CONCLUSIVE.includes(row.verdict))
  const caught = conclusive.filter((row) => row.verdict === 'caught').length
  const broken = rows.filter((row) => row.verdict === 'broken').length
  const withBroken = conclusive.length + broken
  return {
    caught,
    conclusive: conclusive.length,
    broken,
    excluded: rows.length - withBroken,
    rate: conclusive.length > 0 ? caught / conclusive.length : null,
    rateWithBroken: withBroken > 0 ? caught / withBroken : null,
  }
}

export function summarize(records) {
  return Object.entries(groupBy(records, (row) => row.candidate)).map(([candidate, rows]) => {
    const runs = Object.entries(groupBy(rows, (row) => row.run))
      .map(([run, runRows]) => ({ run: Number(run), ...rate(runRows) }))
      .sort((a, b) => a.run - b.run)
    const rates = runs.map((run) => run.rate).filter((value) => value !== null)
    const samples = Object.entries(groupBy(rows, (row) => `${row.project}/${row.sample}`)).map(
      ([key, sampleRows]) => ({ key, byRun: Object.fromEntries(sampleRows.map((row) => [row.run, row.verdict])) }),
    )
    return {
      candidate,
      overall: rate(rows),
      runs,
      spread: rates.length > 0 ? { min: Math.min(...rates), max: Math.max(...rates) } : null,
      samples,
    }
  })
}

const pct = (value) => (value === null ? 'n/a' : `${Math.round(value * 100)}%`)

function renderCandidate({ candidate, overall, runs, spread, samples }) {
  const runNumbers = Array.from({ length: Math.max(...runs.map((run) => run.run)) }, (_, index) => index + 1)
  const header = ['Sample', ...runNumbers.map((n) => `Run ${n}`)]
  const rows = samples.map((sample) => [sample.key, ...runNumbers.map((n) => sample.byRun[n] ?? '—')])
  const table = [header, header.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n')
  const spreadText = spread ? ` · spread across runs ${pct(spread.min)}–${pct(spread.max)}` : ''
  const rateLine = [
    `Catch rate: ${overall.caught}/${overall.conclusive} (${pct(overall.rate)})`,
    `broken counted as misses: ${overall.caught}/${overall.conclusive + overall.broken} (${pct(overall.rateWithBroken)})`,
    `broken ${overall.broken}`,
    `excluded ${overall.excluded}`,
  ].join(' · ') + spreadText
  return `## ${candidate}\n\n${rateLine}\n\n${table}\n`
}

export function renderReport(summaries) {
  if (summaries.length === 0) return 'No verdicts yet.\n'
  return summaries.map(renderCandidate).join('\n')
}
