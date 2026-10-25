import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resultTotals } from './candidate.js'
import { readJson } from './files.js'

const CONCLUSIVE = ['caught', 'caught-below-layer', 'missed', 'empty', 'inverted']

const listDir = (path) => (existsSync(path) ? readdirSync(path).sort() : [])

export function parseRunName(name) {
  const match = name.match(/^(.+)-(\d+)$/)
  if (!match) throw new Error(`run directory "${name}" is not <candidate>-<n>`)
  return { candidate: match[1], run: Number(match[2]) }
}

function runTotals(runDir) {
  const path = join(runDir, 'transcript.jsonl')
  return existsSync(path) ? resultTotals(readFileSync(path, 'utf8')) : {}
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
          ...runTotals(join(runsDir, name)),
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
  const belowLayer = conclusive.filter((row) => row.verdict === 'caught-below-layer').length
  const broken = rows.filter((row) => row.verdict === 'broken').length
  const withBroken = conclusive.length + broken
  return {
    caught,
    conclusive: conclusive.length,
    belowLayer,
    broken,
    excluded: rows.length - withBroken,
    rate: conclusive.length > 0 ? caught / conclusive.length : null,
    rateWithBroken: withBroken > 0 ? caught / withBroken : null,
  }
}

function cost(rows) {
  const priced = rows.filter((row) => typeof row.usd === 'number')
  const totalUsd = priced.reduce((sum, row) => sum + row.usd, 0)
  const totalMs = priced.reduce((sum, row) => sum + (row.ms ?? 0), 0)
  return priced.length === 0
    ? null
    : { measured: priced.length, totalUsd, usdPerRun: totalUsd / priced.length, minutesPerRun: totalMs / priced.length / 60000 }
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
      cost: cost(rows),
      runs,
      spread: rates.length > 0 ? { min: Math.min(...rates), max: Math.max(...rates) } : null,
      samples,
    }
  })
}

const pct = (value) => (value === null ? 'n/a' : `${Math.round(value * 100)}%`)

function renderCandidate({ candidate, overall, cost: spent, runs, spread, samples }) {
  const runNumbers = Array.from({ length: Math.max(...runs.map((run) => run.run)) }, (_, index) => index + 1)
  const header = ['Sample', ...runNumbers.map((n) => `Run ${n}`)]
  const rows = samples.map((sample) => [sample.key, ...runNumbers.map((n) => sample.byRun[n] ?? '—')])
  const table = [header, header.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n')
  const spreadText = spread ? ` · spread across runs ${pct(spread.min)}–${pct(spread.max)}` : ''
  const rateLine = [
    `Catch rate: ${overall.caught}/${overall.conclusive} (${pct(overall.rate)})`,
    ...(overall.belowLayer > 0 ? [`caught below their layer ${overall.belowLayer}`] : []),
    `broken counted as misses: ${overall.caught}/${overall.conclusive + overall.broken} (${pct(overall.rateWithBroken)})`,
    `broken ${overall.broken}`,
    `excluded ${overall.excluded}`,
  ].join(' · ') + spreadText
  const costLine = spent
    ? `\n\nCost: $${spent.usdPerRun.toFixed(2)} per run, $${spent.totalUsd.toFixed(2)} in total over ${spent.measured} measured runs · ${Math.round(spent.minutesPerRun)} min per run`
    : ''
  return `## ${candidate}\n\n${rateLine}${costLine}\n\n${table}\n`
}

// A catch rate over a handful of samples hides which bugs each candidate caught; comparing the
// two on the same samples shows whether one is better or the difference is noise.
export function comparePaired(records, first, second) {
  // broken counts as a miss here: a candidate that writes wrong tests must not win on fewer runs.
  const tally = (rows) => ({
    caught: rows.filter((row) => row.verdict === 'caught').length,
    conclusive: rows.filter((row) => CONCLUSIVE.includes(row.verdict) || row.verdict === 'broken').length,
  })
  const all = Object.entries(groupBy(records, (row) => `${row.project}/${row.sample}`))
    .map(([key, rows]) => ({ key, a: tally(rows.filter((row) => row.candidate === first)), b: tally(rows.filter((row) => row.candidate === second)) }))
  const paired = (sample) => sample.a.conclusive > 0 && sample.b.conclusive > 0
  const samples = all
    .filter(paired)
    .map((sample) => {
      const diff = sample.a.caught / sample.a.conclusive - sample.b.caught / sample.b.conclusive
      return { ...sample, better: diff > 0 ? first : diff < 0 ? second : 'tie' }
    })
  const count = (name) => samples.filter((sample) => sample.better === name).length
  return { first, second, samples, unpaired: all.filter((sample) => !paired(sample)).map((sample) => sample.key), wins: count(first), losses: count(second), ties: count('tie') }
}

export function renderPaired({ first, second, samples, unpaired = [], wins, losses, ties }) {
  const header = ['Sample', first, second, 'Better']
  const rows = samples.map((s) => [s.key, `${s.a.caught}/${s.a.conclusive}`, `${s.b.caught}/${s.b.conclusive}`, s.better])
  const table = [header, header.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n')
  const left = unpaired.length > 0 ? `\n\nNot paired (no conclusive run for one of them): ${unpaired.join(', ')}` : ''
  return `## ${first} vs ${second}\n\nOn ${samples.length} paired samples, broken counted as a miss: ${first} catches more on ${wins}, ${second} on ${losses}, tie on ${ties}.${left}\n\n${table}\n`
}

export function renderReport(summaries) {
  if (summaries.length === 0) return 'No verdicts yet.\n'
  return summaries.map(renderCandidate).join('\n')
}
