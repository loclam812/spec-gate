import { it } from 'node:test'
import assert from 'node:assert/strict'
import { parseReport } from '../cli/lib/reports.js'

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
