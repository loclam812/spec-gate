import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const EVENTS = 'events.jsonl'

// One line per state change or check, so a later review can see where runs stall or repeat.
export function logEvent(dir, event) {
  appendFileSync(join(dir, EVENTS), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
}

export function readEvents(dir) {
  const path = join(dir, EVENTS)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
}
