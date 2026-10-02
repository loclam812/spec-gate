import { it } from 'node:test'
import assert from 'node:assert/strict'
import { fileVerdict, reportedFileVerdict, sampleVerdict } from '../cli/lib/verdict.js'

const green = { code: 0, timedOut: false }
const red = { code: 1, timedOut: false }
const hung = { code: -1, timedOut: true }

it('fileVerdict follows the replay rules', () => {
  assert.equal(fileVerdict({ preWith: red, postWith: green }), 'caught')
  assert.equal(fileVerdict({ preWith: green, postWith: green }), 'missed')
  assert.equal(fileVerdict({ preWith: green, postWith: red }), 'inverted')
  assert.equal(fileVerdict({ preWith: red, postWith: red }), 'broken')
  assert.equal(fileVerdict({ preWith: red, postWith: hung }), 'inconclusive')
  assert.equal(fileVerdict({ preWith: hung, postWith: green }), 'caught')
})

it('a red control run makes the file inconclusive', () => {
  assert.equal(fileVerdict({ preWith: red, postWith: green, preWithout: red, postWithout: green }), 'inconclusive')
  assert.equal(fileVerdict({ preWith: red, postWith: green, preWithout: green, postWithout: red }), 'inconclusive')
  assert.equal(fileVerdict({ preWith: red, postWith: green, preWithout: green, postWithout: green }), 'caught')
})

it('sampleVerdict takes the best file verdict and reports empty runs', () => {
  assert.equal(sampleVerdict([]), 'empty')
  assert.equal(sampleVerdict(['missed', 'caught']), 'caught')
  assert.equal(sampleVerdict(['inverted', 'missed']), 'missed')
  assert.equal(sampleVerdict(['broken', 'inverted']), 'inverted')
  assert.equal(sampleVerdict(['inconclusive', 'broken']), 'broken')
  assert.equal(sampleVerdict(['inconclusive']), 'inconclusive')
})

const ran = (code, tests) => ({ code, timedOut: false, tests: new Map(Object.entries(tests)) })

it('per-test verdicts judge each new test, so a catch survives a broken neighbour', () => {
  const { verdict, tests } = reportedFileVerdict({
    preWith: ran(1, { TestOld: 'pass', TestDob: 'fail', TestIns: 'fail' }),
    postWith: ran(1, { TestOld: 'pass', TestDob: 'pass', TestIns: 'fail' }),
    preWithout: ran(0, { TestOld: 'pass' }),
    postWithout: ran(0, { TestOld: 'pass' }),
  })
  assert.equal(verdict, 'caught')
  assert.deepEqual(
    tests.map((test) => [test.name, test.pre, test.post, test.verdict]),
    [['TestDob', 'fail', 'pass', 'caught'], ['TestIns', 'fail', 'fail', 'broken']],
  )
})

it('a test missing from one side counts as failing there', () => {
  const { verdict } = reportedFileVerdict({ preWith: ran(2, {}), postWith: ran(0, { TestDob: 'pass' }) })
  assert.equal(verdict, 'caught')
})

it('a file with no reported test on either side is inconclusive: the runner never ran it', () => {
  assert.equal(reportedFileVerdict({ preWith: ran(2, {}), postWith: ran(2, {}) }).verdict, 'inconclusive')
})

it('a timeout after the fix stays inconclusive with per-test reports', () => {
  const hungWithReport = { code: -1, timedOut: true, tests: new Map() }
  assert.equal(reportedFileVerdict({ preWith: ran(1, { TestDob: 'fail' }), postWith: hungWithReport }).verdict, 'inconclusive')
})
