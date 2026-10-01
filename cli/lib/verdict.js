import { isGreen } from './exec.js'

const BEST_FIRST = ['caught', 'missed', 'inverted', 'broken', 'inconclusive']

function outcome(preGreen, postGreen) {
  if (!postGreen) return preGreen ? 'inverted' : 'broken'
  return preGreen ? 'missed' : 'caught'
}

export function fileVerdict({ preWith, postWith, preWithout = null, postWithout = null }) {
  if (postWith.timedOut) return 'inconclusive'
  if ([preWithout, postWithout].some((run) => run !== null && !isGreen(run))) return 'inconclusive'
  return outcome(isGreen(preWith), isGreen(postWith))
}

const reported = (run) => (run?.tests ? [...run.tests.keys()] : [])
const passed = (status) => status === 'pass' || status === 'skip'

// With a per-test report, the candidate's tests are the ones its file added to the run; a test
// absent from a side (it did not compile there) counts as failing on that side. Control runs only
// separate those tests from the directory's existing ones, they no longer veto the file.
export function reportedFileVerdict({ preWith, postWith, preWithout = null, postWithout = null }) {
  if (postWith.timedOut) return { verdict: 'inconclusive', tests: [] }
  const existing = new Set([...reported(preWithout), ...reported(postWithout)])
  const names = [...new Set([...reported(preWith), ...reported(postWith)])].filter((name) => !existing.has(name)).sort()
  const tests = names.map((name) => {
    const pre = preWith.tests?.get(name) ?? 'missing'
    const post = postWith.tests?.get(name) ?? 'missing'
    return { name, pre, post, verdict: outcome(passed(pre), passed(post)) }
  })
  if (tests.length === 0) return { verdict: 'broken', tests }
  return { verdict: BEST_FIRST.find((verdict) => tests.some((test) => test.verdict === verdict)), tests }
}

export function sampleVerdict(fileVerdicts) {
  if (fileVerdicts.length === 0) return 'empty'
  return BEST_FIRST.find((verdict) => fileVerdicts.includes(verdict))
}
