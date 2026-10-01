import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { writeJson } from './files.js'
import { answersText, specText } from './sample.js'
import { resetTree } from './workspace.js'

const BUILT_IN = fileURLToPath(new URL('../../candidates', import.meta.url))
const DEFAULTS = {
  prompt: 'prompt.md',
  model: 'opus',
  allowed_tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
  skill_dir: null,
  timeout_s: 1800,
}

export const PROMPT_FILE = 'SPEC_GATE_PROMPT.md'

export function loadCandidate(name, root) {
  const dir = [join(root, 'candidates', name), join(BUILT_IN, name)].find((candidateDir) =>
    existsSync(join(candidateDir, 'candidate.yaml')),
  )
  if (!dir) throw new Error(`candidate "${name}" not found in ${join(root, 'candidates')} or the built-in set`)
  const config = { ...DEFAULTS, ...(parse(readFileSync(join(dir, 'candidate.yaml'), 'utf8')) ?? {}) }
  return {
    ...config,
    name,
    skill_dir: config.skill_dir ? resolve(dir, config.skill_dir) : null,
    promptTemplate: readFileSync(join(dir, config.prompt), 'utf8'),
  }
}

export function renderPrompt(template, vars) {
  return Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, () => value), template)
}

export function headlessArgs(candidate) {
  return [
    '-p',
    `Read ${PROMPT_FILE} in the current directory and follow it exactly.`,
    '--output-format', 'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--permission-mode', 'acceptEdits',
    '--model', candidate.model,
    '--allowedTools', candidate.allowed_tools.join(','),
  ]
}

const PATH_KEYS = ['file_path', 'notebook_path', 'path']

function toolUses(node) {
  if (Array.isArray(node)) return node.flatMap(toolUses)
  if (node === null || typeof node !== 'object') return []
  const own = node.type === 'tool_use' ? [node] : []
  return [...own, ...Object.values(node).flatMap(toolUses)]
}

function parseLines(text) {
  return text.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
}

export function pathsOutside(transcript, root) {
  const roots = [resolve(root), realpathSync(root)]
  const inside = (path) => roots.some((dir) => path === dir || path.startsWith(`${dir}${sep}`))
  return toolUses(parseLines(transcript))
    .flatMap((use) => (use.name === 'Glob' ? [...PATH_KEYS, 'pattern'] : PATH_KEYS).map((key) => use.input?.[key]))
    .filter((value) => typeof value === 'string')
    .map((value) => resolve(root, value))
    .filter((path) => !inside(path))
}

// Hidden trees are made unreadable for the run so the candidate cannot open the fixed code;
// prepareWorkspace restores access if a run dies before the finally block.
function withHidden(paths, run) {
  const modes = paths.filter(existsSync).map((path) => [path, statSync(path).mode & 0o777])
  for (const [path] of modes) chmodSync(path, 0o000)
  try {
    return run()
  } finally {
    for (const [path, mode] of modes) chmodSync(path, mode)
  }
}

export function runCandidate(candidate, sample, preDir, outDir, { env = process.env, hide = [] } = {}) {
  resetTree(preDir)
  const skill = candidate.skill_dir ? basename(candidate.skill_dir) : ''
  if (candidate.skill_dir) {
    cpSync(candidate.skill_dir, join(preDir, '.claude', 'skills', skill), { recursive: true })
  }
  const prompt = renderPrompt(candidate.promptTemplate, {
    spec: specText(sample),
    answers: answersText(sample),
    test_globs: sample.test_globs.join(', '),
    skill,
  })
  writeFileSync(join(preDir, PROMPT_FILE), prompt)
  const result = withHidden(hide, () =>
    spawnSync('claude', headlessArgs(candidate), {
      cwd: preDir,
      env: { ...env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: candidate.timeout_s * 1000,
      maxBuffer: 64 * 1024 * 1024,
    }),
  )
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'prompt.md'), prompt)
  writeFileSync(join(outDir, 'transcript.jsonl'), result.stdout ?? '')
  writeJson(join(outDir, 'leaks.json'), { outside: pathsOutside(result.stdout ?? '', preDir) })
  if (result.status !== 0) {
    const reason = result.status ?? result.error?.code
    throw new Error(`claude exited ${reason}: ${(result.stderr ?? '').slice(-2000)}`)
  }
}
