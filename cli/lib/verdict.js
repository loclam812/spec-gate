import { isGreen } from './exec.js'

const BEST_FIRST = ['caught', 'missed', 'inverted', 'broken', 'inconclusive']

export function fileVerdict({ preWith, postWith, preWithout = null, postWithout = null }) {
  if (postWith.timedOut) return 'inconclusive'
  if ([preWithout, postWithout].some((run) => run !== null && !isGreen(run))) return 'inconclusive'
  if (!isGreen(postWith)) return isGreen(preWith) ? 'inverted' : 'broken'
  return isGreen(preWith) ? 'missed' : 'caught'
}

export function sampleVerdict(fileVerdicts) {
  if (fileVerdicts.length === 0) return 'empty'
  return BEST_FIRST.find((verdict) => fileVerdicts.includes(verdict))
}
