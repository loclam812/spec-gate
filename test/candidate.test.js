import { it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { headlessArgs, loadCandidate, PROMPT_FILE, renderPrompt, runCandidate } from '../cli/lib/candidate.js'
import { loadSample } from '../cli/lib/sample.js'
import { changedFiles, prepareWorkspace } from '../cli/lib/workspace.js'
import { CATCHING_TEST, makeFixtureRepo, tempDir, writeFile, writeSample } from './helpers.js'

function stubClaude(script) {
  const bin = tempDir('sg-bin-')
  writeFile(bin, 'claude', `#!/bin/sh\n${script}\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` }
}

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

it('the built-in single-prompt candidate loads with defaults', () => {
  const candidate = loadCandidate('single-prompt', tempDir())
  assert.equal(candidate.model, 'opus')
  assert.equal(candidate.skill_dir, null)
  assert.deepEqual(candidate.allowed_tools, ['Read', 'Grep', 'Glob', 'Edit', 'Write'])
  assert.match(candidate.promptTemplate, /\{\{spec\}\}/)
})

it('a store candidate shadows the built-in one and resolves its skill_dir', () => {
  const root = tempDir()
  writeFile(root, 'candidates/single-prompt/candidate.yaml', 'model: sonnet\nskill_dir: skills/frozen-skill\n')
  writeFile(root, 'candidates/single-prompt/prompt.md', 'Use {{skill}}.')
  const candidate = loadCandidate('single-prompt', root)
  assert.equal(candidate.model, 'sonnet')
  assert.equal(candidate.skill_dir, join(root, 'candidates/single-prompt/skills/frozen-skill'))
})

it('an unknown candidate fails and says where it looked', () => {
  assert.throws(() => loadCandidate('nope', tempDir()), /candidate "nope" not found/)
})

it('renderPrompt fills every occurrence and leaves unknown placeholders', () => {
  assert.equal(renderPrompt('{{a}} {{a}} {{b}}', { a: 'x' }), 'x x {{b}}')
})

it('headless args isolate the run and keep the variadic tool list last', () => {
  const args = headlessArgs({ model: 'opus', allowed_tools: ['Read', 'Write'] })
  assert.equal(args[0], '-p')
  assert.match(args[1], new RegExp(PROMPT_FILE))
  assert.ok(args.includes('--no-session-persistence'))
  assert.ok(args.includes('--strict-mcp-config'))
  assert.equal(args[args.indexOf('--setting-sources') + 1], 'project')
  assert.deepEqual(args.slice(-2), ['--allowedTools', 'Read,Write'])
})

it('runCandidate writes the prompt, copies the frozen skill and keeps the claude output', () => {
  const root = tempDir()
  writeFile(root, 'candidates/with-skill/candidate.yaml', 'skill_dir: skills/frozen-skill\n')
  writeFile(root, 'candidates/with-skill/prompt.md', 'Skill {{skill}}. Spec:\n{{spec}}\nGlobs: {{test_globs}}\n')
  writeFile(root, 'candidates/with-skill/skills/frozen-skill/SKILL.md', '---\nname: frozen-skill\n---\n')
  const generated = join(tempDir(), 'generated.test.js')
  writeFileSync(generated, CATCHING_TEST)
  const env = stubClaude(`mkdir -p test && cp '${generated}' test/total.test.js && echo '{"ok":true}'`)
  const outDir = tempDir()
  runCandidate(loadCandidate('with-skill', root), sample, sides.pre, outDir, env)
  assert.equal(readFileSync(join(outDir, 'generate.json'), 'utf8'), '{"ok":true}\n')
  assert.match(readFileSync(join(outDir, 'prompt.md'), 'utf8'), /^Skill frozen-skill\. Spec:\n### feature\.md/)
  assert.ok(existsSync(join(sides.pre, '.claude/skills/frozen-skill/SKILL.md')))
  assert.ok(changedFiles(sides.pre).includes('test/total.test.js'))
})

it('a failing claude run raises with its exit code and stderr', () => {
  const env = stubClaude('echo quota exceeded >&2; exit 2')
  const candidate = loadCandidate('single-prompt', tempDir())
  assert.throws(() => runCandidate(candidate, sample, sides.pre, tempDir(), env), /claude exited 2: quota exceeded/)
})
