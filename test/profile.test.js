import { it } from 'node:test'
import assert from 'node:assert/strict'
import { discoverProfile, stackFor } from '../cli/lib/profile.js'
import { commitAll, makeFixtureRepo, writeFile } from './helpers.js'

function fullStackRepo() {
  const { repo } = makeFixtureRepo()
  writeFile(repo, 'go.mod', 'module example.com/shop\n\ngo 1.27\n')
  writeFile(repo, 'web/package.json', JSON.stringify({ devDependencies: { vitest: '4.1.0', '@playwright/test': '1.50.0' } }))
  writeFile(repo, 'pnpm-lock.yaml', 'lockfileVersion: 9\n')
  writeFile(repo, '.claude/skills/spec-to-tests/SKILL.md', '---\nname: spec-to-tests\n---\n')
  writeFile(repo, '.claude/skills/review-changes/SKILL.md', '---\nname: review-changes\n---\n')
  writeFile(repo, '.claude/skills/bug-from-evidence/SKILL.md', '---\nname: bug-from-evidence\n---\n')
  commitAll(repo, 'stack files')
  return repo
}

it('discovers stacks, setup, UI layer and skills from a repository', () => {
  const profile = discoverProfile(fullStackRepo())
  assert.deepEqual(profile.stacks.map((stack) => stack.name), ['go', 'vitest'])
  assert.equal(profile.setup, 'pnpm install --frozen-lockfile --prefer-offline')
  assert.equal(profile.ui_layer, 'playwright')
  assert.deepEqual(profile.skills, {
    test_writing: ['spec-to-tests'],
    review: ['review-changes'],
    bug_fix: ['bug-from-evidence'],
  })
})

it('stackFor picks the stack whose globs match the test file', () => {
  const profile = discoverProfile(fullStackRepo())
  assert.equal(stackFor(profile, 'web/src/refund.test.tsx').name, 'vitest')
  assert.equal(stackFor(profile, 'pkg/refund/refund_test.go').name, 'go')
  assert.equal(stackFor(profile, 'README.md'), null)
})

it('a package whose test script runs node --test gets the node-test stack', () => {
  const { repo } = makeFixtureRepo()
  writeFile(repo, 'package.json', JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }))
  commitAll(repo, 'test script')
  const profile = discoverProfile(repo)
  assert.deepEqual(profile.stacks.map((stack) => stack.name), ['node-test'])
  assert.equal(stackFor(profile, 'test/refund.test.js').report, 'junit')
})

it('a repository with nothing recognisable has no stacks, setup, UI layer or skills', () => {
  const { repo } = makeFixtureRepo()
  assert.deepEqual(discoverProfile(repo), {
    stacks: [],
    setup: null,
    ui_layer: null,
    skills: { test_writing: [], review: [], bug_fix: [] },
  })
})
