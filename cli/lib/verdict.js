import { isGreen } from './exec.js'
import { mentionsId } from './text.js'

const BEST_FIRST = ['caught', 'caught-below-layer', 'missed', 'inverted', 'broken', 'inconclusive']

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

// A Go subtest missing on a side where its parent ran was renamed, not lost to a compile error:
// its name can come from the code under test, so its absence proves nothing.
const renamedOn = (run, name) => {
  const slash = name.indexOf('/')
  return slash > 0 && run.tests?.has(name.slice(0, slash)) === true && !run.tests.has(name)
}

// With a per-test report, the candidate's tests are the ones its file added to the run; a test
// absent from a side (it did not compile there) counts as failing on that side. Control runs only
// separate those tests from the directory's existing ones, they no longer veto the file.
// A test of an e2e case that catches the bug outside a browser proves less than the case asked for.
export function reportedFileVerdict({ preWith, postWith, preWithout = null, postWithout = null, e2eCases = [] }) {
  if (postWith.timedOut) return { verdict: 'inconclusive', tests: [] }
  const existing = new Set([...reported(preWithout), ...reported(postWithout)])
  const names = [...new Set([...reported(preWith), ...reported(postWith)])]
    .filter((name) => !existing.has(name) && !renamedOn(preWith, name) && !renamedOn(postWith, name))
    .sort()
  const tests = names.map((name) => {
    const pre = preWith.tests?.get(name) ?? 'missing'
    const post = postWith.tests?.get(name) ?? 'missing'
    const verdict = outcome(passed(pre), passed(post))
    const belowLayer = verdict === 'caught' && e2eCases.some((id) => mentionsId(name, id))
    return { name, pre, post, verdict: belowLayer ? 'caught-below-layer' : verdict }
  })
  // No test reported on either side means the runner never ran the file (a broken install, a file
  // its config leaves out), which says nothing about the candidate's tests.
  if (tests.length === 0) return { verdict: 'inconclusive', tests }
  return { verdict: BEST_FIRST.find((verdict) => tests.some((test) => test.verdict === verdict)), tests }
}

export function sampleVerdict(fileVerdicts) {
  if (fileVerdicts.length === 0) return 'empty'
  return BEST_FIRST.find((verdict) => fileVerdicts.includes(verdict))
}
