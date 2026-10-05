import { it } from 'node:test'
import assert from 'node:assert/strict'
import { junitFailures, parseReport } from '../cli/lib/reports.js'

it('go-json keeps the final action of each top-level test', () => {
  const output = [
    '{"Action":"run","Test":"TestA"}',
    '{"Action":"fail","Test":"TestA/sub"}',
    '{"Action":"fail","Test":"TestA"}',
    '{"Action":"pass","Test":"TestB"}',
    '{"Action":"skip","Test":"TestC"}',
    'not json',
    '{"Action":"fail","Package":"example.com/x"}',
  ].join('\n')
  assert.deepEqual([...parseReport('go-json', { output, xml: '' })], [
    ['TestA', 'fail'],
    ['TestB', 'pass'],
    ['TestC', 'skip'],
  ])
})

it('junit reads passes, failures, errors, skips and escaped names', () => {
  const xml = [
    '<testsuites><testsuite name="s">',
    '<testcase name="adds &amp; totals" classname="suite"/>',
    '<testcase name="b" classname="suite"><failure message="x"/></testcase>',
    '<testcase name="c"><error/></testcase>',
    '<testcase name="d"><skipped/></testcase>',
    '</testsuite></testsuites>',
  ].join('')
  assert.deepEqual([...parseReport('junit', { output: '', xml })], [
    ['suite > adds & totals', 'pass'],
    ['suite > b', 'fail'],
    ['c', 'fail'],
    ['d', 'skip'],
  ])
})

it('go-json can keep subtests, where a case id often lives', () => {
  const output = [
    '{"Action":"fail","Test":"TestRefund/C1:_rejects_after_the_window"}',
    '{"Action":"fail","Test":"TestRefund"}',
  ].join('\n')
  assert.deepEqual([...parseReport('go-json', { output, xml: '' }, { subtests: true })], [
    ['TestRefund/C1:_rejects_after_the_window', 'fail'],
    ['TestRefund', 'fail'],
  ])
})

it('junitFailures keeps the type, message and body of each failed or errored test', () => {
  const xml = [
    '<testsuites><testsuite name="s">',
    '<testcase name="C1: refuses" classname="refund"><failure type="AssertionError" message="expected 0 to be 1"/></testcase>',
    '<testcase name="C2: loads" classname="refund"><error message="Cannot find module &apos;./missing&apos;"/></testcase>',
    '<testcase name="C3: passes" classname="refund"/>',
    '<testcase name="C4: wraps" classname="refund"><failure type="testCodeFailure" message="Expected values:&#10;+ 1&#x0A;- 2">  Error: a &lt;b&gt;&#10;stack  </failure></testcase>',
    '</testsuite></testsuites>',
  ].join('')
  assert.deepEqual([...junitFailures(xml)], [
    ['refund > C1: refuses', { type: 'AssertionError', message: 'expected 0 to be 1', body: '' }],
    ['refund > C2: loads', { type: '', message: "Cannot find module './missing'", body: '' }],
    ['refund > C4: wraps', { type: 'testCodeFailure', message: 'Expected values:\n+ 1\n- 2', body: 'Error: a <b>\nstack' }],
  ])
})
