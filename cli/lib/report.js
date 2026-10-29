import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { attribute, driverDirs } from './attribution.js'
import { canaryRuling, canaryVerdict } from './canary.js'
import { resultTotals } from './candidate.js'
import { readJson } from './files.js'
import { loadTruth } from './truth.js'

const CONCLUSIVE = ['caught', 'caught-below-layer', 'missed', 'empty', 'inverted']

const listDir = (path) => (existsSync(path) ? readdirSync(path).sort() : [])

export function parseRunName(name) {
  const match = name.match(/^(.+)-(\d+)$/)
  if (!match) throw new Error(`run directory "${name}" is not <candidate>-<n>`)
  return { candidate: match[1], run: Number(match[2]) }
}

function runVersions(runDir, verdict) {
  const collectedPath = join(runDir, 'collected.json')
  const generated = existsSync(collectedPath) ? readJson(collectedPath).version : undefined
  return { ...(generated ? { generated_by: generated } : {}), ...(verdict.scored_by ? { scored_by: verdict.scored_by } : {}) }
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
        .map((name) => {
          const record = readJson(join(runsDir, name, 'verdict.json'))
          return {
            project,
            sample,
            ...parseRunName(name),
            verdict: record.verdict,
            ...runVersions(join(runsDir, name), record),
            ...runTotals(join(runsDir, name)),
          }
        })
    }),
  )
}

// Labels and canaries are read per sample, once: every run of the sample shares them.
export function attributeRecords(records, root) {
  const perSample = new Map()
  const sampleOf = (row) => {
    const key = `${row.project}/${row.sample}`
    const dir = join(root, 'projects', row.project, 'eval', row.sample)
    if (!perSample.has(key)) perSample.set(key, { truth: loadTruth(dir), canary: canaryVerdict(dir), ruling: canaryRuling(dir) })
    return perSample.get(key)
  }
  return records.map((row) => {
    const dir = join(root, 'projects', row.project, 'eval', row.sample, 'runs', `${row.candidate}-${row.run}`)
    const { truth, canary, ruling } = sampleOf(row)
    return {
      ...row,
      bucket: truth?.bucket ?? 'unlabelled',
      ...attribute({ verdict: row.verdict, dir }, truth),
      driver: driverDirs(dir).length > 0,
      canary,
      ...(ruling ? { canaryRuling: ruling } : {}),
    }
  })
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

const countBy = (rows, keyOf) => rows.reduce((counts, row) => ({ ...counts, [keyOf(row)]: (counts[keyOf(row)] ?? 0) + 1 }), {})

function attribution(rows) {
  const grouped = rows.filter((row) => row.group)
  if (grouped.length === 0) return {}
  const driver = grouped.filter((row) => row.driver)
  const misses = driver.filter((row) => row.group !== 'caught')
  // A run that died before QC finished says nothing about what QC asked.
  const gapRuns = driver.filter((row) => row.bucket === 'spec_gap' && !row.group.startsWith('incomplete@'))
  return {
    breakdown: Object.fromEntries(Object.entries(groupBy(grouped, (row) => row.bucket)).map(([bucket, bucketRows]) => [bucket, countBy(bucketRows, (row) => row.group)])),
    layers: driver.length > 0 ? countBy(driver.filter((row) => row.layer), (row) => row.layer) : null,
    explained: driver.length > 0 ? { explained: misses.filter((row) => row.layer !== 'unattributed').length, misses: misses.length } : null,
    gapTouched: gapRuns.length > 0 ? { touched: gapRuns.filter((row) => row.touched).length, runs: gapRuns.length } : null,
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
      cost: cost(rows),
      runs,
      spread: rates.length > 0 ? { min: Math.min(...rates), max: Math.max(...rates) } : null,
      samples,
      versions: {
        generated: countBy(rows, (row) => row.generated_by ?? 'unknown'),
        scored: countBy(rows, (row) => row.scored_by ?? 'unknown'),
      },
      ...attribution(rows),
    }
  })
}

const pct = (value) => (value === null ? 'n/a' : `${Math.round(value * 100)}%`)

const GROUP_ORDER = (group) => (group.startsWith('incomplete@') ? 2 : ['caught', 'missed@done', 'incomplete@', 'broken', 'empty'].indexOf(group))
const LAYERS = ['qc-no-case', 'writer-missed', 'qc-gap-unasked', 'qc-gap-unprobed', 'gap-touched', 'unattributed']
const markdownTable = (header, rows) => [header, header.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n')

function renderAttribution({ breakdown, layers, explained, gapTouched }) {
  if (!breakdown) return ''
  const groups = [...new Set(Object.values(breakdown).flatMap(Object.keys))].sort((a, b) => GROUP_ORDER(a) - GROUP_ORDER(b) || a.localeCompare(b))
  const buckets = ['specified', 'spec_gap', 'unlabelled'].filter((bucket) => breakdown[bucket])
  const parts = [`Breakdown:\n\n${markdownTable(['Bucket', ...groups], buckets.map((bucket) => [bucket, ...groups.map((group) => breakdown[bucket][group] ?? 0)]))}`]
  if (!layers) return `\n\n${[...parts, 'Layers: n/a (not a driver candidate)'].join('\n\n')}`
  const present = LAYERS.filter((layer) => layers[layer])
  if (present.length > 0) parts.push(`Layers of missed@done runs:\n\n${markdownTable(['Layer', 'Runs'], present.map((layer) => [layer, layers[layer]]))}`)
  parts.push(`Explained: ${explained.explained}/${explained.misses} driver misses (${pct(explained.misses > 0 ? explained.explained / explained.misses : null)})`)
  if (gapTouched) parts.push(`spec_gap: QC touched the gap in ${gapTouched.touched}/${gapTouched.runs} runs`)
  if (layers['qc-gap-unprobed']) parts.push('qc-gap-unprobed counts every untouched reality gap: spec-to-tests has no probe step yet.')
  return `\n\n${parts.join('\n\n')}`
}

const versionCounts = (counts) => Object.entries(counts).map(([version, n]) => `${version} ×${n}`).join(', ')

function renderCandidate({ candidate, overall, cost: spent, runs, spread, samples, versions, ...attributed }) {
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
  const versionLine = versions ? `\n\nVersions: generated by ${versionCounts(versions.generated)} · scored by ${versionCounts(versions.scored)}` : ''
  return `## ${candidate}\n\n${rateLine}${costLine}${versionLine}${renderAttribution(attributed)}\n\n${table}\n`
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
  const scoredBy = (name) => [...new Set(records.filter((row) => row.candidate === name && row.scored_by).map((row) => row.scored_by))].sort()
  return { first, second, scoredBy: { [first]: scoredBy(first), [second]: scoredBy(second) }, samples, unpaired: all.filter((sample) => !paired(sample)).map((sample) => sample.key), wins: count(first), losses: count(second), ties: count('tie') }
}

// Scoring changed between versions (0.7.6 copies helpers differently), so a pair scored by two
// versions can differ for reasons that are not the candidates'.
function scoredByWarning(first, second, scoredBy) {
  const [a, b] = [scoredBy?.[first] ?? [], scoredBy?.[second] ?? []]
  if (a.length === 0 || b.length === 0 || a.join() === b.join()) return ''
  return `\n\nScored by different spec-gate versions: ${first} ${a.join(', ')}, ${second} ${b.join(', ')}; rescore both from one checkout.`
}

export function renderPaired({ first, second, scoredBy, samples, unpaired = [], wins, losses, ties }) {
  const header = ['Sample', first, second, 'Better']
  const rows = samples.map((s) => [s.key, `${s.a.caught}/${s.a.conclusive}`, `${s.b.caught}/${s.b.conclusive}`, s.better])
  const table = [header, header.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n')
  const left = unpaired.length > 0 ? `\n\nNot paired (no conclusive run for one of them): ${unpaired.join(', ')}` : ''
  return `## ${first} vs ${second}\n\nOn ${samples.length} paired samples, broken counted as a miss: ${first} catches more on ${wins}, ${second} on ${losses}, tie on ${ties}.${left}${scoredByWarning(first, second, scoredBy)}\n\n${table}\n`
}

export function renderCanaryNote(records) {
  const samplesWith = (verdict) => [...new Set(records.filter((row) => row.canary === verdict).map((row) => `${row.project}/${row.sample}`))]
  const broken = samplesWith('harness-broken')
  const unchecked = samplesWith(null)
  const ruled = [...new Map(records.filter((row) => row.canaryRuling).map((row) => [`${row.project}/${row.sample}`, row.canaryRuling])).entries()]
  const lines = [
    ...(broken.length > 0 ? [`Left out as harness-broken: ${broken.join(', ')}`] : []),
    ...(ruled.length > 0 ? [`Kept by owner ruling: ${ruled.map(([key, reason]) => `${key} (${reason})`).join(', ')}`] : []),
    ...(unchecked.length > 0 ? [`Canary not run on ${unchecked.length} sample(s)`] : []),
  ]
  return lines.length > 0 ? `\n${lines.join('\n')}\n` : ''
}

export function renderReport(summaries) {
  if (summaries.length === 0) return 'No verdicts yet.\n'
  return summaries.map(renderCandidate).join('\n')
}
