import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { stringify } from 'yaml'
import { git } from '../cli/lib/exec.js'

const COMMIT = [
  '-c', 'user.name=fixture',
  '-c', 'user.email=fixture@localhost',
  '-c', 'commit.gpgsign=false',
  '-c', 'core.hooksPath=/dev/null',
  'commit', '-q', '-m',
]

export const BUGGY_TOTAL =
  'export function total(items) {\n  return items.reduce((sum, item) => sum + item.price, 0)\n}\n'
export const FIXED_TOTAL =
  'export function total(items) {\n  return items.reduce((sum, item) => sum + item.price * item.qty, 0)\n}\n'

const testFile = (name, body) =>
  `import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { total } from '../src/total.js'\n\ntest('${name}', () => {\n  ${body}\n})\n`

export const CATCHING_TEST = testFile('total multiplies price by quantity', 'assert.equal(total([{ price: 2, qty: 3 }]), 6)')
export const MISSING_TEST = testFile('total of nothing is zero', 'assert.equal(total([]), 0)')
export const BROKEN_TEST = testFile('total is wrong on purpose', 'assert.equal(total([{ price: 1, qty: 1 }]), 99)')
export const HANGING_TEST =
  "import { test } from 'node:test'\n\ntest('hangs', async () => {\n  await new Promise((resolve) => setTimeout(resolve, 3000))\n})\n"

export function tempDir(prefix = 'sg-test-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function writeFile(root, relPath, content) {
  const target = join(root, relPath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

export function commitAll(repo, message) {
  git(repo, ['add', '-A'])
  git(repo, [...COMMIT, message])
  return git(repo, ['rev-parse', 'HEAD'])
}

export function makeFixtureRepo() {
  const repo = tempDir('sg-fixture-')
  git(repo, ['init', '-q', '-b', 'main'])
  writeFile(repo, 'package.json', '{ "type": "module" }\n')
  writeFile(repo, '.gitignore', 'node_modules/\n')
  writeFile(repo, 'src/total.js', BUGGY_TOTAL)
  const preFix = commitAll(repo, 'add total')
  writeFile(repo, 'src/total.js', FIXED_TOTAL)
  const postFix = commitAll(repo, 'fix: multiply by quantity')
  return { repo, preFix, postFix }
}

export function writeSample(parent, fields, options = {}) {
  const spec = options.spec ?? { 'feature.md': 'The order total is the sum of price times quantity.\n' }
  const answers = options.answers === undefined ? 'questions: []\n' : options.answers
  const dir = join(parent, fields.id)
  writeFile(dir, 'sample.yaml', stringify(fields))
  for (const [name, text] of Object.entries(spec)) writeFile(dir, join('spec', name), text)
  if (answers !== null) writeFile(dir, 'answers.yaml', answers)
  return dir
}
