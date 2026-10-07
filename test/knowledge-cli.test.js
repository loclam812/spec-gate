import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runKnowledge } from '../cli/tests.js'
import { KNOWLEDGE_FULL, makeFixtureRepo, tempDir, writeFile } from './helpers.js'

function setup() {
  const { repo } = makeFixtureRepo()
  const env = { ...process.env, SPEC_GATE_HOME: tempDir('sg-home-') }
  const run = (...argv) => {
    const chunks = []
    const code = runKnowledge([...argv, '--repo', repo], { env, out: { write: (text) => chunks.push(text) } })
    return { code, json: JSON.parse(chunks.join('')) }
  }
  return { repo, env, run }
}

it('knowledge path says where the file is or where to create it', () => {
  const { repo, run } = setup()
  const missing = run('path').json
  assert.equal(missing.found, false)
  assert.match(missing.repo_path, /\.claude\/testing\.md$/)
  writeFile(repo, '.claude/testing.md', KNOWLEDGE_FULL)
  assert.equal(run('path').json.found, true)
})

it('knowledge check lists missing sections and fails', () => {
  const { repo, run } = setup()
  writeFile(repo, 'draft.md', '# x\n## Run\nnpm test\n')
  const result = run('check', '--file', join(repo, 'draft.md'))
  assert.equal(result.code, 1)
  assert.equal(result.json.errors.length, 5)
})

it('knowledge draft renders the learn-project prompt with the old skill when given', () => {
  const { repo, env, run } = setup()
  writeFile(repo, 'old-skill/SKILL.md', '---\nname: write-tests\n---\nUse renderWithCart().\n')
  const draft = run('draft', '--old-skill', join(repo, 'old-skill')).json
  assert.equal(draft.model, 'sonnet')
  assert.match(readFileSync(draft.prompt_file, 'utf8'), /old-skill\/SKILL\.md/)
  assert.match(draft.output, /knowledge\.draft\.md$/)
  assert.ok(draft.prompt_file.startsWith(env.SPEC_GATE_HOME) && draft.output.startsWith(env.SPEC_GATE_HOME))
})

it('knowledge draft accepts a SKILL.md file as the old skill', () => {
  const { repo, run } = setup()
  writeFile(repo, 'old-skill/SKILL.md', 'Use renderWithCart().\n')
  const draft = run('draft', '--old-skill', join(repo, 'old-skill', 'SKILL.md')).json
  assert.match(readFileSync(draft.prompt_file, 'utf8'), /old-skill\/SKILL\.md/)
})

it('knowledge path names the repository\'s bug-reproduction skill when the file declares one', () => {
  const { repo, run } = setup()
  writeFile(repo, '.claude/testing.md', KNOWLEDGE_FULL)
  assert.equal(run('path').json.bug_skill, null)
  writeFile(repo, '.claude/testing.md', KNOWLEDGE_FULL.replace('## Run\n', '## Run\nBug-reproduction skill: bug-from-evidence\n'))
  assert.equal(run('path').json.bug_skill, 'bug-from-evidence')
})

it('the learn-project prompt asks for the bug-reproduction skill line', () => {
  const { run } = setup()
  assert.match(readFileSync(run('draft').json.prompt_file, 'utf8'), /Bug-reproduction skill: <skill name>/)
})
