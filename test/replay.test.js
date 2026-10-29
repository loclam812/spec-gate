import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectTests, renderCommand, scoreRun } from '../cli/lib/replay.js'
import { loadSample } from '../cli/lib/sample.js'
import { VERSION } from '../cli/lib/version.js'
import { changedFiles, prepareWorkspace } from '../cli/lib/workspace.js'
import {
  BROKEN_TEST,
  CATCHING_TEST,
  FIXED_TOTAL,
  HANGING_TEST,
  MISSING_TEST,
  commitAll,
  makeFixtureRepo,
  tempDir,
  writeFile,
  writeSample,
} from './helpers.js'

const { repo, preFix, postFix } = makeFixtureRepo()
const sample = loadSample(
  writeSample(tempDir(), {
    id: 'demo-1',
    pre_fix: preFix,
    post_fix: postFix,
    test_command: 'node --test {file}',
    test_globs: ['**/*.test.js'],
  }),
)
const sides = prepareWorkspace(sample, repo, tempDir())

function candidateRun(files, runSample = sample) {
  for (const [path, text] of Object.entries(files)) writeFile(sides.pre, path, text)
  const outDir = tempDir()
  collectTests(runSample, sides.pre, outDir)
  return { outDir, record: scoreRun(runSample, sides, outDir) }
}

it('renderCommand quotes the file and turns a directory into ./dir', () => {
  assert.equal(renderCommand('node --test {file}', 'test/a b.test.js'), "node --test 'test/a b.test.js'")
  assert.equal(renderCommand('go test {dir}', 'pkg/x/a_test.go'), "go test './pkg/x'")
  assert.equal(renderCommand('go test {dir}', 'a_test.go'), "go test '.'")
})

it('a test red before the fix and green after it is caught, and the record names what it ran on', () => {
  const { record } = candidateRun({ 'test/total.test.js': CATCHING_TEST })
  assert.equal(record.verdict, 'caught')
  assert.deepEqual([record.pre_fix, record.post_fix, record.test_command], [preFix, postFix, 'node --test {file}'])
})

it('collect and score stamp the version that ran', () => {
  const { outDir } = candidateRun({ 'test/total.test.js': CATCHING_TEST })
  assert.equal(JSON.parse(readFileSync(join(outDir, 'collected.json'), 'utf8')).version, VERSION)
  assert.equal(JSON.parse(readFileSync(join(outDir, 'verdict.json'), 'utf8')).scored_by, VERSION)
})

it('a test green on both sides is missed', () => {
  assert.equal(candidateRun({ 'test/total.test.js': MISSING_TEST }).record.verdict, 'missed')
})

it('a test red on both sides is broken', () => {
  assert.equal(candidateRun({ 'test/total.test.js': BROKEN_TEST }).record.verdict, 'broken')
})

it('a test that pins the buggy behaviour is inverted', () => {
  const pinsBug = BROKEN_TEST.replace('total([{ price: 1, qty: 1 }]), 99', 'total([{ price: 2, qty: 3 }]), 2')
  assert.equal(candidateRun({ 'test/total.test.js': pinsBug }).record.verdict, 'inverted')
})

it('a run whose candidate read outside its tree is scored but marked leaked', () => {
  writeFile(sides.pre, 'test/total.test.js', CATCHING_TEST)
  const outDir = tempDir()
  collectTests(sample, sides.pre, outDir)
  writeFileSync(join(outDir, 'leaks.json'), JSON.stringify({ outside: ['/elsewhere/fix.js'] }))
  const record = scoreRun(sample, sides, outDir)
  assert.equal(record.verdict, 'leaked')
  assert.deepEqual(record.leaks, ['/elsewhere/fix.js'])
  assert.equal(record.files[0].verdict, 'caught')
})

it('one caught file makes the run caught, and every file keeps its own verdict', () => {
  const { record } = candidateRun({ 'test/a.test.js': MISSING_TEST, 'test/b.test.js': CATCHING_TEST })
  assert.equal(record.verdict, 'caught')
  assert.deepEqual(
    record.files.map((file) => [file.path, file.verdict]),
    [['test/a.test.js', 'missed'], ['test/b.test.js', 'caught']],
  )
})

it('non-test changes no test refers to are kept under ignored/ but never scored', () => {
  const { outDir, record } = candidateRun({
    'ASSUMPTIONS.md': 'Quantity defaults to 1.\n',
    'src/total.js': FIXED_TOTAL,
    'test/total.test.js': MISSING_TEST,
  })
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'collected.json'), 'utf8')), {
    tests: ['test/total.test.js'],
    support: [],
    helpers: [],
    ignored: ['ASSUMPTIONS.md', 'src/total.js'],
    version: VERSION,
  })
  assert.equal(readFileSync(join(outDir, 'ignored', 'ASSUMPTIONS.md'), 'utf8'), 'Quantity defaults to 1.\n')
  assert.equal(readFileSync(join(outDir, 'ignored', 'src/total.js'), 'utf8'), FIXED_TOTAL)
  assert.equal(record.verdict, 'missed')
})

it('a run that writes no test file is empty', () => {
  assert.equal(candidateRun({ 'src/total.js': FIXED_TOTAL }).record.verdict, 'empty')
})

it('collect and score leave both workspaces clean', () => {
  candidateRun({ 'test/total.test.js': CATCHING_TEST })
  assert.deepEqual(changedFiles(sides.pre), [])
  assert.deepEqual(changedFiles(sides.post), [])
})

it('a hanging test is recorded as timed out and is inconclusive', () => {
  const { record } = candidateRun({ 'test/hang.test.js': HANGING_TEST }, { ...sample, timeout_s: 1 })
  assert.equal(record.verdict, 'inconclusive')
  assert.equal(record.files[0].runs.postWith.timedOut, true)
})

const MIXED_TEST = `${CATCHING_TEST}${BROKEN_TEST.split('\n').slice(3).join('\n')}`

it('without a report format a file is judged whole, so a wrong neighbour hides the catch', () => {
  assert.equal(candidateRun({ 'test/total.test.js': MIXED_TEST }).record.verdict, 'broken')
})

it('with a junit report each test is judged, so the catch survives', () => {
  const reported = {
    ...sample,
    test_command: 'node --test --test-reporter=junit --test-reporter-destination=report.xml {file}',
    report: 'junit',
    report_file: 'report.xml',
  }
  const { record } = candidateRun({ 'test/total.test.js': MIXED_TEST }, reported)
  assert.equal(record.verdict, 'caught')
  assert.deepEqual(
    record.files[0].tests.map((test) => test.verdict).sort(),
    ['broken', 'caught'],
  )
})

const HELPER_TEST = CATCHING_TEST.replace(
  "import { total } from '../src/total.js'",
  "import { total } from '../src/total.js'\nimport { LINE } from './support/line.js'",
).replace('total([{ price: 2, qty: 3 }])', 'total([LINE])')
const HELPER = 'export const LINE = { price: 2, qty: 3 }\n'

it('a new helper file a test imports is copied into both sides without support_globs', () => {
  const { outDir, record } = candidateRun({ 'test/total.test.js': HELPER_TEST, 'test/support/line.js': HELPER })
  assert.equal(record.verdict, 'caught')
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'collected.json'), 'utf8')).helpers, ['test/support/line.js'])
})

it('a helper imported through a path alias, and a file that helper imports, are helpers too', () => {
  const aliased = HELPER_TEST.replace("'./support/line.js'", "'@/test-utils/line'")
  const { outDir } = candidateRun({
    'test/total.test.js': aliased,
    'src/test-utils/line.ts': "export { LINE } from './line-data'\n",
    'src/test-utils/line-data.ts': HELPER,
    'SPEC_BLIND.md': 'A line costs price times quantity.\n',
  })
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'collected.json'), 'utf8')), {
    tests: ['test/total.test.js'],
    support: [],
    helpers: ['src/test-utils/line-data.ts', 'src/test-utils/line.ts'],
    ignored: ['SPEC_BLIND.md'],
    version: VERSION,
  })
})

it('a new source file beside a test with the same extension is a helper, as in a Go package', () => {
  const { outDir } = candidateRun({ 'test/total.test.js': MISSING_TEST, 'test/fixture.js': HELPER })
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'collected.json'), 'utf8')).helpers, ['test/fixture.js'])
})

it('a new helper never replaces a file the fix added at the same path', () => {
  const { repo: fixRepo, preFix: before } = makeFixtureRepo()
  writeFile(fixRepo, 'src/line.js', HELPER)
  writeFile(fixRepo, 'src/total.js', FIXED_TOTAL)
  const after = commitAll(fixRepo, 'fix: add line')
  const fixSample = { ...sample, pre_fix: before, post_fix: after }
  const fixSides = prepareWorkspace(fixSample, fixRepo, tempDir())
  const usesLine = HELPER_TEST.replace("'./support/line.js'", "'../src/line.js'")
  writeFile(fixSides.pre, 'test/total.test.js', usesLine)
  writeFile(fixSides.pre, 'src/line.js', 'export const LINE = { price: 1, qty: 1 }\n')
  const outDir = tempDir()
  collectTests(fixSample, fixSides.pre, outDir)
  assert.equal(scoreRun(fixSample, fixSides, outDir).verdict, 'caught')
})

it('support files are copied into every run but never scored', () => {
  const supported = { ...sample, support_globs: ['test/support/**'] }
  const { outDir, record } = candidateRun({ 'test/total.test.js': HELPER_TEST, 'test/support/line.js': HELPER }, supported)
  assert.equal(record.verdict, 'caught')
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'collected.json'), 'utf8')), {
    tests: ['test/total.test.js'],
    support: ['test/support/line.js'],
    helpers: [],
    ignored: [],
    version: VERSION,
  })
})

const SHARED_HELPER_TEST =
  "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { total } from '../src/total.js'\n\nexport const LINE = { price: 2, qty: 3 }\n\ntest('total of nothing is zero', () => {\n  assert.equal(total([]), 0)\n})\n"
const USES_SHARED_HELPER =
  "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { total } from '../src/total.js'\nimport { LINE } from './a.test.js'\n\ntest('a line costs price times quantity', () => {\n  assert.equal(total([LINE]), 6)\n})\n"

it('a test file that imports another collected test file is scored with it present', () => {
  const { record } = candidateRun({ 'test/a.test.js': SHARED_HELPER_TEST, 'test/b.test.js': USES_SHARED_HELPER })
  assert.equal(record.verdict, 'caught')
  assert.deepEqual(
    record.files.map((file) => [file.path, file.verdict]),
    [['test/a.test.js', 'missed'], ['test/b.test.js', 'caught']],
  )
})

it('a neighbour that does not compile takes the whole directory down, so the file is judged alone', () => {
  // Like a Go package: one file that does not build means no test in the directory runs.
  const packaged = {
    ...sample,
    test_command:
      "sh -c 'grep -q DOES_NOT_COMPILE \"$0\"/*.test.js && exit 2; node --test --test-reporter=junit --test-reporter-destination=report.xml \"$0\"/*.test.js' {dir}",
    report: 'junit',
    report_file: 'report.xml',
  }
  const { record } = candidateRun({ 'test/a.test.js': CATCHING_TEST, 'test/b.test.js': '// DOES_NOT_COMPILE\n' }, packaged)
  assert.equal(record.verdict, 'caught')
  assert.deepEqual(
    record.files.map((file) => [file.path, file.verdict, file.alone === true]),
    [['test/a.test.js', 'caught', true], ['test/b.test.js', 'inconclusive', true]],
  )
})

const reportedSample = (command) => ({
  ...sample,
  test_command: `${command}node --test --test-reporter=junit --test-reporter-destination=report.xml {file}`,
  report: 'junit',
  report_file: 'report.xml',
})
const E2E_CASES = 'cases:\n  - { id: C1, layer: e2e }\n  - { id: C2, layer: unit }\n'

function layeredRun(runSample, casesPath) {
  writeFile(sides.pre, 'test/total.test.js', CATCHING_TEST.replace("test('total", "test('C1: total"))
  const outDir = tempDir()
  collectTests(runSample, sides.pre, outDir)
  writeFile(outDir, casesPath, E2E_CASES)
  return scoreRun(runSample, sides, outDir)
}

it('a catch by a test of an e2e case that runs outside a browser is caught below its layer', () => {
  assert.equal(layeredRun(reportedSample(''), 'spec-to-tests/cases.yaml').verdict, 'caught-below-layer')
  assert.equal(layeredRun(reportedSample(''), 'spec-to-tests/part-2/cases.yaml').verdict, 'caught-below-layer')
})

it('a catch by a test of an e2e case that runs in a browser is caught', () => {
  assert.equal(layeredRun(reportedSample(': playwright; '), 'spec-to-tests/cases.yaml').verdict, 'caught')
})
