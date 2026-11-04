import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hasCases, junitFailures, parseReport, reportFailures, reportFiles, trxFailures, trxFiles } from '../cli/lib/reports.js'

it('go-json keeps the final action of each test and subtest', () => {
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
    ['TestA/sub', 'fail'],
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

it('junitFailures reads a failure body wrapped in CDATA as plain text', () => {
  const xml = '<testsuite><testcase classname="a.spec.ts" name="C1: x"><failure message="a.spec.ts:3:5 C1: x"><![CDATA[Error: expect(locator).toHaveText("<b> & c") failed]]></failure></testcase></testsuite>'
  assert.equal(junitFailures(xml).get('a.spec.ts > C1: x').body, 'Error: expect(locator).toHaveText("<b> & c") failed')
})

const trx = (framework) => readFileSync(new URL(`fixtures/trx/${framework}.trx`, import.meta.url), 'utf8')
const FRAMEWORKS = ['xunit', 'nunit', 'mstest']

for (const framework of FRAMEWORKS) {
  it(`trx from ${framework} reads every result under its class, one name per data row`, () => {
    const results = parseReport('trx', { xml: trx(framework) })
    assert.equal(results.size, 5)
    assert.deepEqual([...results.values()].sort(), ['fail', 'fail', 'pass', 'pass', 'skip'])
    assert.equal(results.get('CalcTests > Adds'), 'pass')
    assert.equal(results.get('CalcTests > Subtracts'), 'fail')
    assert.equal(results.get('CalcTests > Divides'), 'skip')
    const rows = [...results.keys()].filter((name) => name.startsWith('CalcTests > Doubles'))
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map((name) => results.get(name)).sort(), ['fail', 'pass'])
  })

  it(`trxFailures from ${framework} keeps the message and stack trace of each failed test`, () => {
    const failures = trxFailures(trx(framework))
    assert.equal(failures.size, 2)
    const subtracts = failures.get('CalcTests > Subtracts')
    assert.ok(subtracts.message.length > 0)
    assert.match(subtracts.body, /CalcTests\.cs/)
    assert.deepEqual(reportFailures('trx', trx(framework))['CalcTests > Subtracts'], subtracts)
  })

  it(`trxFiles from ${framework} maps each failed test to its source file from the stack trace`, () => {
    const files = trxFiles(trx(framework))
    assert.equal(files.size, 2)
    for (const file of files.values()) assert.equal(file, `/repo/test/fixtures/dotnet/${framework}/CalcTests.cs`)
    assert.deepEqual(reportFiles('trx', trx(framework)), files)
  })
}

it('a TRX outcome of Timeout is a failure typed as a timeout', () => {
  const xml = trx('xunit').replace(/(testName="Calc\.Tests\.CalcTests\.Subtracts"[^>]*?)outcome="Failed"/, '$1outcome="Timeout"')
  assert.equal(parseReport('trx', { xml }).get('CalcTests > Subtracts'), 'fail')
  assert.equal(trxFailures(xml).get('CalcTests > Subtracts').type, 'timeout')
})

it('hasCases tells a report with results from an empty one, per format', () => {
  assert.equal(hasCases('trx', '<TestRun/>'), false)
  assert.equal(hasCases('trx', trx('nunit')), true)
  assert.equal(hasCases('junit', '<testsuites/>'), false)
  assert.equal(hasCases('junit', '<testcase name="a"/>'), true)
  assert.deepEqual(reportFailures('go-json', ''), {})
  assert.equal(reportFiles('go-json', '').size, 0)
})

it('a CRLF report parses the same as LF', () => {
  const crlf = (text) => text.replaceAll('\n', '\r\n')
  const junit = '<testsuites>\n<testsuite name="s">\n<testcase name="b" classname="suite">\n<failure message="x" type="AssertionError">expected 1\nto be 2</failure>\n</testcase>\n</testsuite>\n</testsuites>\n'
  assert.deepEqual([...parseReport('junit', { output: '', xml: crlf(junit) })], [...parseReport('junit', { output: '', xml: junit })])
  assert.deepEqual(reportFailures('junit', crlf(junit)), reportFailures('junit', junit))
  for (const framework of ['xunit', 'nunit', 'mstest']) {
    const xml = trx(framework).replaceAll('\r\n', '\n')
    assert.deepEqual([...parseReport('trx', { xml: crlf(xml) })], [...parseReport('trx', { xml })])
    assert.deepEqual(reportFailures('trx', crlf(xml)), reportFailures('trx', xml))
    assert.deepEqual(reportFiles('trx', crlf(xml)), reportFiles('trx', xml))
  }
  const goJson = '{"Action":"pass","Test":"TestA"}\n{"Action":"fail","Test":"TestB"}\n'
  assert.deepEqual([...parseReport('go-json', { output: crlf(goJson), xml: '' })], [...parseReport('go-json', { output: goJson, xml: '' })])
})
