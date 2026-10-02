import { it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { headlessArgs, loadCandidate, pathsOutside, PROMPT_FILE, renderPrompt, runCandidate, watchedPaths } from '../cli/lib/candidate.js'
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

it('renderPrompt inserts spec text verbatim, dollar sequences included', () => {
  assert.equal(renderPrompt('<{{spec}}>', { spec: "echo $$ $& $' done" }), "<echo $$ $& $' done>")
})

it('headless args isolate the run and keep the variadic tool list last', () => {
  const args = headlessArgs({ model: 'opus', allowed_tools: ['Read', 'Write'] })
  assert.equal(args[0], '-p')
  assert.match(args[1], new RegExp(PROMPT_FILE))
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json')
  assert.ok(args.includes('--verbose'))
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
  runCandidate(loadCandidate('with-skill', root), sample, sides.pre, outDir, { env })
  assert.equal(readFileSync(join(outDir, 'transcript.jsonl'), 'utf8'), '{"ok":true}\n')
  assert.match(readFileSync(join(outDir, 'prompt.md'), 'utf8'), /^Skill frozen-skill\. Spec:\n### feature\.md/)
  assert.ok(existsSync(join(sides.pre, '.claude/skills/frozen-skill/SKILL.md')))
  assert.ok(changedFiles(sides.pre).includes('test/total.test.js'))
})

it('a failing claude run raises with its exit code and stderr', () => {
  const env = stubClaude('echo quota exceeded >&2; exit 2')
  const candidate = loadCandidate('single-prompt', tempDir())
  assert.throws(() => runCandidate(candidate, sample, sides.pre, tempDir(), { env }), /claude exited 2: quota exceeded/)
})

it('the candidate runs without auto memory and cannot read the hidden fixed tree', () => {
  const env = stubClaude(
    'echo "memory-off=$CLAUDE_CODE_DISABLE_AUTO_MEMORY"; cat ../post/src/total.js >/dev/null 2>&1 && echo post-readable || echo post-denied',
  )
  const outDir = tempDir()
  runCandidate(loadCandidate('single-prompt', tempDir()), sample, sides.pre, outDir, { env, hide: [sides.post] })
  const transcript = readFileSync(join(outDir, 'transcript.jsonl'), 'utf8')
  assert.match(transcript, /memory-off=1/)
  assert.match(transcript, /post-denied/)
  assert.ok(existsSync(join(sides.post, 'src/total.js')))
  assert.equal(readFileSync(join(sides.post, 'src/total.js'), 'utf8').length > 0, true)
})

it('pathsOutside reports tool paths that leave the working tree', () => {
  const root = tempDir()
  const lines = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/total.js' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/elsewhere/fix.js' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Glob', input: { pattern: '../post/**' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'total', path: join(root, 'src') } }] } },
  ]
  const transcript = `${lines.map((line) => JSON.stringify(line)).join('\n')}\nnot json\n`
  assert.deepEqual(pathsOutside(transcript, root), ['/elsewhere/fix.js', join(root, '..', 'post', '**')])
})

it('the candidate gets no stdin to wait on', () => {
  const env = stubClaude('[ -c /dev/stdin ] && echo stdin-null || echo stdin-open')
  const outDir = tempDir()
  runCandidate(loadCandidate('single-prompt', tempDir()), sample, sides.pre, outDir, { env })
  assert.match(readFileSync(join(outDir, 'transcript.jsonl'), 'utf8'), /stdin-null/)
})

it('watchedPaths reports only paths that reach a watched root, not scratch files elsewhere', () => {
  const work = tempDir()
  const root = join(work, 'pre')
  const store = tempDir()
  writeFile(root, 'src/total.js', 'x')
  writeFile(work, 'post/src/total.js', 'y')
  const lines = [
    { type: 'tool_use', name: 'Write', input: { file_path: '/tmp/mutation.sh' } },
    { type: 'tool_use', name: 'Read', input: { file_path: '../post/src/total.js' } },
    { type: 'tool_use', name: 'Glob', input: { pattern: '**/*', path: join(store, 'projects') } },
    { type: 'tool_use', name: 'Read', input: { file_path: 'src/total.js' } },
  ]
  const transcript = lines.map((line) => JSON.stringify({ type: 'assistant', message: { content: [line] } })).join('\n')
  assert.deepEqual(watchedPaths(transcript, root, [join(work, 'post'), store]), [
    join(work, 'post', 'src', 'total.js'),
    join(store, 'projects'),
  ])
})

it('a spec-writing candidate gets the feature pointer and neither spec nor answers', () => {
  const root = tempDir()
  writeFile(root, 'candidates/blind/candidate.yaml', 'needs_spec: false\napplies_to: []\n')
  writeFile(root, 'candidates/blind/prompt.md', 'Feature: {{feature}}\nSpec: [{{spec}}]\nAnswers: [{{answers}}]\n')
  const bare = { ...sample, feature: 'order totals on the checkout page', dir: tempDir() }
  const outDir = tempDir()
  runCandidate(loadCandidate('blind', root), bare, sides.pre, outDir, { env: stubClaude('exit 0') })
  assert.equal(readFileSync(join(outDir, 'prompt.md'), 'utf8'), 'Feature: order totals on the checkout page\nSpec: []\nAnswers: []\n')
})

it('the built-in spec-gate candidate is driven, not prompted, and may run every supported runner', () => {
  const candidate = loadCandidate('spec-gate', tempDir())
  assert.equal(candidate.driver, 'spec-gate')
  assert.equal(candidate.timeout_s, 1800)
  for (const tool of ['Bash(npx vitest:*)', 'Bash(go test:*)', 'Bash(npx playwright:*)']) {
    assert.ok(candidate.allowed_tools.includes(tool), tool)
  }
})
