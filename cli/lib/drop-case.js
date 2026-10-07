import { appendFileSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { readJson, writeJson } from './files.js'
import { changedSince, hashFiles } from './run-tests.js'
import { logEvent } from './run-log.js'
import { mentionsId } from './text.js'

const at = (run, name) => join(run.dir, name)
const list = (value) => (Array.isArray(value) ? value : [])
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')

export function withoutCase(doc, id, reason) {
  const sentences = list(doc.sentences).map((sentence) => {
    const cases = list(sentence.cases).filter((caseId) => caseId !== id)
    if (cases.length === list(sentence.cases).length) return sentence
    const { cases: _, ...rest } = sentence
    return cases.length > 0 ? { ...sentence, cases } : { ...rest, non_testable: `every case was dropped (${id}: ${reason})` }
  })
  return { ...doc, sentences, cases: list(doc.cases).filter((c) => c.id !== id) }
}

// Only guarded files whose guarded copy held the dropped case are re-guarded, so dropping a case
// never blesses an unrelated edit to a test file.
function reguard(run, guard, id) {
  const held = changedSince(run.repo, guard).filter((file) => mentionsId(readText(at(run, join('guard', file))), id))
  const kept = held.filter((file) => existsSync(join(run.repo, file)))
  for (const file of kept) cpSync(join(run.repo, file), at(run, join('guard', file)))
  for (const file of held.filter((file) => !kept.includes(file))) rmSync(at(run, join('guard', file)))
  const remaining = Object.fromEntries(Object.entries(guard).filter(([file]) => !held.includes(file) || kept.includes(file)))
  writeJson(at(run, 'guard.json'), { ...remaining, ...hashFiles(run.repo, kept) })
  return held
}

export function dropCase(run, { id, reason }) {
  if (run.state.step !== 'done') throw new Error(`drop: run ${run.state.id} is at step ${run.state.step}; a case is dropped after its tests are written`)
  if (!reason?.trim()) throw new Error('drop: give the reason with --reason "<why the case cannot hold>"')
  const doc = parse(readFileSync(at(run, 'cases.yaml'), 'utf8'))
  if (!list(doc.cases).some((c) => c.id === id)) throw new Error(`drop: no case ${id} in this run`)
  const guard = readJson(at(run, 'guard.json'))
  const holder = Object.keys(guard).find((file) => mentionsId(readText(join(run.repo, file)), id))
  if (holder) throw new Error(`drop: remove the test for ${id} from ${holder} first`)
  writeFileSync(at(run, 'cases.yaml'), stringify(withoutCase(doc, id, reason.trim())))
  appendFileSync(at(run, 'decisions.md'), `- Dropped ${id} after the tests were written: ${reason.trim()}\n`)
  const reguarded = reguard(run, guard, id)
  logEvent(run.dir, { kind: 'drop', case: id })
  return { dropped: id, reguarded }
}
