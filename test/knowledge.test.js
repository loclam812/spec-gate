import { it } from 'node:test'
import assert from 'node:assert/strict'
import { findKnowledge, knowledgeErrors, knowledgePaths, section } from '../cli/lib/knowledge.js'
import { KNOWLEDGE_FULL as FULL, tempDir, writeFile } from './helpers.js'

it('the repository file wins over the store file', () => {
  const repo = tempDir()
  const env = { SPEC_GATE_HOME: tempDir() }
  const paths = knowledgePaths(repo, 'shop', env)
  writeFile(env.SPEC_GATE_HOME, 'projects/shop/knowledge.md', FULL.replace('npm test', 'store'))
  assert.equal(findKnowledge(repo, 'shop', env).path, paths.store)
  writeFile(repo, '.claude/testing.md', FULL)
  assert.equal(findKnowledge(repo, 'shop', env).path, paths.repo)
  assert.equal(findKnowledge(tempDir(), 'none', env), null)
})

it('knowledgeErrors names every missing section and a file over 200 lines', () => {
  assert.deepEqual(knowledgeErrors(FULL), [])
  assert.deepEqual(knowledgeErrors('# x\n## Run\nnpm test\n'), [
    'knowledge: missing section "## Where tests go"', 'knowledge: missing section "## Helpers and fixtures"',
    'knowledge: missing section "## Mocking rules"', 'knowledge: missing section "## Known traps"',
    'knowledge: missing section "## Domain terms"',
  ])
  assert.deepEqual(knowledgeErrors(`${FULL}${'x\n'.repeat(200)}`), ['knowledge: keep it under 200 lines (it has 213)'])
  const exactly200 = ['# Testing', '## Run', ...Array(188).fill('x'), '## Where tests go', 'a', '## Helpers and fixtures', 'b', '## Mocking rules', 'c', '## Known traps', 'd', '## Domain terms', 'e'].join('\n') + '\n'
  assert.deepEqual(knowledgeErrors(exactly200), [])
  const exactly201 = exactly200 + 'z\n'
  assert.deepEqual(knowledgeErrors(exactly201), ['knowledge: keep it under 200 lines (it has 201)'])
})

it('section returns one section body', () => {
  assert.equal(section(FULL, 'Domain terms'), '- basket: Cart')
  assert.equal(section('# x\n', 'Domain terms'), '')
})
