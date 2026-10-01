import { it } from 'node:test'
import assert from 'node:assert/strict'
import { fileVerdict, sampleVerdict } from '../cli/lib/verdict.js'

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
