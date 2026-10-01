import { isGreen } from './exec.js'

export function fileVerdict({ preWith, postWith, preWithout = null, postWithout = null }) {
  if (!isGreen(postWith)) return 'inconclusive'
  if ([preWithout, postWithout].some((run) => run !== null && !isGreen(run))) return 'inconclusive'
  return isGreen(preWith) ? 'missed' : 'caught'
}

export function sampleVerdict(fileVerdicts) {
  if (fileVerdicts.length === 0) return 'empty'
  if (fileVerdicts.includes('caught')) return 'caught'
  if (fileVerdicts.includes('missed')) return 'missed'
  return 'inconclusive'
}
