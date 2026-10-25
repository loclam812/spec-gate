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

it('a Go subtest renamed between the trees, under a parent that ran on both, is not a catch', () => {
  const { verdict, tests } = reportedFileVerdict({
    preWith: ran(0, { TestFormat: 'pass', 'TestFormat/got_09:undefined': 'pass' }),
    postWith: ran(0, { TestFormat: 'pass', 'TestFormat/got_09:00': 'pass' }),
  })
  assert.equal(verdict, 'missed')
  assert.deepEqual(tests.map((test) => test.name), ['TestFormat'])
})

it('a Go subtest whose parent did not compile on a side still counts as failing there', () => {
  const { verdict } = reportedFileVerdict({ preWith: ran(2, {}), postWith: ran(0, { TestDob: 'pass', 'TestDob/utc': 'pass' }) })
  assert.equal(verdict, 'caught')
})

it('a file with no reported test on either side is inconclusive: the runner never ran it', () => {
  assert.equal(reportedFileVerdict({ preWith: ran(2, {}), postWith: ran(2, {}) }).verdict, 'inconclusive')
})

it('a timeout after the fix stays inconclusive with per-test reports', () => {
  const hungWithReport = { code: -1, timedOut: true, tests: new Map() }
  assert.equal(reportedFileVerdict({ preWith: ran(1, { TestDob: 'fail' }), postWith: hungWithReport }).verdict, 'inconclusive')
})

it('a catch by a test of an e2e case, run outside a browser, is caught below its layer', () => {
  const { verdict, tests } = reportedFileVerdict({
    preWith: ran(1, { 'C1: opens the detail': 'fail', 'C2: shows the title': 'pass' }),
    postWith: ran(0, { 'C1: opens the detail': 'pass', 'C2: shows the title': 'pass' }),
    e2eCases: ['C1'],
  })
  assert.equal(verdict, 'caught-below-layer')
  assert.deepEqual(tests.map((test) => test.verdict), ['caught-below-layer', 'missed'])
})

it('a catch at its own layer outranks one below it', () => {
  const { verdict } = reportedFileVerdict({
    preWith: ran(1, { 'C1: opens the detail': 'fail', 'C2: shows the title': 'fail' }),
    postWith: ran(0, { 'C1: opens the detail': 'pass', 'C2: shows the title': 'pass' }),
    e2eCases: ['C1'],
  })
  assert.equal(verdict, 'caught')
  assert.equal(sampleVerdict(['caught-below-layer', 'caught']), 'caught')
  assert.equal(sampleVerdict(['missed', 'caught-below-layer']), 'caught-below-layer')
})
